# apps-script — sincronizador Pluggy → Google Sheets

Backend do app. Roda dentro da própria planilha, então escreve nela sem
autenticação nenhuma — é por isso que ficou aqui e não numa função serverless.

## Regra que não pode ser quebrada

**Cada aba da planilha tem UM único escritor.**

| Aba | Escritor |
|---|---|
| `OF_TRANSACOES` | só este script |
| `OF_CARTOES` | só este script |
| `OF_STATUS` | só este script (exceto a chave `pedido_sync`, escrita pelo app) |
| `OF_AJUSTES` | só o app (`App.jsx`) |
| `CARTAO_CREDITO`, `RENDA_DESPESAS`, `INVESTIMENTOS`, `DICIONARIO` | só o app |

O app faz `clear + append` da planilha inteira a cada alteração. Se este script
escrevesse nas mesmas abas, um sobrescreveria o outro e haveria perda de dados.

## Instalação

1. Na planilha: **Extensões → Apps Script**
2. Crie um arquivo para cada `.gs` desta pasta e cole o conteúdo
3. **⚙ Configurações do projeto → Propriedades do script**, adicione:

   | Propriedade | Valor |
   |---|---|
   | `PLUGGY_CLIENT_ID` | do dashboard.pluggy.ai |
   | `PLUGGY_CLIENT_SECRET` | do dashboard.pluggy.ai |
   | `PLUGGY_ITEM_IDS` | *(opcional — só se a descoberta automática falhar)* |

4. Rode **`testarConexao()`** — na primeira execução o Google pede autorização
   ("app não verificado" → *Avançado* → *Acessar projeto*). É seu próprio script.

## Ordem de execução na primeira vez

```
testarConexao()          diagnóstico, não escreve nada
simularMigracaoMeses()   prévia da migração de Mes Ref, não escreve
migrarMeses()            aplica a migração  ⚠️ faça o backup antes
sincronizarAgora()       primeira carga real
criarGatilhos()          liga a automação
```

## Funções disponíveis

| Função | O que faz | Escreve? |
|---|---|---|
| `testarConexao()` | Lista items, cartões, limites e datas de fechamento | não |
| `simularMigracaoMeses()` | Prévia de `MAIO` → `2026-05` | não |
| `migrarMeses()` | Aplica a migração | **sim** |
| `sincronizarAgora()` | Sincroniza na hora | **sim** |
| `criarGatilhos()` | Sync diário (5h) + poller de 5 min | — |
| `removerGatilhos()` | Desliga a automação | — |
| `listarGatilhos()` | Mostra o que está configurado | não |

## Como o "Atualizar agora" funciona

Sem Web App público. O app grava a chave `pedido_sync` em `OF_STATUS`
(ele já tem permissão de escrita na planilha) e o poller de 5 minutos reage.

Evita expor endpoint anônimo, lidar com CORS do Apps Script e vazar um shared
secret no bundle — que é público, já que o site está no GitHub Pages.

## Como o mês de cada transação é decidido

A coluna `origem_mes` registra qual regra foi usada, o que torna o QA possível:

| `origem_mes` | Regra | Confiança |
|---|---|---|
| `BILL` | Transação tem `billId`; usamos o vencimento da fatura | alta |
| `FORECAST` | `creditCardMetadata.billForecastDate` do Pluggy | alta |
| `ESTIMADO` | Calculado pelo dia de fechamento do cartão | média |

Se aparecer muito `ESTIMADO`, vale investigar — significa que o conector não
está entregando `billId` nem previsão.

## Janela de sincronização

De **120 dias atrás** a **90 dias à frente** (`Config.gs`).

É larga de propósito: parcelas futuras e transações que passam de `PENDING` para
`POSTED` aparecem fora dos últimos dias. Como reprocessamos a janela inteira a
cada sync, não precisamos consumir webhook para não perder lançamento.

Fora da janela, o histórico fica intacto.

## Versionamento com clasp (opcional)

```bash
npm i -g @google/clasp
clasp login
cd apps-script
clasp clone <SCRIPT_ID>   # o ID está em ⚙ Configurações do projeto
clasp push
```

`.clasp.json` e `.clasprc.json` estão no `.gitignore` — contêm credenciais.

## Limites de quota (conta gratuita)

| Recurso | Limite | Uso estimado |
|---|---|---|
| Chamadas externas (UrlFetch) | 20.000/dia | dezenas |
| Tempo de execução | 6 min por execução | segundos |
| Tempo total de gatilhos | 90 min/dia | ~5 min |
| Gatilhos por script | 20 | 2 |

Folga confortável.
