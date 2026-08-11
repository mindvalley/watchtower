defmodule Fixture.Swagger.NoDescController do
  use PhoenixSwagger

  swagger_path :index do
    get("/api/things")
    response(200, "OK")
  end
end
