import { useState } from 'react'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { BotaoOuvir } from '../componentes/BotaoOuvir'
import { Elevacao } from '../componentes/Elevacao'
import { Passarela } from '../componentes/Passarela'
import { Pictograma } from '../componentes/Pictograma'
import { Placa } from '../componentes/Placa'
import { Janela } from '../componentes/Torre'
import {
  formatarData,
  formatarDistancia,
  nomeFonte,
  textoDeclividade,
  textoFalado,
  textoGuia,
  textoLargura,
} from '../dados/passo'
import { ROTA_EXEMPLO, ROTA_EXEMPLO_META } from '../dados/rotaExemplo'

const PASSOS = ROTA_EXEMPLO.passos
const DISTANCIA = formatarDistancia(ROTA_EXEMPLO.distancia_m)
const MINUTOS = Math.round(ROTA_EXEMPLO.duracao_s / 60)
const PROVENIENCIA = `${ROTA_EXEMPLO_META.rotulo} · ${ROTA_EXEMPLO_META.bairro} · fontes: ${ROTA_EXEMPLO_META.fontes.join(', ')}`
const EXIGENCIA = ROTA_EXEMPLO.nivel_exigencia_atendido === 'any' ? 'qualquer inclinação' : `até ${ROTA_EXEMPLO.nivel_exigencia_atendido}%`
const CAMPOS = ['Distância', 'Largura', 'Declividade', 'Guia', 'Degrau', 'Fonte', 'Data']
const MOTOR = ROTA_EXEMPLO.motor === 'ors' ? 'openrouteservice' : ROTA_EXEMPLO.motor

