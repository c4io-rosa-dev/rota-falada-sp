"""Utilidades geométricas: bbox, projeção métrica e comprimento de vias.

O banco guarda tudo em EPSG:4326 (lon/lat), mas comprimento e área precisam
de uma projeção métrica; o projeto usa SIRGAS 2000 / UTM 23S (EPSG:31983),
que cobre a Região Metropolitana de São Paulo.
"""

from pyproj import Transformer
from shapely.geometry import LineString, Polygon, box

PROJ_31983 = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True)


def bbox_para_poligono(bbox: tuple[float, float, float, float]) -> Polygon:
    """Converte uma bbox (oeste, sul, leste, norte) em um `Polygon` 4326."""
    oeste, sul, leste, norte = bbox
    return box(oeste, sul, leste, norte)


def comprimento_m(linestring_4326: LineString) -> float:
    """Comprimento em metros de uma `LineString` em EPSG:4326.

    Reprojeta os vértices para EPSG:31983 (métrico) antes de medir.
    """
    coords_31983 = [PROJ_31983.transform(x, y) for x, y in linestring_4326.coords]
    return LineString(coords_31983).length
