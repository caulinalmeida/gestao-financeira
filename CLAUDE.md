# CLAUDE.md — Contexto do Projeto Gestão Financeira

Este arquivo dá contexto completo ao Claude Code sobre o projeto. Leia antes de fazer qualquer alteração.

## O que é este projeto

App web de controle financeiro doméstico para duas pessoas (Caulin e Luanna) que dividem despesas. Substituiu um fluxo anterior baseado em GPT + planilha Excel manual, que era inconsistente. O objetivo é: importar fatura de cartão + lançar contas do mês → categorizar automaticamente → gerar um checklist mensal simples mostrando quanto cada pessoa deve pagar.

**Não é** um produto SaaS multi-usuário. É uma ferramenta pessoal para essas duas pessoas específicas, com nomes e regras hardcoded.

## Stack técnica

- **React 18** + **Vite** (sem TypeScript)
- **Google Sheets API** como banco de dados (via OAuth2 implicit flow, `gsi/client`)
- **GitHub Pages** para hospedagem (necessário para OAuth funcionar — não funciona rodando dentro de iframe/artifact do Claude.ai)
- Sem bibliotecas de UI externas — tudo em inline styles puro
- Sem roteador — navegação por state (`tab`, `mesRef`)

## Estrutura de arquivos

```
gestao-financeira/
├── src/
│   ├── App.jsx          ← toda a lógica e UI do app (arquivo único, monolítico por design)
│   └── main.jsx          ← entry point padrão do Vite
├── index.html
├── vite.config.js        ← contém `base: '/gestao-financeira/'` (obrigatório pro GitHub Pages)
├── package.json          ← contém script `deploy` usando gh-pages
└── CLAUDE.md              ← este arquivo
```

`App.jsx` é intencionalmente um arquivo único grande. Não foi dividido em componentes/arquivos separados ainda — se for refatorar, preservar toda a lógica de negócio abaixo.

## Credenciais e IDs (já configurados, não recriar)

- **Google OAuth Client ID**: `551652083809-p6o9ch2bvn8ipg508b7nu2afu5fn1ho1.apps.googleusercontent.com`
- **Google Sheet ID**: `19qO91TbQQJMLd_ONeP--Gdh7NwliuYuYQ-GuA-PNen8`
- Ambos estão hardcoded no topo do `App.jsx` como constantes `CLIENT_ID` e `SHEET_ID`
- O app está publicado em: `https://caulinalmeida.github.io/gestao-financeira`
- Origens autorizadas no Google Cloud Console: `https://claude.ai` e `https://caulinalmeida.github.io`
- O projeto Google Cloud está em modo **de teste** (não verificado) — apenas o email `caulin.almeida08@gmail.com` está na lista de usuários de teste autorizados. Se quiser dar acesso à Luanna, adicionar o email dela em **APIs e serviços → Tela de consentimento OAuth → Usuários de teste**.

## Regras de negócio (IMPORTANTE — não alterar sem confirmar com o usuário)

### Pessoas e divisão de despesas
- Só existem duas pessoas: **Caulin** e **Luanna**
- Campo "Dono" em qualquer lançamento pode ser: `Caulin`, `Luanna`, ou `Dividido`
- `Dividido` = o valor é dividido por 2, metade para cada pessoa
- Essa regra se aplica a: contas, cartão de crédito, investimentos — tudo

### Categorias de lançamento
- **RENDA** — só aparece no cálculo de renda, nunca em despesas
- **DESPESA FIXA** / **DESPESA** — contas do dia a dia, lançadas manualmente na aba "Contas"
- **INVESTIMENTO** — aportes mensais, aba separada

