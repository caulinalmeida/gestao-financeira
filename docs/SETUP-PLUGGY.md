# Setup externo — Open Finance (Pluggy) + Apps Script

Guia das configurações que **só você pode fazer** (envolvem suas contas e credenciais).
Marque cada item conforme concluir e me avise o que deu diferente do descrito.

---

## Passo 1 — Backup da planilha ⚠️ FAÇA ANTES DE TUDO

A migração de `Mes Ref` reescreve a coluna A de três abas. Backup é obrigatório.

1. Abra a planilha: `https://docs.google.com/spreadsheets/d/19qO91TbQQJMLd_ONeP--Gdh7NwliuYuYQ-GuA-PNen8`
2. **Arquivo → Fazer uma cópia**
3. Nomeie como `BACKUP gestao-financeira 2026-08-15`
4. Confirme que a cópia tem as 4 abas: `RENDA_DESPESAS`, `CARTAO_CREDITO`, `INVESTIMENTOS`, `DICIONARIO`

- [ ] Backup feito

---

## Passo 2 — Conectar os cartões no Meu Pluggy

O Meu Pluggy é **gratuito por tempo indeterminado** para uso pessoal, sem limite de conexões.

1. Acesse `https://meu.pluggy.ai` e crie a conta
2. Conecte **cada cartão de crédito** que você quer no app (Itaú, Nubank, C6…)
   - Prefira a opção **Open Finance** quando o banco oferecer as duas. É a via regulada: não guarda sua senha, exige menos MFA e tem `billId`/parcelas estruturadas melhores.
3. Confirme que as faturas aparecem corretamente no painel do Meu Pluggy

> **Sobre consentimento:** o consentimento do Open Finance dura **12 meses** e a renovação é feita aqui no `meu.pluggy.ai`, não no nosso app. O app vai te avisar quando estiver perto de expirar.

- [ ] Cartões conectados e faturas visíveis

**Me diga quais cartões você conectou** — preciso saber para conferir o mapeamento no QA.

---

## Passo 3 — Credenciais de API no Dashboard do Pluggy

1. Acesse `https://dashboard.pluggy.ai` e crie a conta de desenvolvedor
   - **Use o mesmo e-mail** do Meu Pluggy, facilita a vinculação
2. Crie uma **Aplicação** (tipo *Development*)
3. Nas configurações da aplicação, habilite o conector **Meu Pluggy**
4. Faça a **autorização OAuth do Meu Pluggy**, que vincula sua conta pessoal à aplicação
   - ⚠️ Segundo a documentação, isso precisa ser feito **uma vez por banco conectado**
5. Copie o **Client ID** e o **Client Secret**

- [ ] Client ID e Client Secret em mãos

> 🔒 **Não me mande essas credenciais no chat.** Você vai colá-las direto no Apps Script no passo 4. Elas nunca entram no repositório nem no bundle do site.

**Você não precisa descobrir os `itemId`s** — o sincronizador chama `GET /items` e encontra sozinho.

---

## Passo 4 — Instalar o Apps Script

O código está em [`apps-script/`](../apps-script/).

### 4.1 Criar os arquivos

1. Na planilha: **Extensões → Apps Script**
2. Barra lateral esquerda, em **Arquivos**, clique em **`+` → Script**
3. Nomeie **sem a extensão** (digite `Config`, vira `Config.gs` sozinho)
4. Repita para os 6: `Config`, `Pluggy`, `Sheets`, `Sync`, `Migracao`, `Triggers`
5. Cole o conteúdo de cada um e salve com **Ctrl+S**
6. Apague o `Código.gs` que veio por padrão

> O `appsscript.json` é opcional — o Apps Script deduz as permissões a partir do
> código. Só aparece no editor se você habilitar em Configurações.

### 4.2 Guardar as credenciais

**⚙ Configurações do projeto** (engrenagem na barra esquerda) → **Propriedades do
script** → **Adicionar propriedade do script**:

