defmodule Fixture.Swagger.ProductController do
  use PhoenixSwagger

  defmacro swagger() do
    quote do
      def update_path do
        swagger_path :update do
          put("/api/products/{id}")
          summary("Updates a product")
          description("<b>Updates a product</b>")

          parameters do
            id(:path, :string, "Product ID", required: true)
            product(:body, Schema.ref(:ProductFormData), "Body for updating product", required: true)
            flag(:query, :boolean, "")
          end

          response(200, "OK", Schema.ref(:ProductResponse))
        end
      end
    end
  end
end
