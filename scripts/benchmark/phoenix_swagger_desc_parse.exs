#
# Parse phoenix_swagger .ex files (AST only — no compile, no deps) and emit a
# JSON array of records: {file, kind, name, has_description}.
#   kind = "operation" | "parameter" | "property"
#   operation   -> swagger_path <name> do ... end; described if a non-empty
#                  summary("..") or description("..") call is in the block.
#   parameter   -> a call inside a parameters do ... end block; described if the
#                  description positional (3rd arg: after location, type) is a
#                  non-empty string literal.
#   property    -> a call inside a properties do ... end block (within
#                  swagger_schema); described if the description positional
#                  (2nd arg: after type) is a non-empty string literal.
# Type-level swagger_schema title/description are NOT counted (mirrors the
# GraphQL facet excluding type-level descriptions). swagger_path/swagger_schema
# may be quote-nested inside defmacro/def — the walk descends into every block.
# Usage:  elixir phoenix_swagger_desc_parse.exs <list_file>
#
defmodule PhoenixSwaggerDescParse do
  def run([list_file]) do
    list_file
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.flat_map(&parse_file/1)
    |> encode()
    |> IO.puts()
  end

  def run(_), do: IO.puts("[]")

  defp parse_file(file) do
    with {:ok, src} <- File.read(file),
         {:ok, ast} <- Code.string_to_quoted(src) do
      ast |> walk() |> Enum.map(&Map.put(&1, "file", file))
    else
      _ -> []
    end
  end

  # swagger_path <name> do BODY end  -> one operation + its parameters.
  defp walk({:swagger_path, _, args}) when is_list(args) do
    name = args |> Enum.at(0) |> label()
    body = do_block(args)
    op = %{"kind" => "operation", "name" => name, "has_description" => op_described?(body)}
    [op | params_in(body)]
  end

  # swagger_schema do BODY end -> properties only (title/description excluded).
  defp walk({:swagger_schema, _, args}) when is_list(args) do
    props_in(do_block(args))
  end

  # Statement block: walk each child statement.
  defp walk({:__block__, _, stmts}), do: Enum.flat_map(stmts, &walk/1)

  # Any other 3-tuple node: descend only into its do-block (not the arg list) to
  # avoid double-visiting nodes already consumed by the swagger_path/swagger_schema
  # clauses above. Must come AFTER the __block__ clause so __block__ nodes are
  # correctly expanded rather than treated as a generic node.
  defp walk({_, _, args}) when is_list(args) do
    case do_block(args) do
      nil -> []
      body -> walk(body)
    end
  end

  defp walk(list) when is_list(list), do: Enum.flat_map(list, &walk/1)
  defp walk({a, b}), do: walk(a) ++ walk(b)
  defp walk(_), do: []

  # --- operation description: summary("..") or description("..") in the block
  defp op_described?(nil), do: false
  defp op_described?(body) do
    body |> stmts() |> Enum.any?(fn
      {:summary, _, [s]} -> nonempty_string?(s)
      {:description, _, [s]} -> nonempty_string?(s)
      _ -> false
    end)
  end

  # --- parameters do ... end within an operation body
  defp params_in(nil), do: []
  defp params_in(body) do
    body
    |> stmts()
    |> Enum.flat_map(fn
      {:parameters, _, pargs} when is_list(pargs) ->
        pargs |> do_block() |> stmts() |> Enum.flat_map(&param_record/1)
      _ -> []
    end)
  end

  # a parameter call: name(location, type, "desc", opts). description = 3rd arg.
  defp param_record({name, _, cargs}) when is_atom(name) and is_list(cargs) do
    [%{"kind" => "parameter", "name" => to_string(name), "has_description" => nonempty_string?(Enum.at(cargs, 2))}]
  end
  defp param_record(_), do: []

  # --- properties do ... end within a swagger_schema body
  defp props_in(nil), do: []
  defp props_in(body) do
    body
    |> stmts()
    |> Enum.flat_map(fn
      {:properties, _, pargs} when is_list(pargs) ->
        pargs |> do_block() |> stmts() |> Enum.flat_map(&prop_record/1)
      _ -> []
    end)
  end

  # a property call: name(type, "desc", opts). description = 2nd arg.
  defp prop_record({name, _, cargs}) when is_atom(name) and is_list(cargs) do
    [%{"kind" => "property", "name" => to_string(name), "has_description" => nonempty_string?(Enum.at(cargs, 1))}]
  end
  defp prop_record(_), do: []

  # --- helpers
  defp do_block(args) when is_list(args) do
    case List.last(args) do
      kw when is_list(kw) -> if Keyword.keyword?(kw), do: Keyword.get(kw, :do), else: nil
      _ -> nil
    end
  end
  defp do_block(_), do: nil

  defp stmts({:__block__, _, s}), do: s
  defp stmts(nil), do: []
  defp stmts(other), do: [other]

  defp nonempty_string?(s) when is_binary(s), do: String.trim(s) != ""
  defp nonempty_string?(_), do: false

  defp label(name) when is_atom(name), do: to_string(name)
  defp label(name) when is_binary(name), do: name
  defp label(_), do: "(dynamic)"

  # --- minimal JSON encoder (no deps) ---
  defp encode(records), do: "[" <> (records |> Enum.map(&encode_record/1) |> Enum.join(",")) <> "]"

  defp encode_record(r) do
    ~s({"file":#{jstr(r["file"])},"kind":#{jstr(r["kind"])},"name":#{jstr(r["name"])},"has_description":#{r["has_description"]}})
  end

  defp jstr(s) do
    escaped = s |> to_string() |> String.replace("\\", "\\\\") |> String.replace("\"", "\\\"")
    "\"" <> escaped <> "\""
  end
end

PhoenixSwaggerDescParse.run(System.argv())
