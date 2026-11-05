import { screen } from '@testing-library/react'
import { MSG_INDISPONIVEL, MSG_INESPERADO, MSG_INSTABILIDADE, MSG_REDE, MSG_SEM_INTERNET, MSG_SEM_RESPOSTA, MSG_TEMPO } from '../api/base'
import { MSG_ROTA_INDISPONIVEL } from '../api/client'
import { MSG_ABRIR_LOGIN, MSG_REDE_AUTH, MSG_TEMPO_AUTH } from '../auth/erros'
import { lembrarMinha } from '../dados/rascunho'
import { textoSobreARota } from '../dados/passo'
import { apiFalsa } from './apiFalsa'
import { abrir, CONTA, ficha, logar, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))
prepararColaboracao()

const REVERSO = { 'GET /api/geocode/reverso': Response.json({ id: 1, tipo: 'endereco', rotulo: 'Rua X, 1 · Lapa', lat: -23.5, lon: -46.7, aproximado: false }) }

describe('decisões do dono de 05/11/2026', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('toda falha do sistema diz só que há instabilidade, sem culpar a conexão da pessoa', () => {
    expect(MSG_INSTABILIDADE).toBe('Instabilidade no sistema. Tente de novo em alguns minutos.')
    for (const m of [MSG_INDISPONIVEL, MSG_REDE, MSG_SEM_INTERNET, MSG_SEM_RESPOSTA, MSG_TEMPO, MSG_INESPERADO, MSG_ROTA_INDISPONIVEL, MSG_REDE_AUTH, MSG_TEMPO_AUTH, MSG_ABRIR_LOGIN]) {
      expect(m).toBe(MSG_INSTABILIDADE)
    }
  })

  it('a rota local promete desviar das barreiras que bloqueiam', () => {
    expect(textoSobreARota('pgrouting')).toContain('evita as escadas da base de ruas e as barreiras confirmadas que bloqueiam a passagem')
    expect(textoSobreARota('pgrouting')).not.toContain('não desvia')
  })

  it('/conta explica a exclusão e dá o contato configurado', async () => {
    vi.stubEnv('VITE_CONTATO_PRIVACIDADE', 'privacidade@exemplo.org')
    apiFalsa(logar())
    abrir('/conta')
    const link = await screen.findByRole('link', { name: 'privacidade@exemplo.org' })
    expect(link).toHaveAttribute('href', 'mailto:privacidade@exemplo.org')
    expect(screen.getByText(/As barreiras que você registrou continuam públicas, sem autor/)).toBeInTheDocument()
  })

  it('/conta sem contato configurado não mostra link quebrado', async () => {
    vi.stubEnv('VITE_CONTATO_PRIVACIDADE', '')
    apiFalsa(logar())
    abrir('/conta')
    expect(await screen.findByText(/fale com a equipe do projeto/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull()
  })

  it('o cadastro diz a licença dos dados', async () => {
    apiFalsa(logar())
    abrir('/barreiras/nova')
    expect(await screen.findByText(/sob a licença ODbL/)).toBeInTheDocument()
  })

  it('o envio de foto diz a licença e fica ligado ao campo', async () => {
    lembrarMinha(CONTA.id, 5)
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    abrir('/barreiras/5')
    const campo = await screen.findByLabelText('Arquivo da foto')
    expect(campo).toHaveAccessibleDescription(expect.stringContaining('licença CC BY-SA 4.0'))
  })

  it('a ficha não avisa mais de exceção na rota de reserva', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha({ status: 'validada' })), ...REVERSO })
    abrir('/barreiras/5')
    await screen.findByText(/Rua X, 1/)
    expect(screen.queryByText(/rota de reserva/i)).toBeNull()
  })
})
