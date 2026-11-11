import { Link } from 'react-router'
import { INCLINACAO_NORMA_PCT, LARGURA_MINIMA_M, type Exigencia } from '../dados/narrador'
import {
  formatarDistancia,
  textoDataPasso,
  textoDeclividade,
  textoDegrauDoPasso,
  textoFontePasso,
  textoGuia,
  textoInstrucao,
  textoLargura,
  type Passo,
} from '../dados/passo'
import { linhaDoGeoJson, meioDaLinha } from '../dados/rotaGeo'
import { BarreirasDoPasso } from './BarreirasDoPasso'
import { guardarPassoDeRetorno } from '../dados/retornoPasso'
import { Placa } from './Placa'

const CAMPOS = ['Distância', 'Largura', 'Declividade', 'Guia', 'Degrau', 'Fonte', 'Data']

type Props = {
  passos: Passo[]
  passoAtivo: number | null
  rotulo: string
  /** Com o mapa aberto, cada passo ganha "Ver o passo N no mapa". O texto dirige o mapa. */
  aoVerNoMapa?: (ordem: number) => void
  passoNoMapa?: number | null
  /** Em /rota cada passo leva às barreiras perto dele. */
  comBarreiras?: boolean
  /** Inclinação pedida: o passo que passa dela ganha destaque em texto, não só em cor. */
  pedido?: Exigencia
}

/** A lista canônica de passos (`id="lista-passos"`). Tudo o que o mapa mostra está aqui. */
export function TabelaPassos({ passos, passoAtivo, rotulo, aoVerNoMapa, passoNoMapa, comBarreiras = false, pedido = 'any' }: Props) {
  const limite = pedido === 'any' ? INCLINACAO_NORMA_PCT : pedido
  return (
    <div className="tabela-passos">
      {/* cabeçalho só visual, alinhado pelo subgrid; cada linha mantém seus <dt> para o leitor de tela */}
      <div className="tabela-passos__cabecalho" aria-hidden="true">
        <span />
        {CAMPOS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <ol id="lista-passos" className="placas" aria-label={rotulo} tabIndex={-1}>
        {passos.map((p) => {
          const ativo = p.ordem === passoAtivo
          const linha = comBarreiras ? linhaDoGeoJson(p.geometria) : null
          const ingreme = p.declividade_pct !== null && p.declividade_pct > limite
          const estreita = p.largura_medida && p.largura_m !== null && p.largura_m < LARGURA_MINIMA_M
          return (
            <li
              key={p.ordem}
              id={`passo-${p.ordem}`}
              tabIndex={-1} // alvo de "Voltar ao passo N na lista": sem isso, o foco cai no body
              className={ativo ? 'placa-passo placa-passo--ativa' : 'placa-passo'}
              aria-current={ativo ? 'step' : undefined}
            >
              <span className="placa-passo__ordem letreiro">{p.ordem}</span>
              <p className="placa-passo__instrucao">{textoInstrucao(p)}</p>
              <dl className="placa-passo__dados">
                <div>
                  <dt className="rotulo-campo">Distância</dt>
                  <dd className="medida">{formatarDistancia(p.distancia_m)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Largura</dt>
                  <dd className={estreita ? 'medida alerta' : 'medida'}>
                    {textoLargura(p)}
                    {estreita && <span className="marca-alerta"> · estreita</span>}
                  </dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Declividade</dt>
                  <dd className={ingreme ? 'medida alerta' : 'medida'}>
                    {textoDeclividade(p)}
                    {ingreme && <span className="marca-alerta"> · {pedido === 'any' ? 'acima da norma' : 'acima do pedido'}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Guia</dt>
                  <dd className={p.guia === 'nao_transponivel' ? 'alerta' : undefined}>{textoGuia(p.guia)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Degrau</dt>
                  <dd className={p.is_degrau ? 'alerta' : undefined}>{textoDegrauDoPasso(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Fonte</dt>
                  <dd>{textoFontePasso(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Data</dt>
                  <dd className="medida">{textoDataPasso(p)}</dd>
                </div>
              </dl>
              <BarreirasDoPasso barreiras={p.barreiras_proximas} />
              {(aoVerNoMapa || linha) && (
                <div className="placa-passo__acoes">
                  {aoVerNoMapa && (
                    <Placa aria-current={p.ordem === passoNoMapa ? 'true' : undefined} onClick={() => aoVerNoMapa(p.ordem)}>
                      Ver o passo {p.ordem} no mapa
                    </Placa>
                  )}
                  {linha && (
                    <Link
                      className="alvo"
                      to="/barreiras"
                      onClick={() => guardarPassoDeRetorno(p.ordem)}
                      state={{ ponto: meioDaLinha(linha), rotuloPonto: `Meio do passo ${p.ordem}: ${textoInstrucao(p)}` }}
                    >
                      Barreiras perto do passo {p.ordem}
                    </Link>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
