/**
 * Por que uma compra que está na fatura do banco não está na fatura do app?
 *
 * Existem TRÊS causas possíveis, e elas pedem correções opostas — então o
 * primeiro trabalho é separá-las:
 *
 *   A. LACUNA DO PLUGGY   o Pluggy não tem a transação. Nada no nosso código
 *                         resolve; é esperar ou atualizar em meu.pluggy.ai.
 *   B. MÊS ERRADO         temos a transação, gravada em outro mes_ref. Ela não
 *                         sumiu: está em outra aba do seletor de mês.
 *   C. PERDA NA ESCRITA   o Pluggy tem, nós não gravamos. Bug nosso, no
 *                         filtro / janela / piso de gravarTransacoes.
 *
 * Confundir B com C custa caro: em B o dado está salvo e o conserto é de
 * regra; em C o dado foi descartado.
 *
 * investigarFaturaSumida() responde qual das três é, confrontando o que o
 * Pluggy entrega AGORA com o que está em OF_TRANSACOES, transação a transação.
 *
 * Não escreve nada.
 */

// Janela da investigação. Ampla o bastante para cobrir o ciclo inteiro em
// volta do fechamento, que é onde os erros de mês se concentram.
var INVESTIGACAO_DIAS_ATRAS = 75;
var INVESTIGACAO_DIAS_FRENTE = 5;

