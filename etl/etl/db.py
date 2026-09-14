"""Acesso ao banco compartilhado com o backend: engine e registro de execuções.

O esquema (tabelas oficiais e `etl_execucao`) é criado pelas migrations do
Alembic do backend (`backend/alembic/versions/002_fontes_oficiais.py`); este
módulo só lê/grava linhas.
"""

from sqlalchemy import Engine, create_engine, text

from etl.config import DATABASE_URL


def engine() -> Engine:
    return create_engine(DATABASE_URL, pool_pre_ping=True)


def fonte_id(engine: Engine, chave: str) -> int:
    """Devolve o id de `fonte_dados` correspondente à `chave` (ex.: 'osm')."""
    with engine.connect() as conexao:
        resultado = conexao.execute(
            text("SELECT id FROM fonte_dados WHERE chave = :chave"), {"chave": chave}
        ).scalar_one()
    return resultado


def registrar_execucao(engine: Engine, fonte: str) -> int:
    """Insere uma linha `executando` em `etl_execucao` e devolve o id."""
    with engine.begin() as conexao:
        return conexao.execute(
            text(
                """
                INSERT INTO etl_execucao (fonte, inicio, status)
                VALUES (:fonte, now(), 'executando')
                RETURNING id
                """
            ),
            {"fonte": fonte},
        ).scalar_one()


def concluir_execucao(
    engine: Engine,
    id: int,
    status: str,
    linhas: int | None = None,
    esperado: int | None = None,
    detalhe: str | None = None,
) -> None:
    """Marca a execução `id` como concluída (`status` = 'ok' ou 'erro')."""
    with engine.begin() as conexao:
        conexao.execute(
            text(
                """
                UPDATE etl_execucao
                SET fim = now(), status = :status, linhas = :linhas,
                    esperado = :esperado, detalhe = :detalhe
                WHERE id = :id
                """
            ),
            {
                "id": id,
                "status": status,
                "linhas": linhas,
                "esperado": esperado,
                "detalhe": detalhe,
            },
        )
