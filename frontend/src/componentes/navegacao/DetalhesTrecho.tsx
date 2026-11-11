import { useState } from 'react'
import type { Passo } from '../../dados/passo'
import {
  textoBarreira,
  textoDataPasso,
  textoDeclividade,
  textoDegrauDoPasso,
  textoFontePasso,
  textoGuia,
  textoLargura,
} from '../../dados/passo'
import { Placa } from '../Placa'

/** A ficha do passo atual, aberta por um botão com aria-expanded. O foco fica no botão. */
export function DetalhesTrecho({ passo }: { passo: Passo }) {
  const [aberto, setAberto] = useState(false)
  const barreiras = passo.barreiras_proximas

  return (
    <div className="detalhes">
      <Placa aria-expanded={aberto} aria-controls="detalhes-trecho" onClick={() => setAberto((a) => !a)}>
        Detalhes do trecho
      </Placa>
      <div id="detalhes-trecho" hidden={!aberto}>
        {aberto && (
          <dl className="ficha__dados detalhes__dados">
            <dt>Largura</dt>
            <dd>{textoLargura(passo)}</dd>
            <dt>Inclinação</dt>
            <dd>{textoDeclividade(passo)}</dd>
            <dt>Guia</dt>
            <dd>{textoGuia(passo.guia)}</dd>
            <dt>Degrau</dt>
            <dd>{textoDegrauDoPasso(passo)}</dd>
            <dt>Barreiras</dt>
            <dd>
              {barreiras.length === 0 ? (
                'nenhuma registrada perto deste passo'
              ) : (
                <ul className="detalhes__barreiras">
                  {barreiras.map((b) => (
                    <li key={`${b.origem}-${b.id}`}>{textoBarreira(b)}</li>
                  ))}
                </ul>
              )}
            </dd>
            <dt>Fonte</dt>
            <dd>{textoFontePasso(passo)}</dd>
            <dt>Data</dt>
            <dd>{textoDataPasso(passo)}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}
