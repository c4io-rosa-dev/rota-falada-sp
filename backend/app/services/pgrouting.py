"""Fallback determinístico de roteamento em pgRouting, usado quando o ORS
não devolve rota acessível em nenhum nível de exigência (`rota.calcular`,
Tarefa 6) ou quando a cota do ORS estourou.

`pgr_dijkstra` (pgRouting 3.7.3, imagem `pgrouting/pgrouting:latest`) roda
sobre `via_pedestre`, usando `custo_acessivel`/`custo_reverso` como
custo/custo-reverso — as mesmas colunas gravadas pelo ETL
(`etl/etl/osm.py`, `etl/etl/osm_regras.py::fator_custo`), onde uma aresta
com `highway=steps` ou `wheelchair=no` recebe o custo `BLOQUEIO = 1e6`.
Uma aresta assim ainda pode entrar no caminho encontrado por `pgr_dijkstra`
(o custo é alto, não infinito), então `rota_pgrouting` sempre confere o
custo de cada passo do caminho e descarta a rota inteira se algum for
`>= BLOQUEIO` — do contrário devolveríamos "rota acessível" atravessando
uma escada.

O SQL passado como primeiro argumento de `pgr_dijkstra` é uma *string*
executada pela própria extensão: parâmetros ligados (`:nome`) não
atravessam essa borda (o SQLAlchemy tenta resolvê-los antes de chegar ao
Postgres, mesmo dentro da string literal, e falha). Por isso a bbox e os
ids de origem/destino são interpolados diretamente na string — sempre como
`float`/`int` já validados pelos schemas Pydantic (`Coordenada`,
`no_pedestre.id`), nunca texto vindo do usuário; não há injeção possível.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import LineString
from shapely.wkt import loads as _carregar_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.rota import Coordenada

# mesmo limiar de bloqueio do ETL (etl/etl/osm_regras.py::BLOQUEIO).
BLOQUEIO = 1_000_000.0

# ~0.0001° por 10 m na latitude de São Paulo (spec da Tarefa 4).
_GRAUS_POR_METRO = 0.00001


@dataclass
class RotaBruta:
    """Resultado bruto do fallback pgRouting: geometria já orientada na
    ordem de percurso (origem -> destino), os ids de `via_pedestre` do
    caminho (na mesma ordem) e a distância real (soma de `comprimento_m`,
    não do custo penalizado)."""

    geometria: LineString  # EPSG:4326
    arestas: list[int]
    distancia_m: float


@dataclass
class PassoBruto:
    """Um trecho contíguo do caminho pgRouting com o mesmo nome de via (ou
    interrompido por uma virada > 30°), pronto para `enriquecimento.py`
    (Tarefa 5) completar com largura/declividade/barreiras."""

    ordem: int
    instrucao: str
    distancia_m: float
    direcao: str  # 'siga' | 'vire_esquerda' | 'vire_direita'
    geometria: LineString  # EPSG:4326
    is_degrau: bool
    kerb_transponivel: bool | None
    arestas: list[int]


_SQL_NO_MAIS_PROXIMO = text(
    """
    SELECT id
    FROM no_pedestre
    WHERE ST_DWithin(
        ST_Transform(geom, 31983),
        ST_Transform(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 31983),
        :raio_m
    )
    ORDER BY
        ST_Transform(geom, 31983)
        <-> ST_Transform(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 31983)
    LIMIT 1
    """
)


def no_mais_proximo(db: Session, lat: float, lng: float, raio_m: float = 300.0) -> int | None:
    """`no_pedestre.id` mais próximo de `(lat, lng)` dentro de `raio_m`
    metros (distância medida em EPSG:31983), ou `None` se não há nenhum —
    o caso de uma origem/destino fora da área piloto."""
    linha = db.execute(_SQL_NO_MAIS_PROXIMO, {"lat": lat, "lng": lng, "raio_m": raio_m}).first()
    return linha[0] if linha is not None else None


def _sql_dijkstra(
    minx: float, miny: float, maxx: float, maxy: float, no_origem: int, no_destino: int
) -> str:
    # ver docstring do módulo: nenhum destes valores é texto do usuário —
    # floats/ints já validados — então interpolar na string é seguro.
    return (
        "SELECT d.seq, d.node, d.edge, d.cost, "
        "v.comprimento_m, v.is_degrau, v.kerb_transponivel, v.nome, "
        "v.source, v.target, ST_AsText(v.geom) AS geom_wkt "
        "FROM pgr_dijkstra("
        "'SELECT id, source, target, custo_acessivel AS cost, custo_reverso AS reverse_cost "
        "FROM via_pedestre "
        f"WHERE geom && ST_MakeEnvelope({minx!r}, {miny!r}, {maxx!r}, {maxy!r}, 4326)', "
        f"{no_origem!r}, {no_destino!r}, directed := false"
        ") d "
        "LEFT JOIN via_pedestre v ON v.id = d.edge "
        "ORDER BY d.seq"
    )


def rota_pgrouting(
    db: Session,
    origem: Coordenada,
    destino: Coordenada,
    *,
    bbox_margem_m: float = 1500.0,
) -> RotaBruta | None:
    """Caminho mais curto acessível entre `origem` e `destino` por
    `pgr_dijkstra` sobre `via_pedestre`, restrito a uma bbox ao redor dos
    dois pontos (expandida por `bbox_margem_m`). Devolve `None` quando:
    origem ou destino ficam fora da área piloto (sem `no_pedestre` a 300 m);
    origem e destino caem no mesmo nó (rota degenerada); não há caminho na
    bbox; ou o caminho encontrado atravessa alguma aresta bloqueada
    (`custo >= BLOQUEIO`, ver docstring do módulo)."""
    no_origem = no_mais_proximo(db, origem.lat, origem.lng)
    no_destino = no_mais_proximo(db, destino.lat, destino.lng)
    if no_origem is None or no_destino is None or no_origem == no_destino:
        return None

    margem_graus = bbox_margem_m * _GRAUS_POR_METRO
    minx = min(origem.lng, destino.lng) - margem_graus
    maxx = max(origem.lng, destino.lng) + margem_graus
    miny = min(origem.lat, destino.lat) - margem_graus
    maxy = max(origem.lat, destino.lat) + margem_graus

    sql = _sql_dijkstra(minx, miny, maxx, maxy, no_origem, no_destino)
    linhas = db.execute(text(sql)).mappings().all()
    if not linhas or linhas[-1]["node"] != no_destino:
        return None

    arestas: list[int] = []
    distancia_total = 0.0
    trechos_coords: list[list[tuple[float, float]]] = []
    for linha in linhas:
        if linha["edge"] == -1:
            continue
        if linha["cost"] is None or float(linha["cost"]) >= BLOQUEIO:
            return None
        arestas.append(linha["edge"])
        distancia_total += float(linha["comprimento_m"])
        geom = _carregar_wkt(linha["geom_wkt"])
        coords = list(geom.coords)
        if linha["source"] != linha["node"]:
            coords = list(reversed(coords))
        trechos_coords.append(coords)

    if not arestas:
        return None

    coordenadas: list[tuple[float, float]] = []
    for coords in trechos_coords:
        if coordenadas and coordenadas[-1] == coords[0]:
            coordenadas.extend(coords[1:])
        else:
            coordenadas.extend(coords)

    return RotaBruta(
        geometria=LineString(coordenadas),
        arestas=arestas,
        distancia_m=distancia_total,
    )


_SQL_ARESTAS_PARA_INSTRUCOES = text(
    "SELECT id, source, target, nome, is_degrau, kerb_transponivel, comprimento_m, "
    "ST_AsText(geom) AS geom_wkt "
    "FROM via_pedestre WHERE id = ANY(:ids)"
)


def _pontos_proximos(a: tuple[float, float], b: tuple[float, float], tol: float = 1e-7) -> bool:
    """`True` se `a` e `b` (lng, lat em graus) são o mesmo ponto a menos de
    `tol` graus — usado só para casar o primeiro ponto de
    `rota_bruta.geometria` com um extremo (source/target) de uma aresta;
    ambos vêm do mesmo `ST_AsText` sobre a mesma coluna `geom`, então na
    prática coincidem bit a bit, mas a tolerância evita depender disso."""
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol


def _rumo_graus(coords: list[tuple[float, float]]) -> float:
    """Rumo aproximado (graus, 0-360, sentido horário a partir do norte) do
    primeiro ao último ponto do trecho — suficiente para decidir viradas
    num trecho curto de calçada, sem precisar de projeção métrica."""
    (x0, y0), (x1, y1) = coords[0], coords[-1]
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360.0


def _diferenca_angular(rumo_anterior: float, rumo_atual: float) -> float:
    """Diferença de rumo em (-180, 180]: positiva = virou à direita."""
    return (rumo_atual - rumo_anterior + 180.0) % 360.0 - 180.0


def _direcao_da_virada(diferenca_graus: float) -> str:
    if diferenca_graus > 30.0:
        return "vire_direita"
    if diferenca_graus < -30.0:
        return "vire_esquerda"
    return "siga"


def _instrucao(nome: str | None, direcao: str) -> str:
    via = nome or "a via"
    if direcao == "siga":
        return f"Siga por {via}"
    lado = "à direita" if direcao == "vire_direita" else "à esquerda"
    return f"Vire {lado} e siga por {via}"


def instrucoes(db: Session, rota_bruta: RotaBruta) -> list[PassoBruto]:
    """Passos determinísticos do fallback pgRouting: agrupa as arestas de
    `rota_bruta` (na ordem do caminho) em trechos contíguos com o mesmo
    `nome` de via, cortando também quando o rumo muda mais de 30° — sem
    nenhuma heurística de IA generativa (regra dura do projeto), só nome de
    via e ângulo entre trechos."""
    if not rota_bruta.arestas:
        return []

    linhas = db.execute(_SQL_ARESTAS_PARA_INSTRUCOES, {"ids": rota_bruta.arestas}).mappings().all()
    por_id = {linha["id"]: linha for linha in linhas}

    # reconstrói, na ordem do caminho, a orientação de cada aresta a partir
    # do nó em que a rota entra na 1ª aresta. `rota_bruta.geometria` já foi
    # orientada corretamente (origem -> destino) por `rota_pgrouting` a
    # partir do retorno de `pgr_dijkstra`, então seu primeiro ponto é a
    # referência: comparamos com os dois extremos da geometria bruta da 1ª
    # aresta (fonte da verdade sobre qual extremo é source e qual é target)
    # para decidir por qual nó a rota entra — sem depender de olhar a 2ª
    # aresta, que não existe quando o caminho tem uma única aresta (bug
    # corrigido na revisão da Tarefa 4, Tentativa 2: o código antigo caía
    # num `else` que assumia cegamente `no_atual = source` nesse caso).
    primeira = por_id[rota_bruta.arestas[0]]
    coords_brutas_primeira = list(_carregar_wkt(primeira["geom_wkt"]).coords)
    ponto_entrada = rota_bruta.geometria.coords[0]
    no_atual = (
        primeira["source"]
        if _pontos_proximos(coords_brutas_primeira[0], ponto_entrada)
        else primeira["target"]
    )

    trechos: list[dict] = []
    for aresta_id in rota_bruta.arestas:
        linha = por_id[aresta_id]
        coords = list(_carregar_wkt(linha["geom_wkt"]).coords)
        if linha["source"] == no_atual:
            no_seguinte = linha["target"]
        else:
            coords = list(reversed(coords))
            no_seguinte = linha["source"]
        trechos.append(
            {
                "id": aresta_id,
                "nome": linha["nome"],
                "is_degrau": bool(linha["is_degrau"]),
                "kerb_transponivel": linha["kerb_transponivel"],
                "comprimento_m": float(linha["comprimento_m"]),
                "coords": coords,
                "rumo": _rumo_graus(coords),
            }
        )
        no_atual = no_seguinte

    grupos: list[list[dict]] = [[trechos[0]]]
    for anterior, atual in zip(trechos, trechos[1:], strict=False):
        mesma_via = atual["nome"] == anterior["nome"]
        virada = abs(_diferenca_angular(anterior["rumo"], atual["rumo"])) > 30.0
        if mesma_via and not virada:
            grupos[-1].append(atual)
        else:
            grupos.append([atual])

    passos: list[PassoBruto] = []
    rumo_anterior_ao_grupo: float | None = None
    for ordem, grupo in enumerate(grupos, start=1):
        direcao = (
            "siga"
            if rumo_anterior_ao_grupo is None
            else _direcao_da_virada(_diferenca_angular(rumo_anterior_ao_grupo, grupo[0]["rumo"]))
        )
        coordenadas: list[tuple[float, float]] = []
        for trecho in grupo:
            if coordenadas and coordenadas[-1] == trecho["coords"][0]:
                coordenadas.extend(trecho["coords"][1:])
            else:
                coordenadas.extend(trecho["coords"])
        passos.append(
            PassoBruto(
                ordem=ordem,
                instrucao=_instrucao(grupo[0]["nome"], direcao),
                distancia_m=sum(t["comprimento_m"] for t in grupo),
                direcao=direcao,
                geometria=LineString(coordenadas),
                is_degrau=any(t["is_degrau"] for t in grupo),
                kerb_transponivel=next(
                    (t["kerb_transponivel"] for t in grupo if t["kerb_transponivel"] is not None),
                    None,
                ),
                arestas=[t["id"] for t in grupo],
            )
        )
        rumo_anterior_ao_grupo = grupo[-1]["rumo"]

    return passos
