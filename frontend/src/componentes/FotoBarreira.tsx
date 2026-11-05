import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar, focoPerdido } from '../a11y/foco'
import { anexarFoto, removerFoto, type Barreira } from '../api/colaboracao'
import { useAcaoComLogin } from '../auth/useAcaoComLogin'
import { erroDaDescricao, erroDoArquivo } from '../dados/barreira'
import { Pictograma } from './Pictograma'
import { Placa } from './Placa'
import { PortaoLogin } from './PortaoLogin'
import { useAnuncio } from './useAnuncio'
import { useEsperaServidor } from './useEsperaServidor'

const MSG_FOTO_FORA = 'Envio de foto indisponível. Sua barreira já está registrada.'

type ErroCampo = { campo: 'arquivo' | 'descricao'; texto: string }

/** Foto sempre opcional, sem zona de arrastar: o input nativo é a via única e basta (2.5.7). */
export function FotoBarreira({ barreira, aoAtualizar }: { barreira: Barreira; aoAtualizar: (b: Barreira) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [descricao, setDescricao] = useState('')
  const [erro, setErro] = useState<ErroCampo | null>(null)
  const [removida, setRemovida] = useState(false)
  const campoDescricao = useRef<HTMLTextAreaElement>(null)
  const campoArquivo = useRef<HTMLInputElement>(null)
  const botaoEnviar = useRef<HTMLButtonElement>(null)
  const botaoRemover = useRef<HTMLButtonElement>(null)
  const retornoRemocao = useRef<HTMLParagraphElement>(null)
  const anunciar = useAnuncio()

  useEffect(() => {
    if (!arquivo) {
      setPrevia(null)
      return
    }
    const url = URL.createObjectURL(arquivo)
    setPrevia(url)
    return () => URL.revokeObjectURL(url)
  }, [arquivo])

  function marcarErro(novo: ErroCampo, campo: HTMLElement | null) {
    flushSync(() => setErro(novo))
    focarOuAnunciar(campo, novo.texto, anunciar)
  }

  function montarEnvio(): [File, string] | null {
    if (!arquivo) {
      marcarErro({ campo: 'arquivo', texto: 'Escolha uma foto.' }, campoArquivo.current)
      return null
    }
    const invalida = erroDaDescricao(descricao)
    if (invalida) {
      marcarErro({ campo: 'descricao', texto: invalida }, campoDescricao.current)
      return null
    }
    setErro(null)
    return [arquivo, descricao.trim()]
  }

  const envio = useAcaoComLogin(
    (token: string, a: File, d: string) => anexarFoto(token, barreira.id, a, d),
    (atualizada) => {
      setArquivo(null)
      // o input é não controlado: sem isto, ele segue mostrando o arquivo já enviado
      if (campoArquivo.current) campoArquivo.current.value = ''
      setDescricao('')
      setErro(null)
      setRemovida(false)
      aoAtualizar(atualizada)
      anunciar('Foto enviada.')
    },
    { montarArgs: montarEnvio, textoEnvio: 'Enviando a foto.' },
  )
  const remocao = useAcaoComLogin(
    (token: string) => removerFoto(token, barreira.id),
    (atualizada) => {
      setRemovida(true)
      aoAtualizar(atualizada)
    },
    { textoEnvio: 'Removendo a foto.' },
  )
  const enviando = envio.estado.fase === 'enviando'
  const removendo = remocao.estado.fase === 'enviando'
  const espera = useEsperaServidor(enviando || removendo)

  // "Remover foto" sai da tela com o sucesso: o foco vai à frase, que se lê sozinha
  useEffect(() => {
    if (!removida) return
    if (focoPerdido()) retornoRemocao.current?.focus()
    else anunciar('Foto removida.')
  }, [removida, anunciar])

  const falha = envio.estado.fase === 'erro' ? envio.estado.erro : remocao.estado.fase === 'erro' ? remocao.estado.erro : null
  const mensagemFalha = falha ? (falha.tipo === 'indisponivel' ? MSG_FOTO_FORA : falha.message) : null
  useEffect(() => {
    if (mensagemFalha) anunciar(mensagemFalha)
  }, [mensagemFalha, anunciar])

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const args = montarEnvio()
    if (args) void envio.executar(...args)
  }

  return (
    <section className="foto" aria-labelledby="titulo-foto">
      <h2 id="titulo-foto" className="letreiro colaborar__titulo">
        Foto (opcional)
      </h2>
      {barreira.foto_url && (
        <Placa ref={botaoRemover} aria-disabled={removendo || undefined} onClick={() => void remocao.executar()}>
          Remover foto
        </Placa>
      )}
      {removendo && <p className="campo__retorno">{espera ?? 'Removendo a foto…'}</p>}
      {removida && !barreira.foto_url && (
        <p ref={retornoRemocao} tabIndex={-1} className="campo__retorno">
          Foto removida.
        </p>
      )}
      <form onSubmit={enviar} noValidate className="foto__form" aria-label="Enviar foto">
        <div className="campo">
          <label htmlFor="foto-arquivo">Arquivo da foto</label>
          <p id="foto-aviso" className="campo__dica">
            Removemos a localização gravada na foto. Evite rostos e placas de carro; não há borramento automático. A foto
            fica pública, sob a licença CC BY-SA 4.0.
          </p>
          <input
            ref={campoArquivo}
            id="foto-arquivo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-invalid={erro?.campo === 'arquivo' ? true : undefined}
            aria-describedby={erro?.campo === 'arquivo' ? 'foto-aviso foto-erro-arquivo' : 'foto-aviso'}
            onChange={(e) => {
              const escolhido = e.target.files?.[0] ?? null
              const invalido = escolhido && erroDoArquivo(escolhido)
              setArquivo(invalido ? null : escolhido)
              if (invalido) {
                e.target.value = '' // escolher de novo o mesmo arquivo precisa disparar change
                marcarErro({ campo: 'arquivo', texto: invalido }, e.target)
              } else setErro(null)
            }}
          />
          {erro?.campo === 'arquivo' && (
            <p id="foto-erro-arquivo" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro.texto}</span>
            </p>
          )}
        </div>
        {previa && <img className="foto__previa" src={previa} alt={descricao.trim() || 'Prévia da foto, ainda sem descrição'} />}
        <div className="campo">
          <label htmlFor="foto-descricao">O que a foto mostra</label>
          <p id="foto-dica" className="campo__dica">
            Quem não enxerga a foto vai ouvir este texto. De 5 a 300 caracteres.
          </p>
          <textarea
            ref={campoDescricao}
            id="foto-descricao"
            rows={2}
            maxLength={300}
            aria-invalid={erro?.campo === 'descricao' ? true : undefined}
            aria-describedby={erro?.campo === 'descricao' ? 'foto-dica foto-erro-descricao' : 'foto-dica'}
            value={descricao}
            onChange={(e) => {
              setDescricao(e.target.value)
              if (erro?.campo === 'descricao') setErro(null)
            }}
          />
          {erro?.campo === 'descricao' && (
            <p id="foto-erro-descricao" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro.texto}</span>
            </p>
          )}
        </div>
        {mensagemFalha && (
          <p className="campo__retorno campo__retorno--erro">
            <Pictograma nome="alerta" />
            <span>{mensagemFalha}</span>
          </p>
        )}
        <Placa ref={botaoEnviar} type="submit" pictograma="foto" aria-disabled={enviando || undefined}>
          Enviar foto
        </Placa>
        {enviando && <p className="campo__retorno">{espera ?? 'Enviando a foto…'}</p>}
      </form>
      {envio.estado.fase === 'login' && <PortaoLogin motivo={envio.estado.motivo} refRetorno={botaoEnviar} refTitulo={envio.refPortao} aoEntrar={envio.concluirLogin} aoCancelar={envio.cancelarLogin} />}
      {remocao.estado.fase === 'login' && <PortaoLogin motivo={remocao.estado.motivo} refRetorno={botaoRemover} refTitulo={remocao.refPortao} aoEntrar={remocao.concluirLogin} aoCancelar={remocao.cancelarLogin} />}
    </section>
  )
}