### Cartão de crédito
- Campo "Parcelas/Fixo" pode ser: `RECORRENTE` (assinaturas fixas tipo streaming), `PARCELADO` (compras parceladas, mostrar sufixo tipo `05/12`), `VARIÁVEL` (compras avulsas)
- No checklist, o cartão é agrupado por: **Fixos → Parcelados → Variáveis**, mostrando só o TOTAL de cada categoria (não item por item). Clicar no total abre um modal com o detalhamento item a item.
- Existem múltiplos "cartões" possíveis: o principal é sempre `"Itaú Black"` (vem do CSV importado), mas o usuário lança manualmente outros cartões (Nubank, C6, etc.) na aba "Lançar manualmente" dentro de Fatura — cada lançamento manual tem seu próprio campo `cartao` livre.
- O checklist mostra um card de "Total Fatura" por cada nome de cartão distinto que existir no mês.

### Checklist (a tela mais importante do app)
Estrutura obrigatória, não simplificar:
- Cards de resumo no topo: Renda total, Despesas Caulin, Despesas Luanna, Saldo Caulin, e um card de Total Fatura por cartão
- Duas colunas lado a lado: Caulin | Luanna — cada uma mostrando SÓ os itens que dizem respeito àquela pessoa (valor já calculado, ÷2 se dividido)
- Dentro de cada coluna: Investimentos → Contas → Cartão (com fixos/parcelados/variáveis agrupados por total, clicável)
- Todo item tem checkbox de "pago". Marcar/desmarcar atualiza o "Saldo Caulin" em tempo real (Saldo = Renda Caulin − tudo que Caulin marcou como pago)
- Checkboxes de pagamento existem **somente no Checklist**, nunca nas abas de Fatura/Contas/Investimentos (isso já foi pedido explicitamente para ser removido de lá)
- Botão final "Copiar resumo para WhatsApp" — gera um texto formatado e copia pro clipboard

### Dicionário de categorização automática
- Ao importar um CSV de fatura, cada transação é comparada (case-insensitive, sem acento, normalizada) contra um dicionário de padrões conhecidos (`dict` state)
- Se encontrar match, preenche Dono/Parcelas/Obs automaticamente
- Se não encontrar, marca como `isNew: true` e a linha aparece destacada em amarelo com Obs = "NOVO"
- Usuário revisa e clica em "Aprender" — isso salva o padrão no dicionário para próximas importações
- O dicionário é compartilhado entre todos os meses (não é por mês)

### Meses
- Cada mês (`mesRef`) tem seu próprio conjunto isolado de: fatura, lançamentos manuais, contas, investimentos
- Trocar de mês no seletor do topo NÃO deve misturar dados entre meses (bug já corrigido antes, cuidado ao mexer no state)
- Existe botão "Copiar do mês anterior" em Contas, Investimentos e Lançamentos manuais — abre modal com checkboxes para selecionar item por item o que replicar pro mês atual (contas fixas recorrentes tipicamente se repetem, gastos variáveis não)

## Integração com Google Sheets — estrutura das abas

A planilha (`SHEET_ID` acima) tem 4 abas, cada uma com cabeçalho fixo na linha 1:

**RENDA_DESPESAS** (contas, incluindo renda; NÃO investimentos)
```
Mes Ref | Data | Transação | Valor | Dono | Tipo | Parcelas/Fixo | Observações
```

**CARTAO_CREDITO** (fatura importada + lançamentos manuais, tudo junto)
```
Mes Ref | Data | Transação | Parcela | Valor | Dono | Tipo | Parcelas/Fixo | Observações | Cartão
```

**INVESTIMENTOS** (aba própria, separada de RENDA_DESPESAS)
```
Mes Ref | Descrição | Valor | Dono | Observações
```

**DICIONARIO**
```
Key | Dono | Parcelas | Obs
```

### Como o sync funciona
- Toda alteração no app (editar campo, adicionar linha, importar CSV) dispara `syncAll()` com debounce de 1200ms
- `syncAll` faz **clear + append completo** de todas as abas relevantes a cada sync (não faz update incremental de linha) — ou seja, ele apaga tudo e reescreve do zero a cada vez, iterando por todos os meses em memória. Isso é intencional pela simplicidade, mas pode ficar lento com muito histórico acumulado (ok até uns 2-3 anos de dados, considerar otimizar depois disso)
- O token de acesso OAuth é guardado em `sessionStorage` (dura a sessão da aba, ~58 minutos) — por isso ao reabrir o navegador depois de muito tempo, pede login de novo. Isso é esperado.

