# Gestão Financeira

Controle financeiro doméstico para duas pessoas que dividem despesas. A fatura
do cartão entra sozinha pelo Open Finance; a classificação de quem paga o quê
continua sendo decisão humana.

Publicado em <https://caulinalmeida.github.io/gestao-financeira>.

## Como funciona

```
Pluggy (Open Finance)          Google Sheets              App (React)
        │                            │                         │
        │  Apps Script, 1×/dia   ┌───┴────────┐                │
        └───────────────────────►│ OF_*       │◄───────────────┤ lê tudo
                                 │ (abas novas)│                │
                                 └───┬────────┘                │
                                     │ OF_AJUSTES ◄────────────┘ escreve
                                     │ (decisões do usuário)      decisões
```

O Pluggy é dono dos fatos — data, descrição, valor, parcela. Você é dono das
decisões — de quem é, como classifica, o que ignorar. O sincronizador nunca
sobrescreve uma decisão, e é isso que faz a categorização durar entre syncs.

**Regra que sustenta o desenho: cada aba da planilha tem um único escritor.**
O app faz `clear + append` do que é dele; o Apps Script, do que é dele. Se os
dois escrevessem na mesma aba, haveria perda de dados.

## Rodando

```bash
npm install
npm run dev      # http://localhost:5173/gestao-financeira/
npm run qa       # testes das funções puras + do sincronizador
npm run lint
npm run build
```

Publicar:

```bash
npm run deploy   # build + gh-pages
git push         # mantém a main sincronizada
```

## Estrutura

| Caminho | O que é |
|---|---|
| `src/App.jsx` | O app inteiro. Monolítico por design. |
| `apps-script/` | O sincronizador do Pluggy. Colado no editor do Apps Script da planilha. |
| `scripts/qa-*.cjs` | Testes. Extraem as funções puras e rodam fora do React. |
| `docs/SETUP-PLUGGY.md` | Configuração externa, passo a passo. |
| `CLAUDE.md` | Contexto completo: regras de negócio, decisões, o que não mexer. |

Leia o `CLAUDE.md` antes de alterar qualquer coisa — as regras de negócio ali
não são deriváveis do código.
