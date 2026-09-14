"""Gabarito e calibração do buffer de conflação (Plano 3, Task 3).

Duas responsabilidades:

1. **Gerar a parte automática do gabarito** (`gerar_gabarito`): as arestas
   com `esquema_calcada = 'geometria_propria'` (a própria geometria já É a
   calçada) cuja geometria está inequivocamente dentro de um único polígono
   do GeoSampa — sem depender de nenhum buffer nem de julgamento humano. Não
   é uma amostra do desempenho da conflação; é "verdade dada", usada como
   régua para calibrar o buffer. As linhas `manual_streetview` (mínimo 40,
   verificadas no Street View) são tarefa humana das semanas 5–6 e **não**
   são geradas aqui — ver a pendência registrada no relatório e no
   `etl/README.md`.

   **Armadilha encontrada ao implementar:** o campo natural para identificar
   uma aresta no gabarito seria `via_pedestre.osmid` (é o que o plano pede:
   coluna `via_osmid`), mas o `osmid` **não é único** em `via_pedestre` desta
   base — o `osmnx` não conseguiu fundir todos os segmentos de uma mesma via
   original do OSM num único trecho simplificado (atributos que diferem
   entre nós, ver `ATRIBUTOS_QUE_DIFEREM` em `etl/osm.py`), então uma única
   via do OSM pode ter virado várias arestas com o mesmo `osmid` e geometrias
   diferentes (confirmado em 14/09/2026: 6.690 grupos de `osmid` duplicado no
   total, 527 só dentro de `esquema_calcada='geometria_propria'`). Gravar um
   `osmid` ambíguo no gabarito tornaria a avaliação indeterminada (a qual das
   várias arestas o gabarito se refere?). Por isso a geração automática só
   escolhe arestas cujo `osmid` aparece **exatamente uma vez** em todo o
   `via_pedestre` — a coluna do CSV continua sendo `via_osmid` (como o plano
   pede), mas só com valores que resolvem sem ambiguidade. As futuras linhas
   `manual_streetview` podem referenciar um `osmid` duplicado (a via toda,
   como aparece no OSM/Street View); `_resolver_gabarito` lida com isso
   pegando todos os `via_id` daquele `osmid` e contando acerto se **qualquer
   um** deles bateu com a calçada esperada (ver docstring de `_classificar`).

2. **Calibrar o buffer** (`avaliar_buffer` + `main`): roda a conflação (via
   `etl.conflacao._candidatos`, em modo leitura, nada é gravado) para cada
   combinação de buffer × método pedida, compara o resultado contra o
   gabarito (acertos/erros/sem_par) e mede cobertura/distância média/%
   ambíguas globais. O relatório em Markdown aponta o "joelho" da curva
   acertos×buffer (`detectar_joelho`) e recomenda um buffer.

Uso:

    python -m etl.calibracao_conflacao --gerar-gabarito
    python -m etl.calibracao_conflacao --buffers 2 3 5 8 10 15
"""

import argparse
import csv
from datetime import date
from pathlib import Path

from sqlalchemy import Connection, Engine, text

from etl.conflacao import _SQL_TOTAL_ARESTAS, _candidatos, _metricas

CAMINHO_GABARITO_PADRAO = (
    Path(__file__).resolve().parent.parent / "gabarito_conflacao.csv"
)
CAMINHO_DOCS_PESQUISA = Path(__file__).resolve().parents[2] / "docs" / "pesquisa"

CAMPOS_GABARITO = ["via_osmid", "calcada_cd_identificador", "origem", "observacao"]
ORIGENS_VALIDAS = {"automatico_contido", "manual_streetview"}

# fração mínima do comprimento da via dentro do polígono para considerar a
# ligação "verdade dada" (bem acima dos 80% usados por `conflacao.py` para o
# método 'contido' — aqui não pode haver dúvida nenhuma).
FRACAO_MINIMA_GABARITO = 0.95

