import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar } from '../a11y/foco'
import '../estilos/rota.css'
import { enviarCodigo, verificarCodigo } from '../auth/cliente'
import { erroDoCodigo, mensagemDeErroAuth, normalizarCodigo } from '../auth/erros'
import { Pictograma } from './Pictograma'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'

const CHAVE_PASSO = 'rf-login'
const ESPERA_REENVIO_MS = 60_000
const MAX_REENVIOS = 3

type PassoGravado = { email: string; enviadoEm: number; reenvios: number }

function lerPasso(): PassoGravado | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_PASSO)
    return bruto ? (JSON.parse(bruto) as PassoGravado) : null
  } catch {
    return null
  }
}

function gravarPasso(passo: PassoGravado | null) {
  try {
    if (passo) sessionStorage.setItem(CHAVE_PASSO, JSON.stringify(passo))
    else sessionStorage.removeItem(CHAVE_PASSO)
  } catch {
    // o celular pode descarregar a aba; sem armazenamento, volta ao e-mail
  }
}

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

/**
 * Login por código de 6 dígitos em campo único: seis caixas fazem o NVDA anunciar seis
 * campos e quebram ao colar. Sem envio automático ao sexto dígito (WCAG 3.2.2) e sem
 * contador regressivo (nada se move sem ação). O código nunca é guardado.
 */
