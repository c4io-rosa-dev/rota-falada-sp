import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { apiFalsa, erroApi } from './apiFalsa'
import { CONTA, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('/admin', () => {
  it('conta comum recebe a resposta do backend como frase', async () => {
    apiFalsa({ ...logar(), 'GET /api/admin/barreiras': erroApi(403, 'Você não tem permissão para esta ação.') })
    abrir('/admin')
    expect(await screen.findByText('Esta área é só para a equipe de moderação.')).toBeInTheDocument()
  })

  it('sem sessão abre o portão', async () => {
    apiFalsa({})
    abrir('/admin')
    expect(await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeInTheDocument()
  })

  it('a fila filtra por link, anuncia a contagem e acha removida para restaurar', async () => {
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': Response.json([ficha({ status: 'removida' })]) })
    const { container } = abrir('/admin?status=removida')
    const link = await screen.findByRole('link', { name: 'Nº 5, Escada' })
    expect(link).toHaveAttribute('href', '/admin/barreiras/5')
    expect(new URL(api.de('GET /api/admin/barreiras')[0].url).searchParams.get('status')).toBe('removida')
    expect(within(screen.getByRole('navigation', { name: 'Filtrar por status' })).getByRole('link', { name: 'Removida pela moderação' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 barreira'))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o padrão é pendente e "Carregar mais" pede antes_de e leva o foco ao primeiro novo', async () => {
    const pagina = Array.from({ length: 50 }, (_, i) => ficha({ id: 100 - i }))
    let vez = 0
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => Response.json(++vez === 1 ? pagina : [ficha({ id: 50 })]) })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 100, Escada' })
    expect(new URL(api.de('GET /api/admin/barreiras')[0].url).searchParams.get('status')).toBe('pendente')
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    const novo = await screen.findByRole('link', { name: 'Nº 50, Escada' })
    expect(new URL(api.de('GET /api/admin/barreiras')[1].url).searchParams.get('antes_de')).toBe('51')
    expect(novo).toHaveFocus()
  })

  it('a decisão exige motivo, mantém o foco, anuncia e atualiza a auditoria', async () => {
    const eventos = [{ id: 1, barreira_id: 5, usuario_id: CONTA.id, tipo: 'criada', de_status: null, para_status: 'pendente', detalhe: {}, criado_em: '2026-11-03T12:00:00+00:00' }]
    const api = apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras/5': Response.json(ficha()),
      'GET /api/admin/barreiras/5/eventos': () => Response.json(eventos),
      'POST /api/admin/barreiras/5/status': () => {
        eventos.push({ ...eventos[0], id: 2, tipo: 'admin', de_status: 'pendente', para_status: 'validada', detalhe: { motivo: 'Vi no local' } as never })
        return Response.json(ficha({ status: 'validada' }))
      },
    })
    const user = userEvent.setup()
    const { container } = abrir('/admin/barreiras/5')
    await screen.findByRole('heading', { level: 2, name: 'Nº 5, Escada' })
    expect(await screen.findByText(/criada por conta 3f2a91b0/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    await user.click(screen.getByRole('radio', { name: /^Confirmada/ }))
    const registrar = screen.getByRole('button', { name: 'Registrar decisão' })
    await user.click(registrar)
    const motivo = screen.getByRole('textbox', { name: 'Motivo' })
    expect(motivo).toHaveFocus()
    expect(motivo).toHaveAttribute('aria-invalid', 'true')
    expect(api.de('POST /api/admin/barreiras/5/status')).toHaveLength(0)

    await user.type(motivo, '  Vi no local  ')
    await user.click(registrar)
    await waitFor(() => expect(api.de('POST /api/admin/barreiras/5/status')).toHaveLength(1))
    expect(JSON.parse(String(api.de('POST /api/admin/barreiras/5/status')[0].init.body))).toEqual({ status: 'validada', motivo: 'Vi no local' })
    expect(registrar).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Status alterado para confirmada. Auditoria atualizada.'))
    expect(await screen.findByText(/Motivo: Vi no local/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('pessoa@exemplo.org')
  })

  it('barreira removida abre e pode voltar', async () => {
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras/5': Response.json(ficha({ status: 'removida' })), 'GET /api/admin/barreiras/5/eventos': Response.json([]) })
    abrir('/admin/barreiras/5')
    expect(await screen.findByRole('radio', { name: /^Removida pela moderação/ })).toBeChecked()
  })

  it('401 na fila renova e repete, sem abrir o portão', async () => {
    let vez = 0
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? erroApi(401, 'Faça login para continuar.') : Response.json([ficha()])) })
    mocks.renovarToken.mockResolvedValue('novo')
    abrir('/admin')
    expect(await screen.findByRole('link', { name: 'Nº 5, Escada' })).toBeInTheDocument()
    expect((api.de('GET /api/admin/barreiras')[1].init.headers as Record<string, string>).Authorization).toBe('Bearer novo')
    expect(screen.queryByRole('heading', { level: 2, name: /Entre para continuar|Sua sessão terminou/ })).toBeNull()
  })

  it('sessão que não renova na fila: "Sua sessão terminou", nunca "Entre para continuar"', async () => {
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': erroApi(401, 'Faça login para continuar.') })
    abrir('/admin')
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toBeInTheDocument()
  })

  it('"Carregar mais": cada lote foca o próprio primeiro item; 401 abre o portão; fim da fila não derruba o foco', async () => {
    const lote = (de: number) => Array.from({ length: 50 }, (_, i) => ficha({ id: de - i }))
    let vez = 0
    apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras': () => {
        vez += 1
        if (vez === 1) return Response.json(lote(200))
        if (vez === 2) return Response.json(lote(150))
        if (vez === 3) return erroApi(401, 'Faça login para continuar.')
        return Response.json([])
      },
    })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 200, Escada' })
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByRole('link', { name: 'Nº 150, Escada' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('Não há mais barreiras.')).toHaveFocus()
  })

  it('"Tentar de novo" some, e o foco vai ao h1', async () => {
    let vez = 0
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? new Response('x', { status: 503 }) : Response.json([])) })
    const user = userEvent.setup()
    abrir('/admin')
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Moderação' })).toHaveFocus()
  })

  it('401 na auditoria abre o portão em vez de uma frase sem saída', async () => {
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras/5': Response.json(ficha()), 'GET /api/admin/barreiras/5/eventos': erroApi(401, 'Faça login para continuar.') })
    abrir('/admin/barreiras/5')
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toBeInTheDocument()
  })

  it('"Remover foto" some, e o foco vai ao retorno; o motivo editado com o portão aberto vale', async () => {
    const comFoto = ficha({ foto_url: 'https://x.supabase.co/f.webp', foto_descricao: 'Escada' })
    const api = apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras/5': Response.json(comFoto),
      'GET /api/admin/barreiras/5/eventos': Response.json([]),
      'DELETE /api/barreiras/5/foto': Response.json(ficha()),
      'POST /api/admin/barreiras/5/status': () => {
        return Response.json(ficha({ status: 'validada' }))
      },
    })
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Remover foto' }))
    await waitFor(() => expect(screen.getByText('Foto removida.')).toHaveFocus())

    mocks.obterToken.mockResolvedValueOnce(null)
    await user.click(screen.getByRole('radio', { name: /^Confirmada/ }))
    await user.type(screen.getByRole('textbox', { name: 'Motivo' }), 'Primeiro motivo')
    const registrar = screen.getByRole('button', { name: 'Registrar decisão' })
    await user.click(registrar)
    // havia sessão salva e ela não deu token: é sessão que terminou, não primeiro login
    await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })
    await user.clear(screen.getByRole('textbox', { name: 'Motivo' }))
    await user.type(screen.getByRole('textbox', { name: 'Motivo' }), 'Motivo corrigido')
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('POST /api/admin/barreiras/5/status')).toHaveLength(1))
    expect(JSON.parse(String(api.de('POST /api/admin/barreiras/5/status')[0].init.body)).motivo).toBe('Motivo corrigido')
    expect(registrar).toHaveFocus()
  })
})
