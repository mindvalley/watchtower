# Absinthe metaprogramming: object/field names produced by `unquote(...)` parse
# to AST tuples, not atoms. The parser must count these fields, not crash on
# to_string/1 of a tuple. (Regression: a real production schema uses this.)
defmodule MyApp.Schema.DynamicTypes do
  use Absinthe.Schema.Notation

  object unquote(:payload) do
    field :ok, :boolean
    field unquote(:dyn_field), :string, description: "dynamic field"
  end
end
