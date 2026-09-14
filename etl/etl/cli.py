"""Ponto de entrada do ETL: `python -m etl.cli <fonte>`.

Cada subcomando roda uma fonte isolada; `tudo` roda as cinco em sequência
(osm, geosampa, sp156, gtfs e, por último, conflacao).
Cada fonte já registra sua própria linha em `etl_execucao` (inclusive em caso
de erro, dentro do próprio `executar`) e relança a exceção; o orquestrador
`tudo` captura essa exceção fonte a fonte para que uma falha não impeça as
demais de rodar, e devolve o código de saída 1 se alguma delas falhou.
"""

import argparse
import sys
from typing import Any

from etl.config import BUFFER_CONFLACAO_M, METODO_CONFLACAO

FONTES = ["osm", "geosampa", "sp156", "gtfs", "conflacao", "tudo"]


def _engine_para_tudo():
    from etl.db import engine

    return engine()


def _executar_osm(engine) -> dict:
    from etl.osm import executar

    return executar(engine)


def _executar_geosampa(engine) -> dict:
    from etl.geosampa import executar

    return executar(engine)


def _executar_sp156(engine) -> dict:
    from etl.sp156 import executar

    return executar(engine)


def _executar_gtfs(engine) -> dict:
    from etl.gtfs import executar

    return executar(engine)


def _executar_conflacao(engine, buffer_m: float, metodo: str) -> dict:
    from etl.conflacao import executar

    return executar(engine, buffer_m=buffer_m, metodo=metodo)


def _executar_conflacao_tudo(engine) -> dict:
    """Roda a conflação com o buffer e o método fixados pela calibração
    (Plano 3, Task 3: `BUFFER_CONFLACAO_M`/`METODO_CONFLACAO` em
    `etl/config.py`), não os padrões (sobrepostos) do subcomando `conflacao`."""
    from etl.conflacao import executar

    return executar(engine, buffer_m=BUFFER_CONFLACAO_M, metodo=METODO_CONFLACAO)


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
    conflacao = subparsers.add_parser(
        "conflacao", help="liga via_pedestre (OSM) a calcada_sp (GeoSampa)"
    )
    conflacao.add_argument(
        "--buffer",
        type=float,
        default=BUFFER_CONFLACAO_M,
        help=f"buffer em metros (padrão: {BUFFER_CONFLACAO_M}, calibrado na Task 3 do Plano 3)",
    )
    conflacao.add_argument(
        "--metodo",
        choices=["mesmo_lado", "mais_proximo"],
        default=METODO_CONFLACAO,
        help=f"regra de desempate (padrão: {METODO_CONFLACAO})",
    )
    subparsers.add_parser(
        "tudo", help="roda osm, geosampa, sp156, gtfs e conflacao em sequência"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)

    if args.fonte == "osm":
        print(_executar_osm(_engine_para_tudo()))
    elif args.fonte == "geosampa":
        print(_executar_geosampa(_engine_para_tudo()))
    elif args.fonte == "sp156":
        print(_executar_sp156(_engine_para_tudo()))
    elif args.fonte == "gtfs":
        print(_executar_gtfs(_engine_para_tudo()))
    elif args.fonte == "conflacao":
        print(_executar_conflacao(_engine_para_tudo(), args.buffer, args.metodo))
    elif args.fonte == "tudo":
        return _tudo()

    return 0


def _tudo() -> int:
    """Roda osm → geosampa → sp156 → gtfs → conflacao em sequência. Cada
    fonte já grava sua própria linha de erro em `etl_execucao` antes de
    relançar a exceção; aqui só continuamos para a próxima fonte e marcamos a
    saída como falha. A conflação roda por último (depende de via_pedestre e
    calcada_sp, carregadas pelas duas primeiras fontes) com o buffer e o
    método fixados pela calibração (`BUFFER_CONFLACAO_M`/`METODO_CONFLACAO`
    em `etl/config.py`, Plano 3 Task 3), não os padrões do subcomando
    isolado — hoje os mesmos valores, mas isso pode divergir no futuro."""
    motor = _engine_para_tudo()
    passos: list[tuple[str, Any]] = [
        ("osm", _executar_osm),
        ("geosampa", _executar_geosampa),
        ("sp156", _executar_sp156),
        ("gtfs", _executar_gtfs),
        ("conflacao", _executar_conflacao_tudo),
    ]
    houve_erro = False
    for nome, executar in passos:
        try:
            resultado = executar(motor)
        except Exception as exc:  # noqa: BLE001 — segue para a próxima fonte
            houve_erro = True
            print(f"{nome}: ERRO — {exc}", file=sys.stderr)
        else:
            print(f"{nome}: {resultado}")
    return 1 if houve_erro else 0


if __name__ == "__main__":
    sys.exit(main())
