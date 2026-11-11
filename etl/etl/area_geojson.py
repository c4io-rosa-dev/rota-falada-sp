"""GeoJSON da área coberta, para recortar o mapa da navegação guiada.

Gera um Feature MultiPolygon com um retângulo por recorte de `AREA_PILOTO`
(`etl/etl/config.py`), no formato que o `pmtiles extract --region=` aceita.
Os passos completos estão em `scripts/mapa/LEIAME.md`.

Uso (a partir de `etl/`):

    python -m etl.area_geojson ../scripts/mapa/area.geojson

Só biblioteca padrão. Não acessa a rede nem o banco.
"""

import json
import sys
from pathlib import Path

from etl.config import AREA_PILOTO

Caixa = tuple[float, float, float, float]  # oeste, sul, leste, norte


def _anel(caixa: Caixa) -> list[list[float]]:
    """Anel de 5 pontos `[lon, lat]`, fechado e anti-horário (regra do GeoJSON,
    RFC 7946, seção 3.1.6): sudoeste, sudeste, nordeste, noroeste, sudoeste."""
    oeste, sul, leste, norte = caixa
    return [[oeste, sul], [leste, sul], [leste, norte], [oeste, norte], [oeste, sul]]


def area_geojson(area: dict[str, Caixa]) -> dict:
    """Um polígono por recorte, na ordem de `area`. Não altera a entrada."""
    return {
        "type": "Feature",
        "properties": {"nome": "Rota Falada SP: área coberta", "recortes": list(area)},
        "geometry": {
            "type": "MultiPolygon",
            "coordinates": [[_anel(caixa)] for caixa in area.values()],
        },
    }


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("uso: python -m etl.area_geojson <saida.geojson>", file=sys.stderr)
        return 2
    saida = Path(argv[0])
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(
        json.dumps(area_geojson(AREA_PILOTO), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"gravado: {saida} ({len(AREA_PILOTO)} recortes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
