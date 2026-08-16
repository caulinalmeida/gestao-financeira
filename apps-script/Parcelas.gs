/**
 * Diagnóstico das compras parceladas.
 *
 * Existe por causa de um erro real: compras cujas parcelas foram ADIANTADAS
 * continuavam sendo projetadas para o futuro pelo app. Há duas formas de o
 * banco representar uma antecipação, e elas pedem correções diferentes:
 *
 *   A) as parcelas restantes aparecem TODAS na fatura da antecipação
 *      (ex.: 03/10 até 10/10 juntas em agosto)
 *      → o app já lida: a âncora vira a última parcela e nada é projetado
 *
 *   B) as parcelas simplesmente PARAM de aparecer, e entra um lançamento
 *      avulso de antecipação
 *      → o app projeta parcelas fantasma a partir da última conhecida
 *
 * Esta função mostra qual é o caso, compra por compra. Não escreve nada.
 *
 *   investigarParcelas()      todas as compras parceladas, agrupadas
 *   investigarParcelaAlvo()   só as que casam com a propriedade PARCELA_ALVO
 *                             (ex.: PARCELA_ALVO = SAMSUNG)
 */

// Reusa a normalização do Sync.gs — é a mesma do App.jsx, e ter duas cópias
// já causou divergência antes (a segunda saiu com os acentos literais).
// Função, não `var`: assim a resolução acontece na chamada, e não depende da
// ordem em que o Apps Script avalia os arquivos.
function _normDesc(s) { return _normalizar(s); }

/** Mesma chave de agrupamento que o App.jsx usa (chaveCompra). */
function _chaveCompra(conta, desc, parcTotal, valorTotal, valor) {
  var total = Number(valorTotal) || (Number(valor) * Number(parcTotal));
  return conta + '|' + _normDesc(desc) + '|' + parcTotal + '|' + Math.round(total);
}

function investigarParcelas() { return _investigarParcelas(null); }

function investigarParcelaAlvo() {
  var alvo = _prop('PARCELA_ALVO', false);
  if (!alvo) {
    throw new Error(
      'Defina a propriedade do script PARCELA_ALVO com um pedaço da descrição.\n\n' +
      '  ⚙ Configurações do projeto → Propriedades do script\n' +
      '  PARCELA_ALVO = SAMSUNG\n\n' +
      'Ou rode investigarParcelas() para ver todas.'
    );
  }
  return _investigarParcelas(_normDesc(alvo));
}

