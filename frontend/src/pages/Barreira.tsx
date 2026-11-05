import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { focoPerdido } from '../a11y/foco'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { enderecoDoPonto } from '../api/client'
import { obterBarreira } from '../api/colaboracao'
import { aquecerServidor } from '../api/servidor'
import { useConsulta } from '../api/useConsulta'
import { useSessao } from '../auth/useSessao'
import { FotoBarreira } from '../componentes/FotoBarreira'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { Placa } from '../componentes/Placa'
import { Votacao } from '../componentes/Votacao'
import { formatarDia, textoEfeito, textoStatus, textoVotos, votacaoEncerrada } from '../dados/barreira'
import { rotuloCategoria } from '../dados/categorias'
import { arredondar4 } from '../dados/localizacao'
import { lembrarMinha, lerMinhas } from '../dados/rascunho'
import '../estilos/colaborar.css'
import '../estilos/rota.css'

const MSG_INDISPONIVEL = 'Esta barreira não está mais disponível.'

type EstadoNavegacao = { recemCriada?: boolean; jaExistia?: boolean; ponto?: [number, number]; rotuloPonto?: string } | null

export function Barreira() {
  const { id } = useParams()
  const numero = Number(id)
  const local = useLocation()
  const navegar = useNavigate()
  const estadoNav = local.state as EstadoNavegacao
  // vale para esta visita: o histórico não guarda quem criou (efeito abaixo)
  const [chegada] = useState(() => ({
    recemCriada: estadoNav?.recemCriada === true,
    jaExistia: estadoNav?.jaExistia === true,
    ponto: estadoNav?.ponto,
    rotuloPonto: estadoNav?.rotuloPonto,
  }))
  const { recemCriada } = chegada
  const volta = chegada.ponto ? { ponto: chegada.ponto, rotuloPonto: chegada.rotuloPonto } : null
  const h1 = usePaginaAcessivel(recemCriada ? 'Barreira registrada' : 'Ficha da barreira')
  const { logado, conta, carregarConta } = useSessao()
  const anunciar = useAnuncio()
  const valido = Number.isInteger(numero) && numero > 0
  const consulta = useConsulta(valido ? `barreira-${numero}` : null, (sinal) => obterBarreira(numero, sinal))
  const espera = useEsperaServidor(consulta.carregando)
  const [autorNestaVisita, setAutorNestaVisita] = useState(false)
  const efeito = useRef<HTMLParagraphElement>(null)
  const fraseErro = useRef<HTMLParagraphElement>(null)
  const tinhaFicha = useRef(false)
  const barreira = consulta.dados

  useEffect(() => aquecerServidor(), [])

  useEffect(() => {
    // outra conta, voltando pelo histórico, não pode herdar "você cadastrou esta barreira"
    if (estadoNav?.recemCriada) navegar(local.pathname, { replace: true, state: volta })
    // só na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (logado) carregarConta().catch(() => {})
  }, [logado, carregarConta])

  useEffect(() => {
    if (recemCriada && conta) lembrarMinha(conta.id, numero)
  }, [recemCriada, conta, numero])

  const endereco = useConsulta(barreira ? `end-${barreira.id}` : null, (sinal) =>
    enderecoDoPonto(arredondar4(barreira!.lat), arredondar4(barreira!.lon), sinal),
  )

  const naoExiste = consulta.erro?.tipo === 'nao_encontrado' || !valido
  const textoErro = naoExiste ? MSG_INDISPONIVEL : (consulta.erro?.message ?? null)
  const temFicha = barreira !== null
  const anunciouFicha = useRef(false)
  useEffect(() => {
    if (temFicha) tinhaFicha.current = true
    if (!textoErro) return
    anunciouFicha.current = false
    // a releitura depois de um voto apagou a ficha e o botão que tinha o foco: a frase recebe o foco
    // e se lê sozinha (D27). Na primeira carga não há o que resgatar: o foco fica, e a região diz.
    if (tinhaFicha.current && focoPerdido()) fraseErro.current?.focus()
    else anunciar(textoErro)
  }, [textoErro, temFicha, anunciar])

  // o h1 já tem o foco e muda de texto quando os dados chegam: sem isto, nada seria dito
  const resumo = barreira ? `${rotuloCategoria(barreira.categoria)}. ${textoStatus(barreira)}. ${textoEfeito(barreira)}` : null
  useEffect(() => {
    if (!resumo || anunciouFicha.current) return
    anunciouFicha.current = true
    anunciar(resumo)
  }, [resumo, anunciar])

  // o voto que encerra, ou a releitura depois de um 409, tiram os botões da tela: o foco vai à
  // frase que diz o que aconteceu. Se a pessoa saiu dali, ele fica, e a região diz.
  const encerrada = barreira ? votacaoEncerrada(barreira) : null
  const votacaoAberta = useRef(false)
  useEffect(() => {
    const estavaAberta = votacaoAberta.current
    votacaoAberta.current = encerrada === false
    if (!estavaAberta || encerrada !== true) return
    if (focoPerdido()) {
      efeito.current?.focus()
      anunciar('') // a frase se lê sozinha; "Registrando o voto." já não vale
    } else if (resumo) anunciar(resumo)
  }, [encerrada, resumo, anunciar])

  const ehMinha = recemCriada || autorNestaVisita || (conta ? lerMinhas(conta.id).includes(numero) : false)
  const ehAdmin = conta?.papel === 'admin'
  const textoEndereco = endereco.dados
    ? `Perto de ${endereco.dados.rotulo}.`
    : endereco.erro?.tipo === 'nao_encontrado'
      ? 'Sem endereço conhecido a até 50 m.'
      : endereco.erro
        ? 'Endereço indisponível agora.'
        : 'Buscando o endereço…'

  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        {recemCriada ? 'Barreira registrada' : barreira ? rotuloCategoria(barreira.categoria) : 'Ficha da barreira'}
      </h1>
      {consulta.carregando && !barreira && <p>{espera ?? 'Carregando a ficha…'}</p>}
      {textoErro && (
        <p ref={fraseErro} tabIndex={-1}>
          {textoErro}
        </p>
      )}
      {consulta.erro && !naoExiste && (
        <Placa
          onClick={() => {
            // o botão some: o foco espera no título da página
            h1.current?.focus()
            consulta.recarregar()
          }}
        >
          Tentar de novo
        </Placa>
      )}
      {barreira && (
        <>
          {recemCriada && chegada.jaExistia && <p>Esta barreira já estava registrada.</p>}
          {recemCriada && <p className="letreiro colaborar__titulo">{rotuloCategoria(barreira.categoria)}</p>}
          <p ref={efeito} tabIndex={-1}>
            <strong className="escolha-local__rotulo">{textoStatus(barreira)}.</strong> {textoEfeito(barreira)}
          </p>
          <p>{textoEndereco}</p>
          {barreira.descricao && <p>{barreira.descricao}</p>}
          <p className="campo__dica">
            {textoVotos(barreira)}. Fonte: relato de colaboradores, não verificado pela Prefeitura, em{' '}
            <span className="medida">{formatarDia(barreira.criada_em)}</span>.
          </p>
          {barreira.foto_url && (
            <img className="foto__previa" src={barreira.foto_url} alt={barreira.foto_descricao ?? ''} loading="lazy" />
          )}
          {/* informativa nunca entra na rota: não há mudança a ver */}
          {barreira.status === 'validada' && barreira.severidade !== 'informativo' && recemCriada === false && (
            <p className="campo__dica">Recalcule a rota para ver a mudança.</p>
          )}
          {/* o endereço pode ocupar mais linhas que "Buscando…": os botões só entram com ele pronto,
              para ninguém votar no botão errado com a tela descendo (D3) */}
          {!endereco.carregando && (
            <>
              {!votacaoEncerrada(barreira) && (
                <Votacao
                  barreira={barreira}
                  ehAutor={ehMinha}
                  aoAtualizar={consulta.atualizar}
                  aoRecarregar={consulta.recarregar}
                  aoDescobrirAutor={() => setAutorNestaVisita(true)}
                />
              )}
              {(ehMinha || ehAdmin) && <FotoBarreira barreira={barreira} aoAtualizar={consulta.atualizar} />}
              {ehAdmin && (
                <p>
                  <Link className="alvo" to={`/admin/barreiras/${barreira.id}`}>
                    Moderar esta barreira
                  </Link>
                </p>
              )}
            </>
          )}
        </>
      )}
      <p>
        <Link className="alvo" to="/barreiras" state={volta}>
          Ver outras barreiras
        </Link>
      </p>
    </div>
  )
}
