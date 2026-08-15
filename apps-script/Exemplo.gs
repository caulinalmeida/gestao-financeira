/**
 * Dados de exemplo — para construir e testar a interface sem depender do Pluggy.
 *
 * Preenche OF_TRANSACOES e OF_CARTOES com transações realistas de dois cartões
 * Itaú, cobrindo todos os casos que a tela precisa tratar:
 *
 *   • fatura FECHADA (POSTED) e fatura ABERTA (PENDING)
 *   • compras parceladas em andamento, com parcelas futuras a projetar
 *   • assinaturas recorrentes
 *   • estorno (valor negativo)
 *   • pagamento da fatura anterior (negativo e grande)
 *   • comerciante desconhecido, que deve cair como "NOVO" no dicionário
 *   • as três regras de derivação de mês (BILL, FORECAST, ESTIMADO)
 *
 * COMO USAR
 *   popularDadosExemplo()   escreve os dados de exemplo
 *   limparDadosExemplo()    remove tudo que tem marcação de exemplo
 *
 * ⚠️ Só escreve em OF_TRANSACOES e OF_CARTOES. Nunca toca nas abas do app.
 * Rodar sincronizarAgora() depois substitui isto pelos dados reais, já que
 * a janela de sincronização é reescrita por inteiro.
 */

var PREFIXO_EXEMPLO = 'exemplo-';

var CARTOES_EXEMPLO = [
  { account_id: 'exemplo-acc-black',    nome: 'Uniclass Black',    ultimos_digitos: '4417', limite: 32000, fechamento_dia: 18 },
  { account_id: 'exemplo-acc-platinum', nome: 'Uniclass Platinum+', ultimos_digitos: '9023', limite: 14000, fechamento_dia: 18 }
];

function _mesRelativo(offset) {
  var d = new Date();
  var ano = d.getFullYear(), mes = d.getMonth() + offset;
  while (mes < 0)  { mes += 12; ano -= 1; }
  while (mes > 11) { mes -= 12; ano += 1; }
  return { chave: ano + '-' + _pad2(mes + 1), ano: ano, mes: mes };
}

function _dataNo(mesInfo, dia) {
  return mesInfo.ano + '-' + _pad2(mesInfo.mes + 1) + '-' + _pad2(dia);
}