# buffer de busca de candidatos na geração do gabarito: só precisa achar
# polígonos essencialmente coincidentes com a via (distância ~0), não é o
# buffer sendo calibrado.
_BUFFER_BUSCA_GABARITO_M = 2.0

_SQL_CANDIDATOS_GABARITO = text(
    """
    WITH osmid_unico AS (
        SELECT osmid FROM via_pedestre GROUP BY osmid HAVING count(*) = 1
    ),
    v AS (
        SELECT
            vp.id,
            vp.osmid,
            vp.geom,
            ST_Transform(vp.geom, 31983) AS g,
            ST_Buffer(ST_Transform(vp.geom, 31983), 0.001, 'endcap=flat') AS g_fino,
            ST_Area(ST_Buffer(ST_Transform(vp.geom, 31983), 0.001, 'endcap=flat')) AS area_fino
        FROM via_pedestre vp
        JOIN osmid_unico ON osmid_unico.osmid = vp.osmid
        WHERE vp.esquema_calcada = 'geometria_propria'
    ),
    c AS (
        SELECT id AS calcada_id, cd_identificador_calcada, ST_Transform(geom, 31983) AS g
        FROM calcada_sp
        WHERE cd_identificador_calcada IS NOT NULL
    ),
    cand AS (
        SELECT
            v.id AS via_id,
            v.osmid,
            v.geom,
            c.calcada_id,
            c.cd_identificador_calcada,
            ST_Area(ST_Intersection(v.g_fino, c.g)) / NULLIF(v.area_fino, 0) AS fracao_dentro
        FROM v
        JOIN c ON ST_DWithin(v.g, c.g, :buffer_busca)
    ),
    fortes AS (
        SELECT *, count(*) OVER (PARTITION BY via_id) AS n_fortes
        FROM cand
        WHERE fracao_dentro >= :fracao_minima
    )
    SELECT DISTINCT ON (f.via_id)
        f.via_id, f.osmid, f.calcada_id, f.cd_identificador_calcada, a.nome AS recorte
    FROM fortes f
    JOIN area_piloto a ON ST_Intersects(f.geom, a.geom)
    WHERE f.n_fortes = 1
    ORDER BY f.via_id, a.nome
    """
)


def gerar_gabarito(engine: Engine, por_recorte: int = 20) -> list[dict]:
    """Gera as linhas `automatico_contido` do gabarito: até `por_recorte`
    arestas `geometria_propria` por `area_piloto`, cujo `osmid` é único em
    `via_pedestre` e que estão a `FRACAO_MINIMA_GABARITO` (95%) do seu
    comprimento dentro de exatamente um polígono `calcada_sp` — "verdade
    dada", não uma amostra do desempenho da conflação. Só lê o banco, nunca
    grava. A ordem é determinística (por `via_id`), para reprodutibilidade."""
    with engine.connect() as conexao:
        linhas = (
            conexao.execute(
                _SQL_CANDIDATOS_GABARITO,
                {
                    "buffer_busca": _BUFFER_BUSCA_GABARITO_M,
                    "fracao_minima": FRACAO_MINIMA_GABARITO,
                },
            )
            .mappings()
            .all()
        )

    por_area: dict[str, list] = {}
    for linha in linhas:
        por_area.setdefault(linha["recorte"], []).append(linha)

    gabarito = []
    for recorte in sorted(por_area):
        for linha in por_area[recorte][:por_recorte]:
            gabarito.append(
                {
                    "via_osmid": str(linha["osmid"]),
                    "calcada_cd_identificador": linha["cd_identificador_calcada"],
                    "origem": "automatico_contido",
                    "observacao": (
                        f"gerado automaticamente ({recorte}): fração dentro >= "
                        f"{FRACAO_MINIMA_GABARITO:.0%}, osmid único no grafo"
                    ),
                }
            )
    return gabarito