function investigarFaturaSumida() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var hoje = new Date();
  var de = _isoData(new Date(hoje.getTime() - INVESTIGACAO_DIAS_ATRAS * 86400000));
  var ate = _isoData(new Date(hoje.getTime() + INVESTIGACAO_DIAS_FRENTE * 86400000));

  p('=== POR QUE A COMPRA NÃO ESTÁ NA FATURA DO APP? ===');
  p('Hoje: ' + _isoData(hoje) + '   janela investigada: ' + de + ' a ' + ate);
  p('Piso de histórico (MES_MINIMO): ' + (MES_MINIMO || '(desligado)'));
  p('');

  var iId = col(COLS_TRANSACOES, 'pluggy_tx_id');
  var iConta = col(COLS_TRANSACOES, 'account_id');
  var iMes = col(COLS_TRANSACOES, 'mes_ref');
  var iData = col(COLS_TRANSACOES, 'data');
  var iDesc = col(COLS_TRANSACOES, 'descricao');
  var iVal = col(COLS_TRANSACOES, 'valor');

  var naPlanilha = {};
  lerLinhas(aba(ABA_TRANSACOES, COLS_TRANSACOES), COLS_TRANSACOES.length)
    .forEach(function (l) { if (l[iId]) naPlanilha[String(l[iId])] = l; });
  p('Transações hoje em ' + ABA_TRANSACOES + ': ' + Object.keys(naPlanilha).length);
  p('');

  pluggyItems().ids.forEach(function (itemId) {
    pluggyContasCredito(itemId).forEach(function (c) {
      var cd = c.creditData || {};
      var faturas = pluggyFaturas(c.id);

      var mapaFaturas = {};
      faturas.forEach(function (b) {
        if (b && b.id && b.dueDate) mapaFaturas[b.id] = b.dueDate;
      });
      var diaFech = _diaFechamento(cd, faturas);
      var diaVenc = _diaVencimento(cd, faturas);

      p('════════════════════════════════════════════════════');
      p('💳 ' + (c.name || c.marketingName || c.id) +
        (c.number ? ' ·' + String(c.number).slice(-4) : ''));
      p('');

      // O dia de fechamento decide o mês de TODA compra sem billId. Se ele
      // mudar de valor, meses inteiros migram de aba sem que nada mais mude —
      // por isso ele é a primeira coisa impressa.
      p('   CICLO EM USO AGORA');
      p('     dia de fechamento: ' + (diaFech || '❌ desconhecido') +
        (cd.balanceCloseDate ? '  (de balanceCloseDate)'
                             : '  (derivado do billClosingDate das faturas)'));
      p('     dia de vencimento: ' + (diaVenc || '❌ desconhecido'));
      p('     -> compra no dia >= ' + diaFech + ' cai na fatura do mês seguinte');
      p('');

      p('   FATURAS QUE O PLUGGY ENTREGA (' + faturas.length + ')');
      faturas.slice().sort(function (a, b) {
        return String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
      }).forEach(function (b) {
        var venc = b.dueDate ? new Date(b.dueDate) : null;
        var mes = venc && !isNaN(venc.getTime())
          ? _mesKey(venc.getUTCFullYear(), venc.getUTCMonth()) : '?';
        p('     ' + mes + '  fecha ' + String(b.billClosingDate || '—').slice(0, 10) +
          '  vence ' + String(b.dueDate || '—').slice(0, 10) +
          '  total ' + Number(b.totalAmount || 0).toFixed(2) +
          (_antesDoPiso(mes) ? '   ⛔ abaixo do piso' : ''));
      });
      p('');

      var txs = pluggyTransacoes(c.id, de, ate);
      p('   O PLUGGY ENTREGOU ' + txs.length + ' TRANSAÇÕES NA JANELA');
      p('');

      var porMes = {}, faltando = [], divergindo = [], cortadas = [];
      var linhas = [];

      txs.forEach(function (tx) {
        var m = _derivarMes(tx, mapaFaturas, diaFech, diaVenc);
        var dataIso = _isoData(new Date(tx.date));
        var meta = tx.creditCardMetadata || {};
        var existe = naPlanilha[String(tx.id)];

        porMes[m.mes] = (porMes[m.mes] || 0) + 1;

        var estado;
        if (_antesDoPiso(m.mes)) { estado = '⛔ CORTADA PELO PISO'; cortadas.push(tx); }
        else if (!existe) { estado = '❌ NÃO ESTÁ NA PLANILHA'; faltando.push(tx); }
        else if (_mesRefTexto(existe[iMes]) !== m.mes) {
          estado = '⚠️ planilha diz ' + _mesRefTexto(existe[iMes]);
          divergindo.push(tx);
        } else estado = 'ok';

        linhas.push({
          data: dataIso, mes: m.mes, origem: m.origem,
          bill: meta.billId ? String(meta.billId).slice(0, 8) : '—',
          valor: Number(tx.amount || 0),
          desc: String(tx.description || tx.descriptionRaw || '').slice(0, 28),
          estado: estado
        });
      });

      // Ordenado por data: é assim que a fronteira aparece. Se as compras até
      // certo dia caem num mês e o resto noutro, o problema é o ciclo — e o
      // corte fica visível a olho nu nesta lista.
      linhas.sort(function (a, b) { return a.data.localeCompare(b.data); });

      p('   data        mês      regra    bill     valor      descrição');
      var mesAnterior = null;
      linhas.forEach(function (r) {
        if (mesAnterior !== null && r.mes !== mesAnterior) {
          p('     ─────── fronteira: ' + mesAnterior + ' → ' + r.mes + ' ───────');
        }
        mesAnterior = r.mes;
        p('     ' + r.data + '  ' + r.mes + '  ' + _pad(r.origem, 9) +
          _pad(r.bill, 9) + _pad(r.valor.toFixed(2), 10) + r.desc +
          (r.estado === 'ok' ? '' : '   ' + r.estado));
      });
      p('');

      p('   RESUMO POR MÊS (do que o Pluggy entregou na janela):');
      Object.keys(porMes).sort().forEach(function (m) {
        p('     ' + m + ': ' + porMes[m]);
      });
      p('');

      var orfas = 0;
      Object.keys(naPlanilha).forEach(function (id) {
        var l = naPlanilha[id];
        if (String(l[iConta]) !== String(c.id)) return;
        var d = _isoDataCelula(l[iData]);
        if (d < de || d > ate) return;
        var achou = txs.some(function (t) { return String(t.id) === id; });
        if (achou) return;
        if (orfas === 0) p('   NA PLANILHA MAS NÃO MAIS NO PLUGGY:');
        orfas++;
        if (orfas <= 10) {
          p('     ' + d + '  ' + _mesRefTexto(l[iMes]) + '  ' +
            String(l[iDesc]).slice(0, 28) + '  ' + l[iVal]);
        }
      });
      if (orfas > 10) p('     ... e mais ' + (orfas - 10));
      if (orfas === 0) p('   (nada órfão: tudo que temos o Pluggy ainda confirma)');
      p('');

      p('   ═══ VEREDITO ═══');
      if (cortadas.length) {
        p('   ⛔ ' + cortadas.length + ' transação(ões) CORTADAS PELO PISO MES_MINIMO=' + MES_MINIMO);
        p('      O Pluggy tem e nós descartamos na gravação, por caírem em mês');
        p('      anterior ao piso. Se pertencem à fatura atual, o mês derivado');
        p('      está errado — veja a coluna "regra" acima.');
      }
      if (faltando.length) {
        p('   ❌ ' + faltando.length + ' transação(ões) que o Pluggy TEM e nós NÃO gravamos.');
        p('      Causa C: perda na escrita. Rode sincronizarAgora() e repita;');
        p('      se persistir, o filtro de gravarTransacoes é o suspeito.');
      }
      if (divergindo.length) {
        p('   ⚠️ ' + divergindo.length + ' gravada(s) com mês diferente do que a regra dá agora.');
        p('      Causa B: o mês mudou entre dois syncs — quase sempre porque o');
        p('      dia de fechamento mudou de valor, ou porque a fatura fechou e');
        p('      o billId passou a existir. NÃO sumiram: estão no outro mês.');
        p('      sincronizarAgora() realinha.');
      }
      if (!cortadas.length && !faltando.length && !divergindo.length) {
        p('   ✅ Tudo que o Pluggy entregou está gravado, no mês que a regra manda.');
        p('      Se ainda falta compra na tela, ela não chegou ao Pluggy (causa A):');
        p('      confira a última visita com diagnosticoOpenFinance().');
      }
      p('');
    });
  });

  return log.join('\n');
}

