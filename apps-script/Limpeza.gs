/**
 * Limpeza única do histórico: apaga tudo que for anterior a MES_MINIMO.
 *
 * COMO USAR — nesta ordem, sem pular:
 *   1. Cópia de segurança da planilha (Arquivo → Fazer uma cópia)
 *   2. FECHE o app em todas as abas do navegador          ← ver o aviso abaixo
 *   3. simularLimpezaHistorico()  → relatório, não escreve nada
 *   4. Confira o relatório
 *   5. limparHistorico()          → aplica
 *   6. Abra o app e dê F5 antes de editar qualquer coisa
 *
 * ⚠️ POR QUE FECHAR O APP ANTES
 *
 * O app guarda todos os meses em memória e, a cada edição, reescreve as abas
 * dele inteiras a partir dessa memória. Se ele estiver aberto com o histórico
 * antigo carregado, a primeira edição depois da limpeza traz tudo de volta —
 * e aí a limpeza terá sido só um susto. F5 recarrega da planilha já limpa.
 *
 * ⚠️ EXCEÇÃO CONSCIENTE À REGRA DE UM ESCRITOR POR ABA
 *
 * Este arquivo escreve em RENDA_DESPESAS, CARTAO_CREDITO, INVESTIMENTOS,
 * OF_AJUSTES e CHECKLIST_PAGO, que são do app. É a única coisa no Apps Script
 * que faz isso. Vale porque é operação manual, pontual, com o app fechado —
 * as três condições que tornam a regra desnecessária aqui. Nada disso pode ir
 * para um gatilho.
 *
 * O QUE NÃO É APAGADO
 *   • O futuro. Parcelas agendadas para 2027 ficam — são elas que fazem a aba
 *     Parcelas projetar.
 *   • DICIONARIO e PESSOAS. Não têm mês; são o cérebro da categorização.
 *   • OF_CARTOES e OF_STATUS. Também não têm mês.
 *   • OF_SYNC_LOG. É diagnóstico append-only; limparSyncLog() cuida dele à parte.
 */

function simularLimpezaHistorico() { return _limpeza(true); }
function limparHistorico()         { return _limpeza(false); }

// Abas com mês: nome → índice (base 0) da coluna de mes_ref.
function _abasComMes() {
  return [
    { nome: 'RENDA_DESPESAS', col: 0, cols: 8,  dono: 'app' },
    { nome: 'CARTAO_CREDITO', col: 0, cols: 11, dono: 'app' },
    { nome: 'INVESTIMENTOS',  col: 0, cols: 5,  dono: 'app' },
    { nome: ABA_PAGO,         col: 0, cols: COLS_PAGO.length,       dono: 'app' },
    { nome: ABA_TRANSACOES,   col: col(COLS_TRANSACOES, 'mes_ref'),
      cols: COLS_TRANSACOES.length, dono: 'script' },
    { nome: ABA_FATURAS,      col: col(COLS_FATURAS, 'mes_ref'),
      cols: COLS_FATURAS.length,    dono: 'script' },
  ];
}

/**
 * Normaliza o mês para comparar. Aceita o formato legado ("MAIO") porque pode
 * ter sobrado linha não migrada — e essa é justamente a sujeira a remover.
 */
function _mesDaLinha(bruto) {
  var s = String(bruto == null ? '' : bruto).trim().toUpperCase();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  var r = _converterMes(s);          // reaproveita a tabela de Migracao.gs
  return r.novo || '';
}

