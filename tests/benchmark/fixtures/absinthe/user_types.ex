defmodule MyApp.Schema.UserTypes do
  use Absinthe.Schema.Notation

  @desc "A registered user"
  object :user do
    field :id, :id
    @desc "The user's email"
    field :email, :string
    field :name, :string, description: "Display name"

    field :bio, :string do
      description "Free-text biography"
    end
  end

  input_object :user_filter do
    field :active, :boolean
  end
end