function _pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/** A célula de data pode voltar como Date; normaliza para ISO antes de comparar. */
function _isoDataCelula(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return _isoData(v);
  }
  return String(v || '').slice(0, 10);
}

/**
 * A paginação do /v2/transactions está trazendo TUDO?
 *
 * Suspeita levantada por dados reais: a fatura de setembro veio sem nenhuma
 * compra entre 03/08 e 09/08, enquanto a conta Platinum — que tem UMA
 * transação no período todo — trouxe a dela normalmente. Mesmo código, mesma
 * janela: a única diferença entre as contas é o volume, e volume é o que
 * aciona a paginação.
 *
 * Uma página perdida no meio do laço produz exatamente esse sintoma: um buraco
 * CONTÍGUO de datas, sem erro nenhum, porque concat de uma lista vazia é
 * silencioso.
 *
 * Esta função refaz a busca página a página e imprime o que o laço de
 * pluggyTransacoes() esconde: quantas páginas, quantos itens em cada uma, o
 * intervalo de datas de cada página, o `next` cru, e o total que a própria API
 * declara. Se o total declarado for maior que o coletado, o bug é nosso.
 *
 * Não escreve nada.
 */
function conferirPaginacao() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var hoje = new Date();
  var de = _isoData(new Date(hoje.getTime() - INVESTIGACAO_DIAS_ATRAS * 86400000));
  var ate = _isoData(new Date(hoje.getTime() + INVESTIGACAO_DIAS_FRENTE * 86400000));

  p('=== A PAGINAÇÃO ESTÁ TRAZENDO TUDO? ===');
  p('Janela: ' + de + ' a ' + ate);
  p('');

  pluggyItems().ids.forEach(function (itemId) {
    pluggyContasCredito(itemId).forEach(function (c) {
      p('════════════════════════════════════════════════════');
      p('💳 ' + (c.name || c.id) + (c.number ? ' ·' + String(c.number).slice(-4) : ''));

      var caminho = '/v2/transactions';
      var params = { accountId: c.id, dateFrom: de, dateTo: ate };
      var todas = [], pagina = 0, declarado = null, totalPaginas = null;
      var datas = [];

      while (pagina < 100) {
        var r = pluggyGet(caminho, params);
        if (!r.ok) { p('   ❌ HTTP ' + r.code + ' na página ' + (pagina + 1)); break; }

        var b = r.body || {};
        var res = b.results || [];
        pagina++;

        if (pagina === 1) {
          // Os campos de paginação variam entre versões da API. Imprimir as
          // chaves cruas evita supor o nome errado e concluir besteira.
          p('   Campos da resposta: ' + Object.keys(b).join(', '));
          declarado = (b.total !== undefined) ? b.total : null;
          totalPaginas = (b.totalPages !== undefined) ? b.totalPages : null;
        }

        var ds = res.map(function (t) { return _isoData(new Date(t.date)); }).sort();
        datas = datas.concat(ds);
        todas = todas.concat(res);

        p('   página ' + _pad(pagina, 3) + ' itens=' + _pad(res.length, 5) +
          ' datas ' + (ds.length ? ds[0] + ' .. ' + ds[ds.length - 1] : '(vazia)') +
          '  next=' + (b.next ? String(b.next).slice(0, 60) : '(fim)'));

        if (!b.next) break;
        caminho = '/v2/transactions' + (String(b.next).charAt(0) === '?' ? b.next : '?' + b.next);
        params = null;
      }

      p('');
      p('   coletado: ' + todas.length +
        '   declarado pela API: ' + (declarado === null ? '(não informa)' : declarado) +
        '   páginas: ' + pagina + (totalPaginas ? ' de ' + totalPaginas : ''));

      if (declarado !== null && declarado !== todas.length) {
        p('   ❌ FALTAM ' + (declarado - todas.length) + ' TRANSAÇÕES. O laço de');
        p('      pluggyTransacoes() está perdendo página. Bug nosso.');
      } else if (declarado !== null) {
        p('   ✅ Coletado bate com o total declarado pela API.');
      }

      // Buraco contíguo de datas é a assinatura de página perdida. Só vale
      // como pista — dia sem compra também produz intervalo.
      datas.sort();
      var maior = 0, ondeA = '', ondeB = '';
      for (var i = 1; i < datas.length; i++) {
        var dias = Math.round((new Date(datas[i]) - new Date(datas[i - 1])) / 86400000);
        if (dias > maior) { maior = dias; ondeA = datas[i - 1]; ondeB = datas[i]; }
      }
      if (maior > 1) {
        p('   Maior intervalo sem transação: ' + maior + ' dias (' + ondeA + ' → ' + ondeB + ')');
      }
      p('');
    });
  });

  p('Se o coletado bate com o declarado e ainda falta compra na fatura do');
  p('banco, então o Pluggy realmente não tem o dado — e o problema está no');
  p('salto banco → Pluggy, não em nós.');
  return log.join('\n');
}
