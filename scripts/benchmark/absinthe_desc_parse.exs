#
# Parse Absinthe schema .ex files (AST only — no compile, no deps) and emit a
# JSON array of field records: {file, type, field, has_description}.
# has_description = inline `description:` opt OR preceding `@desc` attribute OR
# a `description "..."` call inside the field's do-block.
# Usage:  elixir absinthe_desc_parse.exs <list_file>
#   <list_file> = newline-separated .ex paths (already filtered to Absinthe modules).

defmodule AbsintheDescParse do
  # Denominator = object / input_object fields + root operation fields (spec §2).
  # `interface` is intentionally excluded: implementing objects re-declare the
  # interface's fields, so counting the interface block too double-counts the
  # same logical field. (Rare `import_fields(:an_interface)` cases would then be
  # a small conservative undercount — acceptable vs. systematic double-counting.)
  @containers [:object, :input_object]
  @roots [:query, :mutation, :subscription]

  def run([list_file]) do
    files =
      list_file |> File.read!() |> String.split("\n", trim: true) |> Enum.map(&String.trim/1)

    files |> Enum.flat_map(&parse_file/1) |> encode() |> IO.puts()
  end

  def run(_), do: IO.puts("[]")

  defp parse_file(file) do
    with {:ok, src} <- File.read(file),
         {:ok, ast} <- Code.string_to_quoted(src) do
      ast |> walk(nil) |> Enum.map(&Map.put(&1, "file", file))
    else
      _ -> []
    end
  end

  # defmodule wrapper -> descend into body
  defp walk({:defmodule, _, [_alias, [do: body]]}, type), do: walk(body, type)

  # object/input_object/interface :name do ... end -> fields with type = name
  defp walk({macro, _, [name, [do: body]]}, _type) when macro in @containers do
    fields_in_block(body, label(name))
  end

  # query/mutation/subscription do ... end -> root fields, type = macro name
  defp walk({macro, _, [[do: body]]}, _type) when macro in @roots do
    fields_in_block(body, to_string(macro))
  end

  # statement block -> walk each child
  defp walk({:__block__, _, stmts}, type), do: Enum.flat_map(stmts, &walk(&1, type))

  # any other node with a do-block -> descend (defensive; e.g. wrappers)
  defp walk({_, _, args}, type) when is_list(args) do
    case last_kw(args) do
      nil -> []
      kw -> case Keyword.get(kw, :do) do
              nil -> []
              body -> walk(body, type)
            end
    end
  end

  defp walk(_, _), do: []

  # Iterate a container/root block IN ORDER, tracking a pending @desc.
  defp fields_in_block(body, type) do
    stmts =
      case body do
        {:__block__, _, s} -> s
        nil -> []
        other -> [other]
      end

    {records, _pending} =
      Enum.reduce(stmts, {[], false}, fn stmt, {acc, pending} ->
        cond do
          desc_attr?(stmt) ->
            {acc, true}

          field?(stmt) ->
            rec = %{
              "type" => type,
              "field" => label(field_name(stmt)),
              "has_description" => pending or inline_desc?(stmt)
            }
            {[rec | acc], false}

          true ->
            {acc, false}
        end
      end)

    Enum.reverse(records)
  end

  defp desc_attr?({:@, _, [{:desc, _, [_]}]}), do: true
  defp desc_attr?(_), do: false

  defp field?({:field, _, args}) when is_list(args), do: true
  defp field?(_), do: false

  defp field_name({:field, _, [name | _]}), do: name
  defp field_name(_), do: :unknown

  # A type/field name is usually an atom, but Absinthe metaprogramming can make it
  # an AST node (e.g. `object unquote(name) do`, `field unquote(f), :t`). Those are
  # real public fields and must still be counted — never crash on to_string/1 of a
  # tuple. Collapse any non-literal name to "(dynamic)" for grouping; the record
  # count (the denominator) is unaffected.
  defp label(name) when is_atom(name), do: to_string(name)
  defp label(name) when is_binary(name), do: name
  defp label(_), do: "(dynamic)"

  # inline description: keyword-list arg with :description, OR a description
  # call inside the field's do-block.
  defp inline_desc?({:field, _, args}) do
    kw_desc?(args) or block_desc?(args)
  end

  defp kw_desc?(args) do
    args |> Enum.filter(&kwlist?/1) |> Enum.any?(&Keyword.has_key?(&1, :description))
  end

  defp kwlist?(x), do: is_list(x) and Keyword.keyword?(x)

  defp block_desc?(args) do
    case last_kw(args) do
      nil -> false
      kw ->
        case Keyword.get(kw, :do) do
          nil -> false
          body -> block_has_description_call?(body)
        end
    end
  end

  defp block_has_description_call?(body) do
    stmts =
      case body do
        {:__block__, _, s} -> s
        other -> [other]
      end

    Enum.any?(stmts, fn
      {:description, _, [_]} -> true
      _ -> false
    end)
  end

  defp last_kw(args) do
    case List.last(args) do
      kw when is_list(kw) -> if Keyword.keyword?(kw), do: kw, else: nil
      _ -> nil
    end
  end

  # --- minimal JSON encoder (no deps) ---
  defp encode(records) do
    "[" <> (records |> Enum.map(&encode_record/1) |> Enum.join(",")) <> "]"
  end

  defp encode_record(r) do
    ~s({"file":#{jstr(r["file"])},"type":#{jstr(r["type"])},"field":#{jstr(r["field"])},"has_description":#{r["has_description"]}})
  end

  defp jstr(s) do
    escaped =
      s |> to_string() |> String.replace("\\", "\\\\") |> String.replace("\"", "\\\"")

    "\"" <> escaped <> "\""
  end
end

AbsintheDescParse.run(System.argv())
