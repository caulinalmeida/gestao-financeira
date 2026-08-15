/**
 * Configuração central do sincronizador Pluggy → Google Sheets.
 *
 * As credenciais NUNCA ficam neste arquivo (ele é versionado no Git).
 * Elas vivem em Propriedades do Script:
 *   Extensões → Apps Script → ⚙ Configurações do projeto → Propriedades do script
 *
 *   PLUGGY_CLIENT_ID       (obrigatório)
 *   PLUGGY_CLIENT_SECRET   (obrigatório)
 *   PLUGGY_ITEM_IDS        (opcional — só se a descoberta automática falhar;
 *                           IDs separados por vírgula)
 */

var PLUGGY_API = 'https://api.pluggy.ai';

// Nomes das abas. OF_* são as abas novas do Open Finance.
var ABA_TRANSACOES = 'OF_TRANSACOES';
var ABA_CARTOES    = 'OF_CARTOES';
var ABA_STATUS     = 'OF_STATUS';

// Janela de sincronização. Larga de propósito: parcelas futuras e transações
// que passam de PENDING para POSTED aparecem fora dos últimos dias, e é isso
// que nos permite dispensar webhook.
var JANELA_DIAS_ATRAS = 120;
var JANELA_DIAS_FRENTE = 90;

// Cabeçalhos. A ORDEM É CONTRATO — o App.jsx lê por posição de coluna.
var COLS_TRANSACOES = [
  'pluggy_tx_id','account_id','mes_ref','origem_mes','data','descricao','valor',
  'status','bill_id','parcela_num','parcela_total','valor_total','data_compra',
  'fingerprint','atualizado_em'
];

var COLS_CARTOES = [
  'account_id','item_id','nome','ultimos_digitos','limite',
  'fechamento','vencimento','atualizado_em'
];

var COLS_STATUS = ['chave','valor'];

function _props() {
  return PropertiesService.getScriptProperties();
}

function _prop(nome, obrigatorio) {
  var v = _props().getProperty(nome);
  if (!v && obrigatorio) {
    throw new Error(
      'Propriedade do script "' + nome + '" não configurada.\n' +
      'Vá em ⚙ Configurações do projeto → Propriedades do script e adicione.'
    );
  }
  return v;
}
