"""Orquestração da rota acessível: duas passadas no ORS por nível de
exigência, fallback progressivo (3 → 6 → 10 → `any`), fallback determinístico
em pgRouting quando o ORS não devolve rota em nenhum nível (ou estoura cota),
enriquecimento dos passos e cache.

Fiel ao algoritmo do spec (seção 6) e do plano (Tarefa 6):
1. calcula a chave de cache a partir do corredor *provisório* (buffer de
   50 m da reta origem→destino — ainda não sabemos a geometria real da
   rota); cache válido → devolve direto, `cache=True`.
2. para cada nível de `maximum_incline`, a partir do pedido: 1ª passada sem
   `avoid_polygons`; se o corredor real da resposta cruza alguma barreira
   `intransponivel`, 2ª passada com `avoid_polygons`. `sem_rota` em
   qualquer passada tenta o próximo nível; cota/indisponibilidade abandona
   o ORS de vez e cai para pgRouting.
3. sem rota do ORS em nenhum nível → `rota_pgrouting`; sem rota também ali
   → `RotaNaoEncontrada`.
4. os passos brutos (do motor que deu certo) viram `Passo` via
   `enriquecer_passos`; a duração de cada passo (e o total) é recalculada
   com a `velocidade_kmh` do perfil pedido — nem o ORS nem o pgRouting
   sabem essa velocidade.
5. grava no cache antes de devolver.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from shapely.geometry import LineString, mapping

from app.schemas.rota import Aviso, RotaOut
from app.services import cache_rota
from app.services.barreira_geom import (
    barreiras_no_corredor,
    corredor,
    hash_barreiras,
    poligonos_para_evitar,
)
from app.services.enriquecimento import enriquecer_passos
from app.services.ors_client import OrsErro, OrsFixtureClient
from app.services.pgrouting import PassoBruto, instrucoes, rota_pgrouting

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.orm import Session

    from app.schemas.rota import PerfilAcessibilidade, RotaIn
    from app.services.barreira_geom import BarreiraCandidata
    from app.services.ors_client import OrsClient

# ordem do fallback progressivo de `maximum_incline` (Global Constraints do
# Plano 4): sempre começa no valor pedido e avança até 'any'.
NIVEIS_ORDENADOS: tuple[int | str, ...] = (3, 6, 10, "any")

_MENSAGEM_ROTA_NAO_ENCONTRADA = "Não encontramos rota acessível entre esses pontos na área piloto."

_MENSAGEM_MOTOR_FALLBACK = (
    "O OpenRouteService não encontrou rota acessível (ou a cota do dia/minuto foi "
    "excedida); usamos o roteamento local (pgRouting) como alternativa determinística."
)

# tipos de instrução do ORS (GraphHopper/ORS `step.type`) que viram virada à
# esquerda/direita; os demais (reto, entra/sai de rotatória, chegada,
# partida, meia-volta) viram 'siga' — mesma granularidade determinística do
# fallback pgRouting (Tarefa 4), sem nenhuma heurística de IA.
_TIPOS_ESQUERDA = frozenset({0, 2, 4, 12})
_TIPOS_DIREITA = frozenset({1, 3, 5, 13})


class RotaNaoEncontrada(Exception):
    """Nenhum motor (ORS em nenhum nível, nem pgRouting) encontrou rota
    acessível entre os pontos pedidos.

    `erro_ors`, quando presente, é o `OrsErro` que tirou o ORS do laço de
    níveis antes de esgotá-los (cota diária/por minuto ou indisponibilidade)
    — o router (Tarefa 7) usa isso para decidir entre 404 (nenhum motor acha
    rota mesmo) e 503 (o ORS caiu e o pgRouting, subsidiário, também não
    achou nada nessa dupla de pontos)."""

    def __init__(
        self, mensagem: str = _MENSAGEM_ROTA_NAO_ENCONTRADA, *, erro_ors: OrsErro | None = None
    ):
        self.erro_ors = erro_ors
        super().__init__(mensagem)


class _OrsIndisponivel(Exception):
    """Sinal interno: a chamada ao ORS falhou por cota ou indisponibilidade
    (não por falta de rota) — sai do laço de níveis e vai para pgRouting."""

    def __init__(self, erro: OrsErro):
        self.erro = erro
        super().__init__(str(erro))


@dataclass
class _ResultadoOrs:
    """Uma resposta do ORS já aceita (1ª ou 2ª passada) para um nível de
    exigência, com o corredor e as barreiras `dificulta` já resolvidos —
    para não recalculá-los de novo depois de escolher o nível vencedor."""

    resposta: dict[str, Any]
    linha: LineString
    corredor: Any  # Polygon (EPSG:4326)
    barreiras_dificulta: list[BarreiraCandidata]


def _niveis_a_partir(pedido: int | str) -> tuple[int | str, ...]:
    indice = NIVEIS_ORDENADOS.index(pedido)
    return NIVEIS_ORDENADOS[indice:]


def _coords(entrada: RotaIn) -> list[tuple[float, float]]:
    return [(entrada.origem.lng, entrada.origem.lat), (entrada.destino.lng, entrada.destino.lat)]


def _restricoes(nivel: int | str, perfil: PerfilAcessibilidade) -> dict[str, Any]:
    return {
        "maximum_incline": nivel,
        "maximum_sloped_kerb": perfil.guia_max_m,
        "minimum_width": perfil.largura_min_m,
        "surface_type": "cobblestone:flattened",
        "smoothness_type": "good",
    }


def _linha_da_resposta(resposta: dict[str, Any]) -> LineString:
    coordenadas = resposta["features"][0]["geometry"]["coordinates"]
    return LineString([(ponto[0], ponto[1]) for ponto in coordenadas])


def _tentar_nivel(
    db: Session,
    cliente: OrsClient,
    coords: list[tuple[float, float]],
    perfil: PerfilAcessibilidade,
    nivel: int | str,
) -> _ResultadoOrs | None:
    """Uma tentativa completa (1 ou 2 passadas) num nível de exigência.

    Devolve `None` quando o ORS não achou rota nesse nível (1ª ou 2ª
    passada) — sinal para `calcular()` tentar o próximo nível. Levanta
    `_OrsIndisponivel` quando o ORS falhou por outro motivo (cota,
    indisponibilidade, entrada rejeitada) — sinal para abandonar o ORS de
    vez e cair para pgRouting."""
    restricoes = _restricoes(nivel, perfil)

    try:
        resposta = cliente.rota(
            coords, restricoes=restricoes, evitar_degraus=perfil.evitar_degraus, avoid_polygons=None
        )
    except OrsErro as erro:
        if erro.codigo == "sem_rota":
            return None
        raise _OrsIndisponivel(erro) from erro

    linha = _linha_da_resposta(resposta)
    corredor_atual = corredor(linha, largura_m=50.0)
    barreiras = barreiras_no_corredor(db, corredor_atual)
    poligonos = poligonos_para_evitar(barreiras, linha)

    if poligonos is None:
        dificulta = [b for b in barreiras if b.severidade == "dificulta"]
        return _ResultadoOrs(
            resposta=resposta, linha=linha, corredor=corredor_atual, barreiras_dificulta=dificulta
        )

    try:
        resposta_2 = cliente.rota(
            coords,
            restricoes=restricoes,
            evitar_degraus=perfil.evitar_degraus,
            avoid_polygons=poligonos,
        )
    except OrsErro as erro:
        if erro.codigo == "sem_rota":
            return None
        raise _OrsIndisponivel(erro) from erro

    linha_2 = _linha_da_resposta(resposta_2)
    corredor_2 = corredor(linha_2, largura_m=50.0)
    barreiras_2 = barreiras_no_corredor(db, corredor_2)
    dificulta_2 = [b for b in barreiras_2 if b.severidade == "dificulta"]
    return _ResultadoOrs(
        resposta=resposta_2, linha=linha_2, corredor=corredor_2, barreiras_dificulta=dificulta_2
    )


def _direcao_do_tipo_ors(tipo: int | None) -> str:
    if tipo in _TIPOS_ESQUERDA:
        return "vire_esquerda"
    if tipo in _TIPOS_DIREITA:
        return "vire_direita"
    return "siga"


def _passos_brutos_do_ors(
    resposta: dict[str, Any],
) -> tuple[list[PassoBruto], list[tuple[int, int]]]:
    """`PassoBruto` (mesmo formato do fallback pgRouting) para cada `step`
    de cada `segment` do ORS, mais a faixa `(inicio, fim)` de índices em
    `geometry.coordinates` de cada um (usada por `_extras_steepness_do_ors`
    para casar a declividade do trecho). Passos degenerados (way_points com
    início == fim, como o "chegou ao destino" final) são descartados: não
    correspondem a nenhum deslocamento real."""
    propriedades = resposta["features"][0]["properties"]
    coordenadas = resposta["features"][0]["geometry"]["coordinates"]

    passos: list[PassoBruto] = []
    faixas: list[tuple[int, int]] = []
    ordem = 1
    for segmento in propriedades["segments"]:
        for passo in segmento["steps"]:
            inicio, fim = passo["way_points"]
            if inicio == fim:
                continue
            trecho = [(ponto[0], ponto[1]) for ponto in coordenadas[inicio : fim + 1]]
            if len(trecho) < 2:
                continue
            passos.append(
                PassoBruto(
                    ordem=ordem,
                    instrucao=passo.get("instruction", ""),
                    distancia_m=float(passo["distance"]),
                    direcao=_direcao_do_tipo_ors(passo.get("type")),
                    geometria=LineString(trecho),
                    is_degrau=False,
                    kerb_transponivel=None,
                    arestas=[],
                )
            )
            faixas.append((inicio, fim))
            ordem += 1
    return passos, faixas


def _extras_steepness_do_ors(
    resposta: dict[str, Any], faixas: list[tuple[int, int]]
) -> list[int | None]:
    """Classe de steepness (-5..5) dominante de cada passo — a faixa de
    `extras.steepness.values` (índices na geometria completa da rota) com
    maior sobreposição com a faixa `(inicio, fim)` do passo. `None` quando o
    ORS não devolveu `extras.steepness` (fixture sem esse campo) ou nenhuma
    faixa sobrepõe — `enriquecer_passos` cai para o GeoSampa nesse caso."""
    extras = resposta["features"][0]["properties"].get("extras", {})
    valores = extras.get("steepness", {}).get("values", [])

    resultado: list[int | None] = []
    for inicio, fim in faixas:
        melhor_classe: int | None = None
        melhor_sobreposicao = 0
        for v_inicio, v_fim, classe in valores:
            sobreposicao = min(fim, v_fim) - max(inicio, v_inicio)
            if sobreposicao > melhor_sobreposicao:
                melhor_sobreposicao = sobreposicao
                melhor_classe = classe
        resultado.append(melhor_classe)
    return resultado


def _mensagem_exigencia_relaxada(pedido: int | str, atendido: int | str) -> str:
    if atendido == "any":
        return (
            f"Não encontramos rota respeitando inclinação de até {pedido}%; esta rota "
            "pode ter trechos mais íngremes que o pedido."
        )
    return (
        f"Não encontramos rota com inclinação até {pedido}%. "
        f"Esta rota tem trechos de até {atendido}%."
    )


def calcular(db: Session, entrada: RotaIn, cliente: OrsClient, agora: datetime) -> RotaOut:
    perfil = entrada.perfil
    coords = _coords(entrada)

    linha_provisoria = LineString(
        [(entrada.origem.lng, entrada.origem.lat), (entrada.destino.lng, entrada.destino.lat)]
    )
    corredor_provisorio = corredor(linha_provisoria, largura_m=50.0)
    hash_prov = hash_barreiras(db, corredor_provisorio)
    chave_cache = cache_rota.chave(entrada, hash_prov)

    em_cache = cache_rota.obter(db, chave_cache, agora)
    if em_cache is not None:
        return em_cache

    pedido = perfil.inclinacao_max
    resultado_ors: _ResultadoOrs | None = None
    nivel_atendido: int | str | None = None
    erro_ors_motivo: OrsErro | None = None

    for nivel in _niveis_a_partir(pedido):
        try:
            resultado_ors = _tentar_nivel(db, cliente, coords, perfil, nivel)
        except _OrsIndisponivel as falha:
            erro_ors_motivo = falha.erro
            resultado_ors = None
            break
        if resultado_ors is not None:
            nivel_atendido = nivel
            break

    avisos: list[Aviso] = []

    if resultado_ors is not None:
        motor = "fixture" if isinstance(cliente, OrsFixtureClient) else "ors"
        passos_brutos, faixas = _passos_brutos_do_ors(resultado_ors.resposta)
        extras_steepness = _extras_steepness_do_ors(resultado_ors.resposta, faixas)
        barreiras_dificulta = resultado_ors.barreiras_dificulta
        linha_final = resultado_ors.linha
        corredor_final = resultado_ors.corredor
    else:
        rota_bruta = rota_pgrouting(db, entrada.origem, entrada.destino)
        if rota_bruta is None:
            raise RotaNaoEncontrada(erro_ors=erro_ors_motivo)

        passos_brutos = instrucoes(db, rota_bruta)
        extras_steepness = None
        linha_final = rota_bruta.geometria
        corredor_final = corredor(linha_final, largura_m=50.0)
        barreiras_do_corredor = barreiras_no_corredor(db, corredor_final)
        barreiras_dificulta = [b for b in barreiras_do_corredor if b.severidade == "dificulta"]
        motor = "pgrouting"
        # o fallback determinístico não gradua por inclinação (custo binário
        # acessível/bloqueado, já materializado pelo ETL): 'any' é o valor
        # honesto — não há como afirmar que o nível pedido foi respeitado.
        nivel_atendido = "any"

    passos, avisos_enriquecimento, fontes = enriquecer_passos(
        db, passos_brutos, barreiras_dificulta, extras_steepness
    )
    avisos.extend(avisos_enriquecimento)

    if nivel_atendido != pedido:
        avisos.append(
            Aviso(
                tipo="exigencia_relaxada",
                mensagem=_mensagem_exigencia_relaxada(pedido, nivel_atendido),
            )
        )
    if motor == "pgrouting":
        avisos.append(Aviso(tipo="motor_fallback", mensagem=_MENSAGEM_MOTOR_FALLBACK))

    velocidade_ms = perfil.velocidade_kmh * 1000.0 / 3600.0
    passos_com_duracao = [
        passo.model_copy(update={"duracao_s": passo.distancia_m / velocidade_ms})
        for passo in passos
    ]
    distancia_total = sum(passo.distancia_m for passo in passos_com_duracao)
    duracao_total = distancia_total / velocidade_ms

    saida = RotaOut(
        passos=passos_com_duracao,
        distancia_m=distancia_total,
        duracao_s=duracao_total,
        avisos=avisos,
        nivel_exigencia_atendido=nivel_atendido,
        motor=motor,
        fontes=sorted(fontes),
        geometria=mapping(linha_final),
        cache=False,
    )

    cache_rota.guardar(db, chave_cache, saida, regiao=corredor_final, agora=agora)
    return saida
