/**
 * Rotina principal de sincronização Pluggy → planilha.
 *
 * Funções que você roda na mão pelo editor:
 *   testarConexao()   diagnóstico, NÃO escreve nada
 *   sincronizarAgora() sincroniza imediatamente
 *   criarGatilhos()   configura a automação (ver Triggers.gs)
 */

// ── Utilitários ──────────────────────────────────────────────────────────────

function _pad2(n) { return (n < 10 ? '0' : '') + n; }

function _isoData(d) {
  return d.getUTCFullYear() + '-' + _pad2(d.getUTCMonth() + 1) + '-' + _pad2(d.getUTCDate());
}

function _mesKey(ano, mesIdx) { return ano + '-' + _pad2(mesIdx + 1); }

/** Mesma normalização do App.jsx, para o fingerprint casar dos dois lados. */
function _normalizar(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Em que fatura a transação cai. Três estratégias, da mais confiável para a
 * menos — `origem_mes` registra qual foi usada, o que torna o QA possível.
 *
 *   BILL      a transação já tem billId e a fatura tem vencimento conhecido
 *   FORECAST  o Pluggy previu a fatura (billForecastDate), típico de PENDING
 *   ESTIMADO  calculado pelo dia de fechamento do cartão (último recurso)
 */
function _derivarMes(tx, mapaFaturas, diaFechamento) {
  var meta = tx.creditCardMetadata || {};

  if (meta.billId && mapaFaturas[meta.billId]) {
    var venc = new Date(mapaFaturas[meta.billId]);
    if (!isNaN(venc.getTime())) {
      return { mes: _mesKey(venc.getUTCFullYear(), venc.getUTCMonth()), origem: 'BILL' };
    }
  }

  if (meta.billForecastDate && /^\d{4}-\d{2}$/.test(meta.billForecastDate)) {
    return { mes: meta.billForecastDate, origem: 'FORECAST' };
  }

  var d = new Date(tx.date);
  var ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  // Comprou depois do fechamento? Cai na fatura do mês seguinte.
  if (diaFechamento && d.getUTCDate() > diaFechamento) {
    mes += 1;
    if (mes > 11) { mes = 0; ano += 1; }
  }
  return { mes: _mesKey(ano, mes), origem: 'ESTIMADO' };
}

function _mapearTransacao(tx, conta, mapaFaturas, diaFechamento) {
  var meta = tx.creditCardMetadata || {};
  var m = _derivarMes(tx, mapaFaturas, diaFechamento);
  var dataIso = _isoData(new Date(tx.date));

  return {
    pluggy_tx_id: tx.id,
    account_id: conta.id,
    mes_ref: m.mes,
    origem_mes: m.origem,
    data: dataIso,
    descricao: tx.description || tx.descriptionRaw || '(sem descrição)',
    // Cartão de crédito no Pluggy: positivo = despesa, negativo = estorno/pagamento.
    // Preservamos o sinal — o import de CSV antigo fazia Math.abs e transformava
    // estorno em despesa.
    valor: tx.amount,
    status: tx.status || '',
    bill_id: meta.billId || '',
    parcela_num: meta.installmentNumber || '',
    parcela_total: meta.totalInstallments || '',
    valor_total: meta.totalAmount || '',
    data_compra: meta.purchaseDate ? _isoData(new Date(meta.purchaseDate)) : '',
    // Plano B para religar ajustes quando o Pluggy troca o id da transação.
    fingerprint: _normalizar(tx.description) + '|' + tx.amount + '|' + dataIso
  };
}

// ── Diagnóstico (não escreve nada) ───────────────────────────────────────────

function testarConexao() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  p('=== TESTE DE CONEXÃO PLUGGY ===');
  p('Autenticando...');
  pluggyApiKey();
  p('✅ Autenticação OK');

  var items = pluggyItems();
  p('Items encontrados via ' + items.origem + ': ' + items.ids.length);

  var totalCartoes = 0;
  items.ids.forEach(function (itemId) {
    var r = pluggyItem(itemId);
    var st = r.ok && r.body ? r.body.status : 'DESCONHECIDO';
    var conector = r.ok && r.body && r.body.connector ? r.body.connector.name : '?';
    p('');
    p('📦 Item ' + itemId);
    p('   Instituição: ' + conector);
    p('   Status: ' + st + (st === 'UPDATED' ? ' ✅' : ' ⚠️'));

    var contas = pluggyContasCredito(itemId);
    p('   Cartões de crédito: ' + contas.length);
    contas.forEach(function (c) {
      totalCartoes++;
      var cd = c.creditData || {};
      p('     💳 ' + (c.name || c.marketingName || '(sem nome)') +
        '  final ' + (c.number ? String(c.number).slice(-4) : '????'));
      p('        accountId: ' + c.id);
      p('        limite: ' + (cd.creditLimit || '?') +
        ' | fecha: ' + (cd.balanceCloseDate || '?') +
        ' | vence: ' + (cd.balanceDueDate || '?'));
    });
  });

  p('');
  p('=== RESUMO: ' + items.ids.length + ' item(s), ' + totalCartoes + ' cartão(ões) ===');
  p('Nada foi escrito na planilha. Se os cartões acima estão certos,');
  p('rode sincronizarAgora() e depois criarGatilhos().');

  return log.join('\n');
}

