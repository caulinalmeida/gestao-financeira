/**
 * Conferência antes de gravar qualquer coisa.
 *
 * O critério objetivo do projeto é: o total que o app calcula tem que bater com
 * a fatura real do banco. Esta função imprime os totais por cartão e por mês
 * para você comparar com o app do Itaú, e destrincha as transações da virada
 * de fatura — que é onde erro de atribuição de mês aparece.
 *
 *   conferirFatura()          resumo por cartão/mês + transações da virada
 *   conferirFaturaDetalhe(m)  lista TODAS as transações de um mês ("2026-09")
 *
 * Nenhuma das duas escreve na planilha.
 */

function _fmt(v) {
  var n = Number(v || 0);
  return (n < 0 ? '-' : ' ') + 'R$ ' + Math.abs(n).toFixed(2);
}

function _contasComContexto() {
  var items = pluggyItems();
  var out = [];
  items.ids.forEach(function (itemId) {
    pluggyContasCredito(itemId).forEach(function (c) {
      var faturas = pluggyFaturas(c.id);
      var mapa = {};
      faturas.forEach(function (b) { if (b && b.id && b.dueDate) mapa[b.id] = b.dueDate; });
      out.push({
        conta: c,
        faturas: faturas,
        mapaFaturas: mapa,
        diaFech: _diaFechamento(c.creditData || {}, faturas)
      });
    });
  });
  return out;
}

function conferirFatura() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var hoje = new Date();
  var de = _isoData(new Date(hoje.getTime() - JANELA_DIAS_ATRAS * 86400000));
  var ate = _isoData(new Date(hoje.getTime() + JANELA_DIAS_FRENTE * 86400000));

  p('=== CONFERÊNCIA DE FATURA ===');
  p('Janela: ' + de + ' a ' + ate);
  p('Compare os totais abaixo com a fatura real no app do Itaú.');

  _contasComContexto().forEach(function (ctx) {
    var c = ctx.conta;
    p('');
    p('════════════════════════════════════════════════════');
    p('💳 ' + (c.name || '(sem nome)') + '  final ' +
      (c.number ? String(c.number).slice(-4) : '????'));
    p('   fechamento dia ' + (ctx.diaFech || '?') + ' · ' + ctx.faturas.length + ' faturas');

    // O que o BANCO diz que é cada fatura — verdade de referência.
    p('');
    p('   FATURAS SEGUNDO O BANCO:');
    ctx.faturas
      .slice()
      .sort(function (a, b) { return new Date(b.dueDate) - new Date(a.dueDate); })
      .slice(0, 6)
      .forEach(function (b) {
        var venc = b.dueDate ? String(b.dueDate).slice(0, 10) : '?';
        var fech = b.billClosingDate ? String(b.billClosingDate).slice(0, 10) : '?';
        p('     vence ' + venc + ' (fecha ' + fech + ')  total ' + _fmt(b.totalAmount));
      });

    var txs = pluggyTransacoes(c.id, de, ate);
    if (!txs.length) { p('\n   ⚠️  Nenhuma transação na janela.'); return; }

    // O que NÓS calculamos.
    var porMes = {};
    txs.forEach(function (t) {
      var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech);
      if (!porMes[d.mes]) porMes[d.mes] = { n: 0, soma: 0, pend: 0, post: 0, bill: 0, fore: 0, est: 0 };
      var m = porMes[d.mes];
      m.n++; m.soma += Number(t.amount || 0);
      if (t.status === 'PENDING') m.pend++; else m.post++;
      if (d.origem === 'BILL') m.bill++;
      else if (d.origem === 'FORECAST') m.fore++;
      else m.est++;
    });

    p('');
    p('   O QUE CALCULAMOS:');
    p('     mês       qtd    total          aberto/fechado   regra');
    Object.keys(porMes).sort().forEach(function (mes) {
      var m = porMes[mes];
      p('     ' + mes + '   ' + String(m.n).padStart(3) + '   ' +
        _fmt(m.soma).padStart(13) + '    ' +
        String(m.pend + ' pend / ' + m.post + ' post').padEnd(16) +
        'B' + m.bill + ' F' + m.fore + ' E' + m.est);
    });

    // A virada de fatura é onde erro de mês aparece. Lista o entorno do
    // fechamento para inspeção visual.
    if (ctx.diaFech) {
      p('');
      p('   VIRADA DE FATURA (dias ' + Math.max(1, ctx.diaFech - 2) + ' a ' + (ctx.diaFech + 2) + '):');
      var viradas = txs.filter(function (t) {
        var dia = new Date(t.date).getUTCDate();
        return dia >= ctx.diaFech - 2 && dia <= ctx.diaFech + 2;
      }).sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

      if (!viradas.length) p('     (nenhuma)');
      viradas.slice(0, 20).forEach(function (t) {
        var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech);
        p('     ' + String(t.date).slice(0, 10) + '  ' +
          String(t.description || '').slice(0, 26).padEnd(26) + ' ' +
          _fmt(t.amount).padStart(12) + '  ' +
          String(t.status).padEnd(8) + ' → ' + d.mes + ' (' + d.origem + ')');
      });
    }

    // Toda PENDING deveria cair na fatura ainda não fechada. Se cair numa
    // fatura já vencida, a atribuição está errada.
    var pendPorMes = {};
    txs.filter(function (t) { return t.status === 'PENDING'; }).forEach(function (t) {
      var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech);
      pendPorMes[d.mes] = (pendPorMes[d.mes] || 0) + 1;
    });
    var mesesPend = Object.keys(pendPorMes).sort();
    if (mesesPend.length > 1) {
      p('');
      p('   ⚠️  Transações EM ABERTO espalhadas em ' + mesesPend.length + ' meses: ' +
        JSON.stringify(pendPorMes));
      p('      Esperado: todas na próxima fatura a fechar.');
      p('      Rode conferirFaturaDetalhe("' + mesesPend[0] + '") para investigar.');
    }
  });

  p('');
  p('════════════════════════════════════════════════════');
  p('Nada foi escrito. Se os totais batem com o app do banco, siga.');

  return log.join('\n');
}

