"""Teste unitário da leitura do CSV do SP156.

O CSV é `cp1252` e mistura hífen comum com travessão (inclusive o byte solto
`\\x96` de exportações antigas) no campo `Serviço`; sem `normalizar_traco`, o
mesmo serviço apareceria com textos diferentes e não bateria com
`CATEGORIAS`. Este teste escreve um CSV sintético em `cp1252` com quatro
linhas — uma com travessão, uma com hífen comum, uma sem coordenada e uma
fora da área piloto — e verifica que `ler` descarta só a sem coordenada, e
que o filtro de área descarta também a de fora do piloto.
"""

import requests
from etl.sp156 import (
    URL_CSV_FALLBACK,
    _chave_periodo,
    _dentro_da_area_piloto,
    descobrir_url,
    ler,
)

CABECALHO = (
    "Data de Abertura;Data de Finalização;Assunto;Serviço;Status;"
    "Latitude;Longitude;Distrito\n"
)

# ponto dentro da área piloto de Ipiranga (-46.625,-23.605,-46.590,-23.575)
LAT_DENTRO, LON_DENTRO = "-23,590", "-46,610"
# bem longe das três áreas piloto (Vila Mariana, Lapa, Ipiranga)
LAT_FORA, LON_FORA = "-23,000", "-46,000"

# marcador substituído pelo byte cru 0x96 depois de codificar em cp1252 —
# não dá pra colocar o byte 0x96 direto numa `str` do Python (ele decodifica
# para o caractere U+2013, que reencodificaria para o próprio 0x96, então o
# marcador evita confundir esse caminho de ida e volta com o teste).
_MARCADOR_TRAVESSAO = "<TRAVESSAO_0X96>"


def _escrever_csv(caminho, linhas: list[str]) -> None:
    conteudo = CABECALHO + "".join(linhas)
    bruto = conteudo.encode("cp1252").replace(
        _MARCADOR_TRAVESSAO.encode("cp1252"), b"\x96"
    )
    caminho.write_bytes(bruto)


def test_ler_normaliza_traco_e_descarta_so_sem_coordenada(tmp_path):
    caminho = tmp_path / "sp156.csv"
    _escrever_csv(
        caminho,
        [
            # travessão (\x96, byte solto do cp1252), dentro do piloto
            f"01/04/2026;02/04/2026;Calçadas;Cal{_MARCADOR_TRAVESSAO}ada danificada;Aberto;{LAT_DENTRO};{LON_DENTRO};Ipiranga\n",
            # hífen comum, dentro do piloto
            f"01/04/2026;;Calçadas;Tapa-buraco;Aberto;{LAT_DENTRO};{LON_DENTRO};Ipiranga\n",
            # sem coordenada — `ler` deve descartar
            "01/04/2026;;Calçadas;Tapa-buraco;Aberto;;;Ipiranga\n",
            # com coordenada, mas fora das três áreas piloto
            f"01/04/2026;;Calçadas;Tapa-buraco;Aberto;{LAT_FORA};{LON_FORA};Sé\n",
        ],
    )

    df = ler(caminho)

    assert len(df) == 3
    assert df.loc[0, "Serviço"] == "Cal - ada danificada"
    assert df.loc[1, "Serviço"] == "Tapa-buraco"


def test_filtro_de_area_descarta_o_que_esta_fora_do_piloto(tmp_path):
    caminho = tmp_path / "sp156.csv"
    _escrever_csv(
        caminho,
        [
            f"01/04/2026;02/04/2026;Calçadas;Cal{_MARCADOR_TRAVESSAO}ada danificada;Aberto;{LAT_DENTRO};{LON_DENTRO};Ipiranga\n",
            f"01/04/2026;;Calçadas;Tapa-buraco;Aberto;{LAT_DENTRO};{LON_DENTRO};Ipiranga\n",
            "01/04/2026;;Calçadas;Tapa-buraco;Aberto;;;Ipiranga\n",
            f"01/04/2026;;Calçadas;Tapa-buraco;Aberto;{LAT_FORA};{LON_FORA};Sé\n",
        ],
    )

    df = ler(caminho)
    df_no_piloto = _dentro_da_area_piloto(df)

    assert len(df_no_piloto) == 2


def test_chave_periodo_reconhece_trimestre_e_semestre():
    assert _chave_periodo("Dados do SP156 - 2º TRI 2026") == 2026.25
    assert _chave_periodo("Dados do SP156 - 1º TRI 2026") == 2026.0
    assert _chave_periodo("Dados do SP156 - 2° SEM 2014") == 2014.5
    assert _chave_periodo("Avaliação dos Canais - 2025") is None


class _RespostaCkanFalsa:
    def __init__(self, corpo: dict):
        self._corpo = corpo

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._corpo


def _recurso(
    nome: str, url: str, formato: str = "CSV", last_modified: str = "2020-01-01"
) -> dict:
    return {"name": nome, "url": url, "format": formato, "last_modified": last_modified}


def test_descobrir_url_prefere_periodo_do_nome_a_last_modified(monkeypatch):
    """Reproduz uma inconsistência real do CKAN da prefeitura (confirmada em
    14/09/2026): um recurso de 2021 pode ter `last_modified` mais recente do
    que o trimestre atual, por causa de uma edição manual de metadado — por
    isso `descobrir_url` não pode confiar cegamente em `last_modified`."""
    recursos = [
        _recurso(
            "Dados do SP156 - 2º TRI 2021",
            "https://exemplo/2021.csv",
            last_modified="2026-08-10T17:29:39",
        ),
        _recurso(
            "Dados do SP156 - 2º TRI 2026",
            "https://exemplo/2026.csv",
            last_modified="2026-08-10T17:20:14",
        ),
        _recurso(
            "Avaliação dos Canais - 2025",
            "https://exemplo/canais.csv",
            last_modified="2026-09-01T00:00:00",
        ),
    ]
    corpo = {"result": {"resources": recursos}}
    monkeypatch.setattr(
        "etl.sp156.requests.get", lambda *args, **kwargs: _RespostaCkanFalsa(corpo)
    )

    assert descobrir_url() == "https://exemplo/2026.csv"


def test_descobrir_url_cai_no_fallback_se_ckan_nao_responder(monkeypatch):
    def _falha(*args, **kwargs):
        raise requests.RequestException("boom")

    monkeypatch.setattr("etl.sp156.requests.get", _falha)

    assert descobrir_url() == URL_CSV_FALLBACK
