"""Ponto de entrada do ETL: `python -m etl.cli <fonte>`.

Cada subcomando roda uma fonte isolada; `tudo` roda as quatro em sequência
(implementado na Task 7, junto com o orquestrador que continua mesmo se uma
fonte falhar). Por enquanto (Task 2) só o parser existe: os módulos de cada
fonte chegam nas Tasks 3 a 6.
"""

import argparse
import sys

FONTES = ["osm", "geosampa", "sp156", "gtfs", "tudo"]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m etl.cli",
        description="ETL das fontes oficiais do Rota Falada SP.",
    )
    subparsers = parser.add_subparsers(dest="fonte", required=True)
    subparsers.add_parser("osm", help="grafo de pedestres do OpenStreetMap")
    subparsers.add_parser("geosampa", help="calçadas do GeoSampa (WFS)")
    subparsers.add_parser("sp156", help="reclamações do SP156 (CKAN)")
    subparsers.add_parser("gtfs", help="paradas e linhas do GTFS da SPTrans")
    subparsers.add_parser("tudo", help="roda as quatro fontes em sequência")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)

    if args.fonte == "osm":
        from etl.db import engine
        from etl.osm import executar

        print(executar(engine()))
    elif args.fonte == "geosampa":
        from etl.db import engine
        from etl.geosampa import executar

        print(executar(engine()))
    elif args.fonte == "sp156":
        from etl.db import engine
        from etl.sp156 import executar

        print(executar(engine()))
    elif args.fonte == "gtfs":
        from etl.db import engine
        from etl.gtfs import executar

        print(executar(engine()))
    elif args.fonte == "tudo":
        raise NotImplementedError("orquestrador 'tudo' chega na Task 7")

    return 0


if __name__ == "__main__":
    sys.exit(main())
