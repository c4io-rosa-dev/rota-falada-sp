from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente e do .env da raiz do repositório."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade"
    cors_origins: list[str] = ["http://localhost:5173"]
    use_fixtures: bool = False
    sptrans_token: str | None = None
    ors_api_key: str | None = None


settings = Settings()
