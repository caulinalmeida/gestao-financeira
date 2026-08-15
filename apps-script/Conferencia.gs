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
        diaFech: _diaFechamento(c.creditData || {}, faturas),
        diaVenc: _diaVencimento(c.creditData || {}, faturas)
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

    // O que NÓS calculamos. O total da fatura EXCLUI o pagamento recebido —
    // é assim que o banco calcula, e é o que precisa bater.
    var porMes = {};
    txs.forEach(function (t) {
      var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech, ctx.diaVenc);
      if (!porMes[d.mes]) {
        porMes[d.mes] = { n: 0, fatura: 0, pagto: 0, pend: 0, post: 0, bill: 0, ciclo: 0, fore: 0 };
      }
      var m = porMes[d.mes], v = Number(t.amount || 0);
      m.n++;
      if (_tipoTransacao(t) === 'PAGAMENTO') m.pagto += v; else m.fatura += v;
      if (t.status === 'PENDING') m.pend++; else m.post++;
      if (d.origem === 'BILL') m.bill++;
      else if (d.origem === 'CICLO') m.ciclo++;
      else m.fore++;
    });

    // Total real por mês de vencimento, para conferência lado a lado.
    var totalBanco = {};
    ctx.faturas.forEach(function (b) {
      if (!b || !b.dueDate) return;
      var dv = new Date(b.dueDate);
      if (isNaN(dv.getTime())) return;
      totalBanco[_mesKey(dv.getUTCFullYear(), dv.getUTCMonth())] = Number(b.totalAmount || 0);
    });

    p('');
    p('   CONFERÊNCIA (total da fatura, sem o pagamento):');
    p('     mês        qtd     nós          banco         dif      regra');
    Object.keys(porMes).sort().forEach(function (mes) {
      var m = porMes[mes];
      var banco = totalBanco[mes];
      var temBanco = banco !== undefined;
      var dif = temBanco ? (m.fatura - banco) : null;
      var marca = !temBanco ? '  —' : (Math.abs(dif) < 0.01 ? '  ✅' : '  ⚠️');
      p('     ' + mes + '   ' + String(m.n).padStart(3) + '  ' +
        _fmt(m.fatura).padStart(12) + '  ' +
        (temBanco ? _fmt(banco).padStart(12) : '           ?') + '  ' +
        (temBanco ? _fmt(dif).padStart(11) : '          -') + marca +
        '   B' + m.bill + ' C' + m.ciclo + ' F' + m.fore);
      if (m.pagto) p('              (pagamento recebido: ' + _fmt(m.pagto) + ' — fora do total)');
    });
    p('');
    p('     ✅ = bate com o banco · ⚠️ = divergente · — = fatura ainda não fechada');
    p('     Meses na borda da janela ficam incompletos, é esperado.');

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
        var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech, ctx.diaVenc);
        p('     ' + String(t.date).slice(0, 10) + '  ' +
          String(t.description || '').slice(0, 26).padEnd(26) + ' ' +
          _fmt(t.amount).padStart(12) + '  ' +
          String(t.status).padEnd(8) + ' → ' + d.mes + ' (' + d.origem + ')');
      });
    }

    // Transação EM ABERTO espalhada por vários meses é NORMAL — são parcelas
    // futuras. O que seria erro é cair numa fatura JÁ FECHADA.
    var mesesFechados = {};
    ctx.faturas.forEach(function (b) {
      if (!b || !b.dueDate) return;
      var dv = new Date(b.dueDate);
      if (!isNaN(dv.getTime())) mesesFechados[_mesKey(dv.getUTCFullYear(), dv.getUTCMonth())] = true;
    });

    var pendPorMes = {}, pendEmFechada = 0;
    txs.filter(function (t) { return t.status === 'PENDING'; }).forEach(function (t) {
      var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech, ctx.diaVenc);
      pendPorMes[d.mes] = (pendPorMes[d.mes] || 0) + 1;
      if (mesesFechados[d.mes]) pendEmFechada++;
    });

    if (Object.keys(pendPorMes).length) {
      p('');
      p('   EM ABERTO por mês: ' + JSON.stringify(pendPorMes));
      if (pendEmFechada) {
        p('   ⚠️  ' + pendEmFechada + ' transação(ões) em aberto caíram numa fatura JÁ FECHADA.');
        p('      Isso é erro de atribuição de mês.');
      } else {
        p('   ✅ Nenhuma em fatura já fechada. Espalhar por vários meses é normal:');
        p('      são parcelas futuras.');
      }
    }
  });

  p('');
  p('════════════════════════════════════════════════════');
  p('Nada foi escrito. Se os totais batem com o app do banco, siga.');

  return log.join('\n');
}

