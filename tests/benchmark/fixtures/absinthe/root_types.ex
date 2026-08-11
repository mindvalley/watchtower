defmodule MyApp.Schema.Queries do
  use Absinthe.Schema.Notation

  query do
    @desc "List all users"
    field :users, list_of(:user)

    field :user, :user do
      arg :id, non_null(:id)
    end
  end
end
