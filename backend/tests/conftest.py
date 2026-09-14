import pytest
from sqlalchemy import create_engine, text

from app.config import settings


def _banco_disponivel() -> bool:
    try:
        with create_engine(settings.database_url).connect() as conexao:
            conexao.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def pytest_collection_modifyitems(config, items):
    if _banco_disponivel():
        return
    pular = pytest.mark.skip(reason="banco indisponível em DATABASE_URL; rode docker compose up -d")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(pular)