function conferirFaturaDetalhe(mesAlvo) {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  if (!mesAlvo || !/^\d{4}-\d{2}$/.test(mesAlvo)) {
    p('Informe o mês no formato ANO-MÊS. Ex.: conferirFaturaDetalhe("2026-09")');
    return log.join('\n');
  }

  var hoje = new Date();
  var de = _isoData(new Date(hoje.getTime() - JANELA_DIAS_ATRAS * 86400000));
  var ate = _isoData(new Date(hoje.getTime() + JANELA_DIAS_FRENTE * 86400000));

  p('=== DETALHE DE ' + mesAlvo + ' ===');

  _contasComContexto().forEach(function (ctx) {
    var c = ctx.conta;
    var txs = pluggyTransacoes(c.id, de, ate).filter(function (t) {
      return _derivarMes(t, ctx.mapaFaturas, ctx.diaFech).mes === mesAlvo;
    }).sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

    p('');
    p('💳 ' + (c.name || '?') + ' — ' + txs.length + ' transações');
    if (!txs.length) return;

    var soma = 0;
    txs.forEach(function (t) {
      soma += Number(t.amount || 0);
      var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech);
      var mm = t.creditCardMetadata || {};
      var parc = mm.totalInstallments > 1
        ? ' [' + mm.installmentNumber + '/' + mm.totalInstallments + ']' : '';
      p('  ' + String(t.date).slice(0, 10) + '  ' +
        String(t.description || '').slice(0, 30).padEnd(30) +
        _fmt(t.amount).padStart(12) + '  ' +
        String(t.status).padEnd(8) + d.origem + parc);
    });
    p('  ' + ''.padEnd(30) + '  ── TOTAL: ' + _fmt(soma));
  });

  p('');
  p('Compare o TOTAL com a fatura correspondente no app do Itaú.');
  return log.join('\n');
}
