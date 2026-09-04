# CLAUDE.md — Contexto do Projeto Gestão Financeira

Este arquivo dá contexto completo ao Claude Code sobre o projeto. Leia antes de fazer qualquer alteração.

## O que é este projeto

App web de controle financeiro doméstico para duas pessoas (Caulin e Luanna) que dividem despesas. Substituiu um fluxo anterior baseado em GPT + planilha Excel manual, que era inconsistente. O objetivo é: **a fatura do cartão entra sozinha pelo Open Finance** + contas do mês lançadas à mão → categorização automática pelo dicionário → checklist mensal mostrando quanto cada pessoa deve pagar.

**Não é** um produto SaaS multi-usuário. É uma ferramenta pessoal para essas duas pessoas específicas, com nomes e regras hardcoded.

## Stack técnica

- **React 18** + **Vite 5** (sem TypeScript)
- **Google Sheets API** como banco de dados (via OAuth2 implicit flow, `gsi/client`)
- **Google Apps Script** como backend do sincronizador Pluggy (vinculado à própria planilha)
- **GitHub Pages** para hospedagem (necessário para OAuth funcionar — não funciona dentro de iframe/artifact do Claude.ai)
- **Tailwind v4 + shadcn/ui** (componentes vendorizados em `src/components/ui/`, JSX puro)
- A UI está **em migração**: tela migrada usa Tailwind, tela não migrada usa inline style. Os dois convivem de propósito e leem a **mesma paleta** — ver "Estilo visual"
- Sem roteador — navegação por state (`tab`, `mesRef`)

## Estrutura de arquivos

```
gestao-financeira/
├── src/
│   ├── App.jsx           ← toda a lógica e UI do app (arquivo único, monolítico por design)
│   ├── index.css         ← tokens da paleta + reset + color-scheme: dark (crítico)
│   ├── lib/utils.js      ← cn(), exigido por todo componente do shadcn
│   ├── components/ui/    ← shadcn VENDORIZADO: não editar à mão, o CLI reescreve
│   └── main.jsx          ← entry point padrão do Vite
├── apps-script/          ← o sincronizador do Pluggy (colado no editor do Apps Script)
├── scripts/qa-*.cjs      ← testes; extraem as funções puras e rodam fora do React
├── docs/SETUP-PLUGGY.md  ← configuração externa passo a passo
├── index.html
├── vite.config.js        ← contém `base: '/gestao-financeira/'` (obrigatório pro GitHub Pages)
├── package.json          ← scripts: dev, build, lint, qa, deploy
└── CLAUDE.md             ← este arquivo
```

`App.jsx` é intencionalmente um arquivo único grande. Não foi dividido em componentes/arquivos separados ainda — se for refatorar, preservar toda a lógica de negócio abaixo.

## Credenciais e IDs (já configurados, não recriar)

- **Google OAuth Client ID**: `551652083809-p6o9ch2bvn8ipg508b7nu2afu5fn1ho1.apps.googleusercontent.com`
- **Google Sheet ID**: `19qO91TbQQJMLd_ONeP--Gdh7NwliuYuYQ-GuA-PNen8`
- Ambos estão hardcoded no topo do `App.jsx` como constantes `CLIENT_ID` e `SHEET_ID`
- O app está publicado em: `https://caulinalmeida.github.io/gestao-financeira`
- Origens JavaScript autorizadas no Google Cloud Console: `https://claude.ai`, `https://caulinalmeida.github.io` e `http://localhost:5173` (esta última para desenvolvimento)
- O projeto Google Cloud está em modo **de teste** (não verificado) — apenas o email `caulin.almeida08@gmail.com` está na lista de usuários de teste autorizados. Se quiser dar acesso à Luanna, adicionar o email dela em **APIs e serviços → Tela de consentimento OAuth → Usuários de teste**.
- **Credenciais do Pluggy (`clientId`/`clientSecret`) vivem SÓ nas Script Properties do Apps Script.** Nunca no repositório, nunca no bundle — o site é público. Foi essa restrição que ditou toda a arquitetura abaixo.

## Arquitetura do Open Finance (o núcleo do app hoje)

```
Pluggy (Open Finance)          Google Sheets              App (React)
        │                            │                         │
        │  Apps Script, 1×/dia   ┌───┴─────────┐               │
        └───────────────────────►│ OF_*        │◄──────────────┤ lê tudo
                                 │ (abas novas)│               │
                                 └───┬─────────┘               │
                                     │ OF_AJUSTES ◄────────────┘ escreve
                                     │ (decisões do usuário)      decisões
```

**O Pluggy é dono dos fatos** — data, descrição, valor, parcela, cartão, status.
**O usuário é dono das decisões** — dono, classificação, obs, ignorada.
O sincronizador **nunca** sobrescreve uma decisão. É isso que faz a categorização durar entre syncs, e é a garantia central que o `mergeFatura()` implementa.

### REGRA INVIOLÁVEL: cada aba tem UM único escritor

O app faz `clear + append` total do que é dele; o Apps Script faz o mesmo do que é dele. Se os dois escrevessem na mesma aba, haveria perda de dados silenciosa.

