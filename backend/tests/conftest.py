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


def _dados_carregados() -> bool:
    """O ETL do Plano 2 já populou o grafo? No CI só as migrations rodam."""
    try:
        with create_engine(settings.database_url).connect() as conexao:
            total = conexao.execute(text("SELECT count(*) FROM via_pedestre")).scalar_one()
        return total > 0
    except Exception:
        return False


def pytest_collection_modifyitems(config, items):
    if not _banco_disponivel():
        pular = pytest.mark.skip(
            reason="banco indisponível em DATABASE_URL; rode docker compose up -d"
        )
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(pular)
        return
    if not _dados_carregados():
        pular = pytest.mark.skip(
            reason="ETL não carregado (via_pedestre vazia); rode o Plano 2 antes"
        )
        for item in items:
            if "dados_reais" in item.keywords:
                item.add_marker(pular)