function _investigarParcelas(filtro) {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var n = COLS_TRANSACOES.length;
  var s = aba(ABA_TRANSACOES, COLS_TRANSACOES);
  var linhas = lerLinhas(s, n);

  var iId = col(COLS_TRANSACOES, 'pluggy_tx_id');
  var iConta = col(COLS_TRANSACOES, 'account_id');
  var iMes = col(COLS_TRANSACOES, 'mes_ref');
  var iTipo = col(COLS_TRANSACOES, 'tipo');
  var iData = col(COLS_TRANSACOES, 'data');
  var iDesc = col(COLS_TRANSACOES, 'descricao');
  var iValor = col(COLS_TRANSACOES, 'valor');
  var iStatus = col(COLS_TRANSACOES, 'status');
  var iPNum = col(COLS_TRANSACOES, 'parcela_num');
  var iPTot = col(COLS_TRANSACOES, 'parcela_total');
  var iVTot = col(COLS_TRANSACOES, 'valor_total');

  // Nomes dos cartões, para o relatório ficar legível.
  var nomes = {};
  lerLinhas(aba(ABA_CARTOES, COLS_CARTOES), COLS_CARTOES.length).forEach(function (c) {
    nomes[String(c[0])] = String(c[2] || '') + (c[3] ? ' ·' + c[3] : '');
  });

  var grupos = {};
  var mesMaisRecente = '';
  var suspeitas = [];

  linhas.forEach(function (l) {
    if (!l[iId]) return;
    var mes = String(l[iMes] || '');
    if (mes > mesMaisRecente) mesMaisRecente = mes;

    var desc = String(l[iDesc] || '');
    // Lançamentos que cheiram a antecipação/quitação, parcelados ou não.
    if (/ANTECIP|ADIANT|QUITA|LIQUIDA/.test(_normDesc(desc))) {
      suspeitas.push({ mes: mes, data: String(l[iData]), desc: desc,
        valor: Number(l[iValor]) || 0, tipo: String(l[iTipo] || '') });
    }

    var pt = parseInt(l[iPTot], 10) || 0;
    var pn = parseInt(l[iPNum], 10) || 0;
    if (pt <= 1 || pn <= 0) return;
    if (String(l[iTipo] || 'COMPRA').toUpperCase() !== 'COMPRA') return;

    var normalizada = _normDesc(desc);
    if (filtro && normalizada.indexOf(filtro) === -1) return;

    var k = _chaveCompra(String(l[iConta]), desc, pt, l[iVTot], l[iValor]);
    if (!grupos[k]) {
      grupos[k] = { desc: desc, conta: String(l[iConta]), parcTotal: pt,
        valorTotal: Number(l[iVTot]) || 0, parcelas: [] };
    }
    grupos[k].parcelas.push({ num: pn, mes: mes, data: String(l[iData]),
      valor: Number(l[iValor]) || 0, status: String(l[iStatus] || '') });
  });

  var chaves = Object.keys(grupos);
  p('=== COMPRAS PARCELADAS EM OF_TRANSACOES ===');
  p('Mês mais recente com dados: ' + mesMaisRecente);
  p('Compras encontradas: ' + chaves.length + (filtro ? '  (filtro: ' + filtro + ')' : ''));
  p('');

  if (!chaves.length) {
    p('Nenhuma. Rodou sincronizarAgora() antes?');
    return log.join('\n');
  }

  // Ordena pela última parcela conhecida, do mais antigo para o mais novo:
  // as compras problemáticas — âncora velha — aparecem primeiro.
  chaves.sort(function (a, b) {
    var ua = _ultimaDe(grupos[a]), ub = _ultimaDe(grupos[b]);
    return ua.mes === ub.mes ? 0 : (ua.mes < ub.mes ? -1 : 1);
  });

  chaves.forEach(function (k) {
    var g = grupos[k];
    g.parcelas.sort(function (a, b) { return a.num - b.num; });
    var ultima = _ultimaDe(g);
    var vistos = {};
    var duplicadas = [], numeros = [];
    g.parcelas.forEach(function (x) {
      if (vistos[x.num]) duplicadas.push(x.num);
      vistos[x.num] = true;
      numeros.push(x.num);
    });
    var faltando = [];
    for (var i = 1; i <= g.parcTotal; i++) if (!vistos[i]) faltando.push(i);

    // Quantas parcelas caíram no MESMO mês da última: é a assinatura do caso A.
    var noMesmoMes = g.parcelas.filter(function (x) { return x.mes === ultima.mes; }).length;

    p('── ' + g.desc);
    p('   cartão: ' + (nomes[g.conta] || g.conta));
    p('   parcelas: ' + g.parcelas.length + ' de ' + g.parcTotal +
      '   valor total: ' + _fmt(g.valorTotal));
    p('   conhecidas: ' + numeros.map(function (x) { return _pad2(x); }).join(', '));
    if (faltando.length) p('   ⚠️ FALTANDO: ' + faltando.map(_pad2).join(', '));
    if (duplicadas.length) p('   ⚠️ DUPLICADAS: ' + duplicadas.join(', '));
    g.parcelas.forEach(function (x) {
      p('     ' + _pad2(x.num) + '/' + _pad2(g.parcTotal) + '  ' + x.mes +
        '  ' + x.data + '  ' + _fmt(x.valor) + '  ' + x.status);
    });

    // O veredito, que é o que interessa.
    if (ultima.num >= g.parcTotal) {
      p('   ✅ COMPLETA — a última parcela existe, o app não projeta nada.');
      if (noMesmoMes > 1) {
        p('      ' + noMesmoMes + ' parcelas no mesmo mês (' + ultima.mes +
          '): parece ANTECIPAÇÃO do tipo A, e o app já trata.');
      }
    } else {
      var atraso = _distanciaMeses(ultima.mes, mesMaisRecente);
      p('   → o app projeta ' + (g.parcTotal - ultima.num) +
        ' parcela(s) a partir de ' + ultima.mes);
      if (atraso >= 2) {
        p('      🚨 SUSPEITO: a última parcela é de ' + ultima.mes + ', ' + atraso +
          ' meses atrás do mês mais recente (' + mesMaisRecente + ').');
        p('      Um parcelamento ativo cairia todo mês. Provável ANTECIPAÇÃO tipo B');
        p('      — as parcelas pararam de vir e o app está projetando fantasma.');
      }
    }
    p('');
  });

  p('=== LANÇAMENTOS QUE PARECEM ANTECIPAÇÃO/QUITAÇÃO ===');
  if (!suspeitas.length) {
    p('Nenhum lançamento com ANTECIP/ADIANT/QUITA/LIQUIDA na descrição.');
    p('Se houve antecipação, ela NÃO tem nome óbvio — o que reforça o tipo B.');
  } else {
    suspeitas.forEach(function (x) {
      p('  ' + x.mes + '  ' + x.data + '  ' + _fmt(x.valor) + '  [' + x.tipo + ']  ' + x.desc);
    });
  }

  return log.join('\n');
}

function _ultimaDe(g) {
  return g.parcelas.reduce(function (a, x) { return x.num > a.num ? x : a; }, g.parcelas[0]);
}

/** Distância em meses entre duas chaves ANO-MÊS. */
function _distanciaMeses(de, ate) {
  var a = String(de).split('-'), b = String(ate).split('-');
  if (a.length !== 2 || b.length !== 2) return 0;
  return (parseInt(b[0], 10) - parseInt(a[0], 10)) * 12 +
         (parseInt(b[1], 10) - parseInt(a[1], 10));
}
