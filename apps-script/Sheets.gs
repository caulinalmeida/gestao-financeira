/**
 * Acesso à planilha.
 *
 * REGRA CENTRAL DO PROJETO: cada aba tem UM único escritor.
 * Este script escreve SOMENTE em OF_TRANSACOES, OF_CARTOES e OF_STATUS.
 * Ele nunca toca em CARTAO_CREDITO, RENDA_DESPESAS, INVESTIMENTOS, DICIONARIO
 * nem em OF_AJUSTES — essas são do app (App.jsx), que faz clear+append total.
 * Misturar escritores causaria perda de dados.
 *
 * Exceção controlada: a chave `pedido_sync` em OF_STATUS é escrita pelo app
 * (botão "Atualizar agora") e lida/limpa aqui.
 */

function _planilha() {
  return SpreadsheetApp.getActive();
}

/** Devolve a aba, criando com cabeçalho se não existir. */
function aba(nome, colunas) {
  var ss = _planilha();
  var s = ss.getSheetByName(nome);
  if (!s) {
    s = ss.insertSheet(nome);
  }
  if (colunas && colunas.length) {
    var atual = s.getRange(1, 1, 1, colunas.length).getValues()[0];
    var precisa = false;
    for (var i = 0; i < colunas.length; i++) {
      if (String(atual[i] || '') !== colunas[i]) { precisa = true; break; }
    }
    if (precisa) {
      s.getRange(1, 1, 1, colunas.length).setValues([colunas]);
      s.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
      s.setFrozenRows(1);
    }
  }
  return s;
}

/**
 * Cria as abas OF_* que ainda não existirem, com cabeçalho.
 *
 * OF_AJUSTES entra aqui apesar de ser escrita pelo app: o app só faz clear e
 * append, não sabe criar aba. E como ele lê as cinco abas OF_* de uma vez, uma
 * única aba faltando derruba a leitura inteira e a camada Open Finance some da
 * tela sem erro visível. Criar o cabeçalho é tudo que fazemos — o conteúdo
 * continua sendo só do app, a regra de um escritor por aba segue intacta.
 */
function garantirAbas() {
  aba(ABA_TRANSACOES, COLS_TRANSACOES);
  aba(ABA_CARTOES,    COLS_CARTOES);
  aba(ABA_FATURAS,    COLS_FATURAS);
  aba(ABA_STATUS,     COLS_STATUS);
  aba(ABA_AJUSTES,    COLS_AJUSTES);   // cabeçalho só; conteúdo é do app
  var msg = '✅ Abas OF_* prontas: ' + [ABA_TRANSACOES, ABA_CARTOES, ABA_FATURAS,
                                        ABA_STATUS, ABA_AJUSTES].join(', ');
  Logger.log(msg);
  return msg;
}

/** Todas as linhas de dados (sem cabeçalho) como array de arrays. */
function lerLinhas(sheet, numCols) {
  var ultima = sheet.getLastRow();
  if (ultima < 2) return [];
  return sheet.getRange(2, 1, ultima - 1, numCols).getValues();
}

/** Substitui todo o conteúdo de dados da aba (preserva o cabeçalho). */
function escreverLinhas(sheet, linhas, numCols) {
  var ultima = sheet.getLastRow();
  if (ultima >= 2) {
    sheet.getRange(2, 1, ultima - 1, numCols).clearContent();
  }
  if (linhas.length) {
    sheet.getRange(2, 1, linhas.length, numCols).setValues(linhas);
  }
}

// ── OF_STATUS ────────────────────────────────────────────────────────────────

function statusLer() {
  var s = aba(ABA_STATUS, COLS_STATUS);
  var mapa = {};
  lerLinhas(s, 2).forEach(function (l) {
    if (l[0]) mapa[String(l[0])] = l[1];
  });
  return mapa;
}

function statusGravar(patch) {
  var s = aba(ABA_STATUS, COLS_STATUS);
  var mapa = statusLer();
  Object.keys(patch).forEach(function (k) { mapa[k] = patch[k]; });
  var linhas = Object.keys(mapa).sort().map(function (k) { return [k, mapa[k]]; });
  escreverLinhas(s, linhas, 2);
}

// ── OF_CARTOES ───────────────────────────────────────────────────────────────

function gravarCartoes(cartoes) {
  var s = aba(ABA_CARTOES, COLS_CARTOES);
  var agora = new Date();
  var linhas = cartoes.map(function (c) {
    return [
      c.account_id, c.item_id, c.nome, c.ultimos_digitos,
      c.limite, c.fechamento, c.vencimento, agora
    ];
  });
  escreverLinhas(s, linhas, COLS_CARTOES.length);
}

// ── OF_FATURAS ───────────────────────────────────────────────────────────────

function gravarFaturas(faturas) {
  var s = aba(ABA_FATURAS, COLS_FATURAS);
  var agora = new Date();
  var linhas = faturas.map(function (f) {
    return [f.account_id, f.mes_ref, f.vencimento, f.fechamento, f.total_banco, agora];
  });
  linhas.sort(function (a, b) { return String(b[1]).localeCompare(String(a[1])); });
  escreverLinhas(s, linhas, COLS_FATURAS.length);
}

// ── OF_TRANSACOES ────────────────────────────────────────────────────────────

/**
 * Grava as transações substituindo APENAS a janela sincronizada das contas
 * sincronizadas. Histórico fora da janela fica intacto, e transações que o
 * Pluggy apagou desaparecem corretamente (porque a janela inteira é reescrita).
 */
/** Índice de uma coluna pelo nome — evita depender de posição literal. */
function col(colunas, nome) {
  var i = colunas.indexOf(nome);
  if (i === -1) throw new Error('Coluna "' + nome + '" não existe no contrato.');
  return i;
}

function gravarTransacoes(novas, accountIds, dataDe, dataAte) {
  var s = aba(ABA_TRANSACOES, COLS_TRANSACOES);
  var n = COLS_TRANSACOES.length;
  var iId = col(COLS_TRANSACOES, 'pluggy_tx_id');
  var iConta = col(COLS_TRANSACOES, 'account_id');
  var iData = col(COLS_TRANSACOES, 'data');

  var existentes = lerLinhas(s, n);

  var contas = {};
  accountIds.forEach(function (id) { contas[id] = true; });

  var de = new Date(dataDe + 'T00:00:00Z').getTime();
  var ate = new Date(dataAte + 'T23:59:59Z').getTime();

  var preservadas = existentes.filter(function (l) {
    if (!l[iId]) return false;                       // linha vazia
    if (!contas[String(l[iConta])]) return true;     // conta que não sincronizamos
    var t = new Date(l[iData]).getTime();
    if (isNaN(t)) return true;                       // data ilegível: preserva por segurança
    return t < de || t > ate;                        // fora da janela: preserva
  });

  var agora = new Date();
  // Monta cada linha a partir do contrato de colunas, na ordem declarada.
  var linhasNovas = novas.map(function (t) {
    return COLS_TRANSACOES.map(function (c) {
      return c === 'atualizado_em' ? agora : (t[c] === undefined ? '' : t[c]);
    });
  });

  var todas = preservadas.concat(linhasNovas);
  // Ordena por data desc para a aba ficar legível quando inspecionada na mão.
  todas.sort(function (a, b) { return new Date(b[iData]) - new Date(a[iData]); });

  escreverLinhas(s, todas, n);
  return { preservadas: preservadas.length, gravadas: linhasNovas.length, total: todas.length };
}
