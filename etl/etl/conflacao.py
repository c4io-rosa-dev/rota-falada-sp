"""Conflação entre o grafo de pedestres do OSM (`via_pedestre`) e as calçadas
do GeoSampa (`calcada_sp`): liga cada aresta ao polígono de calçada que a
representa, gravando **só chaves e distância** em `conflacao_via_calcada` —
nunca geometria, nunca atributo copiado (é a peça que resolve ODbL ×
CC-BY-SA por modelagem, ver `docs/superpowers/specs/2026-09-08-*.md`).

A query roda inteira em EPSG:31983 (métrico) e usa exatamente a expressão
`ST_Transform(geom, 31983)` no `ST_DWithin`/`ST_Distance` — a mesma expressão
dos índices funcionais `via_pedestre_geom_31983_idx` e
`calcada_sp_geom_31983_idx` criados na migration `003_conflacao` (Task 1),
para que o planner reconheça e use os índices GiST em vez de varrer as
~25 mil × 22 mil geometrias.

**Armadilha encontrada na prática (14/09/2026):** o GEOS 3.9.0 desta imagem
(`pgrouting/pgrouting:latest`, PostGIS 3.5.2) tem um bug de robustez em que
`ST_Intersection`/`ST_Difference` entre uma `LineString` e um `Polygon`/
`MultiPolygon` **sempre devolve geometria vazia**, mesmo quando a linha está
inteiramente dentro do polígono — reproduzido até com coordenadas triviais
(`LINESTRING(0 0,10 0)` × um polígono que a contém de sobra), independente
de SRID, ordem dos operandos ou `ST_Buffer(...,0)`. Por isso `fracao_dentro`
(usada para decidir `'contido'`) **não** usa `ST_Intersection` direto: a via
é bufferizada numa faixa fininha (0,001 m, `endcap=flat`, sem sobra nas
pontas) e a fração vem da razão de **áreas** entre essa faixa e sua
interseção com a calçada — interseção Polígono × Polígono, que funciona
corretamente nesta mesma instância (confirmado à parte).

Regras de desempate (prioridade, em ordem):
1. `contido` — a aresta tem ≥ 80% do seu comprimento dentro do polígono
   (`fracao_dentro`); `distancia_m = 0`, `confianca = 1.0`. Sempre vence,
   independente do `metodo` pedido.
2. `mesmo_lado` (quando `metodo='mesmo_lado'`) — entre os candidatos a até
   `buffer_m` metros, liga ao mais próximo só quando ele não é ambíguo: a
   aresta já é a própria geometria da calçada (`esquema_calcada =
   'geometria_propria'`), ou não há segundo candidato dentro do buffer, ou o
   segundo candidato está a mais de 1,5× a distância do primeiro. Empate
   (dois lados da rua igualmente próximos) não liga — fica só em
   `ambiguas`, para não inventar um lado. `confianca = 1 - distancia_m /
   buffer_m`.
3. `mais_proximo` (quando `metodo='mais_proximo'`) — liga sempre ao mais
   próximo dentro do buffer, sem regra de desempate; é a linha de base
   usada só pela calibração (Task 3), nunca o método de produção.
"""

from sqlalchemy import Connection, Engine, text

from etl.db import concluir_execucao, registrar_execucao

METODOS_VALIDOS = {"mesmo_lado", "mais_proximo"}

# Uma única query: o CTE `cand` faz o único join com `ST_DWithin` (o caro),
# `ranqueado` ordena os candidatos de cada via e calcula a distância do
# segundo colocado (para a regra de empate), e a query final aplica as
# regras de desempate e devolve **uma linha por via com pelo menos um
# candidato no buffer**, com `ligada` dizendo se ela venceu a regra.
_SQL_CANDIDATOS = text(
    """
    WITH v AS (
        SELECT
            id,
            esquema_calcada,
            ST_Transform(geom, 31983) AS g,
            ST_Buffer(ST_Transform(geom, 31983), 0.001, 'endcap=flat') AS g_fino,
            ST_Area(ST_Buffer(ST_Transform(geom, 31983), 0.001, 'endcap=flat')) AS area_fino
        FROM via_pedestre
    ),
    c AS (
        SELECT id, ST_Transform(geom, 31983) AS g FROM calcada_sp
    ),
    cand AS (
        SELECT
            v.id AS via_id,
            v.esquema_calcada,
            c.id AS calcada_id,
            ST_Distance(v.g, c.g) AS distancia_m,
            -- fração do comprimento da via dentro da calçada, via razão de
            -- áreas (ver docstring do módulo: ST_Intersection linha×polígono
            -- é inutilizável nesta imagem do GEOS)
            ST_Area(ST_Intersection(v.g_fino, c.g)) / NULLIF(v.area_fino, 0) AS fracao_dentro
        FROM v
        JOIN c ON ST_DWithin(v.g, c.g, :buffer)
    ),
    ranqueado AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY via_id ORDER BY distancia_m, calcada_id) AS pos,
            lead(distancia_m) OVER (PARTITION BY via_id ORDER BY distancia_m, calcada_id)
                AS distancia_segundo
        FROM cand
    )
    SELECT
        via_id,
        calcada_id,
        distancia_m,
        CASE WHEN fracao_dentro >= 0.8 THEN 'contido' ELSE :metodo END AS metodo,
        CASE WHEN fracao_dentro >= 0.8 THEN 1.0 ELSE 1 - distancia_m / :buffer END AS confianca,
        (
            fracao_dentro >= 0.8
            OR :metodo = 'mais_proximo'
            OR esquema_calcada = 'geometria_propria'
            OR distancia_segundo IS NULL
            OR distancia_segundo > 1.5 * GREATEST(distancia_m, 0.5)
        ) AS ligada
    FROM ranqueado
    WHERE pos = 1
    """
)

