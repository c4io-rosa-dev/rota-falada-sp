"""ETL das reclamações do SP156 (CKAN) para `barreira_oficial`.

O CSV do SP156 é servido em `cp1252` (não UTF-8/latin-1 estrito): o campo
`Serviço` mistura hífen comum e travessão — inclusive o byte solto `\\x96`,
que aparece em exportações antigas do sistema no lugar do travessão. Sem
`normalizar_traco`, o mesmo serviço apareceria com textos diferentes e não
bateria com `CATEGORIAS`.
"""

import re
import unicodedata
from datetime import date

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import Point
from shapely.ops import unary_union
from sqlalchemy import Engine, text

from etl.config import AREA_PILOTO, DIR_DADOS, UA, URL_CKAN_SP156
from etl.db import concluir_execucao, fonte_id, registrar_execucao
from etl.download import baixar
from etl.geo import bbox_para_poligono

# Usado só se o CKAN estiver fora do ar ou não devolver nenhum recurso CSV
# reconhecível como "Dados do SP156" (ver `descobrir_url`).
URL_CSV_FALLBACK = (
    "https://dados.prefeitura.sp.gov.br/dataset/0aecfa2b-aa3a-40d4-8183-0d4351b7fd0a/"
    "resource/368eb32d-ef25-4441-be8f-fce0146575a1/download/arquivo-final-2-trim-26.csv"
)

# User-Agent de navegador: usado como segunda tentativa se a API do CKAN
# bloquear a requisição com o UA do projeto (WAF) — ver `etl/README.md`.
UA_NAVEGADOR = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

COLUNAS = [
    "Data de Abertura",
    "Data de Finalização",
    "Assunto",
    "Serviço",
    "Status",
    "Latitude",
    "Longitude",
    "Distrito",
]

# serviço (já com `normalizar_traco` aplicado) -> categoria de `barreira_oficial`.
CATEGORIAS: dict[str, str] = {
    "Acessibilidade - solicitar avaliação de obstáculo na calçada": "obstaculo_calcada",
    "Calçada pública - solicitar manutenção": "calcada_danificada",
    "Calçada particular - denunciar calçada danificada ou inexistente": "calcada_danificada",
    "Guias para travessia de pedestres - Solicitar rebaixamento": "guia_sem_rebaixamento",
    "Travessia de pedestres - Solicitar avaliação": "travessia",
    "Guias, sarjetas e sarjetões - solicitar manutenção": "guia_danificada",
    "Árvore - Solicitar avaliação em calçadas e praças": "raiz_de_arvore",
    "Tapa-buraco": "buraco",
}

# casa (– U+2013, — U+2014, ou o byte solto \x96 do cp1252) cercado de
# espaços opcionais — nunca um hífen comum, que fica intocado (ex.: em
# "Tapa-buraco", uma única palavra composta, não um separador de categoria).
_TRAVESSAO = re.compile(r"\s*[–—\x96]\s*")


def normalizar_traco(s: str) -> str:
    """Troca travessão (–, —) e o byte solto `\\x96` (cp1252) por `-` com um
    espaço de cada lado, e colapsa os espaços ao redor do caractere trocado.
    Hífen comum (`-`) não é tocado."""
    return _TRAVESSAO.sub(" - ", s).strip()


def _chave_normalizada(servico: str) -> str:
    """Comparação de `Serviço` com `CATEGORIAS` ignora acentuação e caixa: a
    fonte não usa as duas de forma consistente entre trimestres."""
    sem_acento = (
        unicodedata.normalize("NFKD", servico).encode("ascii", "ignore").decode("ascii")
    )
    return re.sub(r"\s+", " ", sem_acento).strip().lower()


_CATEGORIA_POR_CHAVE: dict[str, str] = {
    _chave_normalizada(normalizar_traco(servico)): categoria
    for servico, categoria in CATEGORIAS.items()
}