// ── Sincronização ────────────────────────────────────────────────────────────

function sincronizarAgora() {
  return sincronizar('manual');
}

function sincronizar(motivo) {
  // Trava: o gatilho diário e o poller de 5 min não podem rodar juntos,
  // senão os dois reescrevem OF_TRANSACOES ao mesmo tempo.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Outro sync em andamento. Abortando.');
    return 'ocupado';
  }

  var inicio = new Date();
  try {
    var hoje = new Date();
    var de = new Date(hoje.getTime() - JANELA_DIAS_ATRAS * 86400000);
    var ate = new Date(hoje.getTime() + JANELA_DIAS_FRENTE * 86400000);
    var dataDe = _isoData(de), dataAte = _isoData(ate);

    var items = pluggyItems();
    var cartoes = [], transacoes = [], accountIds = [], avisos = [];

    items.ids.forEach(function (itemId) {
      var info = pluggyItem(itemId);
      var st = info.ok && info.body ? info.body.status : 'ERRO_HTTP_' + info.code;
      var conector = info.ok && info.body && info.body.connector ? info.body.connector.name : itemId;
      statusGravar_um('item_' + itemId + '_status', st + ' — ' + conector);

      if (st === 'LOGIN_ERROR' || st === 'OUTDATED') {
        avisos.push(conector + ': ' + st + ' (renove a conexão em meu.pluggy.ai)');
      }

      pluggyContasCredito(itemId).forEach(function (c) {
        var cd = c.creditData || {};
        var diaFech = cd.balanceCloseDate ? new Date(cd.balanceCloseDate).getUTCDate() : null;

        cartoes.push({
          account_id: c.id,
          item_id: itemId,
          nome: c.name || c.marketingName || conector,
          ultimos_digitos: c.number ? String(c.number).slice(-4) : '',
          limite: cd.creditLimit || '',
          fechamento: cd.balanceCloseDate || '',
          vencimento: cd.balanceDueDate || ''
        });
        accountIds.push(c.id);

        // billId → dueDate, para saber em que fatura cada transação caiu.
        var mapaFaturas = {};
        pluggyFaturas(c.id).forEach(function (b) {
          if (b && b.id && b.dueDate) mapaFaturas[b.id] = b.dueDate;
        });

        pluggyTransacoes(c.id, dataDe, dataAte).forEach(function (tx) {
          transacoes.push(_mapearTransacao(tx, c, mapaFaturas, diaFech));
        });
      });
    });

    gravarCartoes(cartoes);
    var res = gravarTransacoes(transacoes, accountIds, dataDe, dataAte);

    var segundos = Math.round((new Date() - inicio) / 1000);
    statusGravar({
      ultimo_sync: new Date(),
      ultimo_sync_motivo: motivo,
      ultimo_sync_resumo: cartoes.length + ' cartões · ' + res.gravadas + ' transações · ' +
                          segundos + 's · janela ' + dataDe + ' a ' + dataAte,
      ultimo_erro: avisos.length ? avisos.join(' | ') : ''
    });

    Logger.log('Sync OK: ' + res.gravadas + ' transações de ' + cartoes.length + ' cartões (' + segundos + 's)');
    return 'ok';

  } catch (e) {
    statusGravar({ ultimo_erro: String(e && e.message ? e.message : e), ultimo_erro_em: new Date() });
    Logger.log('ERRO no sync: ' + e);
    throw e;

  } finally {
    lock.releaseLock();
  }
}

/** Grava uma única chave sem reescrever a aba inteira duas vezes. */
function statusGravar_um(chave, valor) {
  var patch = {};
  patch[chave] = valor;
  statusGravar(patch);
}
