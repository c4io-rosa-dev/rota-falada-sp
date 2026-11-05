"""Normalização de texto da busca de endereços (spec 2026-11-02-geocode-design.md, 3.3).

Este arquivo existe em dois lugares com conteúdo IDÊNTICO, byte a byte:
`backend/app/services/normalizacao.py` e `etl/etl/normalizacao.py` (a imagem
Docker do ETL só copia `etl/`). O ETL grava `endereco.texto_busca` com
`normalizar` e o backend normaliza o texto digitado com a mesma função; se as
duas cópias divergirem, a busca deixa de casar.
`backend/tests/test_normalizacao_paridade.py` falha se os arquivos diferirem.
"""

import re
import unicodedata

# Só a palavra inteira é trocada. `est` fica de fora de propósito: é ambíguo
# entre "estrada" e "estação", e sem expansão "est vila mariana" ainda casa
# por prefixo com "estacao vila mariana".
ABREVIACOES: dict[str, str] = {
    "r": "rua",
    "av": "avenida",
    "avn": "avenida",
    "al": "alameda",
    "pca": "praca",
    "pc": "praca",
    "tv": "travessa",
    "trav": "travessa",
    "vd": "viaduto",
    "lgo": "largo",
    "dr": "doutor",
    "prof": "professor",
    "sto": "santo",
    "sta": "santa",
    "cel": "coronel",
    "gal": "general",
    "gen": "general",
}

_NAO_ALFANUMERICO = re.compile(r"[^a-z0-9]+")
_NUMERO_FINAL = re.compile(r"^(.*\S)\s+(\d+)(?:\s?([a-z]))?$")


def normalizar(texto: str) -> str:
    """Minúsculas, sem acento, só letras e dígitos separados por um espaço,
    abreviações de logradouro e de título expandidas."""
    decomposto = unicodedata.normalize("NFKD", texto.lower())
    sem_acento = "".join(c for c in decomposto if not unicodedata.combining(c))
    palavras = _NAO_ALFANUMERICO.sub(" ", sem_acento).split()
    return " ".join(ABREVIACOES.get(palavra, palavra) for palavra in palavras)


def separar_numero(texto_normalizado: str) -> tuple[str, str | None]:
    """Separa o número do fim do texto já normalizado.

    "rua vergueiro 1000" -> ("rua vergueiro", "1000");
    "rua vergueiro 1000 a" -> ("rua vergueiro", "1000a");
    sem número no fim (ou só o número) -> (texto, None).
    """
    casamento = _NUMERO_FINAL.match(texto_normalizado)
    if casamento is None:
        return texto_normalizado, None
    rua, digitos, letra = casamento.groups()
    return rua, digitos + (letra or "")