def categoria_de(servico: str) -> str | None:
    """Categoria de `barreira_oficial` para um `Serviço` já normalizado, ou
    `None` se o serviço não interessa (a imensa maioria: SP156 cobre toda a
    prefeitura, não só acessibilidade)."""
    return _CATEGORIA_POR_CHAVE.get(_chave_normalizada(servico))


def _para_float(valor) -> float | None:
    """Converte `Latitude`/`Longitude` (vírgula decimal possível) para
    `float`; célula vazia ou não numérica vira `None` (linha descartada em
    `ler`, pois uma barreira sem coordenada não pode ser um `Point`)."""
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    texto = str(valor).strip()
    if not texto:
        return None
    try:
        return float(texto.replace(",", "."))
    except ValueError:
        return None


def ler(caminho) -> pd.DataFrame:
    """Lê o CSV do SP156 (`;`, `cp1252`) só com as colunas usadas, normaliza
    `Serviço` e `Latitude`/`Longitude`, e descarta linhas sem coordenada."""
    df = pd.read_csv(caminho, sep=";", encoding="cp1252", usecols=COLUNAS, dtype=str)
    df["Serviço"] = df["Serviço"].map(
        lambda v: normalizar_traco(v) if isinstance(v, str) else v
    )
    df["Latitude"] = df["Latitude"].map(_para_float)
    df["Longitude"] = df["Longitude"].map(_para_float)
    df = df.dropna(subset=["Latitude", "Longitude"]).reset_index(drop=True)
    return df


def _dentro_da_area_piloto(df: pd.DataFrame) -> pd.DataFrame:
    """Mantém só as linhas cujo ponto (`Longitude`, `Latitude`) cai dentro da
    união das três `area_piloto`; feito em Python com Shapely, pois os
    registros ainda não foram inseridos no banco nesta etapa."""
    uniao_piloto = unary_union(
        [bbox_para_poligono(bbox) for bbox in AREA_PILOTO.values()]
    )
    dentro = [
        Point(longitude, latitude).within(uniao_piloto)
        for latitude, longitude in zip(df["Latitude"], df["Longitude"], strict=True)
    ]
    return df[dentro].reset_index(drop=True)


# casa "Dados do SP156 - 2º TRI 2026" (também "SEM" de anos mais antigos,
# quando a prefeitura publicava por semestre) já sobre o texto normalizado
# (sem acento/caixa, "º"/"°" viram "o" pelo NFKD).
_PERIODO_NO_NOME = re.compile(r"(\d)\s*[oa]?\s*(tri|sem)\S*\s*(\d{4})")


def _chave_periodo(nome: str) -> float | None:
    """Chave ordenável (ano + fração do período dentro do ano) a partir do
    nome do recurso, por exemplo "Dados do SP156 - 2º TRI 2026" -> 2026.25;
    `None` se o nome não seguir o padrão "Nº TRI/SEM AAAA".

    Não dá para confiar em `last_modified`/`created` para achar o recurso
    mais recente: o CKAN da prefeitura registra edições de metadado feitas
    manualmente em recursos antigos, então um trimestre de anos atrás pode
    ter `last_modified` mais novo que o trimestre atual (confirmado ao vivo
    em 14/09/2026: "2º TRI 2021" apareceu com `last_modified` posterior ao do
    "2º TRI 2026" de fato mais recente) — só o período no próprio nome do
    recurso é confiável."""
    correspondencia = _PERIODO_NO_NOME.search(_chave_normalizada(nome))
    if not correspondencia:
        return None
    periodo, tipo, ano = correspondencia.groups()
    divisor = 4 if tipo == "tri" else 2
    return int(ano) + (int(periodo) - 1) / divisor


