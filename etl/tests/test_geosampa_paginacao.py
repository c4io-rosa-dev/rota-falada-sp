"""Teste unitário da paginação do WFS do GeoSampa.

O WFS devolve HTTP 200 mesmo quando trunca o resultado (por exemplo, se o
`sortBy` não for estável entre páginas); por isso `paginar` só pode ser
considerado correto se ele detectar quando a soma de `numberReturned` não
bate com `numberMatched`, em vez de assumir que uma página menor que `count`
é sempre a última.
"""

import pytest

from etl.geosampa import TruncamentoWFS, paginar

BBOX_TESTE = (-46.625, -23.605, -46.590, -23.575)


class _RespostaFalsa:
    def __init__(self, corpo: dict):
        self._corpo = corpo

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._corpo


class _SessaoFalsa:
    """Simula `requests.Session`: devolve uma resposta por chamada de `get`,
    na ordem configurada, e registra os parâmetros de cada chamada."""

    def __init__(self, paginas: list[dict]):
        self._paginas = list(paginas)
        self.chamadas: list[dict] = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.chamadas.append(params)
        return _RespostaFalsa(self._paginas.pop(0))


def _pagina(ids: list[str], number_matched: int) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"id": valor}} for valor in ids],
        "numberMatched": number_matched,
        "numberReturned": len(ids),
    }


def test_paginar_junta_todas_as_paginas_quando_soma_bate(monkeypatch):
    monkeypatch.setattr("etl.geosampa.time.sleep", lambda segundos: None)
    sessao = _SessaoFalsa([_pagina(["a", "b"], 3), _pagina(["c"], 3)])

    feicoes = list(paginar(BBOX_TESTE, count=2, sessao=sessao))

    assert [f["properties"]["id"] for f in feicoes] == ["a", "b", "c"]
    assert len(sessao.chamadas) == 2
    assert sessao.chamadas[0]["startIndex"] == 0
    assert sessao.chamadas[1]["startIndex"] == 2
    assert sessao.chamadas[0]["sortBy"] == "cd_identificador_calcada"
    assert sessao.chamadas[0]["count"] == 2


def test_paginar_levanta_truncamento_quando_soma_nao_bate(monkeypatch):
    monkeypatch.setattr("etl.geosampa.time.sleep", lambda segundos: None)
    sessao = _SessaoFalsa([_pagina(["a", "b"], 4), _pagina(["c"], 4)])

    with pytest.raises(TruncamentoWFS):
        list(paginar(BBOX_TESTE, count=2, sessao=sessao))
