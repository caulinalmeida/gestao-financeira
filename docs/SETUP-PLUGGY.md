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

## Passo 4 — Apps Script (faremos junto, depois que eu subir o código)

Vou gerar a pasta `apps-script/` no repo. Quando estiver pronta, o fluxo é:

1. Na planilha: **Extensões → Apps Script**
2. Colar os arquivos que eu gerar
3. **Configurações do projeto → Propriedades do script → Adicionar propriedade:**

   | Propriedade | Valor |
   |---|---|
   | `PLUGGY_CLIENT_ID` | *(do passo 3)* |
   | `PLUGGY_CLIENT_SECRET` | *(do passo 3)* |

4. Rodar a função `testarConexao()` — ela valida as credenciais e lista os cartões encontrados, sem escrever nada
5. Rodar `criarGatilhos()` — configura o sync diário e o poller de "atualizar agora"

Na primeira execução o Google vai pedir autorização do script (tela de "app não verificado" → *Avançado* → *Acessar projeto*). É seu próprio script na sua conta, é esperado.

- [ ] Aguardando o código

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
