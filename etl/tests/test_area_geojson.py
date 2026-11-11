"""GeoJSON da área coberta, usado como `--region` no `pmtiles extract`
(scripts/mapa/LEIAME.md). Sem banco e sem rede."""

import json
import subprocess
import sys
from itertools import pairwise
from pathlib import Path

import pytest

from etl.area_geojson import area_geojson, main
from etl.config import AREA_PILOTO

DIR_ETL = Path(__file__).resolve().parent.parent


def _area_com_sinal(anel):
    """Fórmula do laço (shoelace): positiva quando o anel é anti-horário."""
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in pairwise(anel)) / 2


@pytest.fixture
def feature():
    return area_geojson(AREA_PILOTO)


def test_e_um_feature_multipolygon(feature):
    assert feature["type"] == "Feature"
    assert feature["geometry"]["type"] == "MultiPolygon"
    assert isinstance(feature["properties"], dict)


def test_um_poligono_por_recorte(feature):
    poligonos = feature["geometry"]["coordinates"]
    assert len(AREA_PILOTO) == 7
    assert len(poligonos) == 7
    for poligono in poligonos:
        assert len(poligono) == 1  # só o anel externo, sem buracos


def test_anel_de_cinco_pontos_fechado_e_anti_horario(feature):
    for (anel,) in feature["geometry"]["coordinates"]:
        assert len(anel) == 5
        assert anel[0] == anel[-1]
        assert _area_com_sinal(anel) > 0


def test_limites_iguais_aos_da_area_piloto_em_lon_lat(feature):
    for (anel,), bbox in zip(feature["geometry"]["coordinates"], AREA_PILOTO.values()):
        lons = [ponto[0] for ponto in anel]
        lats = [ponto[1] for ponto in anel]
        assert (min(lons), min(lats), max(lons), max(lats)) == bbox
        # [lon, lat]: em São Paulo a longitude fica perto de -46 e a latitude de -23
        assert all(-47 < lon < -46 for lon in lons)
        assert all(-24 < lat < -23 for lat in lats)


def test_nao_altera_a_entrada():
    area = {"A": (-46.7, -23.6, -46.6, -23.5)}
    copia = dict(area)
    area_geojson(area)
    assert area == copia


def test_main_grava_json_valido(tmp_path):
    saida = tmp_path / "area.geojson"
    assert main([str(saida)]) == 0
    lido = json.loads(saida.read_text(encoding="utf-8"))
    assert lido == area_geojson(AREA_PILOTO)


def test_main_sem_argumento_falha(capsys):
    assert main([]) == 2
    assert "uso" in capsys.readouterr().err.lower()


def test_modulo_roda_com_python_m(tmp_path):
    saida = tmp_path / "sub" / "area.geojson"
    resultado = subprocess.run(
        [sys.executable, "-m", "etl.area_geojson", str(saida)],
        cwd=DIR_ETL,
        capture_output=True,
        text=True,
        check=False,
    )
    assert resultado.returncode == 0, resultado.stderr
    assert (
        json.loads(saida.read_text(encoding="utf-8"))["geometry"]["type"]
        == "MultiPolygon"
    )
