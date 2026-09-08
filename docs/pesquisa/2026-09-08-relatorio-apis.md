> **Nota metodológica.** Todas as verificações abaixo foram executadas por mim em **08/09/2026** contra as fontes primárias (documentação oficial, endpoints reais). Onde um número circulante em blogs divergiu da fonte oficial, registro a correção. Números medidos por consulta própria estão marcados como tal e são reproduzíveis pela banca.

---

## 1. Correções às premissas mais repetidas

| Afirmação que circula | O que a fonte primária diz | Fonte |
|---|---|---|
| A Overpass "proíbe" usar instâncias públicas como backend | O texto usa o rótulo **"problematic behaviour"** e recomenda alternativas. A conclusão prática (não chamar em runtime) continua certa; a justificativa jurídica, não | [commons.html](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) |
| ORS: perfil wheelchair limitado a 300 km | 6.000 km como os demais; **300 km apenas quando se enviam `profile_params`** — que é o nosso caso, mas a formulação importa | [restrictions](https://openrouteservice.org/restrictions/) |
| ORS: cotas cumulativas entre endpoints | **Por endpoint.** `directions`: limite diário + 40 requisições por janela deslizante de 60 s; **403** no estouro diário, **429** no minutário | [FAQ oficial](https://giscience.github.io/openrouteservice/frequently-asked-questions) |
| GTFS da SPTrans exige login para baixar | Download **anônimo** e automatizável em CI | verificação do dossiê |
| WCAG 2.2: alvo mínimo de 44 px | **24×24 px CSS é o nível AA (2.5.8)**; 44×44 px é o AAA (2.5.5). Adotaremos 44 px por decisão de projeto | [W3C 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) |
| `openrouteservice-py` é o cliente recomendado | Última release **2.3.3, de fev/2021**, testada só até Python 3.9. Use `httpx` direto ou `routingpy` | [PyPI](https://pypi.org/project/openrouteservice/) |
| `pgr_createTopology` é a forma de montar topologia | **Depreciada na 3.8 e removida na 4.0.** Use `pgr_extractVertices` | [issue #2750](https://github.com/pgRouting/pgrouting/issues/2750) |
| Espelhos Overpass kumi/private.coffee servem de plano B um do outro | Compartilham a **mesma infraestrutura**, e o cluster kumi devolve snapshots de datas diferentes a cada chamada — inviabiliza reprodutibilidade acadêmica | verificação do dossiê |

---

## 2. OpenStreetMap: cobertura real de São Paulo

**Medição própria, executada em 08/09/2026 contra `overpass-api.de`** (bbox `-23.82,-46.83,-23.36,-46.36`), com `[out:csv(::count;false)]`:

| Elemento | Contagem | Leitura |
|---|---|---|
| `highway=crossing` | **54.954** | travessias mapeadas |
| `highway=crossing` **com** `kerb=*` | **1.035** | **1,88%** — a informação decisiva para cadeirante existe em menos de 2% das travessias |
| `highway=steps` | **3.713** | a barreira mais bem mapeada da cidade e o dado mais imediatamente aproveitável |

Essa é a evidência que fundamenta o projeto: **o dado oficial não sustenta roteamento acessível confiável**, e é exatamente essa lacuna que a camada colaborativa preenche. Vá para a fundamentação do relatório com esses três números, que a banca pode reproduzir em uma linha de `curl`.

Valores de `kerb` a tratar no parser, conforme o [wiki](https://wiki.openstreetmap.org/wiki/Key:kerb): `flush` (~0 cm) e `lowered` (≲3 cm) transponíveis; `raised` (>3 cm) e `rolled` como barreira; `no` = ausência de guia (transponível); e **`yes` = DESCONHECIDO** — significa apenas que "existe uma guia, mas não se determinou o tipo". Mapear `yes` como acessível é o bug silencioso mais caro do domínio.

**Fonte de dados para o grafo:** extrato Geofabrik. Verifiquei hoje: `sudeste-latest.osm.pbf` = **817 MB**, `brazil-latest.osm.pbf` = **1,9 GB**, dados de 08/09/2026 às 20:21 UTC. Sem cadastro, sem rate limit.

**Overpass API:** ~10.000 requisições/dia, <1 GB/dia, timeout padrão de 180 s, 512 MiB de memória por consulta, **429** para rate limit e **504** para estouro de recursos. Uso **exclusivamente em desenvolvimento e para as estatísticas do relatório** — nunca no caminho da requisição do usuário. Atenção de sintaxe: `{{bbox}}` é template do overpass-turbo e devolve `parse error: Unknown query clause` no `/api/interpreter`.

---

## 3. GeoSampa — a fonte mais valiosa do projeto

Endpoint: `https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs` (WFS 2.0.0, **sem chave e sem cadastro**).

**Verificação própria (08/09/2026, 23:01 UTC):** `typeName=geoportal:calcada&resultType=hits` devolveu `numberMatched="491383"`. A camada traz, por face de quadra, `qt_largura_minima/media/maxima_trecho` e `pc_declividade_minima/media/maxima_trecho` — **as duas variáveis da NBR 9050**.

**Três armadilhas que custam dias se descobertas tarde:**

1. **Truncamento silencioso.** O `GetCapabilities` declara `CountDefault=30000` e há tetos por camada. Uma requisição sem `count`/`startIndex` explícitos devolve **HTTP 200 com dados incompletos e nenhum aviso**. Todo script deve validar `numberReturned` contra o `numberMatched` obtido com `count=1`.
2. **Zeros que são ausência.** Os campos nunca são `NULL`: dado ausente foi codificado como **0**. Dos 154.770 trechos com largura < 1,20 m, **16.381 têm largura exatamente 0**, e 116.489 feições têm declividade 0. O filtro honesto é `> 0 AND < 1.2`, e a interface precisa dizer "não medida", jamais "0 m".
3. **Data.** Dezembro/2024 atualizou **apenas** o status do Plano Emergencial (1,4% das feições). Largura e declividade vêm do diagnóstico da SMUL revisado em **13/08/2021**. Exibir "2024" ao lado de um alerta de largura é factualmente errado.

**Licença (verificada hoje):** **CC-BY-SA 4.0**, processo SEI 6066.2020/0003044-4, exigindo atribuição **e** manutenção de licença semelhante em obras derivadas.

Outras camadas úteis: `geoportal:acessibilidade_smped` (972 pontos do Selo de Acessibilidade), `geoportal:declividade`, `geoportal:ponto_onibus`, `geoportal:estacao_metro`, `geoportal:obra_arte`. **Não existe** camada de rampa, guia rebaixada ou faixa de pedestre — reposicione esses itens como colaborativos na proposta escrita. A camada `geoportal:semaforo` (6.432 pontos) só distingue COMUM/PISCANTE, **sem sinal sonoro**, com carga de 2018.

---

## 4. SP156 e dados abertos municipais

CSVs trimestrais em `dados.prefeitura.sp.gov.br/dataset/dados-do-sp156`, licença **CC0** — a mais permissiva do conjunto. Leia com `encoding='cp1252'` e `sep=';'` (**não** `latin-1`: o byte `0x96`, travessão, é indefinido em latin-1 estrito e vira `\x96` em silêncio no meio dos nomes de serviço). Os rótulos misturam hífen e travessão — normalize o traço antes de filtrar por string.

Categorias a incluir, além das óbvias de calçada: *"Guias, sarjetas e sarjetões – solicitar manutenção"* (6.895) e *"Árvore – Solicitar avaliação em calçadas e praças"* (15.834; raiz levantando calçada é barreira clássica). **64,1%** das linhas têm coordenada — valide-as com `ST_Within` contra o limite municipal antes de inserir.

Detalhe operacional: o WAF da PRODAM bloqueia o User-Agent do `curl` (devolve HTTP 200 com HTML "Requisicao Bloqueada"); `requests` e `axios` funcionam de primeira.

---

## 5. Roteamento — motores avaliados

**Escolhido: OpenRouteService, perfil `wheelchair`.** Confirmei hoje na [documentação oficial](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options):

| Parâmetro | Default | Valores |
|---|---|---|
| `maximum_incline` | 6 | 3, 6, 10, 15, `any` (%) |
| `maximum_sloped_kerb` | 0.06 | 0.03, 0.06, 0.1, `any` (m) |
| `minimum_width` | — | metros |
| `surface_type` | `cobblestone:flattened` | valores OSM |
| `smoothness_type` | `good` | valores OSM |
| `track_type` | `grade1` | valores OSM |

`avoid_features` do perfil aceita exatamente **`steps`** e **`ferries`**. Limites de forma: polígono a evitar ≤ **200 km²** e ≤ **20 km** de extensão, ≤ **50 waypoints**.

**Alternativas, com o motivo do descarte:**

- **Valhalla** — também tem modo cadeirante pronto (`costing=pedestrian`, `type=wheelchair`) e instância pública gratuita da FOSSGIS; portanto o ORS **não é o único**, é o mais parametrizável. Descartado porque `max_grade` é lido pelo parser mas tem a verificação desativada no código-fonte, e o modo wheelchair impõe `max_distance` de 10 km.
- **GraphHopper** — o veículo `wheelchair` foi **removido na versão 9.0 (23/04/2024)**; reescrevê-lo como custom model é um TCC inteiro. O bloco `areas` do custom model permitiria penalidade **graduada**, tecnicamente superior ao bloqueio binário do ORS — fica como trabalho futuro.
- **OSRM** — perfis Lua só valem no pré-processamento; cada barreira nova exigiria `osrm-extract` + `osrm-contract`. **Arquitetonicamente incompatível** com sistema colaborativo.
- **pgRouting** — **adotado como fallback**, não como motor primário: a extensão vive no PostGIS que o projeto já terá, e uma barreira nova vira um `UPDATE` numa coluna de custo. Atenção: `pgr_createTopology` foi depreciada na 3.8 e removida na 4.0; use `pgr_extractVertices`.

**Elevação:** com `elevation=true` e `extra_info=steepness|surface|waytype`, a **própria resposta do ORS** já traz declividade por segmento e `ascent`/`descent`. Consultar Open Topo Data ponto a ponto para isso é trabalho duplicado.

---

## 6. Geocodificação

O [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) impõe **máximo absoluto de 1 requisição por segundo**, exige User-Agent identificando a aplicação, obriga cache local e diz literalmente sobre autocomplete: *"This is not yet supported by Nominatim and you must not implement such a service on the client side using the API."* Uma caixa de busca React que dispare a cada tecla resulta em bloqueio de IP.

**Solução em duas camadas:** autocomplete **local** sobre a tabela de logradouros no próprio PostGIS (`pg_trgm`), instantâneo e dentro da política; e **Photon** (`photon.komoot.io`) como fallback — é o geocodificador OSM feito para busca tecla a tecla. **Ressalva verificada hoje:** `lang=pt` devolve **HTTP 400**; com `lang=default` a resposta vem correta, trazendo `name`, `district`, `city`, `state`, `postcode` e `countrycode` para endereços de São Paulo.

---

## 7. Tiles do mapa base

A [política oficial](https://operations.osmfoundation.org/policies/tiles/) exige User-Agent próprio, atribuição visível e cache de **no mínimo 7 dias**, e define *bulk downloading* como "qualquer busca preventiva de tiles além dos que o usuário está vendo ativamente", proibindo pre-seeding, construção de arquivos `.mbtiles` e qualquer funcionalidade de download para uso offline — *"Offline use is not permitted on tile.openstreetmap.org"*, com bloqueio **sem aviso prévio**.

Consequência de projeto: **cachear o que o usuário já viu é permitido e até exigido; "mapa offline" não é**. Se offline virar requisito, a única via legítima é Protomaps/PMTiles auto-hospedado. Plano B verificado hoje: **OpenFreeMap** (`https://tiles.openfreemap.org/styles/liberty`) — sem registro, sem chave de API, sem cookies e **sem limite de views ou requisições**, porém **sem SLA nem suporte**.

---

## 8. SPTrans: o que ela responde e o que não responde

**API Olho Vivo v2.1** (`https://api.olhovivo.sptrans.com.br/v2.1`; use HTTPS, embora a documentação ainda exiba `http://`). Confirmei na documentação oficial que o campo **`a`** em `/Posicao` é *"Indica se o veículo é (true) ou não (false) acessível para pessoas com deficiência"*, que **`px` é longitude e `py` é latitude**, e a lista de endpoints (`Linha/Buscar`, `Parada/Buscar`, `Posicao`, `Posicao/Linha`, `Posicao/Garagem`, `Previsao`, `Previsao/Linha`, `Previsao/Parada`, `Corredor`, `Empresa`, `KMZ`).

**Cinco armadilhas confirmadas:**

1. **Sem CORS** em GET, POST e preflight OPTIONS → **backend proxy é obrigatório**, não opcional.
2. `POST /Login/Autenticar` **exige `Content-Length: 0`**, senão devolve **HTTP 411** — e não um erro de token.
3. O cookie `apiCredentials` expira em tempo não documentado; trate **HTTP 401** com `{"Message":"Authorization has been denied for this request."}` como gatilho de reautenticação e retry único. Sem isso a aplicação quebra sozinha depois de horas no ar.
4. O campo `a` é **polissêmico**: bool (acessibilidade) em `/Posicao`, int (área de operação) em `/Empresa`.
5. Cada linha tem **dois** códigos `cl`, um por sentido; e `ta` é UTC enquanto `hr`/`t` são hora local — misturar dá 3 h de erro.

**GTFS estático:** download **anônimo**, 10 tabelas, 22.262 paradas. **Não contém** `wheelchair_boarding` (stops), `wheelchair_accessible` (trips), `pathways.txt`, `levels.txt` nem `calendar_dates.txt` (**feriados não são modelados**). Serve como *seed* de paradas e itinerários, não como fonte de acessibilidade. `route_id` é idêntico a `route_short_name`.

**Conclusão de escopo:** o único dado estruturado de acessibilidade de ônibus em São Paulo é o booleano `a`, e ele é do **veículo**. A proposta escrita precisa ser corrigida: a SPTrans é enriquecimento, não núcleo.

---

## 9. Trilhos: Metrô, CPTM e a lacuna dos elevadores

A **API Trilhos da ARTESP** exige chave desde 25/06/2026, limita a **12 requisições/hora**, pode bloquear por IP não-allowlisted (incompatível com hospedagem gratuita) e, desde **03/09/2026**, **não cobre mais Metrô nem CPTM**.

Restou o **Direto dos Trens**, cuja API oficial confirmei hoje no [Swagger](https://static.diretodostrens.com.br/swagger/api.json): base `https://www.diretodostrens.com.br/api`, autenticação por `token` em query string obtido por e-mail, endpoints `GET /status`, `/status/codigo/{linha}`, `/status/id/{id}`; a documentação **encoraja explicitamente projetos pessoais e acadêmicos** e proíbe uso comercial sem autorização. É hoje a melhor fonte autorizada de status de Metrô/CPTM.

**Não existe nenhuma fonte — API, feed ou CSV — de status de elevador ou escada rolante.** O Metrô publica apenas um PDF estático. Essa lacuna vira funcionalidade: o próprio usuário reporta "elevador da estação X quebrado" pelo mesmo fluxo colaborativo. É o argumento mais forte do trabalho: **o sistema existe porque o dado oficial não existe.**

---

## 10. Fontes avaliadas e descartadas (registrar no relatório)

| Fonte | Por que foi descartada |
|---|---|
| Wheelmap / accessibility.cloud | API clássica fora do ar; sucessora exige token **organizacional** via wheelmap.pro; e como sincroniza com o OSM, o ganho é marginal |
| API Trilhos (ARTESP) | Sem Metrô/CPTM desde 03/09/2026; 12 req/h; allowlist de IP incompatível com IP dinâmico gratuito |
| Portal de dados abertos **estadual** | Zero datasets para "acessibilidade" e "calçada" |
| `metro-sp-api` | Scraping não oficial, parado desde ~2023 |
| MDT LiDAR do GeoSampa | Excelente (10 pontos/m², precisão ~10 cm), mas processamento offline pesado — trabalho futuro, não MVP |

Mostrar que se avaliou e concluiu vale mais, metodologicamente, do que simplesmente ignorar.

---

## 11. APIs nativas do navegador e IA

`SpeechSynthesis` é **local e confiável**. Já o `SpeechRecognition`, segundo a [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), tem status **"Limited availability"** — *"This feature is not Baseline because it does not work in some of the most widely-used browsers"* — e, textualmente: *"On some browsers, like Chrome, using Speech Recognition on a web page involves a server-based recognition engine. Your audio is sent to a web service for recognition processing, so it won't work offline."*

Isso impõe **coerência de critério**: se o projeto levanta risco de LGPD ao enviar fotos para uma IA de terceiro, precisa aplicar o mesmo critério ao microfone. Consentimento explícito, detecção de recurso antes de renderizar o botão, e alternativa por teclado sempre.

**IA generativa** fica fora do caminho crítico: as cotas gratuitas são pequenas e voláteis (o Google deixou de publicar os limites do free tier na documentação, remetendo ao AI Studio), e no tier gratuito o conteúdo enviado é usado para desenvolver produtos do fornecedor. Se usada, apenas como enfeite opcional, atrás de proxy no backend, com rate limit por usuário e fallback determinístico.

---

## 12. Infraestrutura gratuita — limites verificados hoje

| Serviço | Limite confirmado | Consequência de projeto |
|---|---|---|
| **Render Free** | 750 instance-hours/mês; spin down após **15 min** sem tráfego, ~**1 min** para voltar | Cron de keep-alive + aquecer antes da banca |
| **Render Postgres Free** | 1 GB, **sem backups**, **expira 30 dias** após a criação | **Não usar.** Banco fica no Supabase |
| **Supabase Free** | 500 MB de banco, 1 GB de storage, 5 GB de egress, 50.000 MAU, **2 projetos**, pausa após **1 semana** de inatividade | Obriga o recorte por área piloto |
| **Cloudflare Pages Free** | 500 builds/mês, 1 build simultâneo, timeout 20 min, 20.000 arquivos, 25 MiB/arquivo, **sem limite de banda declarado** | Melhor opção para o frontend |
| **OpenFreeMap** | Sem chave, sem limite, **sem SLA** | Plano B dos tiles |

Custo total: **R$ 0,00**. Nenhum item exige cartão de crédito.

---

## 13. Licenças — a decisão que precisa ser tomada agora

**CC-BY-SA 4.0** (GeoSampa) e **ODbL** (OpenStreetMap) são dois copyleft **mutuamente incompatíveis** para gerar uma base derivada única. A solução não é jurídica, é de modelagem: **tabelas fisicamente separadas**, ligadas por uma tabela de junção que guarda **apenas chaves estrangeiras e distância** — nenhuma geometria fundida, nenhum atributo copiado. Assim o conjunto se caracteriza como *Collective Database* e o share-alike **não contamina** os dados próprios do grupo. Custa nada decidir certo no início e é caríssimo desfazer depois. E jamais fazer upload de dados do GeoSampa para dentro do OSM.

Atribuições obrigatórias, em texto legível por leitor de tela: `© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors · Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021 · Solicitações: SP156/SMIT (CC0) · Ônibus: SPTrans/Olho Vivo`.

---

## Fontes

- [openrouteservice — routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options) · [restrictions](https://openrouteservice.org/restrictions/) · [FAQ (rate limits)](https://giscience.github.io/openrouteservice/frequently-asked-questions)
- [Overpass API — commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) · medição própria em `https://overpass-api.de/api/interpreter` (08/09/2026)
- [Geofabrik — Brasil](https://download.geofabrik.de/south-america/brazil.html)
- [OSM wiki — Key:kerb](https://wiki.openstreetmap.org/wiki/Key:kerb)
- [GeoSampa WFS](https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs) (consulta própria, 08/09/2026) · [Licença GeoSampa](https://prefeitura.sp.gov.br/web/licenciamento/w/licen%C3%A7a-para-uso-de-dados-do-geosampa)
- [SP156 — dados abertos](https://dados.prefeitura.sp.gov.br/dataset/dados-do-sp156)
- [SPTrans — documentação da API Olho Vivo](https://www.sptrans.com.br/desenvolvedores/api-do-olho-vivo-guia-de-referencia/documentacao-api/)
- [Direto dos Trens — especificação OpenAPI](https://static.diretodostrens.com.br/swagger/api.json)
- [Política de tiles do OSM](https://operations.osmfoundation.org/policies/tiles/) · [Política do Nominatim](https://operations.osmfoundation.org/policies/nominatim/)
- [OpenFreeMap](https://openfreemap.org/) · [Photon](https://photon.komoot.io/) (teste próprio: `lang=pt` → HTTP 400; `lang=default` → OK)
- [MDN — SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [WCAG 2.2 — 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [eMAG 3.1](https://emag.governoeletronico.gov.br/) · [ABNT NBR 17225:2025 (CTA/IFRS)](https://cta.ifrs.edu.br/abnt-nbr-17225-2025-acessibilidade-em-conteudo-e-aplicacoes-web-requisitos/)
- [react-leaflet — CHANGELOG](https://github.com/PaulLeCam/react-leaflet/blob/master/CHANGELOG.md) · [pgRouting — depreciação de pgr_createTopology](https://github.com/pgRouting/pgrouting/issues/2750)
- [Render — Free tier](https://render.com/docs/free) · [Supabase — pricing](https://supabase.com/pricing) · [Cloudflare Pages — limits](https://developers.cloudflare.com/pages/platform/limits/)