| Propriedade | Valor |
|---|---|
| `PLUGGY_CLIENT_ID` | *(do passo 3)* |
| `PLUGGY_CLIENT_SECRET` | *(do passo 3)* |
| `PLUGGY_ITEM_IDS` | IDs das conexões, separados por vírgula |

Clique em **Salvar propriedades do script**.

### Onde achar o `PLUGGY_ITEM_IDS`

A API do Pluggy **não tem endpoint de listagem de items** — só `GET /items/{id}`.
Por isso os IDs precisam ser informados na mão (uma vez só, por banco).

1. Acesse `dashboard.pluggy.ai`
2. Abra sua aplicação → seção **Items** / **Connections** / **Conexões**
3. Copie o ID de cada conexão — é um UUID, tipo `3f9b1c2a-4d5e-6f70-8a9b-0c1d2e3f4a5b`
4. Vários bancos? Separe por vírgula: `id-1,id-2`

> Cartões do mesmo banco compartilham a mesma conexão, então **2 cartões Itaú
> normalmente são UM único item ID** — o script encontra as duas contas sozinho.

⚠️ Não confunda com **Application ID** nem com **Connector ID** (o do Itaú é um
número curto). O item ID é o UUID da *sua* conexão.

### 4.3 Rodar uma função

⚠️ **O dropdown de funções só lista o que está no arquivo ABERTO.** Abra o arquivo
certo antes de procurar a função no seletor.

Barra do topo: `[▷ Executar] [🐞 Depurar] [ nomeDaFuncao ▼ ] [Registro de execução]`

Abra o arquivo → escolha a função no dropdown → **▷ Executar**.
A saída aparece no painel **Registro de execução**, embaixo.

### 4.4 Autorizar (só na primeira vez)

1. **Autorização necessária** → **Revisar permissões**
2. Escolha sua conta Google
3. **"O Google não verificou este app"** → clique em **Avançado**
4. **Acessar Gestão Financeira (não seguro)** → **Permitir**

É o seu próprio script, na sua conta. O aviso é esperado.

### 4.5 Ordem de execução

Uma de cada vez, conferindo o log antes de seguir:

| # | Função | Arquivo | Escreve? |
|---|---|---|---|
| 1 | `testarConexao` | `Sync.gs` | não — só diagnóstico |
| 2 | `simularMigracaoMeses` | `Migracao.gs` | não — só prévia |
| 3 | `migrarMeses` | `Migracao.gs` | **sim** |
| 4 | `sincronizarAgora` | `Sync.gs` | **sim** |
| 5 | `criarGatilhos` | `Triggers.gs` | — |

- [ ] `testarConexao()` listou os cartões corretamente
- [ ] Migração simulada e aplicada
- [ ] Primeira sincronização concluída
- [ ] Gatilhos criados

### Se der erro

| Erro | Causa provável |
|---|---|
| `Propriedade do script "..." não configurada` | Faltou salvar no passo 4.2 |
| `Falha na autenticação (HTTP 401/403)` | Client ID ou Secret errado |
| `Não consegui listar os items automaticamente` | Adicione a propriedade `PLUGGY_ITEM_IDS` com os IDs separados por vírgula (dashboard.pluggy.ai → Applications → Items) |
| Função não aparece no dropdown | Arquivo errado aberto, ou faltou salvar |

---

## Referência rápida

| Recurso | Onde |
|---|---|
| Conectar bancos / renovar consentimento | `https://meu.pluggy.ai` |
| Credenciais de API | `https://dashboard.pluggy.ai` |
| Documentação | `https://docs.pluggy.ai` |
| Planilha (banco de dados) | `docs.google.com/spreadsheets/d/19qO91TbQQ...` |
| App publicado | `https://caulinalmeida.github.io/gestao-financeira` |

## Custos

Tudo **R$ 0**:
- Meu Pluggy: gratuito por tempo indeterminado, uso pessoal, sem limite de conexões
- Apps Script: gratuito (limites de 20.000 chamadas externas/dia e 90 min/dia de gatilhos — usaremos uma fração)
- GitHub Pages: gratuito

Uso **comercial** exigiria plano pago do Pluggy — não é o caso aqui.
