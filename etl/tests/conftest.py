import pytest
from etl.config import DATABASE_URL
from sqlalchemy import create_engine, text


def _banco_disponivel() -> bool:
    try:
        with create_engine(DATABASE_URL).connect() as conexao:
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
