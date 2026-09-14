import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'

export function Acessibilidade() {
  const h1 = usePaginaAcessivel('Declaração de acessibilidade')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Declaração de acessibilidade
      </h1>
      <p>
        O Rota Falada SP é feito para pessoas com mobilidade reduzida, baixa visão e para quem
        usa leitor de tela. Esta declaração atende ao art. 63, §1º, da Lei Brasileira de Inclusão
        (Lei 13.146/2015) e é atualizada a cada versão.
      </p>

      <h2>Meta de conformidade</h2>
      <p>
        WCAG 2.2 nível AA, tendo o eMAG 3.1 e a ABNT NBR 17225:2025 como referências nacionais.
      </p>

      <h2>Recursos disponíveis</h2>
      <ul>
        <li>Toda rota é apresentada como lista de passos em texto; o mapa é uma ilustração opcional.</li>
        <li>Navegação completa por teclado, com link para pular ao conteúdo e foco visível.</li>
        <li>Alvos de toque de no mínimo 44 por 44 pixels.</li>
        <li>Layout que se reorganiza sem rolagem horizontal a 320 pixels de largura e zoom de 400%.</li>
        <li>Respeito à preferência do sistema por menos movimento.</li>
        <li>Idioma declarado como português do Brasil para leitores de tela e síntese de voz.</li>
      </ul>

      <h2>Limitações conhecidas</h2>
      <ul>
        <li>O cálculo de rotas e a leitura em voz alta ainda não estão disponíveis nesta versão.</li>
        <li>Os dados de calçadas cobrem apenas a área piloto (Vila Mariana, Lapa e Ipiranga) e são de 2021.</li>
        <li>Testes manuais com VoiceOver foram feitos apenas no iPhone, não no macOS.</li>
      </ul>

      <h2>Como relatar um problema</h2>
      <p>
        Encontrou uma barreira neste site? Abra um relato no repositório público do projeto no
        GitHub ou escreva para a equipe pelo e-mail indicado lá. Respondemos em até sete dias.
      </p>
    </>
  )
}
