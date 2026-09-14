import json

from pydantic_settings import BaseSettings, SettingsConfigDict


def parsear_origens(valor: str) -> list[str]:
    """Aceita JSON (["a","b"]) ou lista separada por vírgulas (a, b), ignorando vazios."""
    texto = valor.strip()
    if not texto:
        return []
    if texto.startswith("["):
        return [str(item).strip() for item in json.loads(texto) if str(item).strip()]
    return [parte.strip() for parte in texto.split(",") if parte.strip()]


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente e do .env da raiz do repositório."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://postgres:dev@localhost:5433/acessibilidade"
    # string crua para não exigir JSON no painel do Render; ver cors_origins_lista
    cors_origins: str = "http://localhost:5173"
    use_fixtures: bool = False
    sptrans_token: str | None = None
    ors_api_key: str | None = None
    ors_base_url: str = "https://api.openrouteservice.org"
    ors_timeout_s: float = 15.0

    @property
    def cors_origins_lista(self) -> list[str]:
        return parsear_origens(self.cors_origins)


settings = Settings()