_SQL_TOTAL_ARESTAS = text("SELECT count(*) FROM via_pedestre")
_SQL_LIMPAR = text("DELETE FROM conflacao_via_calcada")
_SQL_INSERIR = text(
    """
    INSERT INTO conflacao_via_calcada
        (via_id, calcada_id, distancia_m, confianca, metodo, buffer_m)
    VALUES (:via_id, :calcada_id, :distancia_m, :confianca, :metodo, :buffer_m)
    """
)


def _candidatos(conexao: Connection, buffer_m: float, metodo: str) -> list:
    """Roda `_SQL_CANDIDATOS` e devolve as linhas (uma por via com ao menos
    um candidato dentro de `buffer_m`), como `RowMapping` (acesso por nome:
    `linha["via_id"]`, `linha["ligada"]`, ...)."""
    return (
        conexao.execute(_SQL_CANDIDATOS, {"buffer": buffer_m, "metodo": metodo})
        .mappings()
        .all()
    )


def _metricas(linhas: list, total_arestas: int) -> dict:
    ligadas = [linha for linha in linhas if linha["ligada"]]
    por_metodo: dict[str, int] = {}
    for linha in ligadas:
        por_metodo[linha["metodo"]] = por_metodo.get(linha["metodo"], 0) + 1
    distancia_media_m = (
        sum(float(linha["distancia_m"]) for linha in ligadas) / len(ligadas)
        if ligadas
        else 0.0
    )
    return {
        "arestas": total_arestas,
        "ligadas": len(ligadas),
        "cobertura": len(ligadas) / total_arestas if total_arestas else 0.0,
        "distancia_media_m": distancia_media_m,
        "por_metodo": por_metodo,
        # candidato(s) existia(m) no buffer, mas a regra de desempate do
        # 'mesmo_lado' recusou ligar (empate entre os dois lados da rua) —
        # usado pela calibração (Task 3) para reportar "% ambíguas".
        "ambiguas": len(linhas) - len(ligadas),
    }


def executar(
    engine: Engine,
    buffer_m: float = 5.0,
    metodo: str = "mesmo_lado",
    *,
    so_medir: bool = False,
) -> dict:
    """Liga cada `via_pedestre` à `calcada_sp` mais adequada dentro de
    `buffer_m` metros (ver regras no docstring do módulo).

    Com `so_medir=True` a query roda, mas nada é gravado — nem em
    `conflacao_via_calcada`, nem em `etl_execucao` — só as métricas voltam;
    é o modo usado pela calibração do buffer (Task 3), que roda a query
    dezenas de vezes. Com `so_medir=False` (padrão), a tabela
    `conflacao_via_calcada` é recriada do zero (`DELETE` + `INSERT` na mesma
    transação) e a execução fica registrada em `etl_execucao` com fonte
    `'conflacao'`.
    """
    if metodo not in METODOS_VALIDOS:
        raise ValueError(
            f"metodo inválido: {metodo!r} (esperado um de {METODOS_VALIDOS})"
        )

    if so_medir:
        with engine.connect() as conexao:
            linhas = _candidatos(conexao, buffer_m, metodo)
            total_arestas = conexao.execute(_SQL_TOTAL_ARESTAS).scalar_one()
        return _metricas(linhas, total_arestas)

    execucao_id = registrar_execucao(engine, "conflacao")
    try:
        with engine.begin() as conexao:
            linhas = _candidatos(conexao, buffer_m, metodo)
            total_arestas = conexao.execute(_SQL_TOTAL_ARESTAS).scalar_one()
            resultado = _metricas(linhas, total_arestas)

            conexao.execute(_SQL_LIMPAR)
            ligadas = [linha for linha in linhas if linha["ligada"]]
            if ligadas:
                conexao.execute(
                    _SQL_INSERIR,
                    [
                        {
                            "via_id": linha["via_id"],
                            "calcada_id": linha["calcada_id"],
                            "distancia_m": linha["distancia_m"],
                            "confianca": linha["confianca"],
                            "metodo": linha["metodo"],
                            "buffer_m": buffer_m,
                        }
                        for linha in ligadas
                    ],
                )

        concluir_execucao(engine, execucao_id, "ok", linhas=resultado["ligadas"])
        return resultado
    except Exception as exc:
        concluir_execucao(engine, execucao_id, "erro", detalhe=str(exc)[:2000])
        raise
