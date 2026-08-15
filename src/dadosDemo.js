/**
 * Dados fictícios para o MODO DEMO.
 *
 * ⚠️ TEMPORÁRIO — usado só para navegar a interface localmente, porque
 * http://localhost:5173 não está nas origens autorizadas do OAuth do Google
 * (só https://claude.ai e https://caulinalmeida.github.io estão).
 *
 * Este arquivo é carregado por import dinâmico dentro de um `if (import.meta.env.DEV)`,
 * então o Vite o coloca num chunk separado que o build de produção nunca baixa.
 *
 * Para voltar ao login real antes do deploy, veja o comentário sobre MODO_DEMO
 * no topo do App.jsx. A correção definitiva é adicionar
 * http://localhost:5173 nas origens JavaScript autorizadas do Google Cloud Console.
 */

const hoje = new Date();
const mk = (off) => {
  let ano = hoje.getFullYear(), mes = hoje.getMonth() + off;
  while (mes < 0) { mes += 12; ano -= 1; }
  while (mes > 11) { mes -= 12; ano += 1; }
  return { chave: `${ano}-${String(mes + 1).padStart(2, "0")}`, ano, mes };
};
const MES_ANTERIOR = mk(-1);
const MES_ATUAL = mk(0);
const MES_PROXIMO = mk(1);

