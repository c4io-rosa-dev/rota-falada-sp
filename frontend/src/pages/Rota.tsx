import { Link } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { Pictograma } from '../componentes/Pictograma'
import { Placa } from '../componentes/Placa'
import { Janela, Torre } from '../componentes/Torre'

const EXIGENCIAS = [
  { valor: '3', rotulo: 'até 3%' },
  { valor: '6', rotulo: 'até 6%' },
  { valor: '10', rotulo: 'até 10%' },
  { valor: 'any', rotulo: 'qualquer inclinação' },
]

/** Esqueleto do Plano 5: o formulário existe, o cálculo ainda não. Nenhuma chamada à API. */
export function Rota() {
  const h1 = usePaginaAcessivel('Planejar rota')

  return (
    <div className="rota">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Planejar rota
        </h1>
        <p className="subtitulo">
          Diga de onde sai e aonde quer chegar. A rota volta como lista de passos, com a fonte e a data de cada dado.
        </p>
      </div>

      {/* o cálculo ainda não abre: o envio é bloqueado aqui, e o aviso vem antes do primeiro campo */}
      <form className="formulario" aria-label="Planejar rota" onSubmit={(e) => e.preventDefault()} noValidate>
        <p id="calculo-em-breve" className="aviso formulario__aviso">
          <Pictograma nome="fonte" />
          <span>O cálculo abre em breve para a área piloto (Vila Mariana, Lapa e Ipiranga).</span>
        </p>

        <div className="campo">
          <label htmlFor="origem">Origem</label>
          <p id="origem-dica" className="campo__dica">
            Endereço ou ponto de referência.
          </p>
          <input id="origem" name="origem" type="text" autoComplete="street-address" aria-describedby="origem-dica" />
        </div>

        <div className="campo">
          <label htmlFor="destino">Destino</label>
          <p id="destino-dica" className="campo__dica">
            Endereço ou ponto de referência.
          </p>
          <input id="destino" name="destino" type="text" autoComplete="off" aria-describedby="destino-dica" />
        </div>

        <fieldset className="exigencia" aria-describedby="exigencia-dica">
          <legend>Exigência</legend>
          <p id="exigencia-dica" className="campo__dica">
            Inclinação máxima que a calçada pode ter no caminho.
          </p>
          <div className="exigencia__opcoes">
            {EXIGENCIAS.map((o) => (
              <label key={o.valor} className="opcao">
                <input type="radio" name="exigencia" value={o.valor} defaultChecked={o.valor === '6'} />
                <span>{o.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="opcao">
          <input type="checkbox" name="evitar_degraus" defaultChecked />
          <span>Evitar degraus</span>
        </label>

        <div className="formulario__envio">
          <Placa type="submit" variante="acao" pictograma="siga" aria-disabled="true" aria-describedby="calculo-em-breve">
            Calcular rota
          </Placa>
        </div>
      </form>

      <Torre variante="anexo">
        <Janela area="aviso">
          <h2 className="letreiro">Área piloto</h2>
          <p>
            Os dados de calçada cobrem Vila Mariana, Lapa e Ipiranga. Fora dessa área a rota não existe, e o Rota
            Falada SP diz isso em vez de inventar um caminho.
          </p>
          <p>
            Enquanto o cálculo não abre, a página inicial mostra uma rota real de Vila Mariana, gravada em 12/10/2026,
            com os 11 passos.
          </p>
          <p>
            <Link to="/">Ver a rota de exemplo</Link>
          </p>
        </Janela>
      </Torre>
    </div>
  )
}
