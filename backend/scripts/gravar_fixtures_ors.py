"""Grava fixtures reais do ORS em backend/app/fixtures/ors/ a partir dos casos de referência.

Uso (com o venv do backend ativado, a partir de backend/):
    python scripts/gravar_fixtures_ors.py

Só funciona se ORS_API_KEY estiver definida (no .env da raiz). Nunca imprime a chave.
Faz poucas requisições (uma por caso de referência) respeitando o limite de 40/min do ORS
(aguarda entre chamadas). As respostas são gravadas com o mesmo nome de arquivo que
OrsFixtureClient usa para escolher fixtures exatas (coordenadas arredondadas a 5 casas +
inclinação), então elas passam a ser servidas automaticamente pelo modo USE_FIXTURES.

Se backend/tests/casos_referencia.json ainda não existir (Task 6 do plano de roteamento),
usa um pequeno conjunto de coordenadas do piloto embutido abaixo.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ_BACKEND))

from app.config import settings  # noqa: E402
from app.services.ors_client import EstadoCota, OrsClient, OrsErro, _nome_fixture  # noqa: E402

DIRETORIO_FIXTURES = RAIZ_BACKEND / "app" / "fixtures" / "ors"
CAMINHO_CASOS_REFERENCIA = RAIZ_BACKEND / "tests" / "casos_referencia.json"

# Usado apenas se tests/casos_referencia.json (Task 6) ainda não existir.
CASOS_PADRAO = [
    {
        "nome": "vila_mariana_curta",
        "origem": {"lat": -23.58930, "lng": -46.63890},
        "destino": {"lat": -23.58878, "lng": -46.63810},
    },
    {
        "nome": "vila_mariana_media",
        "origem": {"lat": -23.59200, "lng": -46.63500},
        "destino": {"lat": -23.58900, "lng": -46.63200},
    },
]

PAUSA_ENTRE_CHAMADAS_S = 2.0  # 40/min = 1 a cada 1.5s; margem de segurança.


def _carregar_casos() -> list[dict]:
    if CAMINHO_CASOS_REFERENCIA.exists():
        casos = json.loads(CAMINHO_CASOS_REFERENCIA.read_text(encoding="utf-8"))
        return casos[:4]  # poucas requisições
    return CASOS_PADRAO


def main() -> None:
    if not settings.ors_api_key:
        print("ORS_API_KEY não configurada; nada a gravar. Use fixtures sintéticas.")
        return

    DIRETORIO_FIXTURES.mkdir(parents=True, exist_ok=True)
    cliente = OrsClient(
        chave=settings.ors_api_key,
        base_url=settings.ors_base_url,
        timeout_s=settings.ors_timeout_s,
        estado=EstadoCota(),
    )

    casos = _carregar_casos()
    for i, caso in enumerate(casos):
        origem = (caso["origem"]["lng"], caso["origem"]["lat"])
        destino = (caso["destino"]["lng"], caso["destino"]["lat"])
        inclinacao = caso.get("inclinacao_max", 6)
        restricoes = {"maximum_incline": inclinacao}

        try:
            resposta = cliente.rota(
                [origem, destino],
                restricoes=restricoes,
                evitar_degraus=True,
                avoid_polygons=None,
            )
        except OrsErro as erro:
            print(f"[{caso.get('nome', i)}] falhou: {erro.codigo}", file=sys.stderr)
            continue

        nome_arquivo = _nome_fixture(origem, destino, inclinacao)
        caminho = DIRETORIO_FIXTURES / f"{nome_arquivo}.json"
        caminho.write_text(json.dumps(resposta, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[{caso.get('nome', i)}] gravado em {caminho.name}")

        if i < len(casos) - 1:
            time.sleep(PAUSA_ENTRE_CHAMADAS_S)

    print(
        "Concluído. Atualize backend/app/fixtures/README.md removendo o aviso de "
        "fixture sintética para os casos regravados."
    )


if __name__ == "__main__":
    main()
