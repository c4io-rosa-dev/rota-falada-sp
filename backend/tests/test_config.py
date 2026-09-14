from app.config import normalizar_url_banco, parsear_origens


def test_origens_separadas_por_virgula():
    assert parsear_origens("https://a.workers.dev, http://localhost:5173") == [
        "https://a.workers.dev",
        "http://localhost:5173",
    ]


def test_origens_em_json_continuam_aceitas():
    assert parsear_origens('["https://a.workers.dev","http://localhost:5173"]') == [
        "https://a.workers.dev",
        "http://localhost:5173",
    ]


def test_origens_vazias_e_espacos_sao_ignorados():
    assert parsear_origens(" , https://a.workers.dev ,, ") == ["https://a.workers.dev"]
    assert parsear_origens("") == []


def test_url_do_banco_ganha_driver_psycopg():
    assert (
        normalizar_url_banco("postgresql://u:p@host:5432/db")
        == "postgresql+psycopg://u:p@host:5432/db"
    )
    assert normalizar_url_banco("postgres://u:p@host/db") == "postgresql+psycopg://u:p@host/db"


def test_url_do_banco_ja_correta_nao_muda():
    assert (
        normalizar_url_banco("postgresql+psycopg://u:p@host/db")
        == "postgresql+psycopg://u:p@host/db"
    )