export function Inicio() {
  const h1 = usePaginaAcessivel('Início')
  const [passoAtivo, setPassoAtivo] = useState<number | null>(null)

  return (
    <>
      <section aria-labelledby="titulo-inicio">
        <Elevacao
          passos={PASSOS}
          passoAtivo={passoAtivo}
          rotuloLista="Passos da rota de exemplo, em elevação"
          baseOrigem={ROTA_EXEMPLO_META.origem}
          origem={
            <>
              <Janela area="titulo">
                <h1 id="titulo-inicio" ref={h1} tabIndex={-1} className="display">
                  A rota é um texto.
                </h1>
                <p className="subtitulo">
                  Rotas a pé em São Paulo que evitam escadas, calçadas estreitas e guias altas, descritas passo a passo
                  com fonte e data.
                </p>
              </Janela>
              <Janela area="acoes">
                <Placa para="/rota" variante="acao" pictograma="siga">
                  Planejar rota
                </Placa>
                <BotaoOuvir passos={PASSOS} aoMudarPasso={setPassoAtivo} />
              </Janela>
            </>
          }
          destino={
            <Janela area="destino">
              <p className="letreiro destino__rua">{ROTA_EXEMPLO_META.destino}</p>
              <p className="destino__resumo medida">
                {DISTANCIA} em {PASSOS.length} passos
              </p>
              <p className="proveniencia">{PROVENIENCIA}</p>
            </Janela>
          }
        />
      </section>

      <section className="secao secao--como" aria-labelledby="titulo-como">
        <h2 id="titulo-como" className="titulo-secao letreiro">
          Como funciona
        </h2>
        <ol className="como">
          <li className="laje laje--1">
            <span className="laje__numero letreiro" aria-hidden="true">
              1
            </span>
            <h3 className="letreiro">Origem e destino</h3>
            <p>Você diz de onde sai, aonde quer chegar e quanta inclinação aguenta.</p>
            <p className="placa-gravada">
              <span className="placa-gravada__trajeto">
                <span className="letreiro">{ROTA_EXEMPLO_META.origem}</span>
                <Pictograma nome="siga" tamanho={20} />
                <span className="visualmente-oculto"> até </span>
                <span className="letreiro">{ROTA_EXEMPLO_META.destino}</span>
              </span>
              <span className="visualmente-oculto">, </span>
              <span className="placa-gravada__perfil">
                <span className="medida">{EXIGENCIA}</span>
                <span className="visualmente-oculto">, </span>
                <span>evitar degraus</span>
              </span>
            </p>
            <p>Por enquanto, só na área piloto: Vila Mariana, Lapa e Ipiranga.</p>
          </li>
          <li className="laje laje--2">
            <span className="laje__numero letreiro" aria-hidden="true">
              2
            </span>
            <h3 className="letreiro">Lista de passos com fonte e data</h3>
            <p>A rota chega como lista ordenada. Quando não há dado, a lista diz “sem dado”.</p>
            <p>
              Na elevação, cada passo mostra rua e distância; na lista completa, também largura, declividade, guia,
              degrau, fonte e data.
            </p>
            <ol className="como__amostra" start={4} aria-label="Dois passos reais da rota de exemplo">
              <Passarela passo={PASSOS[3]} />
              <Passarela passo={PASSOS[4]} lado="fim" />
            </ol>
          </li>
          <li className="laje laje--3">
            <span className="laje__numero letreiro" aria-hidden="true">
              3
            </span>
            <h3 className="letreiro">Leia ou ouça</h3>
            <p>
              Por ser texto, a rota funciona com leitor de tela, só com teclado e com zoom de 400%. Se o navegador
              tiver voz, ela é lida em voz alta, um passo de cada vez.
            </p>
            <figure className="fala">
              <blockquote>
                <p>{textoFalado(PASSOS[3])}</p>
              </blockquote>
              <figcaption>O que a voz diz no passo 4 da rota de exemplo.</figcaption>
            </figure>
          </li>
        </ol>
      </section>

      <section className="secao secao--quem" aria-labelledby="titulo-quem">
        <h2 id="titulo-quem" className="titulo-secao letreiro">
          Para quem é
        </h2>
        <div className="personas">
          <div className="persona">
            <h3 className="persona__nome letreiro">Marcos</h3>
            <p className="persona__perfil">34 anos, cadeira de rodas manual.</p>
            <p>
              Vai de casa até a estação e quer saber se há degrau no caminho e se o ônibus é acessível. Usa o celular
              na rua, com uma mão livre.
            </p>
          </div>
          <div className="persona">
            <h3 className="persona__nome letreiro">Dona Ivete</h3>
            <p className="persona__perfil">68 anos, baixa visão, usa NVDA.</p>
            <p>Ouve a rota, navega só por teclado e digita com zoom de 400%. Nunca vê o mapa.</p>
          </div>
          <div className="persona">
            <h3 className="persona__nome letreiro">Sr. Antônio</h3>
            <p className="persona__perfil">79 anos, usa andador.</p>
            <p>
              Quer trechos curtos e sem inclinação e reporta calçada quebrada na hora, em poucos toques, às vezes sem
              sinal.
            </p>
          </div>
        </div>
        <p className="nota-banca">
          Personas do documento de projeto; o teste com usuários reais ainda não aconteceu e está previsto para a
          semana 15.
        </p>
        <p className="nota-banca">
          Para a banca da FATEC: cada passo declara fonte e data, e o cálculo é determinístico, sem IA generativa.
        </p>
      </section>

      <section className="secao secao--exemplo" aria-labelledby="titulo-exemplo">
        <h2 id="titulo-exemplo" className="titulo-secao letreiro">
          Exemplo de rota real
        </h2>
        <div className="exemplo">
          <div className="ficha">
            <p className="ficha__resumo">
              {ROTA_EXEMPLO_META.origem} até {ROTA_EXEMPLO_META.destino}, em {ROTA_EXEMPLO_META.bairro}:{' '}
              <span className="medida">{DISTANCIA}</span> em {PASSOS.length} passos, cerca de {MINUTOS} minutos a pé.
            </p>
            <dl className="ficha__dados">
              <dt>Calculada por</dt>
              <dd>{MOTOR}, em produção</dd>
              <dt>Exigência atendida</dt>
              <dd>{EXIGENCIA}</dd>
              <dt>Fontes</dt>
              <dd>{ROTA_EXEMPLO.fontes.map(nomeFonte).join(', ')}</dd>
              <dt>Gravada em</dt>
              <dd>{formatarData('2026-10-12')}</dd>
            </dl>
            {ROTA_EXEMPLO.avisos.map((a) => (
              <p key={a.tipo} className="aviso">
                <Pictograma nome="fonte" />
                <span>{a.mensagem}</span>
              </p>
            ))}
            <BotaoOuvir passos={PASSOS} aoMudarPasso={setPassoAtivo} />
          </div>

          <div className="tabela-passos">
            {/* cabeçalho só visual, alinhado pelo subgrid; cada linha mantém seus <dt> para o leitor de tela */}
            <div className="tabela-passos__cabecalho" aria-hidden="true">
              <span />
              {CAMPOS.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          <ol className="placas" aria-label="Os 11 passos da rota de exemplo">
            {PASSOS.map((p) => {
              const ativo = p.ordem === passoAtivo
              return (
                <li
                  key={p.ordem}
                  className={ativo ? 'placa-passo placa-passo--ativa' : 'placa-passo'}
                  aria-current={ativo ? 'step' : undefined}
                >
                  <span className="placa-passo__ordem letreiro">{p.ordem}</span>
                  <p className="placa-passo__instrucao">{p.instrucao}</p>
                  <dl className="placa-passo__dados">
                    <div>
                      <dt className="rotulo-campo">Distância</dt>
                      <dd className="medida">{formatarDistancia(p.distancia_m)}</dd>
                    </div>
                    <div>
                      <dt className="rotulo-campo">Largura</dt>
                      <dd className="medida">{textoLargura(p)}</dd>
                    </div>
                    <div>
                      <dt className="rotulo-campo">Declividade</dt>
                      <dd className="medida">{textoDeclividade(p)}</dd>
                    </div>
                    <div>
                      <dt className="rotulo-campo">Guia</dt>
                      <dd className={p.guia === 'nao_transponivel' ? 'alerta' : undefined}>{textoGuia(p.guia)}</dd>
                    </div>
                    <div>
                      <dt className="rotulo-campo">Degrau</dt>
                      <dd>{p.is_degrau ? 'sim' : 'não'}</dd>
                    </div>
                    <div>
                      <dt className="rotulo-campo">Fonte</dt>
                      <dd>{nomeFonte(p.fonte)}</dd>
                    </div>
                    <div>
                      <dt className="rotulo-campo">Data</dt>
                      <dd className="medida">{formatarData(p.data_referencia)}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ol>
          </div>
        </div>
      </section>
    </>
  )
}