export function FluxoCodigo({ aoEntrar }: { aoEntrar: () => void }) {
  const [passo, setPasso] = useState<PassoGravado | null>(lerPasso)
  const [email, setEmail] = useState(passo?.email ?? '')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [esperando, setEsperando] = useState<string | null>(null)
  const [, renderizar] = useState(0)
  const campoCodigo = useRef<HTMLInputElement>(null)
  const campoEmail = useRef<HTMLInputElement>(null)
  const anunciar = useAnuncio()
  // uma página pode ter dois portões: os rótulos não podem apontar para o campo do outro
  const base = useId()
  const ids = {
    email: `${base}-email`,
    emailDica: `${base}-email-dica`,
    emailErro: `${base}-email-erro`,
    codigo: `${base}-codigo`,
    codigoDica: `${base}-codigo-dica`,
    codigoErro: `${base}-codigo-erro`,
    reenvioDica: `${base}-reenvio-dica`,
    reenvioAviso: `${base}-reenvio-aviso`,
  }
  const ocupado = esperando !== null
  const liberaEm = passo ? passo.enviadoEm + ESPERA_REENVIO_MS : null

  useEffect(() => {
    if (passo) campoCodigo.current?.focus()
    // só quando troca de passo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo?.email])

  // sem contador: um único render na hora em que o reenvio libera, para o botão não mentir
  useEffect(() => {
    if (liberaEm === null) return
    const resta = liberaEm - Date.now()
    if (resta <= 0) return
    const relogio = setTimeout(() => renderizar((n) => n + 1), resta)
    return () => clearTimeout(relogio)
  }, [liberaEm])

  function esperar(texto: string) {
    setEsperando(`${texto}…`)
    anunciar(`${texto}.`)
  }

  function mostrarErro(texto: string, campo: HTMLInputElement | null) {
    flushSync(() => {
      setErro(texto)
      setEsperando(null)
    })
    focarOuAnunciar(campo, texto, anunciar)
  }

  async function pedirCodigo(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    if (!email.includes('@')) {
      mostrarErro('Confira o e-mail digitado.', campoEmail.current)
      return
    }
    esperar('Enviando o código')
    setErro(null)
    try {
      await enviarCodigo(email.trim())
      const novo = { email: email.trim(), enviadoEm: Date.now(), reenvios: 0 }
      gravarPasso(novo)
      setPasso(novo)
      setEsperando(null)
    } catch (falha) {
      mostrarErro(mensagemDeErroAuth(falha), campoEmail.current)
    }
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    if (ocupado || !passo) return
    const limpo = normalizarCodigo(codigo)
    const invalido = erroDoCodigo(limpo)
    if (invalido) {
      mostrarErro(invalido, campoCodigo.current)
      return
    }
    esperar('Confirmando o código')
    setErro(null)
    try {
      await verificarCodigo(passo.email, limpo)
      gravarPasso(null)
      setEsperando(null)
      aoEntrar()
    } catch (falha) {
      mostrarErro(mensagemDeErroAuth(falha), campoCodigo.current)
    }
  }

  async function reenviar() {
    if (!passo || ocupado || liberaEm === null) return
    if (passo.reenvios >= MAX_REENVIOS) {
      anunciar('Confira o spam ou tente mais tarde.')
      return
    }
    if (Date.now() < liberaEm) {
      anunciar(`Você pode pedir outro código a partir das ${HORA.format(liberaEm)}.`)
      return
    }
    esperar('Enviando outro código')
    try {
      await enviarCodigo(passo.email)
      const novo = { ...passo, enviadoEm: Date.now(), reenvios: passo.reenvios + 1 }
      gravarPasso(novo)
      setPasso(novo)
      setAviso('Enviamos outro código. Use sempre o mais recente.')
      anunciar('Enviamos outro código. Use sempre o mais recente.')
    } catch (falha) {
      const frase = mensagemDeErroAuth(falha)
      setAviso(frase)
      anunciar(frase)
    } finally {
      setEsperando(null)
    }
  }

  function trocarEmail() {
    gravarPasso(null)
    setPasso(null)
    setCodigo('')
    setErro(null)
    setAviso(null)
    setTimeout(() => campoEmail.current?.focus())
  }

  if (!passo) {
    return (
      <form className="fluxo-codigo" onSubmit={pedirCodigo} noValidate aria-label="Receber código por e-mail">
        <div className="campo">
          <label htmlFor={ids.email}>E-mail</label>
          <p id={ids.emailDica} className="campo__dica">
            Seu e-mail serve só para contar um voto por pessoa. Suas rotas não ficam ligadas à sua conta.
          </p>
          <input
            ref={campoEmail}
            id={ids.email}
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${ids.emailDica} ${ids.emailErro}` : ids.emailDica}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {erro && (
            <p id={ids.emailErro} className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro}</span>
            </p>
          )}
        </div>
        <Placa type="submit" variante="acao" pictograma="siga" aria-disabled={ocupado || undefined}>
          Receber código
        </Placa>
        {esperando && <p className="campo__retorno">{esperando}</p>}
      </form>
    )
  }

  const bloqueado = liberaEm !== null && Date.now() < liberaEm
  const esgotado = passo.reenvios >= MAX_REENVIOS
  const dicaReenvio = esgotado
    ? 'Confira o spam ou tente mais tarde.'
    : bloqueado && liberaEm !== null
      ? `Você pode pedir outro código a partir das ${HORA.format(liberaEm)}.`
      : 'Você já pode pedir outro código.'
  return (
    <div className="fluxo-codigo">
      <form onSubmit={confirmar} noValidate aria-label="Confirmar código">
        <div className="campo">
          <label htmlFor={ids.codigo}>Código de 6 dígitos</label>
          <p id={ids.codigoDica} className="campo__dica">
            Enviamos para {passo.email}. Confira também o spam. Use sempre o código mais recente.
          </p>
          <input
            ref={campoCodigo}
            id={ids.codigo}
            name="codigo"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${ids.codigoDica} ${ids.codigoErro}` : ids.codigoDica}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          {erro && (
            <p id={ids.codigoErro} className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro}</span>
            </p>
          )}
        </div>
        <Placa type="submit" variante="acao" pictograma="siga" aria-disabled={ocupado || undefined}>
          Confirmar código
        </Placa>
      </form>
      {esperando && <p className="campo__retorno">{esperando}</p>}
      <div className="fluxo-codigo__apoio">
        <Placa onClick={reenviar} aria-disabled={bloqueado || esgotado || ocupado || undefined} aria-describedby={aviso ? `${ids.reenvioDica} ${ids.reenvioAviso}` : ids.reenvioDica}>
          Reenviar código
        </Placa>
        <Placa onClick={trocarEmail}>Trocar e-mail</Placa>
      </div>
      {/* a frase fica sempre: trocar o texto não empurra nada quando o reenvio libera */}
      <p id={ids.reenvioDica} className="campo__dica fluxo-codigo__reenvio">
        {dicaReenvio}
      </p>
      {aviso && (
        <p id={ids.reenvioAviso} className="campo__retorno">
          {aviso}
        </p>
      )}
    </div>
  )
}
