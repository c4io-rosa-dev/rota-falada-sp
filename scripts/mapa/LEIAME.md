# Arquivo do mapa da navegação guiada (`.pmtiles`)

Como gerar e publicar o arquivo de tiles vetoriais que o mapa da navegação guiada usa. O desenho está em `docs/superpowers/specs/2026-11-09-mapa-proprio-navegacao-design.md` (seção 14).

**Nada aqui roda sozinho.** Nenhum passo deste documento é executado pelo build, pelos testes ou pelo deploy. Nenhum binário é baixado sem autorização do dono do projeto.

Resumo do caminho: build do Protomaps (planeta inteiro) → recorte só da área coberta → bucket R2 `rota-falada-mapas` → servido pelo próprio Worker do site em `/mapa/*`. Assim o celular só pede tiles ao próprio site; nenhum terceiro recebe pedido de mapa durante a navegação.

---

## 1. Origem dos dados

- Builds diários do Protomaps: `https://build.protomaps.com/AAAAMMDD.pmtiles` (troque `AAAAMMDD` pela data do build, por exemplo `20261109`).
- Só os builds dos **últimos 7 dias** ficam no ar. Escolha uma data recente na hora de gerar.
- Dados: **OpenStreetMap**, licença **ODbL 1.0** (© colaboradores do OpenStreetMap, <https://www.openstreetmap.org/copyright>).
- Esquema de camadas do Protomaps (o "basemap"): o pacote `@protomaps/basemaps` declara BSD-3-Clause.
- O registro de licenças do projeto fica em `DATA-LICENSES.md`, na raiz.

## 2. Ferramenta: `go-pmtiles` (BSD-3-Clause)

- O programa é o `pmtiles` do projeto `go-pmtiles`, distribuído como binário nos GitHub Releases (`https://github.com/protomaps/go-pmtiles/releases`).
- **Baixar só com autorização do dono do projeto.** Este repositório não traz o binário e nenhum script daqui o baixa.
- Antes de qualquer passo, confira se ele já está instalado. Se não estiver, **pare** e peça autorização:

```bash
if ! command -v pmtiles >/dev/null 2>&1; then
  echo "O programa 'pmtiles' (go-pmtiles, BSD-3) não está no PATH." >&2
  echo "Nada foi baixado. Peça autorização ao dono do projeto antes de instalar." >&2
  exit 1
fi
pmtiles version
```

## 3. Recortar a área coberta

Primeiro gere o polígono da área a partir dos recortes de `AREA_PILOTO` em `etl/etl/config.py` (só biblioteca padrão do Python, não baixa nada). Rodar a partir de `etl/`:

```bash
cd etl
python -m etl.area_geojson ../scripts/mapa/area.geojson
cd ..
```

Depois recorte o build (o `pmtiles extract` lê só os pedaços necessários do arquivo remoto, por requisições HTTP Range). A saída vai para `etl/dados/`, pasta que o git já ignora (o `.gitignore` também ignora qualquer `*.pmtiles` e o `scripts/mapa/area.geojson`):

```bash
DATA=AAAAMMDD   # data do build escolhido
SAIDA="etl/dados/rota-falada-sp-${DATA}.pmtiles"
pmtiles extract "https://build.protomaps.com/${DATA}.pmtiles" "$SAIDA" \
  --region=scripts/mapa/area.geojson --maxzoom=15
```

- `--maxzoom=15`: o mapa da navegação usa zoom 17, que o MapLibre amplia a partir do 15.
- O nome precisa casar com `rota-falada-sp-\d{8}.pmtiles` (oito dígitos). O Worker devolve 404 para qualquer outro nome.

## 4. Conferir o arquivo

```bash
pmtiles verify "$SAIDA"
pmtiles show "$SAIDA"
```

Anote o tamanho do arquivo (estimativa: 10 a 40 MB) e confira no `show` que os limites batem com a `BBOX_UNIAO` de `etl/etl/config.py` (`-46.720, -23.625, -46.575, -23.510`).

## 5. Enviar ao R2

Pelo painel do Cloudflare (R2 → bucket `rota-falada-mapas` → Upload) ou pela linha de comando:

```bash
npx wrangler r2 object put "rota-falada-mapas/rota-falada-sp-${DATA}.pmtiles" \
  --file="$SAIDA" \
  --content-type=application/octet-stream \
  --cache-control="public, max-age=31536000, immutable" \
  --remote
```

Não versione o `.pmtiles` no git (o `.gitignore` já impede o `git add` comum).

**Nunca reenvie um arquivo com o mesmo nome.** O nome versionado é o que permite o cache longo, e o Worker guarda o tamanho e a ETag do arquivo na memória do isolate. Se o arquivo de um dia precisar ser refeito, use o build de outra data (outro nome). Por segurança, o Worker confere a ETag de cada leitura do R2 com a guardada: se o arquivo tiver sido trocado, ele relê o `head` e serve a versão nova, e nunca mistura o tamanho de uma com os bytes da outra.

## 6. Trocar o nome no frontend

Em `frontend/src/componentes/mapa/arquivoMapa.ts`, troque `ARQUIVO_MAPA` para `rota-falada-sp-AAAAMMDD.pmtiles` com a data nova. O nome versionado é o que permite o cache `immutable`: um arquivo novo sempre tem um nome novo.

Até o arquivo real existir, `ARQUIVO_MAPA` fica no marcador `rota-falada-sp-00000000.pmtiles`. Com ele, o mapa mostra "O mapa não carregou" e a navegação segue normal, pela voz e pelo texto.

Arquivos antigos podem ficar no bucket até o deploy com o nome novo estar no ar; depois podem ser apagados.

## 7. Atribuição obrigatória

A licença ODbL exige atribuição visível. O mapa mostra, fora da imagem e sempre visível: "Mapa: Protomaps © colaboradores do OpenStreetMap", com link para <https://www.openstreetmap.org/copyright>. Não remova nem esconda esse texto.

## 8. Não usar `wrangler tail`

**`wrangler tail` não faz parte deste fluxo.** Ele mostraria ao vivo os pedidos ao Worker, e o cabeçalho `Range` de cada pedido de tile revela a região que a pessoa está vendo, ou seja, onde ela está. Pelo mesmo motivo, o Worker não usa `console` e roda com a observabilidade desligada (`frontend/wrangler.jsonc`). Para conferir se o arquivo está no ar, use `curl -I https://<site>/mapa/rota-falada-sp-AAAAMMDD.pmtiles` (um `HEAD`, sem `Range`), que só mostra os cabeçalhos.

## 9. Teste obrigatório na prévia por branch (antes do merge)

Os testes locais passam pelo código do Worker (`frontend/worker/servirMapa.ts`): o Vitest chama `responderMapa` direto e o Playwright atende `/mapa/*` com a mesma função sobre um bucket falso. Eles **não** rodam o `workerd` nem o `wrangler`, que não estão instalados (o `wrangler` baixa o binário do `workerd`, o que pede autorização do dono). Ficam sem prova local: que o `assets.run_worker_first` manda `/mapa/*` ao Worker em vez do `index.html`, que o `main` em TypeScript empacota no Workers Builds e que o binding `MAPAS` do R2 funciona. Por isso, na prévia por branch do Workers Builds, antes do merge:

1. `curl -I https://<prévia>/mapa/rota-falada-sp-00000000.pmtiles`: com o arquivo ausente, **404** com `Cache-Control: no-store` (nunca 200 com `text/html`, que seria o `index.html` do SPA).
2. Com o arquivo real no bucket: `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Range: bytes=0-16383' https://<prévia>/mapa/rota-falada-sp-AAAAMMDD.pmtiles` deve dar **206 application/octet-stream**.
3. `curl -I https://<prévia>/mapa/qualquer-coisa`: **404**, sem `text/html`.
4. `curl -I https://<prévia>/rota`: **200** com `text/html` (o SPA continua servido pelos assets).
5. No celular, abrir a navegação de demonstração, tocar em "Mostrar o mapa" e ver o mapa desenhar.

## 10. Consumo e limites do plano gratuito

Os assets estáticos do site não contam no limite de pedidos do Worker; **cada pedido a `/mapa/*` conta**, porque passa pelo código do Worker. A resposta do Worker não passa pelo cache da CDN, e o mapa pede os pedaços com `cache: 'no-store'` (o navegador não grava em disco a região vista, por privacidade), então cada pedaço novo vira um pedido.

- **Por sessão de navegação com o mapa aberto (estimativa, a conferir na prévia):** 1 pedido para o cabeçalho e o diretório raiz (16 KB), alguns pedidos de diretórios folha e 1 pedido por tile z15 novo. No zoom 17, a tela do celular mostra de 1 a 4 tiles z15 (cada um com cerca de 1,1 km de lado em São Paulo), e o MapLibre guarda os recentes em memória. Uma caminhada de 1 a 2 km fica na ordem de **10 a 40 pedidos**.
- **Cada pedido:** 1 invocação do Worker e 1 leitura no R2 (operação Classe B). O primeiro pedido de cada isolate faz também um `head` (outra Classe B).
- **Limites gratuitos (confira em developers.cloudflare.com/workers/platform/pricing e developers.cloudflare.com/r2/pricing antes de ligar):** Workers Free com 100 mil pedidos por dia; R2 com 10 milhões de operações Classe B por mês e saída gratuita. Na estimativa acima, isso cobre milhares de sessões por dia.
- **Quando o limite diário de pedidos do Worker estoura:** os pedidos a `/mapa/*` falham até o dia virar. O mapa mostra "O mapa não carregou" (ou "Parte do mapa não carregou") e a navegação segue pela voz e pelo texto. O resto do site, servido como asset estático, continua no ar.