/**
 * Investiga a diferença entre o nosso total e o do banco num mês específico.
 *
 * A fatura do banco pode incluir ENCARGOS (IOF, seguro, anuidade, juros) que
 * não vêm como transação no extrato. O campo `financeCharges` do objeto bill
 * lista esses lançamentos — é a primeira suspeita quando falta valor.
 *
 *   investigarMes("2026-06")
 */
function investigarMes(mesAlvo) {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  if (!mesAlvo || !/^\d{4}-\d{2}$/.test(mesAlvo)) {
    p('Use: investigarMes("2026-06")');
    return log.join('\n');
  }

  var hoje = new Date();
  var de = _isoData(new Date(hoje.getTime() - JANELA_DIAS_ATRAS * 86400000));
  var ate = _isoData(new Date(hoje.getTime() + JANELA_DIAS_FRENTE * 86400000));

  p('=== INVESTIGAÇÃO DE ' + mesAlvo + ' ===');

  _contasComContexto().forEach(function (ctx) {
    var c = ctx.conta;

    var fatura = null;
    ctx.faturas.forEach(function (b) {
      if (!b || !b.dueDate) return;
      var dv = new Date(b.dueDate);
      if (isNaN(dv.getTime())) return;
      if (_mesKey(dv.getUTCFullYear(), dv.getUTCMonth()) === mesAlvo) fatura = b;
    });

    p('');
    p('💳 ' + (c.name || '?'));
    if (!fatura) { p('   (sem fatura fechada com vencimento neste mês)'); return; }

    p('   Fatura: vence ' + String(fatura.dueDate).slice(0, 10) +
      ' · fecha ' + String(fatura.billClosingDate || '?').slice(0, 10));
    p('   Total segundo o banco: ' + _fmt(fatura.totalAmount));

    var txs = pluggyTransacoes(c.id, de, ate).filter(function (t) {
      return _derivarMes(t, ctx.mapaFaturas, ctx.diaFech, ctx.diaVenc).mes === mesAlvo;
    });

    var compras = 0, pagtos = 0, estornos = 0;
    txs.forEach(function (t) {
      var v = Number(t.amount || 0), tp = _tipoTransacao(t);
      if (tp === 'PAGAMENTO') pagtos += v;
      else if (tp === 'ESTORNO') estornos += v;
      else compras += v;
    });

    p('');
    p('   NOSSO CÁLCULO (' + txs.length + ' transações):');
    p('     compras:  ' + _fmt(compras));
    p('     estornos: ' + _fmt(estornos));
    p('     subtotal: ' + _fmt(compras + estornos) + '   ← comparado com o banco');
    p('     (pagamento, fora do total: ' + _fmt(pagtos) + ')');

    var dif = (compras + estornos) - Number(fatura.totalAmount || 0);
    p('');
    p('   DIFERENÇA: ' + _fmt(dif) + (Math.abs(dif) < 0.01 ? '  ✅ bate' : '  ⚠️'));

    if (Math.abs(dif) >= 0.01) {
      // Encargos entram no total da fatura mas costumam não vir como transação.
      var enc = fatura.financeCharges || [];
      p('');
      p('   ENCARGOS NA FATURA (financeCharges): ' + enc.length);
      var somaEnc = 0;
      enc.forEach(function (e) {
        somaEnc += Number(e.amount || 0);
        p('     ' + String(e.type || e.name || '?').padEnd(28) + _fmt(e.amount));
      });
      if (enc.length) {
        p('     ' + 'SOMA'.padEnd(28) + _fmt(somaEnc));
        var difComEnc = dif + somaEnc;
        p('');
        p('   Diferença considerando encargos: ' + _fmt(difComEnc) +
          (Math.abs(difComEnc) < 0.01 ? '  ✅ EXPLICADO pelos encargos' : '  ⚠️ ainda sobra'));
      } else {
        p('     (nenhum encargo listado — a diferença é outra coisa)');
      }

      // Campos extras do bill que podem explicar o resto.
      p('');
      p('   OUTROS CAMPOS DA FATURA:');
      ['minimumPayment', 'totalAmountCurrencyCode', 'allowsInstallments'].forEach(function (k) {
        if (fatura[k] !== undefined) p('     ' + k + ': ' + JSON.stringify(fatura[k]));
      });
      if (fatura.payments && fatura.payments.length) {
        p('     payments: ' + fatura.payments.length + ' registro(s)');
        fatura.payments.forEach(function (pg) {
          p('       ' + String(pg.dueDate || pg.date || '?').slice(0, 10) + '  ' + _fmt(pg.amount || pg.valuePaid));
        });
      }

      // As maiores transações ajudam a bater o olho com a fatura do app.
      p('');
      p('   MAIORES LANÇAMENTOS DO MÊS (para conferir no app do banco):');
      txs.slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); })
        .slice(0, 10).forEach(function (t) {
          p('     ' + String(t.date).slice(0, 10) + '  ' +
            String(t.description || '').slice(0, 30).padEnd(30) + _fmt(t.amount));
        });
    }
  });

  p('');
  p('Nada foi escrito na planilha.');
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
      return _derivarMes(t, ctx.mapaFaturas, ctx.diaFech, ctx.diaVenc).mes === mesAlvo;
    }).sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

    p('');
    p('💳 ' + (c.name || '?') + ' — ' + txs.length + ' transações');
    if (!txs.length) return;

    var soma = 0;
    txs.forEach(function (t) {
      var tp = _tipoTransacao(t);
      if (tp !== 'PAGAMENTO') soma += Number(t.amount || 0);
      var d = _derivarMes(t, ctx.mapaFaturas, ctx.diaFech, ctx.diaVenc);
      var mm = t.creditCardMetadata || {};
      var parc = mm.totalInstallments > 1
        ? ' [' + mm.installmentNumber + '/' + mm.totalInstallments + ']' : '';
      p('  ' + String(t.date).slice(0, 10) + '  ' +
        String(t.description || '').slice(0, 30).padEnd(30) +
        _fmt(t.amount).padStart(12) + '  ' +
        String(t.status).padEnd(8) + String(d.origem).padEnd(9) +
        (tp === 'PAGAMENTO' ? '(fora do total)' : parc));
    });

    // Total do banco lado a lado, para achar o lançamento que falta.
    var banco = null;
    ctx.faturas.forEach(function (b) {
      if (!b || !b.dueDate) return;
      var dv = new Date(b.dueDate);
      if (!isNaN(dv.getTime()) && _mesKey(dv.getUTCFullYear(), dv.getUTCMonth()) === mesAlvo) {
        banco = Number(b.totalAmount || 0);
      }
    });

    p('  ' + ''.padEnd(30) + '  ── NOSSO TOTAL: ' + _fmt(soma));
    if (banco !== null) {
      p('  ' + ''.padEnd(30) + '     BANCO:       ' + _fmt(banco));
      var dif = soma - banco;
      p('  ' + ''.padEnd(30) + '     DIFERENÇA:   ' + _fmt(dif) +
        (Math.abs(dif) < 0.01 ? '  ✅' : '  ⚠️ procure na fatura do app um lançamento de ' + _fmt(-dif)));
    }
  });

  p('');
  p('Compare a lista com a fatura no app do Itaú para achar o que falta.');
  return log.join('\n');
}
