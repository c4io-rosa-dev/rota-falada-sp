"""Download cacheado dos arquivos brutos das fontes oficiais.

Os arquivos crus (PBF, ZIP, CSV) ficam em `etl/dados/`, fora do git, e são
reaproveitados entre execuções para o ETL não precisar baixar centenas de MB
a cada corrida local — só o cron semanal do GitHub Actions baixa sempre.
"""

import time
from pathlib import Path

import requests

from etl.config import UA


class DownloadInvalido(Exception):
    """O arquivo baixado é menor que o `tamanho_minimo` esperado."""


def baixar(
    url: str,
    destino: Path,
    max_idade_dias: int = 7,
    tamanho_minimo: int = 1024,
) -> Path:
    """Baixa `url` para `destino`, reaproveitando o cache quando recente.

    Pula o download se `destino` já existe e foi modificado há menos de
    `max_idade_dias`. Sempre envia o `User-Agent` do projeto. Levanta
    `DownloadInvalido` se o arquivo final tiver menos de `tamanho_minimo`
    bytes (download incompleto ou página de erro no lugar do arquivo).
    """
    destino.parent.mkdir(parents=True, exist_ok=True)

    if destino.exists():
        idade_segundos = time.time() - destino.stat().st_mtime
        if idade_segundos < max_idade_dias * 86400:
            return destino

    cabecalhos = {"User-Agent": UA}
    with requests.get(url, headers=cabecalhos, stream=True, timeout=300) as resposta:
        resposta.raise_for_status()
        tmp = destino.with_suffix(destino.suffix + ".tmp")
        with open(tmp, "wb") as arquivo:
            arquivo.writelines(resposta.iter_content(chunk_size=1024 * 1024))
        tmp.replace(destino)

    tamanho = destino.stat().st_size
    if tamanho < tamanho_minimo:
        detalhe = f"{destino.name}: {tamanho} bytes, esperado >= {tamanho_minimo}"
        raise DownloadInvalido(detalhe)

    return destino
