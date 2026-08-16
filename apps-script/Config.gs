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
var ABA_FATURAS    = 'OF_FATURAS';
var ABA_STATUS     = 'OF_STATUS';
var ABA_AJUSTES    = 'OF_AJUSTES';

// Janela de sincronização. Larga de propósito: parcelas futuras e transações
// que passam de PENDING para POSTED aparecem fora dos últimos dias, e é isso
// que nos permite dispensar webhook.
// 210 e não 120: com 120, a janela começava no meio de abril e a fatura de
// maio (que fecha 03/05 e cobre compras desde 03/04) nascia cortada — faltavam
// R$ 3.622 só por causa da borda. Como o mês mais antigo da janela é SEMPRE
// parcial, o jeito de ter meses fechados confiáveis é a janela alcançar mais
// para trás do que os meses que se quer conferir.
var JANELA_DIAS_ATRAS = 210;
var JANELA_DIAS_FRENTE = 90;

/**
 * Piso do histórico: nenhum mês anterior a este é gravado ou preservado.
 *
 * Existe porque a janela de sync alcança 210 dias para trás. Sem o piso, todo
 * sync ressuscitaria os meses que limparHistorico() acabou de apagar — a
 * limpeza duraria até a próxima execução do gatilho.
 *
 * O piso NÃO corta o futuro: parcelas agendadas para 2027 continuam entrando,
 * porque são elas que fazem a aba Parcelas projetar.
 *
 * '' (vazio) desliga o piso e volta a guardar todo o histórico.
 */
var MES_MINIMO = '2026-08';

/**
 * Normaliza o que está na célula de mês para 'ANO-MÊS', ou '' se não der.
 *
 * `getValues()` não devolve só texto: uma célula com "2026-08" pode ter sido
 * interpretada pelo Sheets como DATA, e aí chega como objeto Date. As duas
 * formas viram a mesma string no log, então o bug fica invisível — foi o que
 * fez a primeira simulação de limpeza marcar 100% das linhas como ilegíveis.
 *
 * Nos getters locais e não nos UTC de propósito: o Apps Script constrói a Date
 * no fuso da planilha, então getMonth() já devolve o mês que aparece na tela.
 * Com getUTCMonth(), um fuso negativo como o nosso jogaria 01/08 00:00 para
 * 31/07 e o mês mudaria — justamente numa operação que apaga linhas.
 */
function _mesRefTexto(bruto) {
  // toString e não instanceof: o QA carrega os .gs num sandbox com outro realm,
  // onde `instanceof Date` é falso para uma Date legítima.
  var ehData = Object.prototype.toString.call(bruto) === '[object Date]';
  if (ehData && !isNaN(bruto.getTime())) {
    var mm = bruto.getMonth() + 1;
    return bruto.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm;
  }
  var s = String(bruto == null ? '' : bruto).trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}

/** true se `mesRef` é anterior ao piso. Formato ANO-MÊS ordena como texto. */
function _antesDoPiso(mesRef) {
  if (!MES_MINIMO) return false;
  var m = _mesRefTexto(mesRef);
  if (!m) return false;                         // não entendeu: preserva
  return m < MES_MINIMO;
}

// Cabeçalhos. A ORDEM É CONTRATO — o App.jsx lê por posição de coluna.
// `tipo`: COMPRA | PAGAMENTO | ESTORNO. O banco não soma o pagamento da fatura
// no total, então o app precisa distinguir para bater o valor.
var COLS_TRANSACOES = [
  'pluggy_tx_id','account_id','mes_ref','origem_mes','tipo','data','descricao','valor',
  'status','bill_id','parcela_num','parcela_total','valor_total','data_compra',
  'fingerprint','atualizado_em'
];

var COLS_CARTOES = [
  'account_id','item_id','nome','ultimos_digitos','limite',
  'fechamento','vencimento','atualizado_em'
];

// Total oficial da fatura segundo o banco. Guardar isso permite ao app mostrar
// "confere ✅" ou "difere R$ X ⚠️" por cartão/mês — descobrimos com dados reais
// que o Pluggy pode entregar menos transações do que o total da fatura em meses
// antigos, e sem esse confronto o erro passaria despercebido.
var COLS_FATURAS = [
  'account_id','mes_ref','vencimento','fechamento','total_banco','atualizado_em'
];

var COLS_STATUS = ['chave','valor'];

// OF_AJUSTES é a ÚNICA aba OF_* escrita pelo app, não por este script. Mas o
// app só sabe fazer clear/append — não sabe criar aba. Se ela não existir, a
// leitura do app falha e as decisões do usuário não têm onde ser gravadas.
// Por isso o script garante o cabeçalho aqui e nunca mais toca no conteúdo.
var COLS_AJUSTES = [
  'tipo','ref_id','dono','classificacao','obs','ignorada',
  'mes_ref_override','apelido','fingerprint'
];

// Terceiros que usam o cartão do casal. Cadastro, para o mesmo nome escrito de
// duas formas não virar duas pessoas nos totais. Escrita pelo app.
var ABA_PESSOAS  = 'PESSOAS';
var COLS_PESSOAS = ['nome'];

// O que já foi marcado como pago no checklist. A chave é derivada do conteúdo
// da linha, não do id — contas e investimentos recebem id novo a cada
// carregamento, então persistir por id não sobreviveria ao F5. Escrita pelo app.
var ABA_PAGO  = 'CHECKLIST_PAGO';
var COLS_PAGO = ['mes_ref','chave'];

// Fuso para exibir horários nos diagnósticos. As datas em si são guardadas
// como Date/ISO; isto é só apresentação.
var FUSO = 'America/Sao_Paulo';

// Registro append-only de cada sync: quando NÓS lemos × quando o PLUGGY visitou
// o banco. É o que permite descobrir o horário em que o Pluggy atualiza, em vez
// de supor. Escrita pelo Apps Script.
var ABA_SYNC_LOG  = 'OF_SYNC_LOG';
var COLS_SYNC_LOG = ['observado_em','conector','status','pluggy_visitou_em',
                     'proximo_auto_sync','nosso_sync_em','tx_mais_recente','origem'];

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
