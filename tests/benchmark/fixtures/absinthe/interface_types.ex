# Interface blocks are NOT part of the C2 denominator (spec §2): implementing
# objects re-declare these fields, so counting the interface too double-counts.
# The parser must emit ZERO records for a standalone interface block.
defmodule MyApp.Schema.InterfaceTypes do
  use Absinthe.Schema.Notation

  @desc "A node"
  interface :node do
    field :id, :id
    field :name, :string
  end
end
