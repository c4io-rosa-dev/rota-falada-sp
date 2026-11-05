import { lerConfigAuth, voltaSegura } from '../auth/config'
import { ErroApi } from '../api/base'
import { erroDoCodigo, mensagemDeErroAuth, MSG_CODIGO_ERRADO, MSG_LIMITE, MSG_REDE_AUTH, MSG_TEMPO_AUTH, normalizarCodigo } from '../auth/erros'

describe('configuração do login', () => {
  it('sem variáveis, ou com chave que não é publishable, o login some', () => {
    expect(lerConfigAuth({})).toBeNull()
    expect(lerConfigAuth({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toBeNull()
    expect(lerConfigAuth({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOi' })).toBeNull()
    expect(lerConfigAuth({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({
      url: 'https://x.supabase.co',
      chave: 'sb_publishable_abc',
    })
  })

  it('volta só aceita caminho interno', () => {
    expect(voltaSegura('/barreiras/nova')).toBe('/barreiras/nova')
    expect(voltaSegura('//evil.example')).toBe('/conta')
    expect(voltaSegura('https://evil.example')).toBe('/conta')
    expect(voltaSegura(null)).toBe('/conta')
    expect(voltaSegura('/admin?status=removida')).toBe('/admin?status=removida')
    // o navegador normaliza estes para outra origem
    expect(voltaSegura('/' + String.fromCharCode(92) + 'evil.example')).toBe('/conta')
    expect(voltaSegura('/\t/evil.example')).toBe('/conta')
    expect(voltaSegura('/\n/evil.example')).toBe('/conta')
    expect(voltaSegura('javascript:alert(1)')).toBe('/conta')
  })
})

describe('código de 6 dígitos', () => {
  it('colar com espaço ou hífen funciona; zero à esquerda fica', () => {
    expect(normalizarCodigo(' 012 345 ')).toBe('012345')
    expect(normalizarCodigo('012-345')).toBe('012345')
    expect(erroDoCodigo('012345')).toBeNull()
  })

  it('diz quantos dígitos faltam', () => {
    expect(erroDoCodigo('1234')).toBe('O código tem 6 dígitos; você digitou 4.')
    expect(erroDoCodigo('12a456')).toBe('O código tem só números.')
  })

  it.each([
    ['otp_expired', MSG_CODIGO_ERRADO],
    ['over_email_send_rate_limit', MSG_LIMITE],
    ['over_request_rate_limit', MSG_LIMITE],
    ['email_address_not_authorized', 'Este e-mail ainda não pode receber código: o envio está em fase de teste.'],
    ['email_address_invalid', 'Confira o e-mail digitado.'],
    ['validation_failed', 'Confira o e-mail digitado.'],
    ['signup_disabled', 'O login está desligado no momento.'],
    ['otp_disabled', 'O login está desligado no momento.'],
    ['qualquer_outro', MSG_REDE_AUTH],
  ])('código %s tem mensagem própria', (code, texto) => {
    expect(mensagemDeErroAuth({ code })).toBe(texto)
  })

  it('erro já traduzido passa como está', () => {
    expect(mensagemDeErroAuth(new ErroApi('tempo', MSG_TEMPO_AUTH))).toBe(MSG_TEMPO_AUTH)
  })

  it('falha sem código é rede', () => {
    expect(mensagemDeErroAuth(new TypeError('x'))).toBe(MSG_REDE_AUTH)
  })
})
