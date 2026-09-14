from app.config import parsear_origens


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