def escrever_gabarito(caminho: Path, linhas: list[dict]) -> None:
    """Escreve o CSV do gabarito com `;` como separador, UTF-8 — formato
    exigido pelo plano (`via_osmid;calcada_cd_identificador;origem;observacao`)."""
    with caminho.open("w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.DictWriter(arquivo, fieldnames=CAMPOS_GABARITO, delimiter=";")
        escritor.writeheader()
        escritor.writerows(linhas)


def ler_gabarito(caminho: Path) -> list[dict]:
    """Lê o CSV do gabarito (`;`, UTF-8) e valida `origem`. Recusa (com
    `ValueError`) qualquer linha cuja `origem` não seja uma das duas
    aceitas pelo plano — um erro de digitação aqui contaminaria a
    calibração silenciosamente."""
    with caminho.open(encoding="utf-8", newline="") as arquivo:
        leitor = csv.DictReader(arquivo, delimiter=";")
        linhas = list(leitor)
    for numero, linha in enumerate(linhas, start=2):  # linha 1 é o cabeçalho
        if linha["origem"] not in ORIGENS_VALIDAS:
            raise ValueError(
                f"{caminho}: linha {numero} tem origem inválida {linha['origem']!r} "
                f"(esperado um de {sorted(ORIGENS_VALIDAS)})"
            )
    return linhas


def atualizar_gabarito(
    engine: Engine, caminho: Path, por_recorte: int = 20
) -> list[dict]:
    """Regenera as linhas `automatico_contido` e as grava em `caminho`,
    preservando qualquer linha `manual_streetview` já presente (a verificação
    humana no Street View não é refeita a cada corrida deste script)."""
    manuais: list[dict] = []
    if caminho.exists():
        manuais = [
            linha
            for linha in ler_gabarito(caminho)
            if linha["origem"] == "manual_streetview"
        ]

    automaticas = gerar_gabarito(engine, por_recorte=por_recorte)
    todas = automaticas + manuais
    escrever_gabarito(caminho, todas)
    return todas


def _resolver_gabarito(conexao: Connection, gabarito: list[dict]) -> list[dict]:
    """Resolve cada linha do gabarito para ids reais do banco: `via_ids`
    (todos os `via_pedestre.id` daquele `osmid` — normalmente um só; mais de
    um só acontece para `osmid`s duplicados, ver docstring do módulo) e
    `calcada_id_esperado` (o `calcada_sp.id` daquele `cd_identificador`, ou
    `None` se não existir mais na base — gabarito órfão, contado como
    'invalido' por `_classificar`)."""
    osmids = [int(linha["via_osmid"]) for linha in gabarito]
    cds = [linha["calcada_cd_identificador"] for linha in gabarito]

    mapa_via: dict[int, list[int]] = {}
    for via_id, osmid in conexao.execute(
        text("SELECT id, osmid FROM via_pedestre WHERE osmid = ANY(:osmids)"),
        {"osmids": osmids},
    ):
        mapa_via.setdefault(osmid, []).append(via_id)

    mapa_calcada: dict[str, int] = {
        cd: calcada_id
        for calcada_id, cd in conexao.execute(
            text(
                "SELECT id, cd_identificador_calcada FROM calcada_sp "
                "WHERE cd_identificador_calcada = ANY(:cds)"
            ),
            {"cds": cds},
        )
    }

    return [
        {
            "via_osmid": linha["via_osmid"],
            "via_ids": mapa_via.get(int(linha["via_osmid"]), []),
            "calcada_id_esperado": mapa_calcada.get(linha["calcada_cd_identificador"]),
            "origem": linha["origem"],
        }
        for linha in gabarito
    ]


def _classificar(linhas_por_via: dict, gabarito_resolvido: list[dict]) -> dict:
    """Compara o resultado da conflação (`linhas_por_via`: `via_id` ->
    `{'ligada': bool, 'calcada_id': int|None}`) contra o gabarito já
    resolvido. Pura (sem banco, sem I/O) — testável com dados sintéticos.

    Por caso do gabarito:
    - **inválido**: `via_osmid` não resolveu para nenhum `via_id`, ou
      `calcada_cd_identificador` não existe mais em `calcada_sp`.
    - **acerto**: pelo menos um dos `via_id` daquele `osmid` ligou (na
      conflação) exatamente à calçada esperada.
    - **erro**: nenhum acertou, mas pelo menos um ligou a uma calçada
      diferente (a conflação decidiu algo, e decidiu errado).
    - **sem_par**: nenhum dos `via_id` ligou a nada (candidato ambíguo ou
      fora do buffer) — a conflação preferiu não decidir, não decidiu errado.
    """
    acertos = erros = sem_par = invalidos = 0
    for linha in gabarito_resolvido:
        if not linha["via_ids"] or linha["calcada_id_esperado"] is None:
            invalidos += 1
            continue
        houve_acerto = False
        houve_erro = False
        for via_id in linha["via_ids"]:
            resultado = linhas_por_via.get(via_id)
            if resultado is None or not resultado["ligada"]:
                continue
            if resultado["calcada_id"] == linha["calcada_id_esperado"]:
                houve_acerto = True
            else:
                houve_erro = True
        if houve_acerto:
            acertos += 1
        elif houve_erro:
            erros += 1
        else:
            sem_par += 1
    return {
        "acertos": acertos,
        "erros": erros,
        "sem_par": sem_par,
        "invalidos": invalidos,
        "total": len(gabarito_resolvido),
    }


def avaliar_buffer(
    engine: Engine, buffer_m: float, metodo: str, gabarito: list[dict]
) -> dict:
    """Roda a conflação (só leitura — mesma query de `etl.conflacao.executar`,
    nada é gravado) para `buffer_m`/`metodo` e devolve métricas globais
    (cobertura, distância média, ambíguas) mais a comparação contra o
    gabarito (acertos/erros/sem_par/inválidos)."""
    with engine.connect() as conexao:
        linhas = _candidatos(conexao, buffer_m, metodo)
        total_arestas = conexao.execute(_SQL_TOTAL_ARESTAS).scalar_one()
        gabarito_resolvido = _resolver_gabarito(conexao, gabarito)

    metricas = _metricas(linhas, total_arestas)
    linhas_por_via = {linha["via_id"]: linha for linha in linhas}
    classificacao = _classificar(linhas_por_via, gabarito_resolvido)

    return {"buffer_m": buffer_m, "metodo": metodo, **metricas, **classificacao}


def detectar_joelho(
    buffers: list[float], acertos_pct: list[float], erros_pct: list[float]
) -> tuple[float | None, float]:
    """Acha o "joelho" da curva acertos×buffer: o menor buffer a partir do
    qual os acertos param de crescer mais que 2 pontos percentuais em
    relação ao buffer anterior **enquanto** os erros continuam crescendo —
    sinal de que aumentar o buffer daqui em diante só adiciona erro, sem
    ganho real de cobertura correta. Devolve `(joelho, recomendado)`: o
    buffer recomendado é o **anterior** ao joelho (o último ainda com bom
    custo-benefício). Se a curva nunca estabiliza dentro do que foi testado,
    não há joelho (`None`) e o maior buffer testado é o recomendado."""
    for i in range(1, len(buffers)):
        crescimento_acertos = acertos_pct[i] - acertos_pct[i - 1]
        crescimento_erros = erros_pct[i] - erros_pct[i - 1]
        if crescimento_acertos < 2.0 and crescimento_erros > 0:
            return buffers[i], buffers[i - 1]
    return None, buffers[-1]


def detectar_pico_cobertura(buffers: list[float], cobertura_pct: list[float]) -> float:
    """Acha o buffer que maximiza a cobertura (% de arestas ligadas).

    **Por que isto existe além de `detectar_joelho`:** os casos
    `automatico_contido` do gabarito só testam a regra `'contido'`
    (`etl/conflacao.py`), que vence a disputa de prioridade **independente do
    buffer** sempre que a aresta está de fato dentro do polígono — então,
    enquanto o gabarito não tiver linhas `manual_streetview` (que testam
    casos ambíguos, sensíveis ao buffer), a curva acertos×buffer de
    `detectar_joelho` fica praticamente constante e não diz nada sobre qual
    buffer escolher (confirmado com o gabarito automático real gerado em
    14/09/2026: 24 acertos e 3 erros em **todo** buffer testado, de 2 a 15
    metros). A cobertura, ao contrário, **é** sensível ao buffer com o
    método de produção `'mesmo_lado'`: ela não cresce sempre — a regra de
    desempate (só liga ao mais próximo quando ele não é ambíguo, ver
    docstring de `etl/conflacao.py`) rejeita mais candidatos como empate
    conforme o buffer cresce e traz o lado oposto da rua para dentro do
    alcance, então a cobertura pode **cair** depois de um pico e só
    recuperar parte disso com buffers ainda maiores. `detectar_pico_cobertura`
    é por isso o critério usado por `main()` para fixar `BUFFER_CONFLACAO_M`
    enquanto a parte manual do gabarito não existe. Em caso de empate,
    prefere o menor buffer (mesma cobertura com menos risco de ligar do lado
    errado da rua)."""
    melhor_indice = max(
        range(len(buffers)), key=lambda i: (cobertura_pct[i], -buffers[i])
    )
    return buffers[melhor_indice]


def _hoje() -> date:
    return date.today()  # noqa: DTZ011 — só para nomear o relatório, sem fuso relevante


def _formatar_pct(valor: float) -> str:
    return f"{valor:.1f}%"


def gerar_relatorio(
    resultados: list[dict],
    gabarito: list[dict],
    joelho: float | None,
    recomendado_acertos: float,
    pico_cobertura: float,
    recomendado: float,
    metodo_recomendado: str,
    caminho_saida: Path,
) -> None:
    """Escreve o relatório em Markdown com as tabelas por método/buffer, o
    joelho encontrado e a justificativa do buffer recomendado."""
    n_manual = sum(1 for linha in gabarito if linha["origem"] == "manual_streetview")
    n_automatico = sum(
        1 for linha in gabarito if linha["origem"] == "automatico_contido"
    )

    linhas_md = [
        "# Calibração do buffer de conflação OSM x GeoSampa",
        "",
        (
            f"Gerado em {_hoje().isoformat()} pelo `etl/etl/calibracao_conflacao.py` "
            "(Plano 3, Task 3)."
        ),
        "",
        "## Gabarito",
        "",
        (
            f"- `automatico_contido`: **{n_automatico}** linhas (geradas automaticamente: arestas "
            "`geometria_propria` com >= 95% do comprimento dentro de exatamente um polígono "
            "do GeoSampa e `osmid` único no grafo — verdade dada, sem buffer nem julgamento humano)."
        ),
        f"- `manual_streetview`: **{n_manual}** linhas.",
    ]
    if n_manual == 0:
        linhas_md += [
            "",
            (
                "**Pendência para o dono do projeto:** este plano gera só a parte automática do "
                "gabarito. As linhas `manual_streetview` (mínimo 40, verificadas no Street View "
                "pela equipe humana, semanas 5–6) ainda não existem — a calibração abaixo usa só "
                "os `automatico_contido`. `etl.calibracao_conflacao.ler_gabarito`/`avaliar_buffer` "
                "já aceitam as duas origens sem mudança de código; basta acrescentar as linhas "
                "`manual_streetview` a `etl/gabarito_conflacao.csv` e rodar este script de novo."
            ),
        ]

    for metodo in sorted({linha["metodo"] for linha in resultados}):
        linhas_do_metodo = [linha for linha in resultados if linha["metodo"] == metodo]
        linhas_do_metodo.sort(key=lambda linha: linha["buffer_m"])
        linhas_md += [
            "",
            f"## Método `{metodo}`",
            "",
            (
                "| buffer (m) | cobertura | distância média (m) | ambíguas | acertos | erros | "
                "sem par | acerto sobre avaliado |"
            ),
            "|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for linha in linhas_do_metodo:
            avaliados = linha["total"] - linha["invalidos"]
            acerto_pct = (linha["acertos"] / avaliados * 100) if avaliados else 0.0
            linhas_md.append(
                f"| {linha['buffer_m']:g} | {_formatar_pct(linha['cobertura'] * 100)} | "
                f"{linha['distancia_media_m']:.2f} | {linha['ambiguas']} | {linha['acertos']} | "
                f"{linha['erros']} | {linha['sem_par']} | {_formatar_pct(acerto_pct)} |"
            )

    erros_totais = sum(linha["erros"] for linha in resultados)
    if erros_totais > 0:
        linhas_md += [
            "",
            "## Observação: os 3 erros do `'contido'` (não é sensível ao buffer)",
            "",
            (
                "Investigados individualmente (14/09/2026): os 3 casos `automatico_contido` que "
                "erram fazem isso em **todo** buffer testado, porque a causa não é o buffer — é "
                "um polígono do GeoSampa sobreposto a outro no mesmo lugar. Nos três casos, a via "
                "está a distância 0 de **duas** calçadas (`ST_Distance = 0` para as duas), e a "
                "regra de desempate de `etl/conflacao.py` (`ORDER BY distancia_m, calcada_id`) "
                "escolhe a de menor `id`, que nem sempre é a que o gabarito identificou pelo "
                "critério mais rigoroso (>= 95% do comprimento contido, ver `FRACAO_MINIMA_GABARITO`). "
                "Fora do escopo desta task (mudar o desempate é código da Task 2, já commitado); "
                "registrado aqui como achado real para o dono do projeto avaliar — por exemplo, "
                "desempatar por maior `fracao_dentro` em vez de menor `calcada_id` quando a "
                "distância empatar em zero."
            ),
        ]

    linhas_md += [
        "",
        "## Joelho da curva de acertos",
        "",
    ]
    if joelho is not None:
        linhas_md.append(
            f"No método `{metodo_recomendado}`, a partir do buffer **{joelho:g} m** os acertos "
            "param de crescer mais que 2 pontos percentuais em relação ao buffer anterior "
            "enquanto os erros continuam subindo — sinal de que buffers maiores só adicionam "
            f"erro por esse critério. Buffer indicado pelo joelho: **{recomendado_acertos:g} m** "
            "(o último com bom custo-benefício)."
        )
    else:
        linhas_md.append(
            f"No método `{metodo_recomendado}`, os acertos **não formaram um joelho** dentro do "
            "buffer testado — com o gabarito atual (só `automatico_contido`), essa curva fica "
            "praticamente constante em todo buffer: essas linhas testam exclusivamente a regra "
            "`'contido'` de `etl/conflacao.py`, que vence a disputa de prioridade **independente "
            "do buffer** sempre que a aresta está de fato dentro do polígono. Este critério só "
            "vai discriminar buffers de verdade quando as linhas `manual_streetview` (casos "
            "ambíguos, verificados no Street View) forem acrescentadas ao gabarito — ver "
            "pendência acima."
        )

    linhas_md += [
        "",
        "## Pico de cobertura e buffer recomendado",
        "",
        (
            f"Enquanto o joelho de acertos não é decisivo, `BUFFER_CONFLACAO_M` é fixado pelo "
            f"buffer que **maximiza a cobertura** no método `{metodo_recomendado}` — essa curva, "
            "ao contrário da de acertos, é sensível ao buffer: a regra de desempate do "
            "`'mesmo_lado'` (não liga quando o segundo candidato mais próximo é ambíguo, ver "
            "`etl/conflacao.py`) rejeita mais candidatos como empate conforme buffers maiores "
            "trazem o lado oposto da rua para dentro do alcance, então a cobertura pode cair "
            f"depois de um pico. Pico observado em **{pico_cobertura:g} m**."
        ),
        "",
        (
            f"**Buffer recomendado e fixado: {recomendado:g} m** "
            f"(`BUFFER_CONFLACAO_M = {recomendado:g}`, `METODO_CONFLACAO = {metodo_recomendado!r}` "
            "em `etl/etl/config.py`)."
        ),
    ]

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)
    caminho_saida.write_text("\n".join(linhas_md) + "\n", encoding="utf-8")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m etl.calibracao_conflacao",
        description="Gabarito e calibração do buffer de conflação OSM x GeoSampa.",
    )
    parser.add_argument(
        "--gerar-gabarito",
        action="store_true",
        help="regenera as linhas automatico_contido de etl/gabarito_conflacao.csv e sai",
    )
    parser.add_argument("--gabarito", type=Path, default=CAMINHO_GABARITO_PADRAO)
    parser.add_argument(
        "--buffers", type=float, nargs="+", default=[2.0, 3.0, 5.0, 8.0, 10.0, 15.0]
    )
    parser.add_argument(
        "--metodos",
        nargs="+",
        choices=["mesmo_lado", "mais_proximo"],
        default=["mesmo_lado", "mais_proximo"],
    )
    parser.add_argument(
        "--metodo-recomendado",
        choices=["mesmo_lado", "mais_proximo"],
        default="mesmo_lado",
        help="método cujo joelho decide o buffer recomendado (padrão: mesmo_lado, o de produção)",
    )
    parser.add_argument("--saida", type=Path, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    from etl.db import engine as criar_engine

    args = _parser().parse_args(argv)
    motor = criar_engine()

    if args.gerar_gabarito:
        linhas = atualizar_gabarito(motor, args.gabarito)
        print(
            f"{args.gabarito}: {len(linhas)} linhas ({len(linhas)} automatico_contido + manuais preservadas)"
        )
        return 0

    gabarito = ler_gabarito(args.gabarito)
    resultados = [
        avaliar_buffer(motor, buffer_m, metodo, gabarito)
        for metodo in args.metodos
        for buffer_m in sorted(args.buffers)
    ]

    linhas_recomendado = [
        linha for linha in resultados if linha["metodo"] == args.metodo_recomendado
    ]
    linhas_recomendado.sort(key=lambda linha: linha["buffer_m"])
    buffers = [linha["buffer_m"] for linha in linhas_recomendado]
    acertos_pct = [
        (linha["acertos"] / (linha["total"] - linha["invalidos"]) * 100)
        if (linha["total"] - linha["invalidos"])
        else 0.0
        for linha in linhas_recomendado
    ]
    erros_pct = [
        (linha["erros"] / (linha["total"] - linha["invalidos"]) * 100)
        if (linha["total"] - linha["invalidos"])
        else 0.0
        for linha in linhas_recomendado
    ]
    cobertura_pct = [linha["cobertura"] * 100 for linha in linhas_recomendado]

    joelho, recomendado_acertos = detectar_joelho(buffers, acertos_pct, erros_pct)
    pico_cobertura = detectar_pico_cobertura(buffers, cobertura_pct)
    # o joelho de acertos só é decisivo quando existe (ver docstring de
    # `detectar_pico_cobertura`: com só `automatico_contido` no gabarito, a
    # curva de acertos não varia com o buffer e nunca forma joelho); na
    # ausência dele, o pico de cobertura é quem decide.
    recomendado = recomendado_acertos if joelho is not None else pico_cobertura

    saida = args.saida or (
        CAMINHO_DOCS_PESQUISA / f"{_hoje().isoformat()}-calibracao-conflacao.md"
    )
    gerar_relatorio(
        resultados,
        gabarito,
        joelho,
        recomendado_acertos,
        pico_cobertura,
        recomendado,
        args.metodo_recomendado,
        saida,
    )
    print(f"Relatório escrito em {saida}")
    print(
        f"Buffer recomendado: {recomendado:g} m (joelho de acertos: {joelho}, pico de cobertura: {pico_cobertura:g})"
    )
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