function popularDadosExemplo() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var mesPassado = _mesRelativo(-1);   // fatura fechada
  var mesAtual   = _mesRelativo(0);    // fatura fechada mais recente
  var mesProximo = _mesRelativo(1);    // fatura em aberto

  var black = CARTOES_EXEMPLO[0].account_id;
  var plat  = CARTOES_EXEMPLO[1].account_id;

  // [conta, dia, descrição, valor, status, origem_mes, mesRef, parcNum, parcTot, valorTotal]
  var base = [
    // ── Fatura FECHADA do mês passado (BILL) ──────────────────────────────
    [black, 3,  'NETFLIX.COM',                 55.90,  'POSTED', 'BILL', mesPassado, '', '', ''],
    [black, 5,  'SPOTIFY',                     34.90,  'POSTED', 'BILL', mesPassado, '', '', ''],
    [black, 7,  'IFOOD *RESTAURANTE SUSHI',   128.40,  'POSTED', 'BILL', mesPassado, '', '', ''],
    [black, 9,  'DROGARIA SAO PAULO',          87.15,  'POSTED', 'BILL', mesPassado, '', '', ''],
    [black, 11, 'MAGAZINE LUIZA',             249.90,  'POSTED', 'BILL', mesPassado, 2, 10, 2499.00],
    [black, 14, 'UBER *TRIP',                  32.70,  'POSTED', 'BILL', mesPassado, '', '', ''],
    [plat,  6,  'CARREFOUR',                  412.83,  'POSTED', 'BILL', mesPassado, '', '', ''],
    [plat,  12, 'POSTO IPIRANGA',             280.00,  'POSTED', 'BILL', mesPassado, '', '', ''],

    // ── Fatura FECHADA do mês atual (BILL) ────────────────────────────────
    [black, 2,  'NETFLIX.COM',                 55.90,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [black, 4,  'SPOTIFY',                     34.90,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [black, 6,  'AMAZON PRIME BR',             19.90,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [black, 8,  'MAGAZINE LUIZA',             249.90,  'POSTED', 'BILL', mesAtual, 3, 10, 2499.00],
    [black, 10, 'IFOOD *PIZZARIA',             94.60,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [black, 12, 'DECOLAR.COM',                583.33,  'POSTED', 'BILL', mesAtual, 1, 6,  3499.98],
    [black, 13, 'ESTORNO IFOOD *PIZZARIA',    -94.60,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [black, 15, 'PGTO FATURA ANTERIOR',      -1240.00, 'POSTED', 'BILL', mesAtual, '', '', ''],
    [black, 16, 'PETZ SAO BERNARDO',          156.70,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [plat,  5,  'CARREFOUR',                  389.44,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [plat,  9,  'FARMACIA PAGUE MENOS',        62.30,  'POSTED', 'BILL', mesAtual, '', '', ''],
    [plat,  14, 'POSTO IPIRANGA',             310.00,  'POSTED', 'BILL', mesAtual, '', '', ''],

    // ── Fatura EM ABERTO (PENDING / FORECAST) ─────────────────────────────
    [black, 19, 'NETFLIX.COM',                 55.90,  'PENDING', 'FORECAST', mesProximo, '', '', ''],
    [black, 20, 'MAGAZINE LUIZA',             249.90,  'PENDING', 'FORECAST', mesProximo, 4, 10, 2499.00],
    [black, 21, 'DECOLAR.COM',                583.33,  'PENDING', 'FORECAST', mesProximo, 2, 6,  3499.98],
    [black, 22, 'IFOOD *HAMBURGUERIA',         76.20,  'PENDING', 'FORECAST', mesProximo, '', '', ''],
    [black, 23, 'LOJA QUE NUNCA COMPREI XYZ',  49.99,  'PENDING', 'CICLO', mesProximo, '', '', ''],
    [plat,  20, 'CARREFOUR',                  201.55,  'PENDING', 'FORECAST', mesProximo, '', '', ''],
    [plat,  24, 'UBER *TRIP',                  28.40,  'PENDING', 'CICLO', mesProximo, '', '', '']
  ];

  var agora = new Date();
  var linhas = base.map(function (r, i) {
    var conta = r[0], dia = r[1], desc = r[2], valor = r[3];
    var status = r[4], origemMes = r[5], mesInfo = r[6];
    var parcNum = r[7], parcTot = r[8], valorTot = r[9];

    var data = _dataNo(mesInfo, dia);
    var dataCompra = '';
    if (parcNum && parcNum > 1) {
      // Compra original: parcNum-1 meses antes.
      var mi = _mesRelativo(-(parcNum - 1) + (mesInfo === mesProximo ? 1 : (mesInfo === mesPassado ? -1 : 0)));
      dataCompra = _dataNo(mi, dia);
    } else if (parcNum === 1) {
      dataCompra = data;
    }

    var reg = {
      pluggy_tx_id: PREFIXO_EXEMPLO + 'tx-' + _pad2(i + 1),
      account_id: conta,
      mes_ref: mesInfo.chave,
      origem_mes: origemMes,
      tipo: _tipoTransacao({ description: desc, amount: valor }),
      data: data,
      descricao: desc,
      valor: valor,
      status: status,
      bill_id: status === 'POSTED' ? PREFIXO_EXEMPLO + 'bill-' + mesInfo.chave : '',
      parcela_num: parcNum,
      parcela_total: parcTot,
      valor_total: valorTot,
      data_compra: dataCompra,
      fingerprint: _normalizar(desc) + '|' + valor + '|' + data,
      atualizado_em: agora
    };

    // Monta pelo contrato de colunas, não por posição literal.
    return COLS_TRANSACOES.map(function (cn) {
      return reg[cn] === undefined ? '' : reg[cn];
    });
  });

  // Cartões
  var sc = aba(ABA_CARTOES, COLS_CARTOES);
  var linhasCartoes = CARTOES_EXEMPLO.map(function (c) {
    return [
      c.account_id, PREFIXO_EXEMPLO + 'item-itau', c.nome, c.ultimos_digitos,
      c.limite,
      _dataNo(mesAtual, c.fechamento_dia),
      _dataNo(mesProximo, 5),
      agora
    ];
  });
  escreverLinhas(sc, linhasCartoes, COLS_CARTOES.length);

  // Transações — substitui a aba inteira (é modo de exemplo, não incremental)
  var st = aba(ABA_TRANSACOES, COLS_TRANSACOES);
  escreverLinhas(st, linhas, COLS_TRANSACOES.length);

  statusGravar({
    ultimo_sync: agora,
    ultimo_sync_motivo: 'DADOS DE EXEMPLO',
    ultimo_sync_resumo: linhasCartoes.length + ' cartões · ' + linhas.length +
                        ' transações de exemplo · NÃO são dados reais',
    ultimo_erro: ''
  });

  p('✅ Dados de exemplo gravados');
  p('   ' + linhasCartoes.length + ' cartões, ' + linhas.length + ' transações');
  p('   fatura fechada: ' + mesPassado.chave + ' e ' + mesAtual.chave);
  p('   fatura em aberto: ' + mesProximo.chave);
  p('');
  p('⚠️  São dados FICTÍCIOS, para desenvolver a interface.');
  p('   Rodar sincronizarAgora() substitui pelos dados reais do Pluggy.');
  p('   Ou rode limparDadosExemplo() para apagar.');

  return log.join('\n');
}

function limparDadosExemplo() {
  var n = COLS_TRANSACOES.length;
  var st = aba(ABA_TRANSACOES, COLS_TRANSACOES);
  var restantes = lerLinhas(st, n).filter(function (l) {
    return String(l[0] || '').indexOf(PREFIXO_EXEMPLO) !== 0;
  });
  escreverLinhas(st, restantes, n);

  var nc = COLS_CARTOES.length;
  var sc = aba(ABA_CARTOES, COLS_CARTOES);
  var cartoesRestantes = lerLinhas(sc, nc).filter(function (l) {
    return String(l[0] || '').indexOf(PREFIXO_EXEMPLO) !== 0;
  });
  escreverLinhas(sc, cartoesRestantes, nc);

  var msg = '🧹 Dados de exemplo removidos. Restaram ' + restantes.length +
            ' transações e ' + cartoesRestantes.length + ' cartões reais.';
  Logger.log(msg);
  return msg;
}
