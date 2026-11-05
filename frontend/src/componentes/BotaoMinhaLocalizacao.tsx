import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ErroApi, ehCancelamento, MSG_INESPERADO } from '../api/base'
import { enderecoDoPonto, type Endereco } from '../api/client'
import { arredondar4, ErroLocalizacao, obterPosicao, PRECISAO_ACEITAVEL_M, temGeolocalizacao } from '../dados/localizacao'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'
import { useEsperaServidor } from './useEsperaServidor'

type Props = {
  /** Recebe o endereço devolvido pelo reverso: a rota parte do endereço anunciado, não do GPS bruto. */
  aoEscolher: (endereco: Endereco) => void
  /** O campo que este botão preenche: recebe o foco quando "Usar este endereço" some. */
  idCampo: string
  /** O texto do campo agora. A espera diz que nada se perde: se ele mudar, o GPS é descartado. */
  valorCampo: string
}

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'buscando' }
  | { fase: 'impreciso'; endereco: Endereco; precisaoM: number }
  | { fase: 'mensagem'; texto: string }

const NEGADO = 'O navegador não autorizou a localização. Digite o endereço; a rota funciona igual.'
const SEM_POSICAO = 'Não conseguimos sua localização agora. Digite o endereço.'

export function BotaoMinhaLocalizacao({ aoEscolher, idCampo, valorCampo }: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' })
  const anunciar = useAnuncio()
  const espera = useEsperaServidor(estado.fase === 'buscando')
  const dica = useId()
  const pedido = useRef<{ controle: AbortController; valor: string } | null>(null)

  useEffect(() => () => pedido.current?.controle.abort(), [])

  useEffect(() => {
    if (pedido.current && pedido.current.valor !== valorCampo) {
      pedido.current.controle.abort()
      pedido.current = null
      setEstado({ fase: 'ocioso' })
    }
    // "não autorizou, digite o endereço" não vale mais para um campo que já mudou
    setEstado((e) => (e.fase === 'mensagem' ? { fase: 'ocioso' } : e))
  }, [valorCampo])

  if (!temGeolocalizacao()) {
    return <p className="campo__dica">Este navegador não informa a localização. Digite o endereço.</p>
  }

  function avisar(texto: string) {
    setEstado({ fase: 'mensagem', texto })
    anunciar(texto)
  }

  async function localizar() {
    if (estado.fase === 'buscando') return
    const controle = new AbortController()
    pedido.current = { controle, valor: valorCampo }
    setEstado({ fase: 'buscando' })
    anunciar('Buscando sua localização.')
    try {
      const posicao = await obterPosicao()
      if (controle.signal.aborted) return
      const endereco = await enderecoDoPonto(arredondar4(posicao.lat), arredondar4(posicao.lon), controle.signal)
      if (controle.signal.aborted) return
      pedido.current = null
      if (posicao.precisaoM > PRECISAO_ACEITAVEL_M) {
        setEstado({ fase: 'impreciso', endereco, precisaoM: Math.round(posicao.precisaoM) })
        anunciar(`Achamos ${endereco.rotulo}, mas a margem é de cerca de ${Math.round(posicao.precisaoM)} metros.`)
        return
      }
      setEstado({ fase: 'ocioso' })
      aoEscolher(endereco)
      anunciar(`Origem: ${endereco.rotulo}. Confira se é onde você está.`)
    } catch (erro) {
      if (controle.signal.aborted || ehCancelamento(erro)) return
      pedido.current = null
      if (erro instanceof ErroLocalizacao) avisar(erro.codigo === 1 ? NEGADO : SEM_POSICAO)
      else if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado') avisar(`${erro.message} Digite o endereço.`)
      else avisar(erro instanceof ErroApi ? erro.message : MSG_INESPERADO)
    }
  }

  return (
    <div className="localizacao">
      <Placa pictograma="localizacao" onClick={localizar} aria-describedby={dica} aria-disabled={estado.fase === 'buscando' || undefined}>
        Usar minha localização
      </Placa>
      <p id={dica} className="campo__dica">
        Usa o GPS do aparelho uma vez, só quando você aciona.
      </p>
      {estado.fase === 'buscando' && <p className="campo__retorno">{espera ?? 'Buscando sua localização…'}</p>}
      {estado.fase === 'mensagem' && <p className="campo__retorno">{estado.texto}</p>}
      {estado.fase === 'impreciso' && (
        <div className="campo__retorno">
          <p>
            Achamos {estado.endereco.rotulo}, mas a margem é de cerca de {estado.precisaoM} m. Se não for aí, digite o
            endereço.
          </p>
          <Placa
            onClick={() => {
              // o botão some: o foco vai ao campo, que lê o endereço escolhido
              flushSync(() => {
                aoEscolher(estado.endereco)
                setEstado({ fase: 'ocioso' })
              })
              document.getElementById(idCampo)?.focus()
            }}
          >
            Usar este endereço
          </Placa>
        </div>
      )}
    </div>
  )
}
