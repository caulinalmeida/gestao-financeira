/**
 * O Pluggy não tem o dado, ou nós é que não estamos pedindo direito?
 *
 * Estado da investigação quando este arquivo nasceu:
 *
 *   • dia de fechamento correto (3) e vencimento correto (10) — descartado
 *   • paginação: 1 página, 117 itens, sem `next` — descartado
 *   • tudo que o Pluggy entregou está gravado no mês certo — descartado
 *
 * Sobra um buraco contíguo de 9 dias (02/08 → 10/08) na conta Black, no
 * intervalo entre o FECHAMENTO da fatura de agosto (03/08) e o PAGAMENTO
 * dela (10/08). A conta Platinum tem uma compra em 09/08 e ela veio.
 *
 * Antes de culpar o Pluggy, falta eliminar a última hipótese sob nosso
 * controle: o filtro `dateFrom`/`dateTo` da nossa chamada. Se a API filtra por
 * um campo diferente do `date` que lemos — data de processamento, por exemplo —
 * uma compra de 05/08 processada depois do fechamento cairia fora da janela
 * sem nunca aparecer, e o buraco seria nosso, não dele.
 *
 * sondarLacuna() faz a MESMA pergunta de três formas e compara:
 *
 *   1. com a janela que o sync usa
 *   2. sem filtro de data nenhum
 *   3. com uma janela estreita em cima do buraco
 *
 * Se (2) ou (3) trouxer o que (1) não trouxe, o problema é a nossa chamada e
 * tem conserto. Se os três concordarem, o dado não existe no Pluggy.
 *
 * Não escreve nada.
 */

// O intervalo suspeito. Ajuste se o buraco for outro.
var LACUNA_DE = '2026-08-02';
var LACUNA_ATE = '2026-08-10';

function sondarLacuna() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  p('=== O DADO NÃO EXISTE, OU NÃO PEDIMOS DIREITO? ===');
  p('Buraco investigado: ' + LACUNA_DE + ' a ' + LACUNA_ATE);
  p('');

  var hoje = new Date();
  var janelaDe = _isoData(new Date(hoje.getTime() - INVESTIGACAO_DIAS_ATRAS * 86400000));
  var janelaAte = _isoData(new Date(hoje.getTime() + INVESTIGACAO_DIAS_FRENTE * 86400000));

  pluggyItems().ids.forEach(function (itemId) {
    pluggyContasCredito(itemId).forEach(function (c) {
      p('════════════════════════════════════════════════════');
      p('💳 ' + (c.name || c.id) + (c.number ? ' ·' + String(c.number).slice(-4) : ''));
      p('');

      var formas = [
        { nome: '1. janela do sync', params: { accountId: c.id, dateFrom: janelaDe, dateTo: janelaAte } },
        { nome: '2. SEM filtro de data', params: { accountId: c.id } },
        { nome: '3. só em cima do buraco', params: { accountId: c.id, dateFrom: LACUNA_DE, dateTo: LACUNA_ATE } }
      ];

      var achadosPorForma = {};

      formas.forEach(function (f) {
        var todas = _buscarTudo(f.params);
        if (todas.erro) { p('   ' + f.nome + ': ❌ ' + todas.erro); return; }

        var naLacuna = todas.itens.filter(function (t) {
          var d = _isoData(new Date(t.date));
          return d >= LACUNA_DE && d <= LACUNA_ATE;
        });
        achadosPorForma[f.nome] = naLacuna;

        p('   ' + _pad(f.nome, 26) + ' total=' + _pad(todas.itens.length, 6) +
          ' páginas=' + _pad(todas.paginas, 4) + ' no buraco=' + naLacuna.length);
      });
      p('');

      // O que a forma mais permissiva achou dentro do buraco. Se aparecer algo
      // aqui que a janela do sync não trouxe, o conserto é na nossa chamada.
      var melhor = achadosPorForma['2. SEM filtro de data'] ||
                   achadosPorForma['3. só em cima do buraco'] || [];
      if (melhor.length) {
        p('   TRANSAÇÕES ENCONTRADAS DENTRO DO BURACO:');
        melhor.forEach(function (t) {
          p('     ' + _isoData(new Date(t.date)) + '  ' +
            Number(t.amount || 0).toFixed(2) + '  ' +
            String(t.description || t.descriptionRaw || '').slice(0, 40) +
            '  status=' + (t.status || '?'));
        });
      } else {
        p('   Nenhuma transação no buraco, por nenhuma das três formas.');
      }
      p('');

      // Todos os campos de UMA transação. Se existir um segundo campo de data
      // (processamento, criação), é por ele que a API pode estar filtrando —
      // e é o que explicaria o buraco sem haver perda de dado.
      var amostra = _buscarTudo({ accountId: c.id, dateFrom: '2026-08-10', dateTo: '2026-08-14' });
      if (!amostra.erro && amostra.itens.length) {
        var t0 = amostra.itens[0];
        p('   CAMPOS DE UMA TRANSAÇÃO REAL (procurando outra data):');
        Object.keys(t0).sort().forEach(function (k) {
          var v = t0[k];
          if (v === null || v === undefined || v === '') return;
          if (typeof v === 'object') v = JSON.stringify(v);
          p('     ' + _pad(k, 22) + String(v).slice(0, 90));
        });
      }
      p('');
    });
  });

  p('LEITURA DO RESULTADO');
  p('  • formas 2/3 acham o que a 1 não achou  -> nossa chamada está errada');
  p('  • as três concordam em zero             -> o Pluggy não tem o dado');
  p('     e aí o gargalo é banco -> Pluggy, fora do nosso alcance.');
  return log.join('\n');
}

/** Busca paginada crua, sem as regras do sync. Devolve {itens, paginas, erro}. */
function _buscarTudo(params) {
  var todas = [], paginas = 0;
  var caminho = '/v2/transactions';
  var p = params;

  while (paginas < 100) {
    var r = pluggyGet(caminho, p);
    if (!r.ok) return { erro: 'HTTP ' + r.code, itens: todas, paginas: paginas };
    var b = r.body || {};
    todas = todas.concat(b.results || []);
    paginas++;
    if (!b.next) break;
    caminho = '/v2/transactions' + (String(b.next).charAt(0) === '?' ? b.next : '?' + b.next);
    p = null;
  }
  return { itens: todas, paginas: paginas, erro: null };
}
