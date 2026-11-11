import { Placa } from '../Placa'
import { ANTES_DE_SAIR } from './textosNavegacao'

type Props = {
  resumo: string
  vozDisponivel: boolean
  vozLigada: boolean
  aoAlternarVoz: () => void
  aoComecar: () => void
  aoPassoAPasso: () => void
}

/** Antes de sair: o que o app faz e o que não faz, a escolha da voz e o botão Começar (spec 3). */
export function PreparoNavegacao({ resumo, vozDisponivel, vozLigada, aoAlternarVoz, aoComecar, aoPassoAPasso }: Props) {
  return (
    <div className="navegar__preparo">
      <p className="navegar__resumo">{resumo}.</p>

      <h2 id="antes-de-sair" className="letreiro navegar__subtitulo">
        Antes de sair
      </h2>
      <ul className="navegar__lista" aria-labelledby="antes-de-sair">
        {ANTES_DE_SAIR.map((texto) => (
          <li key={texto}>{texto}</li>
        ))}
      </ul>

      {vozDisponivel ? (
        <div className="navegar__voz">
          {/* rótulo fixo, estado no aria-pressed; a escolha não é gravada */}
          <Placa pictograma="ouvir" aria-pressed={vozLigada} aria-describedby="voz-dica" onClick={aoAlternarVoz}>
            Voz do app
          </Placa>
          <p id="voz-dica" className="campo__dica">
            Use se não tiver leitor de tela ligado, para não ouvir tudo duas vezes.
          </p>
        </div>
      ) : (
        <p className="campo__dica">A voz do app não está disponível neste aparelho. Use o leitor de tela ou leia a tela.</p>
      )}

      <div className="navegar__comecar">
        {/* no clique, sem await antes: voz, tela ligada e GPS, nesta ordem (useNavegacao) */}
        <Placa variante="acao" pictograma="siga" onClick={aoComecar}>
          Começar
        </Placa>
        <button type="button" className="alvo navegar__discreto" onClick={aoPassoAPasso}>
          Seguir passo a passo, sem localização
        </button>
      </div>
    </div>
  )
}