| Aba | Escritor |
|---|---|
| `RENDA_DESPESAS`, `CARTAO_CREDITO`, `INVESTIMENTOS`, `DICIONARIO`, `OF_AJUSTES`, `PESSOAS`, `CHECKLIST_PAGO` | **o app** |
| `OF_TRANSACOES`, `OF_CARTOES`, `OF_FATURAS`, `OF_STATUS`, `OF_SYNC_LOG` | **o Apps Script** |

Exceção controlada e única: a chave `pedido_sync` em `OF_STATUS` é escrita pelo app (botão "Atualizar agora") e lida/limpa pelo Apps Script.

`OF_AJUSTES`, `PESSOAS` e `CHECKLIST_PAGO` são escritas pelo app mas **criadas** pelo Apps Script (`garantirAbas()`), porque o app só sabe fazer clear/append — não sabe criar aba.

### Frescor: três saltos, não um

```
BANCO ──①──► PLUGGY ──②──► PLANILHA ──③──► APP
       (o Pluggy visita     (nosso sync)    (recarregar
        no ritmo dele)                       a página)
```

Só o salto ② é nosso. O ① é do Pluggy e no Meu Pluggy **nem dá para forçar**.
Se o ② rodar antes do ① no mesmo dia, o app fica um dia atrasado por
construção — era o caso com um único sync às 5h. Por isso o padrão passou a ser
**4 execuções/dia** (`HORAS_SYNC_PADRAO`, ajustável pela propriedade
`HORAS_SYNC`). `OF_SYNC_LOG` registra cada observação, e `historicoSync()`
mostra a que horas o Pluggy realmente visita — aí dá para alinhar o gatilho.

> A API **não expõe `nextAutoSyncAt`** para este item (verificado no dump cru), então
> não há como consultar o agendamento: só observando ao longo dos dias.

### Frescor: duas idades diferentes

`sincronizarAgora()` lê o que o **Pluggy já tem em cache**. Se o Pluggy não foi ao banco hoje, a compra de hoje não existe para nós por mais que se sincronize. `atualizarDoBancoESincronizar()` faz `PATCH /items/{id}`, que é o que manda o Pluggy ao banco — fica manual porque forçar todo dia gasta a conexão, e conector com MFA pode parar em `WAITING_USER_INPUT`. A faixa do app mostra as duas idades separadas.

