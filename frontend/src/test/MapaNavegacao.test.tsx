import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { axe } from 'vitest-axe'
import type { RotaIn } from '../api/client'
import type { MotivoFalha, OpcoesMotor } from '../componentes/mapa/MotorMapaNavegacao'
import { MapaNavegacao } from '../componentes/mapa/MapaNavegacao'
import {
  ATRIBUICAO_MAPA,
  DICA_GIRAR_MAPA,
  DICA_MOSTRAR_MAPA,
  MAPA_ANUNCIO_FALHOU,
  MAPA_ANUNCIO_SEM_WEBGL,
  MAPA_CARREGANDO,
  MAPA_FALHOU,
  MAPA_PARTE_FALTANDO,
  MAPA_SEM_WEBGL,
  ROTULO_MAPA_FIM,
  ROTULO_MAPA_GIRADO,
  ROTULO_MAPA_NORTE,
} from '../componentes/navegacao/textosNavegacao'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { ContextoAnuncio, type Anunciar } from '../componentes/useAnuncio'
import type { PrefsMapa } from '../dados/navegacao/mapaNavegacao'
import type { QualPreferenciaMapa } from '../dados/preferenciaMapa'
import { estadoNavegacao, type EstadoNavegacao, type Fase } from '../dados/navegacao/navegacao'
import { ROTA_L } from './fixturasNavegacao'
// o apoio do mapa aberto chega por import() junto com o motor: já carregado aqui, o import() do teste não espera a transformação
import '../componentes/mapa/apoioMapaAberto'

/* ---------- motor simulado: a primeira carga do chunk falha (como Mapa.test.tsx) ---------- */

type MotorFalso = { atualizar: ReturnType<typeof vi.fn>; apontar: ReturnType<typeof vi.fn>; trocarTema: ReturnType<typeof vi.fn>; destruir: ReturnType<typeof vi.fn> }
type Criacao = { el: HTMLElement; opcoes: OpcoesMotor; motor: MotorFalso }

const sim = vi.hoisted(() => ({
  falharImport: true,
  cargas: 0,
  /** O que a próxima criarMotor faz. */
  proximo: 'ok' as 'ok' | 'sem_webgl' | 'nao_carregou' | 'pendente',
  criacoes: [] as Criacao[],
  liberar: null as null | (() => void),
}))

vi.mock('../componentes/mapa/MotorMapaNavegacao', () => {
  sim.cargas++
  if (sim.falharImport) {
    sim.falharImport = false
    throw new Error('chunk')
  }
  class ErroMotorMapa extends Error {
    readonly motivo: MotivoFalha
    constructor(motivo: MotivoFalha) {
      super(motivo)
      this.motivo = motivo
    }
  }
  return {
    ErroMotorMapa,
    criarMotor: (el: HTMLElement, opcoes: OpcoesMotor) => {
      const motor: MotorFalso = { atualizar: vi.fn(), apontar: vi.fn(), trocarTema: vi.fn(), destruir: vi.fn() }
      sim.criacoes.push({ el, opcoes, motor })
      const modo = sim.proximo
      if (modo === 'sem_webgl' || modo === 'nao_carregou') {
        opcoes.aoFalhar(modo)
        return Promise.reject(new ErroMotorMapa(modo))
      }
      if (modo === 'pendente') return new Promise((resolver) => (sim.liberar = () => resolver(motor)))
      return Promise.resolve(motor)
    },
  }
})

/* ---------- estado de navegação ---------- */

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}
const BASE = estadoNavegacao(ROTA_L, PEDIDO, { simulacao: false })

function estado(fase: Fase, progressoMaxM = 0): EstadoNavegacao {
  return { ...BASE, fase, acompanhamento: { ...BASE.acompanhamento, progressoMaxM, sinal: 'bom' } }
}

const FECHADO: PrefsMapa = { aberto: false, girar: false }

function Tela({ e, inicial = FECHADO, aoMudar, anunciar }: { e: EstadoNavegacao; inicial?: PrefsMapa; aoMudar?: (q: QualPreferenciaMapa, v: boolean) => void; anunciar?: Anunciar }) {
  const [prefs, setPrefs] = useState(inicial)
  const mapa = (
    <MapaNavegacao
      estado={e}
      prefs={prefs}
      aoMudarPrefs={(qual, valor) => {
        aoMudar?.(qual, valor)
        setPrefs((p) => ({ ...p, [qual]: valor }))
      }}
    />
  )
  return (
    <main>
      <h2 tabIndex={-1}>Painel</h2>
      {anunciar ? <ContextoAnuncio.Provider value={anunciar}>{mapa}</ContextoAnuncio.Provider> : <RegiaoViva>{mapa}</RegiaoViva>}
    </main>
  )
}

