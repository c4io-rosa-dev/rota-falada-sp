"""Erros de domínio da camada colaborativa, cada um com seu status HTTP. Os
routers traduzem qualquer `ErroDominio` em `HTTPException(status_http, str(erro))`."""

from __future__ import annotations


class ErroDominio(Exception):
    status_http: int = 400
    mensagem: str = "Requisição inválida."

    def __init__(self, mensagem: str | None = None) -> None:
        super().__init__(mensagem or self.mensagem)


class NaoEncontrada(ErroDominio):
    status_http = 404
    mensagem = "Barreira não encontrada."


class ForaDaArea(ErroDominio):
    status_http = 422
    mensagem = "Este ponto está fora da área atendida pelo Rota Falada SP."


class LimiteDiario(ErroDominio):
    status_http = 429
    mensagem = "Limite de 20 barreiras por dia atingido. Tente de novo amanhã."


class AutorNaoVota(ErroDominio):
    status_http = 403
    mensagem = "Quem cadastrou a barreira não pode votar nela."


class BarreiraEncerrada(ErroDominio):
    status_http = 409
    mensagem = "Esta barreira não recebe mais votos."


class SemPermissao(ErroDominio):
    status_http = 403
    mensagem = "Você não tem permissão para esta ação."


class FotoGrande(ErroDominio):
    status_http = 413
    mensagem = "A foto pode ter no máximo 5 MB."


class FotoFormato(ErroDominio):
    status_http = 415
    mensagem = "Envie uma foto JPEG, PNG ou WebP de até 40 megapixels."


class DescricaoFotoInvalida(ErroDominio):
    status_http = 422
    mensagem = "Descreva a foto com 5 a 300 caracteres."


class StorageIndisponivel(ErroDominio):
    status_http = 503
    mensagem = "Envio de foto indisponível no momento."
