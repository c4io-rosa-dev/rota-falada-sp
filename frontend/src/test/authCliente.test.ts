import { MSG_ABRIR_LOGIN, MSG_REDE_AUTH, MSG_TEMPO_AUTH } from '../auth/erros'

type Sessao = { data: { session: unknown }; error: unknown }

const auth = vi.hoisted(() => ({
  falhar: 0,
  otp: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  verificar: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  sessao: vi.fn(async (): Promise<unknown> => ({ data: { session: null }, error: null })),
  renovar: vi.fn(async (): Promise<unknown> => ({ data: { session: null }, error: null })),
  sair: vi.fn(async () => ({ error: null })),
}))

vi.mock('@supabase/auth-js', () => ({
  AuthClient: class {
    constructor() {
      if (auth.falhar > 0) {
        auth.falhar -= 1
        throw new Error('chunk')
      }
    }
    signInWithOtp = auth.otp
    verifyOtp = auth.verificar
    getSession = auth.sessao
    refreshSession = auth.renovar
    signOut = auth.sair
  },
}))

const ERRO_RETENTAVEL = { name: 'AuthRetryableFetchError', message: 'rede' }

async function cliente() {
  vi.resetModules()
  return import('../auth/cliente')
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
  auth.falhar = 0
  auth.otp.mockReset().mockResolvedValue({ error: null })
  auth.sessao.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  auth.renovar.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  auth.sair.mockReset().mockResolvedValue({ error: null })
  localStorage.setItem('rf-sessao', '{}')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('auth/cliente', () => {
  it('falha ao abrir a biblioteca não fica gravada: tentar de novo funciona', async () => {
    const c = await cliente()
    auth.falhar = 1
    await expect(c.enviarCodigo('p@e.org')).rejects.toMatchObject({ tipo: 'rede', message: MSG_ABRIR_LOGIN })
    await expect(c.enviarCodigo('p@e.org')).resolves.toBeUndefined()
    expect(auth.otp).toHaveBeenCalledTimes(1)
  })

  it('conexão travada no login tem teto, com mensagem própria', async () => {
    vi.useFakeTimers()
    auth.otp.mockImplementation(() => new Promise(() => {}))
    const c = await cliente()
    const envio = c.enviarCodigo('p@e.org').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(30_100)
    expect(await envio).toMatchObject({ tipo: 'tempo', message: MSG_TEMPO_AUTH })
  })

  it('refresh que falha por rede não vira "deslogado"', async () => {
    const retentavel: Sessao = { data: { session: null }, error: ERRO_RETENTAVEL }
    auth.sessao.mockResolvedValue(retentavel)
    auth.renovar.mockResolvedValue(retentavel)
    const c = await cliente()
    await expect(c.obterToken()).rejects.toMatchObject({ tipo: 'rede', message: MSG_REDE_AUTH })
    await expect(c.lerConta()).rejects.toMatchObject({ tipo: 'rede' })
    await expect(c.renovarToken()).rejects.toMatchObject({ tipo: 'rede' })
  })

  it('refresh recusado pelo servidor é fim de sessão, não falha de rede', async () => {
    auth.sessao.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', message: 'x' } })
    auth.renovar.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', message: 'x' } })
    const c = await cliente()
    await expect(c.obterToken()).resolves.toBeNull()
    await expect(c.lerConta()).resolves.toBeNull()
    await expect(c.renovarToken()).resolves.toBeNull()
  })

  it('sair funciona mesmo sem a biblioteca: a sessão sai deste aparelho', async () => {
    const c = await cliente()
    auth.falhar = 1
    await expect(c.sair()).resolves.toBeUndefined()
    expect(localStorage.getItem('rf-sessao')).toBeNull()
  })
})