def descobrir_url() -> str:
    """Escolhe, via `package_show` do CKAN, o recurso CSV mais recente da
    família "Dados do SP156": pelo período no nome (`_chave_periodo`) quando
    dá pra extrair, senão por `last_modified`/`created` como último recurso.
    Tenta primeiro com o `User-Agent` do projeto e, se a requisição falhar (o
    CKAN da prefeitura tem WAF), tenta de novo com um `User-Agent` de
    navegador antes de cair no `URL_CSV_FALLBACK` fixo."""
    for user_agent in (UA, UA_NAVEGADOR):
        try:
            resposta = requests.get(
                URL_CKAN_SP156, headers={"User-Agent": user_agent}, timeout=30
            )
            resposta.raise_for_status()
            recursos = resposta.json()["result"]["resources"]
        except (requests.RequestException, ValueError, KeyError):
            continue

        candidatos = [
            recurso
            for recurso in recursos
            if (recurso.get("format") or "").strip().upper() == "CSV"
            and "sp156" in _chave_normalizada(recurso.get("name") or "")
        ]
        com_periodo = [
            (recurso, _chave_periodo(recurso.get("name") or ""))
            for recurso in candidatos
        ]
        com_periodo = [
            (recurso, chave) for recurso, chave in com_periodo if chave is not None
        ]
        if com_periodo:
            mais_recente, _ = max(com_periodo, key=lambda item: item[1])
            return mais_recente["url"]
        if candidatos:
            mais_recente = max(
                candidatos,
                key=lambda r: r.get("last_modified") or r.get("created") or "",
            )
            return mais_recente["url"]

    return URL_CSV_FALLBACK


def executar(engine: Engine) -> dict:
    """Baixa (ou reaproveita) o CSV mais recente do SP156, filtra pelas
    categorias de acessibilidade e pela área piloto, e carrega
    `barreira_oficial`. `data_referencia` é a maior `Data de Abertura` do
    arquivo baixado (a data de referência da própria carga, não uma data
    fixa como no GeoSampa)."""
    execucao_id = registrar_execucao(engine, "sp156")
    try:
        url = descobrir_url()
        caminho = baixar(url, DIR_DADOS / "sp156.csv", tamanho_minimo=10_000_000)
        df = ler(caminho)

        df["categoria"] = df["Serviço"].map(categoria_de)
        df = df[df["categoria"].notna()].reset_index(drop=True)
        df = _dentro_da_area_piloto(df)

        data_abertura = pd.to_datetime(
            df["Data de Abertura"], format="%d/%m/%Y", errors="coerce"
        )
        data_finalizacao = pd.to_datetime(
            df["Data de Finalização"], format="%d/%m/%Y", errors="coerce"
        )
        data_ref = data_abertura.max()
        if pd.isna(data_ref):
            data_ref = pd.Timestamp(date.today())  # noqa: DTZ011 — data_referencia é DATE (sem fuso)

        fid = fonte_id(engine, "sp156")
        registros = pd.DataFrame(
            {
                "categoria": df["categoria"],
                "servico": df["Serviço"],
                "status": df["Status"],
                "data_abertura": data_abertura.dt.date,
                "data_finalizacao": data_finalizacao.dt.date,
                "distrito": df["Distrito"],
                "fonte_id": fid,
                "data_referencia": data_ref.date(),
            }
        )
        geometria = [
            Point(longitude, latitude)
            for latitude, longitude in zip(df["Latitude"], df["Longitude"], strict=True)
        ]
        gdf = gpd.GeoDataFrame(registros, geometry=geometria, crs="EPSG:4326")
        gdf = gdf.rename_geometry("geom")

        with engine.begin() as conexao:
            conexao.execute(text("DELETE FROM barreira_oficial"))
            gdf.to_postgis("barreira_oficial", conexao, if_exists="append", index=False)

        resultado = {"barreiras": len(gdf)}
        concluir_execucao(engine, execucao_id, "ok", linhas=resultado["barreiras"])
        return resultado
    except Exception as exc:
        concluir_execucao(engine, execucao_id, "erro", detalhe=str(exc)[:2000])
        raise
