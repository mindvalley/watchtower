defmodule Fixture.Swagger.Schemas.Product do
  import PhoenixSwagger

  def product_schema do
    swagger_schema do
      title("Product")
      description("A product in the catalogue")

      properties do
        id(:integer, "ID")
        name(:string, "Product Name")
        slug(:string)
      end

      example(%{"id" => 1})
    end
  end
end