const dia = (m, d) => `${m.ano}-${String(m.mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const ACC_BLACK = "demo-acc-black";
const ACC_PLAT = "demo-acc-platinum";

let seq = 0;
function tx(accountId, m, d, nome, valor, status, extra = {}) {
  seq += 1;
  const data = dia(m, d);
  return {
    id: `demo-tx-${String(seq).padStart(2, "0")}`,
    accountId,
    mesRef: m.chave,
    origemMes: status === "POSTED" ? "BILL" : "CICLO",
    natureza: extra.natureza || (valor < 0 ? "ESTORNO" : "COMPRA"),
    data,
    nome,
    valor,
    status,
    billId: status === "POSTED" ? `demo-bill-${m.chave}` : "",
    parcelaNum: extra.parcelaNum || 0,
    parcelaTotal: extra.parcelaTotal || 0,
    valorTotal: extra.valorTotal || 0,
    dataCompra: extra.dataCompra || "",
    fingerprint: `${nome.toUpperCase()}|${valor}|${data}`,
  };
}

export const ofCartoes = [
  { accountId: ACC_BLACK, itemId: "demo-item", nome: "Itau Uniclass Mult MC Black", ultimos: "3216", limite: 70880, fechamento: "3", vencimento: "10" },
  { accountId: ACC_PLAT, itemId: "demo-item", nome: "Itau Uniclass Mastercard Platinum+", ultimos: "7292", limite: 10000, fechamento: "3", vencimento: "10" },
];

export const ofTransacoes = [
  // ── Fatura fechada do mês anterior ────────────────────────────────────────
  tx(ACC_BLACK, MES_ANTERIOR, 5, "NETFLIX.COM", 55.90, "POSTED"),
  tx(ACC_BLACK, MES_ANTERIOR, 6, "Spotify", 34.90, "POSTED"),
  tx(ACC_BLACK, MES_ANTERIOR, 8, "99Food *RESTAURANTE JAPA", 157.49, "POSTED"),
  tx(ACC_BLACK, MES_ANTERIOR, 11, "SUPERMERCADOS BERGAMIN", 380.23, "POSTED"),
  tx(ACC_BLACK, MES_ANTERIOR, 14, "Pier Seguradora", 324.77, "POSTED"),
  tx(ACC_BLACK, MES_ANTERIOR, 18, "MERCADOLIVRE*KINGHOME", 188.13, "POSTED", { parcelaNum: 4, parcelaTotal: 10, valorTotal: 1881.30, dataCompra: dia(mk(-4), 18) }),
  tx(ACC_PLAT, MES_ANTERIOR, 9, "ASSAI ATACADISTA LJ20", 333.25, "POSTED"),

  // ── Fatura fechada do mês atual ───────────────────────────────────────────
  tx(ACC_BLACK, MES_ATUAL, 4, "NETFLIX.COM", 55.90, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 5, "Spotify", 34.90, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 5, "Google YouTubePremium", 26.90, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 6, "OPENAI *CHATGPT SUBSCR", 20.00, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 7, "99Food *LITTLE NICK PIZZA", 31.49, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 9, "SUPERMERCADOS BERGAMIN", 145.62, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 10, "Pier Seguradora", 324.77, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 12, "MERCADOLIVRE*KINGHOME", 188.13, "POSTED", { parcelaNum: 5, parcelaTotal: 10, valorTotal: 1881.30, dataCompra: dia(mk(-4), 12) }),
  tx(ACC_BLACK, MES_ATUAL, 13, "DL*Alipay MAGAZI", 322.48, "POSTED", { parcelaNum: 8, parcelaTotal: 12, valorTotal: 3869.76, dataCompra: dia(mk(-7), 13) }),
  tx(ACC_BLACK, MES_ATUAL, 14, "PETZ SAO BERNARDO", 156.70, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 15, "ZIG*AKI ESPETO", 242.41, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 16, "ESTORNO 99Food *LITTLE NICK", -31.49, "POSTED"),
  tx(ACC_BLACK, MES_ATUAL, 4, "Pagamento recebido", -2180.44, "POSTED", { natureza: "PAGAMENTO" }),
  tx(ACC_PLAT, MES_ATUAL, 8, "CARREFOUR", 154.36, "POSTED"),
  tx(ACC_PLAT, MES_ATUAL, 12, "PostoJacanaLtda", 100.00, "POSTED"),

  // ── Fatura em aberto ──────────────────────────────────────────────────────
  tx(ACC_BLACK, MES_PROXIMO, 4, "NETFLIX.COM", 55.90, "PENDING"),
  tx(ACC_BLACK, MES_PROXIMO, 5, "Google YouTubePremium", 26.90, "PENDING"),
  tx(ACC_BLACK, MES_PROXIMO, 7, "99APP *99App", 25.80, "PENDING"),
  tx(ACC_BLACK, MES_PROXIMO, 9, "MERCADOLIVRE*KINGHOME", 188.13, "PENDING", { parcelaNum: 6, parcelaTotal: 10, valorTotal: 1881.30, dataCompra: dia(mk(-4), 9) }),
  tx(ACC_BLACK, MES_PROXIMO, 10, "LOJA QUE NUNCA COMPREI XYZ", 89.90, "PENDING"),
  tx(ACC_BLACK, MES_PROXIMO, 11, "IOF COMPRA INTERNACIONAL", 3.70, "PENDING"),
  tx(ACC_PLAT, MES_PROXIMO, 8, "REDE PAPA", 50.00, "PENDING"),
];

// Totais do banco. O do mês atual está de propósito R$ 85,60 acima do que
// somamos, para exercitar o aviso de conciliação divergente.
const somaMes = (acc, chave) => ofTransacoes
  .filter(t => t.accountId === acc && t.mesRef === chave && t.status === "POSTED" && t.natureza !== "PAGAMENTO")
  .reduce((a, t) => a + t.valor, 0);

export const ofFaturas = [
  { accountId: ACC_BLACK, mesRef: MES_ANTERIOR.chave, vencimento: dia(MES_ANTERIOR, 10), fechamento: dia(MES_ANTERIOR, 3), totalBanco: somaMes(ACC_BLACK, MES_ANTERIOR.chave) },
  { accountId: ACC_BLACK, mesRef: MES_ATUAL.chave, vencimento: dia(MES_ATUAL, 10), fechamento: dia(MES_ATUAL, 3), totalBanco: somaMes(ACC_BLACK, MES_ATUAL.chave) + 85.60 },
  { accountId: ACC_PLAT, mesRef: MES_ANTERIOR.chave, vencimento: dia(MES_ANTERIOR, 10), fechamento: dia(MES_ANTERIOR, 3), totalBanco: somaMes(ACC_PLAT, MES_ANTERIOR.chave) },
  { accountId: ACC_PLAT, mesRef: MES_ATUAL.chave, vencimento: dia(MES_ATUAL, 10), fechamento: dia(MES_ATUAL, 3), totalBanco: somaMes(ACC_PLAT, MES_ATUAL.chave) },
];

export const ofStatus = {
  ultimo_sync: new Date(Date.now() - 42 * 60000).toISOString(),
  ultimo_sync_motivo: "MODO DEMO",
  ultimo_sync_resumo: "2 cartões · dados fictícios",
  ultimo_erro: "",
};

// Alguns ajustes já feitos, para a tela não nascer toda "para revisar".
export const ajustes = {
  "CARTAO:demo-acc-black": { tipo: "CARTAO", refId: ACC_BLACK, dono: "", classificacao: "", obs: "", ignorada: false, mesRefOverride: "", apelido: "Black", fingerprint: "" },
  "CARTAO:demo-acc-platinum": { tipo: "CARTAO", refId: ACC_PLAT, dono: "", classificacao: "", obs: "", ignorada: false, mesRefOverride: "", apelido: "Platinum+", fingerprint: "" },
};

export const dict = [
  { key: "NETFLIX", dono: "Dividido", parcelas: "RECORRENTE", obs: "streaming" },
  { key: "SPOTIFY", dono: "Caulin", parcelas: "RECORRENTE", obs: "" },
  { key: "GOOGLE YOUTUBEPREMIUM", dono: "Dividido", parcelas: "RECORRENTE", obs: "" },
  { key: "OPENAI", dono: "Caulin", parcelas: "RECORRENTE", obs: "trabalho" },
  { key: "SUPERMERCADOS BERGAMIN", dono: "Dividido", parcelas: "VARIÁVEL", obs: "mercado" },
  { key: "ASSAI ATACADISTA", dono: "Dividido", parcelas: "VARIÁVEL", obs: "mercado" },
  { key: "CARREFOUR", dono: "Dividido", parcelas: "VARIÁVEL", obs: "mercado" },
  { key: "PIER SEGURADORA", dono: "Caulin", parcelas: "RECORRENTE", obs: "seguro carro" },
  { key: "MERCADOLIVRE", dono: "Luanna", parcelas: "PARCELADO", obs: "" },
  { key: "DL ALIPAY MAGAZI", dono: "Caulin", parcelas: "PARCELADO", obs: "" },
  { key: "99FOOD", dono: "Dividido", parcelas: "VARIÁVEL", obs: "delivery" },
  { key: "99APP", dono: "Caulin", parcelas: "VARIÁVEL", obs: "transporte" },
  { key: "PETZ", dono: "Luanna", parcelas: "VARIÁVEL", obs: "pet" },
  { key: "ZIG AKI ESPETO", dono: "Dividido", parcelas: "VARIÁVEL", obs: "" },
  { key: "POSTOJACANALTDA", dono: "Caulin", parcelas: "VARIÁVEL", obs: "combustível" },
  { key: "IOF COMPRA INTERNACIONAL", dono: "Caulin", parcelas: "VARIÁVEL", obs: "" },
];

export const dadosMes = {
  [MES_ANTERIOR.chave]: {
    contas: [
      { id: "d1", transacao: "Salário Caulin", valor: "12500", dono: "Caulin", tipo: "RENDA", parcelas: "", obs: "" },
      { id: "d2", transacao: "Salário Luanna", valor: "9800", dono: "Luanna", tipo: "RENDA", parcelas: "", obs: "" },
      { id: "d3", transacao: "Aluguel", valor: "3200", dono: "Dividido", tipo: "DESPESA FIXA", parcelas: "", obs: "" },
      { id: "d4", transacao: "Condomínio", valor: "780", dono: "Dividido", tipo: "DESPESA FIXA", parcelas: "", obs: "" },
    ],
    investimentos: [{ id: "d5", descricao: "Tesouro Selic", valor: "1500", dono: "Caulin", obs: "Tesouro" }],
    fatura: [], manual: [],
  },
  [MES_ATUAL.chave]: {
    contas: [
      { id: "d10", transacao: "Salário Caulin", valor: "12500", dono: "Caulin", tipo: "RENDA", parcelas: "", obs: "" },
      { id: "d11", transacao: "Salário Luanna", valor: "9800", dono: "Luanna", tipo: "RENDA", parcelas: "", obs: "" },
      { id: "d12", transacao: "Aluguel", valor: "3200", dono: "Dividido", tipo: "DESPESA FIXA", parcelas: "", obs: "" },
      { id: "d13", transacao: "Condomínio", valor: "780", dono: "Dividido", tipo: "DESPESA FIXA", parcelas: "", obs: "" },
      { id: "d14", transacao: "Energia", valor: "245,80", dono: "Dividido", tipo: "DESPESA", parcelas: "", obs: "" },
      { id: "d15", transacao: "Internet", valor: "129,90", dono: "Dividido", tipo: "DESPESA FIXA", parcelas: "", obs: "" },
      { id: "d16", transacao: "Academia", valor: "180", dono: "Caulin", tipo: "DESPESA FIXA", parcelas: "", obs: "" },
    ],
    investimentos: [
      { id: "d17", descricao: "Tesouro Selic", valor: "1500", dono: "Caulin", obs: "Tesouro" },
      { id: "d18", descricao: "CDB Liquidez", valor: "800", dono: "Luanna", obs: "CDB" },
    ],
    fatura: [],
    manual: [
      { id: "d19", data: "12/08", nome: "Nubank — mercado", valor: 210.4, dono: "Dividido", parcelas: "VARIÁVEL", obs: "", cartao: "Nubank" },
    ],
  },
  [MES_PROXIMO.chave]: { contas: [], investimentos: [], fatura: [], manual: [] },
};

export const mesInicial = MES_ATUAL.chave;
