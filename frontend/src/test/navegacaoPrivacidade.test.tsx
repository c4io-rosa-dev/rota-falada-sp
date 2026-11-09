/**
 * Guarda dinâmica da LGPD (spec 8): cada cenário simulado inteiro na página, do Começar ao fim,
 * sem nada gravado, sem console, sem coordenada na URL nem no estado de navegação, e com rede só
 * no toque em Recalcular, com a origem em 4 casas.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router'
import type { RotaIn } from '../api/client'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { CENARIOS } from '../dados/navegacao/simulacao'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { Navegar } from '../pages/Navegar'
import { apiFalsa } from './apiFalsa'
import { ROTA_L } from './fixturasNavegacao'

const PEDIDO: RotaIn = {
  origem: { lat: -23.5617, lng: -46.656 },
  destino: { lat: -23.5636, lng: -46.6547 },
  perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 },
}

/** Coordenada da região da fixtura, com 3 casas ou mais (spec 8). */
const COORDENADA = [/-2[34]\.\d{3,}/, /-46\.\d{3,}/]

function conteudo(armazem: Storage): string {
  const partes: string[] = []
  for (let i = 0; i < armazem.length; i++) {
    const chave = armazem.key(i)!
    partes.push(chave, armazem.getItem(chave) ?? '')
  }
  return partes.join('\n')
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Guarda a última localização do roteador (pathname, search e state), para conferir a URL final. */
let localizacao: Location | null = null
function Espia() {
  localizacao = useLocation()
  return null
}

describe('navegação simulada: privacidade de ponta a ponta', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (navigator as unknown as Record<string, unknown>).geolocation
    localizacao = null
  })

  it.each(CENARIOS)(
    'cenário %s: nada gravado, nada no console, nada na URL nem no estado, rede só no Recalcular',
    async (cenario) => {
      gravarSessaoRota({
        versao: 1,
        origem: null,
        destino: null,
        perfil: PERFIL_FORM_PADRAO,
        rota: ROTA_L,
        rotaDe: { pedido: PEDIDO, origem: 'Rua A', destino: 'Rua B' },
        calculadaEm: new Date().toISOString(),
      })
      const sessaoAntes = conteudo(sessionStorage)
      const historicoAntes = JSON.stringify(window.history.state)
      const watchPosition = vi.fn()
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch: vi.fn() } })
      const api = apiFalsa({ 'POST /api/rotas': Response.json(ROTA_L) })
      const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
      const busca = `?simular=${cenario}&ritmo=20`

      render(
        <MemoryRouter initialEntries={[`/rota/navegar${busca}`]}>
          <RegiaoViva>
            <Espia />
            <Routes>
              <Route path="/rota/navegar" element={<Navegar />} />
            </Routes>
          </RegiaoViva>
        </MemoryRouter>,
      )
      // o módulo da simulação chega por import() dinâmico; depois disso, o relógio é falso
      expect(await screen.findByText('Modo demonstração: a posição é simulada, não é a sua.')).toBeInTheDocument()
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: 'Começar' }))

      // anda um terço da rota (50 ms por leitura com ritmo 20)
      await avancar(40 * 50)
      expect(api.falso).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Recalcular' }))
      await avancar(10)
      // só o POST de rota (e o /health que o acorda), nunca outra coisa
      expect(api.chamadas.every((c) => c.caminho === '/health' || c.caminho === '/api/rotas')).toBe(true)
      const pedidos = api.de('POST /api/rotas')
      // só a precisão ruim não tem leitura boa recente para recalcular
      expect(pedidos).toHaveLength(cenario === 'precisao-ruim-40m' ? 0 : 1)
      for (const p of pedidos) {
        const corpo = JSON.parse(p.init.body as string) as RotaIn
        expect({ ...corpo, origem: null }).toEqual({ ...PEDIDO, origem: null })
        for (const v of [corpo.origem.lat, corpo.origem.lng]) expect(String(v).split('.')[1].length).toBeLessThanOrEqual(4)
      }
      const chamadasNoRecalculo = api.chamadas.length

      // até o fim do cenário (o mais longo tem um buraco de 30 s)
      await avancar(800 * 50 + 30_000)

      expect(api.chamadas).toHaveLength(chamadasNoRecalculo)
      expect(watchPosition).not.toHaveBeenCalled()
      for (const espia of consoles) expect(espia).not.toHaveBeenCalled()
      // a sessão continua exatamente como a página de rota deixou; nada no localStorage
      expect(conteudo(sessionStorage)).toBe(sessaoAntes)
      expect(conteudo(localStorage)).toBe('')
      // nem a URL nem o estado de navegação ganharam coordenada
      expect(localizacao?.pathname).toBe('/rota/navegar')
      expect(localizacao?.search).toBe(busca)
      expect(localizacao?.state ?? null).toBeNull()
      expect(JSON.stringify(window.history.state)).toBe(historicoAntes)
      for (const re of COORDENADA) {
        expect(`${localizacao?.search}${localizacao?.hash}${window.location.href}`).not.toMatch(re)
        expect(JSON.stringify(window.history.state ?? null)).not.toMatch(re)
      }
    },
    60_000,
  )
})