> **Meu Pluggy recusa o PATCH** com `400 MeuPluggy item cant be updated`. O item vem com `clientUserId: my-pluggy:<email>` e `connector: Itaú #601` — o prefixo `my-pluggy:` é o que o marca como pertencente àquela aplicação. É restrição de **autorização**, não impedimento técnico: o item pertence à aplicação Meu Pluggy e nossa `clientId` é outra aplicação, com leitura mas sem escrita sobre ele. Verificado na prática — pelo site do Meu Pluggy a mesma atualização roda **sem pedir senha**, o widget abre com o CPF preenchido e coleta em ~1 min.
>
> **Caminho manual:** `https://meu.pluggy.ai/connections/<itemId>` → botão **Atualizar** → voltar ao app e clicar 🔄. O app monta esse link sozinho na faixa de aviso quando o dado passa de 24h.
>
> **Widget do Pluggy Connect embutido no app: descartado, medido.** A ideia era `POST /connect_tokens` + widget em modo update, para atualizar sem sair do app.
>
> `testarWidgetUpdate()` (em `Diagnostico.gs`) rodou em 16/08/2026 e devolveu **403 Forbidden nos dois modos — create inclusive**. Com a mesma credencial que sincroniza normalmente, então não é credencial errada: 403 é autenticado sem permissão para o endpoint. **A credencial do Meu Pluggy é somente leitura das suas próprias conexões.** Não emite `connect_token`, não faz PATCH.
>
> Isso encerra o assunto um nível acima da posse do item: a hipótese anterior era que o widget esbarraria no `itemId` do Meu Pluggy ([404 `ITEM_NOT_FOUND` pela doc](https://docs.pluggy.ai/reference/connect-token-create)), mas nem se chega lá. Também torna irrelevante a parte contornável — o Apps Script poderia guardar o segredo e emitir o token pela planilha, como o `pedido_sync` faz; só que não há token a emitir.
>
> **Reconectar o Itaú sob a nossa própria aplicação** é a única coisa que destravaria — aí o item seria nosso, o PATCH bastaria e o widget nem seria preciso. Mas sai do Meu Pluggy, que é o tier gratuito; o [plano pago](https://www.pluggy.ai/en/pricing) começa na casa dos milhares de reais/mês. Para um app doméstico, não fecha.
>
> Por isso o caminho manual (`meu.pluggy.ai` → Atualizar → 🔄 no app) **é o desenho certo**, não uma gambiarra à espera de solução. Só vale reabrir se o Pluggy mudar os termos do Meu Pluggy — rodar `testarWidgetUpdate()` de novo responde em 10 segundos.

### Como o Apps Script deriva o mês da transação

Precedência, verificada contra dados reais do Itaú (fecha dia 3, vence dia 10):

1. **BILL** — transação `POSTED` tem `billId`; o mês vem do `dueDate` da fatura. É a fonte mais confiável.
2. **AGENDADA** — parcela futura. O banco a entrega datada com o **vencimento da fatura** em que vai cair, não com a data da compra; então o mês é o da própria data, sem passar pelo ciclo. Exige as duas condições: ser parcela **e** ter data no futuro.
3. **CICLO** — compra normal, calculada pelo dia de fechamento. Compra **no** dia do fechamento já cai na fatura seguinte (`>=`, não `>`).
4. **FORECAST/ESTIMADO** — último recurso.

`billForecastDate` do Pluggy usa uma convenção de mês **diferente** do `dueDate` — misturar os dois empurra as compras da fatura aberta um mês para trás. Não usar.

### Conciliação contra o banco

`OF_FATURAS` guarda o total oficial da fatura segundo o banco. O app compara com o nosso total e mostra ✅ ou ⚠️ por cartão/mês. Sem isso, uma lacuna de dados do Pluggy viraria total errado em silêncio — e isso já aconteceu: em meses antigos o backfill do Pluggy entrega menos transações do que o total da própria fatura que ele reporta.

> **A conciliação tinha um ponto cego, e ele era o pior possível.** Ela descarta o cartão quando não existe fatura do banco para aquele mês (`.filter(c => c.banco !== null)`) — ou seja, no exato momento em que o dado do banco falta, o aviso some da tela. Em setembro/2026 a fatura fechou dia 03, o Pluggy não a materializou, e o app exibiu um total parcial **sem nenhum sinal**. `faturasPendentesDoBanco()` fecha isso: se o dia de fechamento daquele mês já passou e a fatura não chegou, a barra do Open Finance avisa que o total está incompleto. Antes do fechamento não avisa — faltar fatura ali é normal, e ruído mensal vira aviso que ninguém lê.

### "Atualizar agora" sem endpoint público

O app grava `pedido_sync = <timestamp>` em `OF_STATUS`; um gatilho de 5 min do Apps Script vê e dispara o sync. Evita Web App exposto, CORS e shared secret vazando no bundle público. Latência de até 5 minutos, sinalizada na UI.

## Regras de negócio (IMPORTANTE — não alterar sem confirmar com o usuário)

### Pessoas e divisão de despesas
- O casal é fixo: **Caulin** e **Luanna** (constante `CASAL`)
- O campo "Dono" guarda os **participantes separados por `+`**, então terceiros cabem sem mudar coluna nenhuma:
  - `Caulin` → 100% dele
  - `Dividido` → apelido histórico de `Caulin+Luanna`, ÷2. **Continua sendo gravado assim**, para o histórico ler igual
  - `Rafael` → 100% do terceiro, vira "a receber"
  - `Caulin+Rafael` → ÷2 · `Caulin+Luanna+Rafael` → ÷3
- `participantes()` e `valorDe()` são o único ponto onde o rateio acontece — a soma das partes sempre fecha o total
- Terceiros vêm da aba `PESSOAS` (cadastro), para o mesmo nome escrito de duas formas não virar duas pessoas nos totais
- No checklist, terceiro **não** vira coluna: sai das despesas do casal e aparece no card "A receber"

### Categorias de lançamento
- **RENDA** — só aparece no cálculo de renda, nunca em despesas
- **DESPESA FIXA** / **DESPESA** — contas do dia a dia, lançadas manualmente na aba "Contas"
- **INVESTIMENTO** — aportes mensais, aba separada

### Cartão de crédito
- Campo "Parcelas/Fixo" pode ser: `RECORRENTE` (assinaturas fixas tipo streaming), `PARCELADO` (compras parceladas, mostrar sufixo tipo `05/12`), `VARIÁVEL` (compras avulsas)
- `PARCELADO` vem estruturado do Pluggy (`creditCardMetadata`), não mais de regex na descrição
- No checklist, o cartão é agrupado por: **Fixos → Parcelados → Variáveis**, mostrando só o TOTAL de cada categoria (não item por item). Clicar no total abre um modal com o detalhamento item a item.
- Os cartões vêm do Open Finance (`OF_CARTOES`). O usuário pode dar um **apelido** a cada um, que vence o nome do banco na exibição. Cartões sem conector continuam sendo lançados na aba "Manual".
- O checklist mostra um card de "Total Fatura" por cada nome de cartão distinto que existir no mês.

### Natureza da transação (COMPRA / PAGAMENTO / ESTORNO)
- **PAGAMENTO** (da fatura anterior) **fica FORA do total** — é assim que o banco calcula. Ignorar isso já causou uma divergência de R$ 5.645,77 num mês.
- **ESTORNO** entra com valor negativo e abate do total.
- Pagamentos ficam escondidos na tabela por padrão, com toggle para exibir.

### Remover transação da fatura
Marcar como **`ignorada`**, nunca deletar — o próximo sync a traria de volta. Some da lista e do total, e é reversível pelo toggle "mostrar ignoradas".

### Checklist (a tela mais importante do app)
Estrutura obrigatória, não simplificar:
- Cards de resumo no topo: Renda total, Despesas Caulin, Despesas Luanna, Saldo Caulin, e um card de Total Fatura por cartão
- Duas colunas lado a lado: Caulin | Luanna — cada uma mostrando SÓ os itens que dizem respeito àquela pessoa (valor já calculado, ÷2 se dividido)
- Dentro de cada coluna: Investimentos → Contas → Cartão (com fixos/parcelados/variáveis agrupados por total, clicável)
- Todo item tem checkbox de "pago". Marcar/desmarcar atualiza o "Saldo Caulin" em tempo real (Saldo = Renda Caulin − tudo que Caulin marcou como pago)
- Checkboxes de pagamento existem **somente no Checklist**, nunca nas abas de Fatura/Parcelas/Contas/Investimentos (isso já foi pedido explicitamente para ser removido de lá)
- Usa a fatura **FECHADA** — é o que efetivamente se vai pagar. **Exceção:** se o mês ainda não tem nenhuma transação `POSTED`, usa a **aberta**, com aviso na tela. Sem isso a seção Cartão do mês corrente ficava vazia, inútil justamente no mês que se está planejando. Mês já fechado continua idêntico.
- Botão final "Copiar resumo para WhatsApp" — gera um texto formatado e copia pro clipboard

> **"Sobra prevista" e "Na mão" são perguntas diferentes.** O cartão do topo
> mostra `renda − (contas + cartão + investimento)`: quanto vai sobrar no fim do
> mês, independente do que já foi pago. O rodapé do cartão de cada pessoa mostra
> `renda − o que ela já marcou como pago`: quanto ainda está na mão hoje. O
> segundo começa o mês valendo a renda inteira e cai a cada item marcado — por
> isso não se chama mais "Saldo", que dava a entender a primeira coisa. Nenhum
> dos dois é armazenado; são leituras dos baldes que `calcChecklist()` devolve.

> **`secoesDaPessoa()` é a fonte única das linhas E do progresso** ("8 de 12
> pagos · falta R$ 1.240"). Se saíssem de lugares diferentes, o contador poderia
> discordar do que está na tela. Marcar um grupo do cartão (Fixos/Parcelados/
> Variáveis) continua marcando cada linha por trás — é o que alimenta
> `estaPago` e, por ele, o "Na mão".

### Aba Parcelas
Projeta as parcelas futuras a partir de `OF_TRANSACOES`, **sem armazenar nada novo**.
- **O Itaú carimba o número da parcela na descrição** (`SAMSUNG NO ITAU 06/21`). `semSufixoParcela()` remove antes de qualquer agrupamento — sem isso cada parcela vira uma compra distinta e a projeção multiplica em cascata. Também impedia o dicionário de aprender parcelada, porque a chave mudava todo mês.
- A projeção ancora na parcela conhecida de **maior número** e projeta uma por mês a partir dela
- **Dedup obrigatório:** alguns bancos lançam todas as parcelas de uma vez. Como as reais já estão na lista, a âncora é a última e nada é projetado por cima — senão contaria dobrado.
- **Compra quitada/antecipada não é projetada.** O banco agenda as parcelas futuras com antecedência; se ele está agendando (existe alguma parcela de `mesBase` em diante) e uma compra não tem nenhuma daqui para a frente, ela foi liquidada. Caso real: `SAMSUNG NO ITAU` 21x teve as parcelas 09 a 16 lançadas juntas em agosto, com três estornos `DESC ANTECIPA PARCELAS`, e sumiu da fatura. A condição "o banco está agendando" é a trava: num conjunto de dados sem nada futuro, ninguém é dado como quitado por engano.
- A chave da compra arredonda o valor total para reais inteiros de propósito: R$ 100 em 3x vira 33,34 + 33,33 + 33,33, e o centavo não pode quebrar o agrupamento
- Transação `ignorada` não compromete nada

### Dicionário de categorização automática
- Cada transação é comparada (case-insensitive, sem acento, normalizada) contra um dicionário de padrões conhecidos (`dict` state)
- Se encontrar match, preenche Dono/Parcelas/Obs automaticamente
- Se não encontrar, marca como `isNew: true` e a linha aparece destacada em âmbar
- Usuário revisa e clica em "Aprender" — salva o padrão no dicionário **e** grava o ajuste daquela transação, para a decisão não depender do dicionário continuar existindo
- O dicionário é compartilhado entre todos os meses (não é por mês)
- `category`/`merchant` do Pluggy são enriquecimento de plano pago e vêm nulos — por isso o dicionário continua sendo o cérebro da categorização

### Meses
- **O mês que o app abre é o da fatura QUE AINDA SE VAI PAGAR** — âncora no **vencimento**, não no fechamento. Com o Itaú (fecha 3, vence 10): dia 16/08 já passou do vencimento de agosto, então setembro; dia 04/09 ainda não venceu setembro, então setembro; dia 11/09 já foi pago, então outubro. `mesAtualKey(ofCartoes)` usa `diaDoCartao(cartoes,"vencimento")`. Ancorar no fechamento responde outra pergunta ("onde cai uma compra feita hoje") e jogava o app em outubro no dia 4 de setembro, bem na semana entre fechar e pagar — que é quando se fecha as contas.
- **Piso de histórico**: `MES_MINIMO` em `Config.gs` (hoje `2026-08`). Nada anterior é gravado ou preservado nas abas `OF_*`. Existe porque a janela de sync alcança 210 dias para trás — sem o piso, todo sync ressuscitaria o que `limparHistorico()` acabou de apagar. O piso **não corta o futuro**: parcelas de 2027 continuam entrando, e são elas que fazem a aba Parcelas projetar.
- A chave é **`ANO-MÊS`** (`"2026-08"`), não mais o nome do mês. O modelo antigo tinha 12 baldes fixos e JANEIRO/2027 sobrescreveria JANEIRO/2026.
- `parseMesRef()` aceita os dois formatos, então dados legados continuam legíveis
- Cada mês tem seu próprio conjunto isolado de: fatura, lançamentos manuais, contas, investimentos
- Trocar de mês no seletor do topo NÃO deve misturar dados entre meses (bug já corrigido antes, cuidado ao mexer no state)
- Existe botão "Copiar do mês anterior" em Contas, Investimentos e Lançamentos manuais — abre modal com checkboxes para selecionar item por item o que replicar pro mês atual

## Integração com Google Sheets — estrutura das abas

Cada aba tem cabeçalho fixo na linha 1. **A ordem das colunas é contrato** — o app lê por posição.

### Abas do app

**RENDA_DESPESAS** (contas, incluindo renda; NÃO investimentos)
```
Mes Ref | Data | Transação | Valor | Dono | Tipo | Parcelas/Fixo | Observações
```

**CARTAO_CREDITO** (hoje só lançamentos manuais + histórico legado do CSV)
```
Mes Ref | Data | Transação | Parcela | Valor | Dono | Tipo | Parcelas/Fixo | Observações | Cartão | Origem
```
A coluna K `Origem` (`MANUAL` | `LEGADO`) separa lançamento manual de fatura importada. Sem ela, lançamentos manuais viravam linhas de fatura semi-ineditáveis a cada reload.

**INVESTIMENTOS**
```
Mes Ref | Descrição | Valor | Dono | Observações
```

**DICIONARIO**
```
Key | Dono | Parcelas | Obs
```

**OF_AJUSTES** (as decisões do usuário; só linha que ele efetivamente tocou)
```
tipo | ref_id | dono | classificacao | obs | ignorada | mes_ref_override | apelido | fingerprint
```
`tipo` é `TX` (ref_id = id da transação) ou `CARTAO` (ref_id = account_id, usa `apelido`).
O `fingerprint` religa o ajuste quando o Pluggy troca o id da transação — ele deleta e recria quando data, descrição ou valor mudam.

### Abas do Apps Script

**OF_TRANSACOES**
```
pluggy_tx_id | account_id | mes_ref | origem_mes | tipo | data | descricao | valor |
status | bill_id | parcela_num | parcela_total | valor_total | data_compra |
fingerprint | atualizado_em
```

**OF_CARTOES**
```
account_id | item_id | nome | ultimos_digitos | limite | fechamento | vencimento | atualizado_em
```

**OF_FATURAS**
```
account_id | mes_ref | vencimento | fechamento | total_banco | atualizado_em
```

**OF_STATUS** — chave/valor: `ultimo_sync`, `ultimo_erro`, `item_<id>_status`, `pedido_sync`, `pluggy_atualizado_em`, `item_<id>_pluggy_em`

**PESSOAS** (terceiros que usam o cartão) — uma coluna: `nome`

**CHECKLIST_PAGO** (o que já foi marcado como pago)
```
mes_ref | chave
```
A `chave` vem do **conteúdo** da linha, não do id — contas e investimentos recebem `uid()` novo a cada carregamento, então persistir por id não sobreviveria ao F5. Editar valor ou descrição desmarca o pago, o que é o comportamento certo: virou outro lançamento.

### Como o sync funciona
- Toda alteração no app dispara `syncAll()` (ou `syncAjustes()`) com debounce de 1200ms
- Ambos fazem **clear + append completo** das abas relevantes — apagam tudo e reescrevem do zero, iterando por todos os meses em memória. Intencional pela simplicidade; pode ficar lento com muito histórico (ok até uns 2-3 anos, considerar otimizar depois)
- O Apps Script reescreve **só a janela sincronizada** (−120/+90 dias) de `OF_TRANSACOES`; histórico fora da janela fica intocado
- O token OAuth fica em `sessionStorage` (~58 minutos) — ao reabrir o navegador depois de muito tempo, pede login de novo. Isso é esperado.

## Funções do Apps Script (rodar pelo seletor no topo do editor)

| Função | O que faz |
|---|---|
| `garantirAbas()` | Cria as abas que faltarem, com cabeçalho |
| `atualizarDoBancoESincronizar()` | Força o Pluggy a ir ao banco e depois sincroniza |
| `investigarParcelas()` | Agrupa as compras parceladas e diagnostica projeção errada |
| `diagnosticoOpenFinance()` | Fotografia dos três saltos + campos crus do item |
| `historicoSync()` | A que horas o Pluggy visita o banco, pelos dados de `OF_SYNC_LOG` |
| `investigarFaturaSumida()` | Separa lacuna do Pluggy × mês errado × perda na escrita, transação a transação |
| `conferirPaginacao()` | Página a página do `/v2/transactions`, contra o total declarado pela API |
| `sondarLacuna()` | Mesma pergunta em três formas, para saber se o buraco é da API ou da nossa chamada |
| `testarWidgetUpdate()` | Se o widget do Pluggy Connect cabe no app (hoje: não, 403) |
| `testarConexao()` | Valida credenciais e lista os cartões conectados |
| `sincronizarAgora()` | Sync completo, na hora |
| `conferirFatura()` | Compara nosso total com o do banco, mês a mês |
| `criarGatilhos()` | Liga o sync diário (5h) e o poller de 5 min |
| `simularLimpezaHistorico()` / `limparHistorico()` | Apaga tudo anterior a `MES_MINIMO` (**app fechado**, ver `Limpeza.gs`) |
| `limparSyncLog(n)` | Poda `OF_SYNC_LOG` para as últimas N linhas (padrão 200) |
| `simularMigracaoMeses()` / `migrarMeses()` | Migração `MAIO` → `2026-05` (já rodada) |
| `popularDadosExemplo()` / `limparDadosExemplo()` | Fixtures para desenvolver sem o Pluggy |

O botão Run do Apps Script **não passa parâmetros** — por isso existe `Atalhos.gs` com wrappers sem argumento (`investigarUltimaFatura()`, `detalharMesAlvo()` etc.).

## Problemas já resolvidos (não reintroduzir)

1. **Bug de parse de valor BR/EN**: `parseBRL()` precisa detectar se a string tem vírgula (formato BR "1.234,56") ou não (já é float tipo "1920.72"). Um bug anterior tratava tudo como BR e multiplicava valores por 100.
2. **Erro React #310**: aconteceu porque um `useState` estava sendo chamado dentro de uma IIFE dentro do JSX, e não no nível do componente. Todo hook precisa estar no topo da função `App()`.
3. **OAuth não funciona dentro do Claude.ai artifact/iframe** — por isso o projeto foi movido para GitHub Pages.
4. **Login perdido a cada F5** — resolvido guardando token em `sessionStorage` com expiração de ~58min, e auto-carregando dados no `useEffect` de montagem.
5. **"Copiar do mês anterior" não atualizava a tela** — estado desatualizado por closure; a correção usa a forma funcional do `setDadosMes(prev => ...)`.
6. **Investimentos não sincronizavam** — estavam sendo gravados junto com RENDA_DESPESAS. Corrigido com leitura/escrita dedicada na aba INVESTIMENTOS.
7. **Pagamento da fatura entrava no total** — divergência de R$ 5.645,77 contra o banco. Resolvido com a coluna `tipo` distinguindo COMPRA/PAGAMENTO/ESTORNO.
8. **Regra do dia de fechamento usava `>` em vez de `>=`** — a compra feita NO dia do fechamento vai para a fatura seguinte. Verificado contra dados reais.
9. **`billForecastDate` tem convenção de mês diferente de `dueDate`** — misturar empurrava a fatura aberta um mês para trás. Substituído pela regra CICLO.
10. **`OF_AJUSTES` não era criada por ninguém** — o app não sabe criar aba, e o Apps Script não conhecia o nome dela. Toda decisão do usuário falhava ao gravar. Resolvido com `garantirAbas()`.
11. **Leitura das abas OF_* em `Promise.all`** — uma aba faltando derrubava o lote inteiro e o Open Finance sumia da tela sem erro visível. Agora cada aba é lida isoladamente.
12. **`sessionStorage` bloqueado / falha de gravação eram silenciosas** — hoje aparecem como "⚠️ NÃO salvo" e vão para o console.
13. **Número da parcela dentro da descrição** — quebrava o agrupamento por descrição e o dicionário. Resolvido com `semSufixoParcela()`.
14. **Parcela futura empurrada um mês** — vem datada com o vencimento da fatura, e o CICLO tratava como data de compra. Resolvido com a regra AGENDADA.
15. **"Pago" sumia no F5 e vazava entre meses** — era `useState` puro com chave sem mês. Resolvido com `CHECKLIST_PAGO` e chave derivada do conteúdo.
16. **App abria no mês do calendário** — em 16/08 caía em agosto, uma fatura já fechada, justamente no mês em que se está gastando. O mês certo é o da fatura aberta, derivado do dia de fechamento do cartão.
17. **Limpeza de histórico desfeita pela edição seguinte** — o app guarda todos os meses em memória e reescreve as abas dele por inteiro a cada edição. Limpar a planilha com o app aberto traz tudo de volta no primeiro clique. Por isso `Limpeza.gs` exige o app fechado e um F5 depois.
18. **Dia de fechamento/vencimento voltando como `1900-01-02`** — são números (3, 10) gravados em célula que herdou formato de data; a API do Sheets devolve o serial lido como data. `parseInt` disso dá 1900, falha no teste `1..31`, e o app caía no mês do calendário **em silêncio**. `gravarCartoes()` força formato numérico nas duas colunas. Mesma família do `mes_ref` virando `Date`.
19. **Buraco entre o fechamento e o pagamento da fatura** — a fatura aberta chega ao Pluggy sem as compras feitas entre o dia do fechamento e o dia do pagamento (03 a 09/08, no caso real). Confirmado com três formas de consulta — janela do sync, sem filtro de data e estreita sobre o buraco — e todas concordaram: o dado não existe no Pluggy. Não é paginação (1 página, 117 itens, sem `next`) nem perda na gravação. A hipótese é que o pagamento reinicia a visão de "fatura atual" do banco, e essas compras só aparecem quando a fatura fecha e o Pluggy a materializa como fatura fechada. **Enquanto isso, o total do mês corrente fica subestimado** — usar lançamento manual para fechar o mês. `sondarLacuna()` e `investigarFaturaSumida()` refazem a verificação.

20. **"Sincronizado há 149d" com um sync de minutos atrás** — `ultimo_sync` era gravado como objeto `Date`; o Sheets formatava a célula como data e a API devolvia `"04/09/2026 16:37:58"`, que o `new Date()` do browser lê como **9 de abril** (assume MM/DD). Na mesma barra, `pluggy_atualizado_em` acertava porque já chega em ISO do Pluggy — dois valores lado a lado, só um errado, e a diferença era o tipo gravado. Corrigido nos dois lados: `statusGravar()` converte `Date` para ISO e força a coluna de valor como texto **antes** de escrever (senão o Sheets reinterpreta a própria string ISO); e `parseDataHora()` no app entende `dd/mm/aaaa hh:mm:ss` além de ISO.

21. **Uma descrição longa arrastava a página inteira para o lado no celular.** "IOF INTERNACIONAL - ANTHROPIC* CLAUDE SUBSAN FRANCISCOUSA" esticava o cartão para além da tela; como a barra de navegação é `fixed`, ela saltava junto e o sintoma parecia zoom do navegador. A lista era `<div className="grid gap-2">` — **sem coluna declarada, o track é `auto`, cujo MÍNIMO é o min-content do item**. Não cabendo, o track cresce em vez de o texto encolher, e `truncate`/`overflow:hidden` não salvam: o piso é calculado antes. Vale igual para `1fr` solto, que é `minmax(auto,1fr)`.

    **Regra:** todo grid que empilha conteúdo de largura imprevisível usa `grid-cols-N` (que o Tailwind gera como `repeat(N,minmax(0,1fr))`) ou `minmax(0,1fr)` escrito à mão. A seção 18 do `qa-app.cjs` é uma análise estática do fonte que cobre os dois casos — layout não dá para executar no QA, mas a causa dá para ler. Ela achou uma ocorrência que eu tinha deixado passar no mesmo commit em que nasceu.

> **Padrão recorrente, não coincidência.** Esta é a terceira aparição da mesma família — `mes_ref` virando `Date`, dia de fechamento virando `1900-01-02`, agora a data do sync. A causa é sempre a mesma: **valor gravado com tipo, lido de volta como texto localizado**. A API do Sheets devolve VALOR FORMATADO, então tudo que o Apps Script grava tipado volta ao app na localização da planilha. Regra prática: **o que o app vai ler, o Apps Script grava como texto** (ISO para data/hora, número puro com `setNumberFormat('0')` para dia do mês) — e nunca confiar em `new Date(string)` para valor vindo da planilha.

## Estilo visual (design system informal)

Tema **dark**. Paleta no objeto `C` no topo do `App.jsx`:

| Cor | Token 600 | Uso |
|---|---|---|
| Teal | `#2DD4A7` | Cor primária, Caulin, renda, ações principais |
| Purple | `#A78BFA` | Luanna |
| Red | `#F87171` | Despesas, ações destrutivas |
| Green | `#4ADE80` | Saldo positivo, sucesso, quitação |
| Blue | `#60A5FA` | Cards de fatura/cartão, parcelas |
| Amber | `#FBBF24` | Itens novos/pendentes de revisão, avisos |

Superfícies: `bg #0F1115`, `surface #171A20`, `surfaceAlt #1E222A`, bordas `#2A2F3A`.

**`color-scheme: dark` no `index.css` é crítico** — sem essa linha, `<select>`, checkboxes e scrollbars nativos renderizam brancos sobre o tema escuro.

Estilo geral: cards com sombra sutil, bordas arredondadas (8-14px), tipografia do sistema (`system-ui`), `font-variant-numeric: tabular-nums` em valores monetários.

**Ícones:** emoji continua valendo como **conteúdo** (rótulo de botão, empty state, resumo do WhatsApp), mas a **navegação e o chrome usam `lucide-react`**. Emoji em nav renderiza diferente em cada sistema operacional e é colorido demais para um item inativo — era o que mais deixava o app com cara amadora no celular.

### A paleta vive em dois lugares e precisa concordar

O objeto `C` no topo do `App.jsx` (inline styles) e as variáveis `--gf-*` em `index.css` (Tailwind) são **o mesmo valor escrito duas vezes**. Mudou um, muda o outro — senão tela migrada e tela não migrada divergem no meio do app.

Os tokens semânticos do shadcn (`--primary`, `--card`, `--border`…) apontam para os `--gf-*`, então os componentes vendorizados já nascem na paleta certa. Dois detalhes não óbvios:

- **`--primary-foreground` é escuro**, não claro: aqui o primary é o teal vivo.
- **Os utilitários da paleta levam prefixo `gf-`** (`bg-gf-teal-50`, `text-gf-text-dim`). Não é enfeite: nesta paleta o sufixo `*50` é um fundo **escuro** e o `*600` é a cor viva, o inverso da escala do Tailwind. Sem o prefixo, `bg-amber-50` pareceria creme e pintaria marrom.

### A escala tipográfica é a única fonte de tamanho

Oito degraus em `src/index.css`, e **nada de px cravado no `App.jsx`**:

| token | celular | desktop | para quê |
|---|---|---|---|
| `micro` | 11 | 10 | rótulo caixa-alta, legenda, contador |
| `meta` | 12 | 11 | metadado: `data · cartão · parcela` |
| `small` | 13 | 12 | texto secundário, aviso, chip |
| `body` | 14 | 13 | corpo: linha de lista, campo, célula |
| `strong` | 15 | 14 | nome, título de card |
| `lead` | 16 | 15 | título de modal/seção |
| `title` | 22 | 24 | valor de MetricCard |
| `hero` | 30 | 38 | o número que a tela existe para dizer |

Use `text-body` (Tailwind) ou `fontSize:"var(--fs-body)"` (inline) — os dois
leem a **mesma variável**, e é ela que muda no `@media`. É o que faz o mesmo
componente encolher no desktop e crescer no celular **sem nenhum `isMobile`**.

Dois detalhes que parecem erro e não são:

- **A parte de baixo é uma rampa de 1px, não uma escala modular.** Numa tela
  densa de dados é preciso separar rótulo de metadado de corpo em degraus finos;
  uma razão de 1,25 daria 10 → 12,5 → 15,6, saltos grandes demais para caber
  numa linha de tabela. O salto grande fica só no topo, onde significa "isto é
  um título".
- **No celular os degraus de baixo são MAIORES que no desktop.** A tela é lida a
  30cm, em movimento e com reflexo. Nos degraus de cima é o contrário: no
  desktop sobra largura para um número grande respirar.

Ficam fora da escala os tamanhos de **glifo** — o ✕ de fechar (20), o ícone do
login (26) e o emoji do empty state (34). São desenho, não tipografia.

A seção 19 do `qa-app.cjs` recusa `text-[Npx]`, `fontSize:` numérico fora dos
glifos, e os nomes padrão do Tailwind (`text-sm`, `text-lg`…) dentro do
`App.jsx` — eles conviveriam com a escala e ninguém saberia qual venceu ao bater
o olho. Dentro de `src/components/ui` valem, que é código vendorizado.

### Abaixo de 768px, tabela não existe

As sete tabelas do app têm de 420 a 680px de largura mínima — num aparelho de 390px todas rolavam na horizontal, com os controles de edição nascendo fora da tela. Cada uma tem agora duas formas: `isMobile ? cartões : <table>`. São dois tipos de cartão, e a escolha entre eles é sobre o que a tela faz:

- **`CardFatura`** — compacto, expande ao toque. A fatura é tela de **leitura** (o que é, quanto, de quem); editar é o caso raro. Expande no lugar em vez de abrir gaveta porque `DonoSelect` já abre o próprio modal, e overlay dentro de overlay briga por foco.
- **`CardForm`** + `CampoCard` — tudo à vista (contas, investimentos, manuais, dicionário). São telas de **digitação**: quem abre já vem para editar, e esconder campo custaria um toque por lançamento.
- `CardCompra` e as parcelas do mês são só leitura, então mostram tudo aberto.

Use `inpM`/`selM` dentro dos cartões: nas tabelas os campos têm largura fixa em px porque disputam a coluna; no cartão cada um tem a linha inteira, e o padding de 6px vira alvo pequeno demais.

> **Sumiu a tabela, sumiria a ordenação.** Sem cabeçalho não há o que clicar, e ordenar foi pedido explicitamente. `BarraOrdenacao` cobre isso no mobile: fala o mesmo `sort` = `{col,dir}` do `Thead`, mas usa o `definir` do `useSort` — lá coluna e direção são dois controles, e ciclar asc→desc→nenhum num `<select>` confundiria. **Toda tabela nova precisa das duas coisas**, senão a ordenação só existe no desktop.

**O breakpoint mobile é 768px em três lugares e os três têm que concordar:** `md:` do Tailwind (`min-width:768px`), `isMobile` no `App.jsx` (`max-width:767.98px`) e o `@media` do `index.css`. Se divergirem, abre uma faixa de largura em que o CSS já está em modo mobile e o JS ainda acha que é desktop.

## O que NÃO fazer sem perguntar antes

- Não trocar Google Sheets por outro backend sem discutir — escolha deliberada após avaliar alternativas (Supabase, Notion, storage local)
- **Não quebrar a regra de um-escritor-por-aba** — é a única coisa que impede perda de dados entre o app e o sincronizador
- Não adicionar autenticação multi-usuário genérica — o app é hardcoded para duas pessoas específicas por design
- Não reintroduzir checkboxes de pagamento fora da aba Checklist
- Não mudar a estrutura de colunas das abas do Sheets sem migrar os dados existentes
- Não remover o dicionário de aprendizado automático — é o motivo do app funcionar melhor que a versão anterior em GPT
- Não colocar `clientId`/`clientSecret` do Pluggy no repositório ou no bundle
- Não reintroduzir o import de CSV — foi removido de propósito quando o Open Finance passou a funcionar

## Ideias para evoluir (backlog)

- Otimizar sync para update incremental em vez de clear+append total (importante se o histórico crescer muito)
- Gráfico de comparativo mês a mês
- Ambiente de staging — hoje se edita a planilha de produção direto
- Total de gastos com tag "Férias/" separado
- Adicionar a Luanna como segunda usuária de teste no Google Cloud
- Conectar cartões de outros bancos no Meu Pluggy (hoje só Itaú)

## Como rodar localmente

```bash
npm install
npm run dev          # http://localhost:5173/gestao-financeira/
npm run qa           # testes do sincronizador + das funções puras do app
npm run lint
npm run build
```

Depois de qualquer alteração, o fluxo de publicação é sempre:
```bash
git add .
git commit -m "mensagem"
npm run deploy
git push
```
(o `deploy` publica no GitHub Pages via branch `gh-pages`; o `push` mantém o código-fonte sincronizado na branch `main`)

**Alterou o `apps-script/`?** O `deploy` não publica isso. É preciso colar os arquivos alterados no editor do Apps Script da planilha (Extensões → Apps Script) e salvar.