## Problemas já resolvidos (não reintroduzir)

1. **Bug de parse de valor BR/EN**: `parseBRL()` precisa detectar se a string tem vírgula (formato BR "1.234,56") ou não (já é float tipo "1920.72"). Um bug anterior tratava tudo como BR e multiplicava valores por 100.
2. **Erro React #310**: aconteceu porque um `useState` estava sendo chamado dentro de uma IIFE (`(() => {...})()`) dentro do JSX, e não no nível do componente. Todo hook precisa estar no topo da função `App()`.
3. **OAuth não funciona dentro do Claude.ai artifact/iframe** — por isso o projeto foi movido para GitHub Pages. Não tentar voltar a rodar isso como artifact React puro com login Google.
4. **Login perdido a cada F5** — resolvido guardando token em `sessionStorage` com expiração de ~58min, e auto-carregando dados no `useEffect` inicial se já houver token válido.
5. **"Copiar do mês anterior" não atualizava a tela** — a causa era estado desatualizado por closure; a correção usa a forma funcional do `setDadosMes(prev => ...)` para todos os updates.
6. **Investimentos não sincronizavam com Sheets** — estavam sendo gravados junto com RENDA_DESPESAS ao invés da aba própria INVESTIMENTOS. Corrigido para ter leitura/escrita dedicada.

## Estilo visual (design system informal)

Paleta de cores usada consistentemente (ver objeto `C` no topo do `App.jsx`):
- **Teal** (`#0F6E56` / `#E1F5EE`) — cor primária, usada para Caulin, renda, ações principais
- **Purple** (`#534AB7` / `#EEEDFE`) — usada para Luanna
- **Red** (`#A32D2D` / `#FCEBEB`) — despesas, ações destrutivas
- **Green** (`#3B6D11` / `#EAF3DE`) — saldo positivo, sucesso
- **Blue** (`#185FA5` / `#E6F1FB`) — cards de fatura/cartão
- **Amber** (`#854F0B` / `#FAEEDA`) — itens novos/pendentes de revisão

Estilo geral: cards brancos com sombra sutil, bordas arredondadas (8-14px), tipografia do sistema (`system-ui`), sem ícones de biblioteca — usa emojis diretamente no texto (📊💰📉✅ etc.) para evitar dependência externa.

## O que NÃO fazer sem perguntar antes

- Não trocar Google Sheets por outro backend sem discutir — foi uma escolha deliberada após avaliar alternativas (Supabase, Notion, storage local)
- Não adicionar autenticação multi-usuário genérica — o app é hardcoded para duas pessoas específicas por design
- Não reintroduzir checkboxes de pagamento fora da aba Checklist
- Não mudar a estrutura de colunas das abas do Sheets sem migrar os dados existentes
- Não remover o dicionário de aprendizado automático — é o motivo do app funcionar melhor que a versão anterior em GPT

## Ideias para evoluir (não implementadas ainda, backlog)

- Otimizar sync para update incremental em vez de clear+append total (importante se o histórico crescer muito)
- Layout mobile mais compacto para a tabela de fatura (hoje precisa scroll horizontal)
- Gráfico de comparativo mês a mês
- Alertas de parcelamentos terminando no mês
- Total de gastos com tag "Férias/" separado
- Adicionar a Luanna como segunda usuária de teste no Google Cloud para ela acessar o app também

## Como rodar localmente

```bash
npm install
npm run dev          # dev server local
npm run build        # build de produção
npm run deploy       # build + publica no GitHub Pages (gh-pages -d dist)
```

Depois de qualquer alteração, o fluxo de publicação é sempre:
```bash
git add .
git commit -m "mensagem"
npm run deploy
git push
```
(o `deploy` publica no GitHub Pages via branch `gh-pages`; o `push` mantém o código-fonte sincronizado na branch `main`)