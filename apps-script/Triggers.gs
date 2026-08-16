/**
 * Automação.
 *
 * Dois gatilhos:
 *
 *   1. syncDiario()          — 1× por dia, de madrugada. É o sync de verdade.
 *   2. verificarPedidoSync() — a cada 5 min, só lê uma célula e sai.
 *
 * O item 2 é o truque que dá o botão "Atualizar agora" no app SEM expor um Web
 * App público na internet: o app já tem permissão de escrita na planilha, então
 * ele grava a chave `pedido_sync` em OF_STATUS e este poller reage. Sem CORS,
 * sem endpoint anônimo, e sem shared secret vazando no bundle do GitHub Pages
 * (que é público).
 *
 * Custo de quota: o poller sai em ~1s quando não há pedido. 288 execuções/dia
 * ≈ 5 min do orçamento de 90 min/dia de gatilhos. Folga confortável.
 */

// Horários do sync diário. Vários, e não um só, porque não controlamos quando
// o Pluggy visita o banco: com uma execução às 5h, se o Pluggy atualizasse às
// 9h a gente lia o dado de ontem o dia inteiro e só pegava o de hoje na
// madrugada seguinte — um dia inteiro de atraso por construção.
//
// Ajustável pela propriedade do script HORAS_SYNC (ex.: "7,13,20") depois de
// descobrir o horário real do Pluggy com historicoSync().
var HORAS_SYNC_PADRAO = [6, 11, 16, 21];

function _horasSync() {
  var bruto = _prop('HORAS_SYNC', false);
  if (!bruto) return HORAS_SYNC_PADRAO;
  var horas = String(bruto).split(',')
    .map(function (h) { return parseInt(String(h).trim(), 10); })
    .filter(function (h) { return !isNaN(h) && h >= 0 && h <= 23; });
  return horas.length ? horas : HORAS_SYNC_PADRAO;
}

function criarGatilhos() {
  removerGatilhos();

  var horas = _horasSync();
  horas.forEach(function (h) {
    ScriptApp.newTrigger('syncDiario').timeBased().everyDays(1).atHour(h).create();
  });

  ScriptApp.newTrigger('verificarPedidoSync')
    .timeBased()
    .everyMinutes(5)
    .create();

  var msg = '✅ Gatilhos criados:\n' +
            '   • syncDiario — ' + horas.map(function (h) { return h + 'h'; }).join(', ') +
            ' (o Apps Script roda dentro da hora, não no minuto exato)\n' +
            '   • verificarPedidoSync — a cada 5 min (botão "Atualizar agora")\n' +
            '\n' +
            'Para mudar os horários: propriedade do script HORAS_SYNC = "7,13,20"\n' +
            'e rode criarGatilhos() de novo. Use historicoSync() para descobrir\n' +
            'a que horas o Pluggy visita o banco.';
  Logger.log(msg);
  return msg;
}

function removerGatilhos() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'syncDiario' || f === 'verificarPedidoSync') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('Gatilhos removidos: ' + n);
  return n;
}

function listarGatilhos() {
  var linhas = ScriptApp.getProjectTriggers().map(function (t) {
    return '• ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')';
  });
  var msg = linhas.length ? linhas.join('\n') : '(nenhum gatilho configurado)';
  Logger.log(msg);
  return msg;
}

function syncDiario() {
  sincronizar('gatilho diário');
}

/**
 * Poller do botão "Atualizar agora".
 * O app grava `pedido_sync` com um timestamp; consumimos e limpamos a chave.
 * Pedidos com mais de 30 min são descartados (evita disparar um sync por causa
 * de um clique antigo, se o gatilho tiver ficado parado).
 */
function verificarPedidoSync() {
  var st = statusLer();
  var pedido = st['pedido_sync'];
  if (!pedido) return;

  var quando = new Date(pedido);
  var idadeMin = isNaN(quando.getTime()) ? 0 : (new Date() - quando) / 60000;

  // Limpa antes de sincronizar, para um clique durante o sync não re-disparar.
  statusGravar({ pedido_sync: '' });

  if (idadeMin > 30) {
    Logger.log('Pedido de sync descartado (idade ' + Math.round(idadeMin) + ' min).');
    return;
  }

  Logger.log('Pedido de sync recebido do app. Sincronizando...');
  sincronizar('botão do app');
}