/** O mesmo botão, com o rótulo do que ele faz: "Mostrar o mapa" fechado, "Esconder o mapa" aberto. */
const mostrar = () => screen.getByRole('button', { name: /^(Mostrar|Esconder) o mapa$/ })
const girar = () => screen.queryByRole('button', { name: 'Girar o mapa com a rota' })
const figura = () => document.querySelector<HTMLElement>('figure.mapa-nav')
const rotuloNorte = ROTULO_MAPA_NORTE + ROTULO_MAPA_FIM
const rotuloGirado = ROTULO_MAPA_GIRADO + ROTULO_MAPA_FIM
const ultimo = () => sim.criacoes[sim.criacoes.length - 1]

async function abrirPronto() {
  await userEvent.click(mostrar())
  await waitFor(() => expect(figura()).toHaveAttribute('data-fase', 'pronto'))
  return ultimo()
}

beforeEach(() => {
  sim.proximo = 'ok'
  sim.criacoes = []
  sim.liberar = null
})

describe('MapaNavegacao', () => {
  // ordem importa: o chunk só falha na primeira carga do arquivo
  it('começa fechado: nada importado, nenhuma figura, botão "Mostrar o mapa" (ação, sem aria-pressed) e a dica', () => {
    render(<Tela e={estado('navegando', 10)} />)
    expect(sim.cargas).toBe(0)
    expect(figura()).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(girar()).toBeNull()
    const botao = mostrar()
    expect(botao).toHaveAccessibleName('Mostrar o mapa')
    expect(botao).not.toHaveAttribute('aria-pressed')
    expect(botao).toHaveAccessibleDescription(DICA_MOSTRAR_MAPA)
  })

  it('primeira carga do chunk falha: "Tentar de novo", anúncio uma vez; a segunda tentativa abre', async () => {
    const anunciar = vi.fn()
    const aoMudar = vi.fn()
    render(<Tela e={estado('navegando', 10)} anunciar={anunciar} aoMudar={aoMudar} />)
    await userEvent.click(mostrar())
    expect(aoMudar).toHaveBeenCalledWith('aberto', true)
    expect(await screen.findByText(MAPA_FALHOU)).toBeInTheDocument()
    expect(figura()).toHaveAttribute('data-fase', 'falhou')
    expect(anunciar).toHaveBeenCalledTimes(1)
    expect(anunciar).toHaveBeenCalledWith(MAPA_ANUNCIO_FALHOU, { chave: 'mapa' })
    expect(girar()).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    // o botão some: o foco vai ao "Mostrar o mapa", nunca ao corpo da página
    expect(mostrar()).toHaveFocus()
    await waitFor(() => expect(figura()).toHaveAttribute('data-fase', 'pronto'))
    expect(sim.cargas).toBe(2)
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
    expect(screen.queryByText(MAPA_FALHOU)).toBeNull()
    expect(anunciar).toHaveBeenCalledTimes(1)
  })

  it('abrir cria um motor só, no contêiner dentro do role=img, e aplica a cena atual', async () => {
    render(<Tela e={estado('navegando', 30)} />)
    const c = await abrirPronto()
    expect(sim.criacoes).toHaveLength(1)
    const img = screen.getByRole('img', { name: rotuloNorte })
    expect(img).toContainElement(c.el)
    expect(c.motor.atualizar).toHaveBeenCalled()
    const [cena, girarLigado] = c.motor.atualizar.mock.calls.at(-1)!
    expect(girarLigado).toBe(false)
    expect(cena.camera.modo).toBe('seguir')
    expect(figura()).toHaveAttribute('data-camera', 'seguir')
  })

  it('carregando mostra o texto sem região viva; o botão já diz "Esconder o mapa"', async () => {
    sim.proximo = 'pendente'
    const anunciar = vi.fn()
    render(<Tela e={estado('navegando', 10)} anunciar={anunciar} />)
    await userEvent.click(mostrar())
    expect(mostrar()).toHaveAccessibleName('Esconder o mapa')
    expect(await screen.findByText(MAPA_CARREGANDO)).toBeInTheDocument()
    expect(figura()).toHaveAttribute('data-fase', 'carregando')
    await act(async () => sim.liberar?.())
    await waitFor(() => expect(figura()).toHaveAttribute('data-fase', 'pronto'))
    expect(screen.queryByText(MAPA_CARREGANDO)).toBeNull()
    expect(anunciar).not.toHaveBeenCalled()
  })

  it('sem_webgl: texto próprio, sem "Tentar de novo", sem "Girar", anúncio uma vez', async () => {
    sim.proximo = 'sem_webgl'
    const anunciar = vi.fn()
    render(<Tela e={estado('navegando', 10)} anunciar={anunciar} />)
    await userEvent.click(mostrar())
    expect(await screen.findByText(MAPA_SEM_WEBGL)).toBeInTheDocument()
    expect(figura()).toHaveAttribute('data-fase', 'sem_webgl')
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
    expect(girar()).toBeNull()
    expect(anunciar).toHaveBeenCalledTimes(1)
    expect(anunciar).toHaveBeenCalledWith(MAPA_ANUNCIO_SEM_WEBGL, { chave: 'mapa' })
  })

  it('arquivo que não carrega (motor rejeita): falhou com "Tentar de novo" e um anúncio só', async () => {
    sim.proximo = 'nao_carregou'
    const anunciar = vi.fn()
    render(<Tela e={estado('navegando', 10)} anunciar={anunciar} />)
    await userEvent.click(mostrar())
    expect(await screen.findByText(MAPA_FALHOU)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    expect(anunciar).toHaveBeenCalledTimes(1)
    expect(anunciar).toHaveBeenCalledWith(MAPA_ANUNCIO_FALHOU, { chave: 'mapa' })
  })

  it('falha com "Girar" focado: o foco vai ao "Mostrar o mapa", nunca ao corpo da página', async () => {
    render(<Tela e={estado('navegando', 10)} />)
    const c = await abrirPronto()
    girar()!.focus()
    act(() => c.opcoes.aoFalhar('nao_carregou'))
    expect(await screen.findByText(MAPA_FALHOU)).toBeInTheDocument()
    expect(girar()).toBeNull()
    expect(mostrar()).toHaveFocus()
  })

  it('falha com o foco fora do mapa: o foco não sai do lugar', async () => {
    render(<Tela e={estado('navegando', 10)} />)
    const c = await abrirPronto()
    const h2 = screen.getByRole('heading', { name: 'Painel' })
    h2.focus()
    act(() => c.opcoes.aoFalhar('nao_carregou'))
    expect(await screen.findByText(MAPA_FALHOU)).toBeInTheDocument()
    expect(h2).toHaveFocus()
  })

  it('falha depois de pronto (contexto perdido): destrói o motor, falhou e anuncia uma vez', async () => {
    const anunciar = vi.fn()
    render(<Tela e={estado('navegando', 10)} anunciar={anunciar} />)
    const c = await abrirPronto()
    act(() => c.opcoes.aoFalhar('nao_carregou'))
    act(() => c.opcoes.aoFalhar('nao_carregou'))
    expect(await screen.findByText(MAPA_FALHOU)).toBeInTheDocument()
    expect(c.motor.destruir).toHaveBeenCalled()
    expect(anunciar).toHaveBeenCalledTimes(1)
  })

  it('parte faltando: texto comum, sem anúncio, e o mapa continua', async () => {
    const anunciar = vi.fn()
    render(<Tela e={estado('navegando', 10)} anunciar={anunciar} />)
    const c = await abrirPronto()
    act(() => c.opcoes.aoFaltarParte())
    expect(await screen.findByText(MAPA_PARTE_FALTANDO)).toBeInTheDocument()
    expect(figura()).toHaveAttribute('data-fase', 'pronto')
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(anunciar).not.toHaveBeenCalled()
  })

  it('"Mostrar o mapa" vira "Esconder o mapa", sem aria-pressed; "Girar" tem nome fixo, aria-pressed e o estado escrito à vista', async () => {
    // WCAG 1.4.1 e 4.1.2: o estado não fica só no fundo e na borda. Mostrar/esconder é ação com o
    // rótulo do que faz; "Girar" é alternância: nome fixo + aria-pressed, e o "ligado"/"desligado"
    // visível fica fora do nome (aria-hidden), para o nome nunca trocar junto com o aria-pressed
    render(<Tela e={estado('navegando', 10)} />)
    expect(girar()).toBeNull()
    await abrirPronto()
    expect(mostrar()).toHaveAccessibleName('Esconder o mapa')
    expect(mostrar()).not.toHaveAttribute('aria-pressed')
    expect(mostrar()).toHaveAccessibleDescription(DICA_MOSTRAR_MAPA)
    const g = girar()!
    expect(g).toHaveAttribute('aria-pressed', 'false')
    expect(g).toHaveAccessibleDescription(DICA_GIRAR_MAPA)
    expect(g).toHaveTextContent(/^Girar o mapa com a rota: desligado$/)
    await userEvent.click(g)
    expect(girar()).toHaveAttribute('aria-pressed', 'true')
    expect(girar()).toHaveAccessibleName('Girar o mapa com a rota')
    expect(girar()).toHaveTextContent(/^Girar o mapa com a rota: ligado$/)
  })

  it('trocar "Girar" muda o aria-label, chama aoMudarPrefs e repassa ao motor; o indicador de norte segue o rumo real do mapa', async () => {
    const aoMudar = vi.fn()
    render(<Tela e={estado('navegando', 10)} aoMudar={aoMudar} />)
    const c = await abrirPronto()
    const norte = document.querySelector<HTMLElement>('.mapa-nav__norte')!
    expect(norte).toHaveAttribute('aria-hidden', 'true')
    expect(norte).not.toBeVisible()
    await userEvent.click(girar()!)
    expect(aoMudar).toHaveBeenCalledWith('girar', true)
    expect(girar()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', rotuloGirado)
    expect(c.motor.atualizar.mock.calls.at(-1)![1]).toBe(true)
    // rota em L: o primeiro trecho segue para o leste, rumo ≈ 90
    const rumo = c.motor.atualizar.mock.calls.at(-1)![0].rumoAplicado as number
    expect(Math.abs(rumo - 90)).toBeLessThan(1)
    // a agulha não segue o alvo: segue o ângulo que o motor diz que o mapa tem (no meio do giro, 45)
    expect(norte).not.toBeVisible()
    act(() => c.opcoes.aoMudarRumo?.(45))
    expect(norte).toBeVisible()
    expect(norte.querySelector<SVGElement>('.mapa-nav__agulha')!.style.transform).toBe('rotate(-45deg)')
    act(() => c.opcoes.aoMudarRumo?.(rumo))
    expect(norte.querySelector<SVGElement>('.mapa-nav__agulha')!.style.transform).toBe(`rotate(${-rumo}deg)`)
    await userEvent.click(girar()!)
    expect(aoMudar).toHaveBeenLastCalledWith('girar', false)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', rotuloNorte)
    act(() => c.opcoes.aoMudarRumo?.(0.2))
    expect(norte).not.toBeVisible()
  })

  it('20 leituras: o motor recebe cada uma, nada é anunciado e o aria-label não muda', async () => {
    const anunciar = vi.fn()
    const { rerender } = render(<Tela e={estado('navegando', 0)} inicial={{ aberto: false, girar: true }} anunciar={anunciar} />)
    const c = await abrirPronto()
    const img = screen.getByRole('img')
    const antes = c.motor.atualizar.mock.calls.length
    for (let i = 1; i <= 20; i++) {
      rerender(<Tela e={estado('navegando', i * 5)} inicial={{ aberto: false, girar: true }} anunciar={anunciar} />)
      expect(img).toHaveAttribute('aria-label', rotuloGirado)
    }
    expect(c.motor.atualizar.mock.calls.length - antes).toBe(20)
    expect(anunciar).not.toHaveBeenCalled()
    expect(sim.criacoes).toHaveLength(1)
  })

  it('20 leituras com a região viva real: ela continua vazia', async () => {
    const { rerender } = render(<Tela e={estado('navegando', 0)} />)
    await abrirPronto()
    for (let i = 1; i <= 20; i++) rerender(<Tela e={estado('navegando', i * 5)} />)
    await new Promise((r) => setTimeout(r, 250))
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('o rumo usado na histerese vem da última cena (o motor recebe o rumo anterior certo)', async () => {
    const { rerender } = render(<Tela e={estado('navegando', 10)} inicial={{ aberto: false, girar: true }} />)
    const c = await abrirPronto()
    const r1 = c.motor.atualizar.mock.calls.at(-1)![0].rumoAplicado as number
    // pausada mantém o rumo anterior: só vale se a casca guardou o rumo da cena anterior
    rerender(<Tela e={estado('pausada', 10)} inicial={{ aberto: false, girar: true }} />)
    const cena = c.motor.atualizar.mock.calls.at(-1)![0]
    expect(cena.camera.modo).toBe('congelar')
    expect(cena.rumoAplicado).toBe(r1)
    expect(figura()).toHaveAttribute('data-camera', 'congelar')
  })

  it('passo_a_passo: o mapa continua e enquadra o passo; fase sem mapa não chama o motor', async () => {
    const { rerender } = render(<Tela e={estado('passo_a_passo')} />)
    const c = await abrirPronto()
    expect(c.motor.atualizar.mock.calls.at(-1)![0].pessoa).toBeNull()
    expect(figura()).toHaveAttribute('data-camera', 'enquadrar')
    const n = c.motor.atualizar.mock.calls.length
    rerender(<Tela e={estado('chegou')} />)
    expect(c.motor.atualizar.mock.calls.length).toBe(n)
  })

  it('nada focável dentro do role=img; a atribuição fica fora dele, com o link do OSM', async () => {
    render(<Tela e={estado('navegando', 10)} />)
    await abrirPronto()
    const img = screen.getByRole('img')
    expect(img.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toHaveLength(0)
    // abre em outra aba e diz isso: um toque sem querer não encerra a navegação
    const link = screen.getByRole('link', { name: 'OpenStreetMap (abre em outra aba)' })
    expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(img).not.toContainElement(link)
    const legenda = figura()!.querySelector('figcaption')!
    expect(legenda).toHaveTextContent(ATRIBUICAO_MAPA)
    expect(img).not.toContainElement(legenda)
  })

  it('fechar destrói o motor e tira a figura; aoMudarPrefs recebe falso', async () => {
    const aoMudar = vi.fn()
    render(<Tela e={estado('navegando', 10)} aoMudar={aoMudar} />)
    const c = await abrirPronto()
    await userEvent.click(mostrar())
    expect(aoMudar).toHaveBeenLastCalledWith('aberto', false)
    expect(c.motor.destruir).toHaveBeenCalledTimes(1)
    expect(figura()).toBeNull()
    expect(girar()).toBeNull()
    expect(mostrar()).toHaveAccessibleName('Mostrar o mapa')
  })

  it('desmontar destrói o motor', async () => {
    const { unmount } = render(<Tela e={estado('navegando', 10)} />)
    const c = await abrirPronto()
    unmount()
    expect(c.motor.destruir).toHaveBeenCalledTimes(1)
  })

  it('fechar antes de o motor ficar pronto: o motor que chega depois é destruído e não vira "pronto"', async () => {
    sim.proximo = 'pendente'
    render(<Tela e={estado('navegando', 10)} />)
    await userEvent.click(mostrar())
    await waitFor(() => expect(sim.criacoes).toHaveLength(1))
    await userEvent.click(mostrar())
    await act(async () => sim.liberar?.())
    expect(sim.criacoes[0].motor.destruir).toHaveBeenCalledTimes(1)
    expect(sim.criacoes[0].motor.atualizar).not.toHaveBeenCalled()
    expect(figura()).toBeNull()
  })

  it('preferência aberta vinda da aba: abre sozinho ao montar, sem mexer no foco', async () => {
    render(<Tela e={estado('navegando', 10)} inicial={{ aberto: true, girar: true }} />)
    const h2 = screen.getByRole('heading', { name: 'Painel' })
    h2.focus()
    await waitFor(() => expect(figura()).toHaveAttribute('data-fase', 'pronto'))
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', rotuloGirado)
    expect(h2).toHaveFocus()
  })

  it('o foco fica no botão ao abrir e ao carregar', async () => {
    const { rerender } = render(<Tela e={estado('navegando', 10)} />)
    await abrirPronto()
    expect(mostrar()).toHaveFocus()
    rerender(<Tela e={estado('navegando', 40)} />)
    expect(mostrar()).toHaveFocus()
  })

  it('axe sem violações: fechado, pronto e falhou', async () => {
    const { container, unmount } = render(<Tela e={estado('navegando', 10)} />)
    expect(await axe(container)).toHaveNoViolations()
    await abrirPronto()
    expect(await axe(container)).toHaveNoViolations()
    unmount()
    sim.proximo = 'nao_carregou'
    const outro = render(<Tela e={estado('navegando', 10)} />)
    await userEvent.click(mostrar())
    await screen.findByText(MAPA_FALHOU)
    expect(await axe(outro.container)).toHaveNoViolations()
  })
})
