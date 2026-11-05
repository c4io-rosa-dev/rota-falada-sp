import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { ehCancelamento } from '../api/base'
import { enderecoDoPonto } from '../api/client'
import { listarProximas, type Barreira } from '../api/colaboracao'
import { aquecerServidor } from '../api/servidor'
import { useConsulta } from '../api/useConsulta'
import { EscolhaLocal } from '../componentes/EscolhaLocal'
import { Placa } from '../componentes/Placa'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { distanciaDirecao, textoEfeito, textoStatus } from '../dados/barreira'
import { rotuloCategoria } from '../dados/categorias'
import { arredondar4 } from '../dados/localizacao'
import type { LocalEscolhido } from '../dados/rascunho'
import '../estilos/colaborar.css'

type Item = { barreira: Barreira; endereco: string | null }
type Lista = { itens: Item[]; total: number }

const LIMITE_LISTA = 20

/** Vindo de um passo, o ponto chega por location.state: nunca na URL. */
type EstadoNavegacao = { ponto?: [number, number]; rotuloPonto?: string } | null

/**
 * Até 20 itens, os mais próximos (a API já ordena). A lista só aparece com os endereços prontos,
 * para nada pular de lugar. As coordenadas vão à URL com 4 casas, como no reverso; a posição exata
 * do GPS fica só no cadastro e na distância exibida.
 */
async function carregar(lat: number, lon: number, raio: number, sinal: AbortSignal): Promise<Lista> {
  const barreiras = await listarProximas(arredondar4(lat), arredondar4(lon), raio, sinal)
  const itens = await Promise.all(
    barreiras.slice(0, LIMITE_LISTA).map(async (barreira) => {
      try {
        const e = await enderecoDoPonto(arredondar4(barreira.lat), arredondar4(barreira.lon), sinal)
        return { barreira, endereco: e.rotulo }
      } catch (erro) {
        if (ehCancelamento(erro)) throw erro
        return { barreira, endereco: null } // reverso que falha cai só na distância
      }
    }),
  )
  return { itens, total: barreiras.length }
}

export function Barreiras() {
  const h1 = usePaginaAcessivel('Barreiras por perto')
  const { pathname, state } = useLocation()
  const navegar = useNavigate()
  const estadoNav = state as EstadoNavegacao
  const [local, setLocal] = useState<LocalEscolhido | null>(
    estadoNav?.ponto
      ? { lat: estadoNav.ponto[0], lon: estadoNav.ponto[1], rotulo: estadoNav.rotuloPonto ?? null, origem: 'passo' }
      : null,
  )
  const [raio, setRaio] = useState(200)
  const anunciar = useAnuncio()
  const tituloLista = useRef<HTMLHeadingElement>(null)

  useEffect(() => aquecerServidor(), [])

  /** O ponto fica na entrada do histórico, nunca na URL: o Voltar do navegador o traz de volta. */
  function escolherLocal(novo: LocalEscolhido | null) {
    setLocal(novo)
    navegar(pathname, { replace: true, state: novo ? { ponto: [novo.lat, novo.lon], rotuloPonto: novo.rotulo ?? undefined } : null })
  }

  const chave = local ? `${local.lat},${local.lon},${raio}` : null
  const { dados, erro, carregando, recarregar } = useConsulta(chave, (sinal) => carregar(local!.lat, local!.lon, raio, sinal))
  const espera = useEsperaServidor(carregando)

  useEffect(() => {
    if (erro) anunciar(erro.message)
    else if (dados) {
      const n = dados.total
      if (n === 0) anunciar(`Nenhuma barreira registrada a até ${raio} metros.`)
      else if (n > dados.itens.length) anunciar(`As ${dados.itens.length} mais próximas de ${n} barreiras a até ${raio} metros.`)
      else anunciar(`${n} ${n === 1 ? 'barreira' : 'barreiras'} a até ${raio} metros.`)
    }
  }, [dados, erro, raio, anunciar])

  return (
    <div className="colaborar">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Barreiras por perto
        </h1>
        <p className="subtitulo">Veja o que já foi registrado perto de um ponto e confirme, conteste ou diga que foi resolvido.</p>
      </div>

      <form className="formulario" aria-label="Escolher o ponto" onSubmit={(e) => e.preventDefault()}>
        <EscolhaLocal id="perto" local={local} aoEscolher={escolherLocal} />
      </form>

      <section className="colaborar__lista" aria-labelledby="titulo-lista">
        <h2 id="titulo-lista" ref={tituloLista} tabIndex={-1} className="letreiro colaborar__titulo">
          Registradas aqui
        </h2>
        {!local && <p>Escolha um ponto para ver as barreiras registradas perto dele.</p>}
        {carregando && <p>{espera ?? 'Buscando barreiras…'}</p>}
        {erro && (
          <>
            <p>{erro.message}</p>
            <Placa
              onClick={() => {
                tituloLista.current?.focus()
                recarregar()
              }}
            >
              Tentar de novo
            </Placa>
          </>
        )}
        {dados && dados.total === 0 && <p>Nenhuma barreira registrada a até {raio} m. Isso não quer dizer que não haja.</p>}
        {dados && dados.total > dados.itens.length && (
          <p>
            As {dados.itens.length} mais próximas de {dados.total} barreiras a até {raio} m.
          </p>
        )}
        {dados && dados.itens.length > 0 && local && (
          <ol className="lista-gravada">
            {dados.itens.map(({ barreira: b, endereco }) => (
              <li key={b.id}>
                <h3 className="letreiro">{rotuloCategoria(b.categoria)}</h3>
                <p>
                  {textoStatus(b)}. {textoEfeito(b)}
                </p>
                <p>
                  <span className="medida">{distanciaDirecao([local.lat, local.lon], b)}</span>
                  {endereco && `, perto de ${endereco}`}.
                </p>
                <Link
                  className="alvo"
                  to={`/barreiras/${b.id}`}
                  state={{ ponto: [local.lat, local.lon], rotuloPonto: local.rotulo ?? undefined }}
                  aria-label={`Ver e votar: ${rotuloCategoria(b.categoria)}, ${distanciaDirecao([local.lat, local.lon], b)}`}
                >
                  Ver e votar
                </Link>
              </li>
            ))}
          </ol>
        )}
        {local && raio === 200 && dados && dados.total < 5 && (
          <Placa
            onClick={() => {
              tituloLista.current?.focus()
              setRaio(500)
            }}
          >
            Ver até 500 m
          </Placa>
        )}
        {local && (
          <p>
            <Link className="alvo" to="/barreiras/nova" state={{ local }}>
              Registrar barreira neste ponto
            </Link>
          </p>
        )}
      </section>
    </div>
  )
}
