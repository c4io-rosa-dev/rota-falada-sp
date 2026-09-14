import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

const FONTES = [
  {
    chave: 'geosampa',
    nome: 'GeoSampa / Prefeitura de São Paulo',
    licenca: 'CC-BY-SA 4.0',
    url: 'https://geosampa.prefeitura.sp.gov.br',
    atribuicao: 'Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021',
    data_referencia: '2021-08-13',
    data_extracao: null,
  },
  {
    chave: 'osm',
    nome: 'OpenStreetMap',
    licenca: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    atribuicao: 'Dados do mapa © colaboradores do OpenStreetMap (ODbL)',
    data_referencia: null,
    data_extracao: null,
  },
]

function renderizarFontes() {
  return render(
    <MemoryRouter initialEntries={['/fontes']}>
      <App />
    </MemoryRouter>,
  )
}

describe('página /fontes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lista cada fonte com link, licença, data de referência e atribuição', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(FONTES)))
    const { container } = renderizarFontes()

    expect(await screen.findByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
    expect(screen.getByText(/licença ODbL 1\.0/)).toBeInTheDocument()
    expect(screen.getByText(/Dados de 13\/08\/2021/)).toBeInTheDocument()
    expect(screen.getByText('Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021')).toBeInTheDocument()
    expect(document.title).toBe('Fontes de dados e licenças · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('chama a API no endereço configurado', async () => {
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    renderizarFontes()
    await screen.findByRole('heading', { level: 1 })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/fontes')
  })

  it('anuncia erro em role=alert quando a API falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 503 })))
    renderizarFontes()
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
  })
})
