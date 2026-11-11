"""Enriquecimento dos passos de uma rota (ORS ou pgRouting) com dados de
proveniência declarada: largura e declividade da calçada (GeoSampa, via
`conflacao_via_calcada`), transponibilidade de guia e presença de degrau
(OSM, via `via_pedestre`) e barreiras `dificulta` próximas.

Recebe uma lista genérica de `PassoBruto` (o mesmo dataclass do fallback
pgRouting, Tarefa 4 — `rota.py`, Tarefa 6, monta os equivalentes a partir da
resposta do ORS) e devolve `Passo` já prontos para `RotaOut`, os `Aviso`
levantados no caminho e o conjunto de chaves de `fonte_dados` realmente
usadas (para o rodapé de proveniência).

**Por que cada passo é resolvido de novo contra `via_pedestre`, mesmo que
`PassoBruto` já traga `is_degrau`/`kerb_transponivel` (caso do pgRouting):**
esses dois campos em `PassoBruto` só existem de fato para o fallback
pgRouting — uma rota do ORS não tem `via_pedestre` nenhuma associada, só uma
geometria. Para tratar os dois motores com o mesmo código, este módulo
sempre busca as `via_pedestre` mais próximas (≤ 10 m, EPSG:31983) de pontos
a cada 25 m do passo e usa **essa** leitura como fonte da verdade; os campos de
`PassoBruto` só entram como reserva quando nenhuma via é encontrada a 10 m
(rota fora da malha mapeada, ou passo cuja geometria não é de calçada).

**O passo mostra o pior valor conhecido ao longo dele:** menor largura, maior
declividade, qualquer degrau. Um passo pode ter centenas de metros, e uma média
ou só o ponto do meio esconderia a ladeira ou o degrau que importam a quem usa
cadeira de rodas. A via com calçada nos dois lados (`dois_lados`) segue a mesma
regra.

**`declividade_medida` só é verdadeira para valor medido no GeoSampa.** A classe
de steepness do ORS é uma faixa calculada sobre elevação de baixa resolução:
entra como estimativa e só vence quando a faixa inteira fica acima do valor medido.

**Regra inegociável do projeto** (zeros do GeoSampa são ausência de
medição, nunca "calçada de largura/declividade zero"): a coluna gerada
`calcada_sp.largura_medida` já encapsula isso (`largura_min_m > 0`), então
basta nunca devolver `largura_m` quando `largura_medida` é falso — mesmo
que `largura_min_m` valha 0. O mesmo vale para `declividade_medida`/
`declividade_max_pct`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from shapely.geometry import Point, mapping
from shapely.ops import transform as _transformar_geometria
from sqlalchemy import text

from app.schemas.rota import Aviso, BarreiraResumo, Passo
from app.services.barreira_geom import PROJ_4326_31983

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.services.barreira_geom import BarreiraCandidata
    from app.services.pgrouting import PassoBruto

# raio de busca da via_pedestre mais próxima do ponto médio de cada passo
# (spec da Tarefa 5), medido em EPSG:31983.
_RAIO_VIA_M = 10.0

# um ponto de amostra a cada tantos metros do passo, até o teto (15 km de rota
# têm dezenas de passos: o teto segura o custo das consultas).
_AMOSTRA_M = 25.0
_AMOSTRAS_MAX = 40

# raio dentro do qual uma barreira 'dificulta' entra em barreiras_proximas
# do passo (spec da Tarefa 5).
_RAIO_BARREIRA_M = 15.0

# origem da BarreiraCandidata -> chave de fonte_dados (barreira_oficial vem
# sempre do SP156; barreira_colaborativa é a própria contribuição do site —
# ver alembic/versions/001_fundacao.py, FONTES, e 002_fontes_oficiais.py).
_FONTE_POR_ORIGEM_BARREIRA = {"oficial": "sp156", "colaborativa": "colaborativo"}

# Classes de steepness do `extra_info` do ORS (perfil wheelchair), -5..5,
# cada uma representando uma FAIXA de inclinação (documentação oficial:
# https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/steepness,
# consultada em 2026-09-14): 0 = 0–<1%; ±1 = 1–<4%; ±2 = 4–<7%; ±3 = 7–<10%;
# ±4 = 10–<16%; ±5 = ≥16% (sinal = ladeira acima/abaixo, irrelevante aqui —
# `declividade_pct` é sempre a magnitude). O valor escolhido para cada classe
# não é o limite literal da faixa: é um número representativo alinhado aos
# próprios limiares de `PerfilAcessibilidade.inclinacao_max` (3, 6, 10 — ver
# `app/schemas/rota.py`), para o front poder comparar `declividade_pct` de
# um passo direto contra o nível de exigência pedido/atendido, sem reabrir a
# tabela de faixas do ORS. A classe 5 (≥16%, sem teto) usa 20.0 — "bem acima
# de 15%", não uma medição exata.
_PCT_POR_CLASSE_STEEPNESS: dict[int, float] = {
    0: 0.0,
    1: 3.0,
    2: 6.0,
    3: 10.0,
    4: 15.0,
    5: 20.0,
}


# Menor inclinação de cada classe do ORS (início da faixa). A estimativa só desmente uma medida
# do GeoSampa quando nem o começo da faixa cabe nela: a classe 1 (1% a 4%) não desmente 1,9%.
_PISO_POR_CLASSE_STEEPNESS: dict[int, float] = {0: 0.0, 1: 1.0, 2: 4.0, 3: 7.0, 4: 10.0, 5: 16.0}


def _piso_da_classe_steepness(classe: int) -> float | None:
    return _PISO_POR_CLASSE_STEEPNESS.get(abs(classe))


def _pct_da_classe_steepness(classe: int) -> float | None:
    """`declividade_pct` representativo da classe de steepness do ORS (ver
    `_PCT_POR_CLASSE_STEEPNESS`), ou `None` se `classe` não é uma classe
    válida do ORS (-5..5)."""
    return _PCT_POR_CLASSE_STEEPNESS.get(abs(classe))


_SQL_VIAS_MAIS_PROXIMAS = text(
    """
    SELECT v.id, v.is_degrau, v.kerb_transponivel, v.data_referencia, v.fonte_chave
    FROM unnest(CAST(:lngs AS double precision[]), CAST(:lats AS double precision[]))
        WITH ORDINALITY AS p(lng, lat, i)
    CROSS JOIN LATERAL (
        SELECT via.id, via.is_degrau, via.kerb_transponivel, via.data_referencia,
               f.chave AS fonte_chave
        FROM via_pedestre via
        JOIN fonte_dados f ON f.id = via.fonte_id
        WHERE ST_DWithin(
            ST_Transform(via.geom, 31983),
            ST_Transform(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), 31983),
            :raio_m
        )
        ORDER BY
            ST_Transform(via.geom, 31983)
            <-> ST_Transform(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), 31983)
        LIMIT 1
    ) v
    ORDER BY p.i
    """
)

_SQL_CONFLACAO = text(
    """
    SELECT c.largura_min_m, c.largura_medida, c.declividade_max_pct, c.declividade_medida,
           c.data_referencia, f.chave AS fonte_chave
    FROM conflacao_via_calcada cv
    JOIN calcada_sp c ON c.id = cv.calcada_id
    JOIN fonte_dados f ON f.id = c.fonte_id
    WHERE cv.via_id = ANY(:via_ids)
    """
)


def _pontos_do_passo(geometria) -> list[Point]:
    """Pontos no meio de intervalos iguais do passo, um a cada `_AMOSTRA_M`.
    Fogem das pontas, onde a via mais próxima pode ser a rua transversal."""
    comprimento = _transformar_geometria(PROJ_4326_31983.transform, geometria).length
    quantidade = max(1, min(_AMOSTRAS_MAX, round(comprimento / _AMOSTRA_M)))
    return [
        geometria.interpolate((i + 0.5) / quantidade, normalized=True) for i in range(quantidade)
    ]


def _vias_mais_proximas(db: Session, pontos: list[Point]) -> list[dict]:
    """A via mais próxima de cada ponto, a até `_RAIO_VIA_M`, sem repetir."""
    linhas = (
        db.execute(
            _SQL_VIAS_MAIS_PROXIMAS,
            {
                "lngs": [ponto.x for ponto in pontos],
                "lats": [ponto.y for ponto in pontos],
                "raio_m": _RAIO_VIA_M,
            },
        )
        .mappings()
        .all()
    )
    return list({linha["id"]: dict(linha) for linha in linhas}.values())


def _conflacoes_das_vias(db: Session, via_ids: list[int]) -> list[dict]:
    linhas = db.execute(_SQL_CONFLACAO, {"via_ids": via_ids}).mappings().all()
    return [dict(linha) for linha in linhas]


def _kerb_do_passo(vias: list[dict]) -> bool | None:
    """Uma guia intransponível decide o passo; só é transponível se todas forem."""
    valores = [via["kerb_transponivel"] for via in vias]
    if any(valor is False for valor in valores):
        return False
    return True if valores and all(valor is True for valor in valores) else None


def _guia(kerb_transponivel: bool | None) -> str:
    if kerb_transponivel is True:
        return "transponivel"
    if kerb_transponivel is False:
        return "nao_transponivel"
    return "desconhecida"


def _distancia_m(ponto_4326: Point, linha_4326) -> float:
    ponto_31983 = _transformar_geometria(PROJ_4326_31983.transform, ponto_4326)
    linha_31983 = _transformar_geometria(PROJ_4326_31983.transform, linha_4326)
    return ponto_31983.distance(linha_31983)


def enriquecer_passos(
    db: Session,
    passos_brutos: list[PassoBruto],
    barreiras_dificulta: list[BarreiraCandidata],
    extras_steepness: list[int | None] | None,
) -> tuple[list[Passo], list[Aviso], set[str]]:
    """Enriquece cada `PassoBruto` com largura/declividade/guia/barreiras e
    devolve `(passos, avisos, fontes)`.

    `extras_steepness`, quando informado, é uma lista **alinhada por índice**
    com `passos_brutos` — `extras_steepness[i]` é a classe de steepness do
    ORS (-5..5, ou `None`) já resolvida por quem montou os passos brutos do
    ORS (`rota.py`, Tarefa 6) para o passo `i`, cruzando `way_points` com
    `properties.extras.steepness.values`. Quando o item existe (não é
    `None`), ele entra como estimativa: vence a declividade do GeoSampa só se
    o começo da faixa da classe já passar dela (ver `_PISO_POR_CLASSE_STEEPNESS`).

    `duracao_s` de cada `Passo` sai como `0.0`: nenhum dos dois motores dá a
    duração "certa" para o perfil pedido (a do ORS é para outra velocidade;
    o pgRouting não calcula duração nenhuma) — `rota.py` (Tarefa 6) recalcula
    com `velocidade_kmh` do perfil antes de devolver `RotaOut`.
    """
    avisos: list[Aviso] = []
    fontes: set[str] = set()
    aviso_sem_dados_emitido = False
    passos: list[Passo] = []

    for indice, bruto in enumerate(passos_brutos):
        vias = _vias_mais_proximas(db, _pontos_do_passo(bruto.geometria))

        if vias:
            fontes.update(via["fonte_chave"] for via in vias)
            fonte_passo = vias[0]["fonte_chave"]
            data_referencia_passo = vias[0]["data_referencia"]
            is_degrau = any(via["is_degrau"] for via in vias)
            kerb_transponivel = _kerb_do_passo(vias)
        else:
            # nenhuma via_pedestre a 10 m: sem OSM confirmado para este
            # trecho (não entra em `fontes`), mas a geometria da rota ainda
            # nasceu da malha OSM/ORS — 'osm' é o valor nominal do spec.
            fonte_passo = "osm"
            data_referencia_passo = None
            is_degrau = bruto.is_degrau
            kerb_transponivel = bruto.kerb_transponivel

        conflacoes = _conflacoes_das_vias(db, [via["id"] for via in vias]) if vias else []
        fontes.update(conflacao["fonte_chave"] for conflacao in conflacoes)
        # regra inegociável: largura_medida=False ⇒ largura_m=None, mesmo que
        # largura_min_m valha 0 (GeoSampa: zero é ausência).
        larguras = [float(c["largura_min_m"]) for c in conflacoes if c["largura_medida"]]
        largura_m = min(larguras, default=None)
        largura_medida = largura_m is not None
        declividades = [
            float(c["declividade_max_pct"]) for c in conflacoes if c["declividade_medida"]
        ]
        declividade_pct_geosampa = max(declividades, default=None)
        if not conflacoes:
            if not aviso_sem_dados_emitido:
                avisos.append(
                    Aviso(
                        tipo="trecho_sem_dados",
                        mensagem=(
                            "Em alguns trechos não temos medida da calçada: largura e "
                            "inclinação ficam sem dado nesses trechos."
                        ),
                    )
                )
                aviso_sem_dados_emitido = True

        classe_steepness = (
            extras_steepness[indice]
            if extras_steepness is not None and indice < len(extras_steepness)
            else None
        )
        estimativa_ors = (
            _pct_da_classe_steepness(classe_steepness) if classe_steepness is not None else None
        )
        piso_ors = (
            _piso_da_classe_steepness(classe_steepness) if classe_steepness is not None else None
        )
        if estimativa_ors is not None and (
            declividade_pct_geosampa is None
            or (piso_ors is not None and piso_ors > declividade_pct_geosampa)
        ):
            declividade_pct = estimativa_ors
            declividade_medida = False
        else:
            declividade_pct = declividade_pct_geosampa
            declividade_medida = declividade_pct_geosampa is not None

        barreiras_proximas: list[BarreiraResumo] = []
        for barreira in barreiras_dificulta:
            if barreira.severidade != "dificulta":
                continue  # intransponíveis já viraram avoid_polygons (Tarefa 3/6)
            distancia = _distancia_m(barreira.geom, bruto.geometria)
            if distancia > _RAIO_BARREIRA_M:
                continue
            barreiras_proximas.append(
                BarreiraResumo(
                    id=barreira.id,
                    origem=barreira.origem,
                    categoria=barreira.categoria,
                    severidade=barreira.severidade,
                    distancia_m=distancia,
                    confirmacoes=barreira.confirmacoes,
                    data_referencia=barreira.data_referencia,
                )
            )
            fontes.add(_FONTE_POR_ORIGEM_BARREIRA[barreira.origem])
            avisos.append(
                Aviso(
                    tipo="barreira_dificulta",
                    mensagem=(
                        f"Barreira '{barreira.categoria}' a {distancia:.0f} m do passo "
                        f"{bruto.ordem} dificulta a travessia, mas não bloqueia a rota."
                    ),
                )
            )

        passos.append(
            Passo(
                ordem=bruto.ordem,
                instrucao=bruto.instrucao,
                distancia_m=bruto.distancia_m,
                duracao_s=0.0,  # recalculado por rota.py com a velocidade do perfil
                direcao=bruto.direcao,
                largura_m=largura_m,
                largura_medida=largura_medida,
                declividade_pct=declividade_pct,
                declividade_medida=declividade_medida,
                guia=_guia(kerb_transponivel),
                is_degrau=is_degrau,
                barreiras_proximas=barreiras_proximas,
                fonte=fonte_passo,
                data_referencia=data_referencia_passo,
                geometria=mapping(bruto.geometria),
            )
        )

    return passos, avisos, fontes