function _limpeza(simular) {
  var ss = SpreadsheetApp.getActive();
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  if (!MES_MINIMO) {
    p('MES_MINIMO está vazio em Config.gs — o piso está desligado e não há o');
    p('que limpar. Defina, por exemplo, MES_MINIMO = "2026-08".');
    return log.join('\n');
  }

  p(simular ? '=== SIMULAÇÃO — nada será escrito ===' : '=== LIMPEZA REAL ===');
  p('Mantendo ' + MES_MINIMO + ' em diante. Tudo anterior sai.');
  p('');

  var removidasGeral = 0, mantidasGeral = 0;

  _abasComMes().forEach(function (cfg) {
    var s = ss.getSheetByName(cfg.nome);
    if (!s) { p('•  ' + cfg.nome + ': não existe — pulando'); return; }

    var linhas = lerLinhas(s, cfg.cols);
    if (!linhas.length) { p('•  ' + cfg.nome + ': vazia'); return; }

    var porMes = {}, semMes = 0;
    var mantidas = linhas.filter(function (l) {
      // Linha totalmente vazia não conta como dado.
      var temAlgo = l.some(function (v) { return String(v || '').trim() !== ''; });
      if (!temAlgo) return false;

      var m = _mesDaLinha(l[cfg.col]);
      if (!m) { semMes++; return true; }   // não entendeu o mês: preserva
      if (m >= MES_MINIMO) return true;
      porMes[m] = (porMes[m] || 0) + 1;
      return false;
    });

    var removidas = linhas.length - mantidas.length;
    p('•  ' + cfg.nome + ' (' + cfg.dono + '): ' + linhas.length + ' linhas → ' +
      'mantém ' + mantidas.length + ', remove ' + removidas);
    Object.keys(porMes).sort().forEach(function (m) {
      p('      ' + m + ': ' + porMes[m]);
    });
    if (semMes) p('      ⚠️  ' + semMes + ' linha(s) com mês ilegível — MANTIDAS');

    if (!simular && removidas > 0) {
      escreverLinhas(s, mantidas, cfg.cols);
      p('      ✅ gravado');
    }

    removidasGeral += removidas;
    mantidasGeral += mantidas.length;
  });

  // ── OF_AJUSTES: não tem mês, tem ref_id ──────────────────────────────────
  // Um ajuste de transação que não existe mais é sujeira invisível: não afeta
  // total nenhum, mas fica para sempre. Ajuste de CARTÃO (o apelido) não tem
  // transação e nunca é órfão — some junto seria perder os apelidos.
  var sAj = ss.getSheetByName(ABA_AJUSTES);
  if (sAj) {
    var ajustes = lerLinhas(sAj, COLS_AJUSTES.length);
    if (ajustes.length) {
      var sTx = ss.getSheetByName(ABA_TRANSACOES);
      var vivos = {};
      if (sTx) {
        var iTxId = col(COLS_TRANSACOES, 'pluggy_tx_id');
        var iTxMes = col(COLS_TRANSACOES, 'mes_ref');
        lerLinhas(sTx, COLS_TRANSACOES.length).forEach(function (l) {
          // Na simulação as transações antigas ainda estão na planilha, então
          // o piso é aplicado aqui também — senão o relatório mentiria.
          if (l[iTxId] && !_antesDoPiso(l[iTxMes])) vivos[String(l[iTxId])] = true;
        });
      }

      var iTipo = col(COLS_AJUSTES, 'tipo');
      var iRef = col(COLS_AJUSTES, 'ref_id');
      var orfaos = 0;
      var ajMantidos = ajustes.filter(function (l) {
        if (!String(l[iRef] || '').trim()) return false;
        if (String(l[iTipo] || 'TX').toUpperCase() !== 'TX') return true;  // apelido
        if (vivos[String(l[iRef])]) return true;
        orfaos++;
        return false;
      });

      p('•  ' + ABA_AJUSTES + ' (app): ' + ajustes.length + ' linhas → ' +
        'mantém ' + ajMantidos.length + ', remove ' + orfaos + ' órfão(s)');
      if (!simular && orfaos > 0) {
        escreverLinhas(sAj, ajMantidos, COLS_AJUSTES.length);
        p('      ✅ gravado');
      }
      removidasGeral += orfaos;
    }
  }

  p('');
  p('=== RESUMO ===');
  p('linhas mantidas: ' + mantidasGeral);
  p('linhas removidas: ' + removidasGeral);
  p('');

  if (simular) {
    p('Nada foi escrito.');
    p('Se o relatório está certo: feche o app no navegador e rode limparHistorico().');
  } else {
    p('✅ Limpeza aplicada.');
    p('');
    p('AGORA, NESTA ORDEM:');
    p('  1. Abra o app e dê F5 ANTES de editar qualquer coisa.');
    p('     Sem isso, a primeira edição reescreve o histórico antigo de volta.');
    p('  2. Confira que o seletor de mês só mostra ' + MES_MINIMO + ' em diante.');
    p('');
    p('O piso MES_MINIMO em Config.gs mantém a limpeza: o próximo sync não');
    p('traz os meses antigos de volta, mesmo com a janela de ' +
      JANELA_DIAS_ATRAS + ' dias.');
  }

  return log.join('\n');
}

/**
 * OF_SYNC_LOG cresce uma linha por sync e não tem mês. Separado da limpeza de
 * histórico porque é diagnóstico: apagar cedo demais é perder justamente a
 * série que revela a cadência do Pluggy.
 */
function limparSyncLog(manterUltimas) {
  var n = manterUltimas || 200;
  var s = SpreadsheetApp.getActive().getSheetByName(ABA_SYNC_LOG);
  if (!s) return 'Aba ' + ABA_SYNC_LOG + ' não existe.';

  var linhas = lerLinhas(s, COLS_SYNC_LOG.length).filter(function (l) { return l[0]; });
  if (linhas.length <= n) {
    var nada = ABA_SYNC_LOG + ': ' + linhas.length + ' linhas, abaixo do limite de ' + n + '. Nada a fazer.';
    Logger.log(nada);
    return nada;
  }

  var mantidas = linhas.slice(-n);
  escreverLinhas(s, mantidas, COLS_SYNC_LOG.length);
  var msg = ABA_SYNC_LOG + ': ' + linhas.length + ' → ' + mantidas.length + ' linhas.';
  Logger.log(msg);
  return msg;
}
