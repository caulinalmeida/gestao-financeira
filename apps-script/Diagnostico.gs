/**
 * Por que uma compra de ontem ainda não apareceu?
 *
 * Existem TRÊS saltos entre a maquininha e a tela do app, e cada um tem a
 * própria latência. Confundir os três foi o que gerou a pergunta:
 *
 *   1. BANCO → PLUGGY     o Pluggy visita o banco no ritmo dele. Não
 *                         controlamos, e no Meu Pluggy nem dá para forçar
 *                         (PATCH /items devolve 400).
 *   2. PLUGGY → PLANILHA  nosso sync. Este a gente controla.
 *   3. PLANILHA → APP     recarregar a página.
 *
 * Se o salto 2 acontece ANTES do salto 1 no mesmo dia, o app fica sempre um
 * dia atrasado por construção — foi a suspeita que motivou este arquivo.
 *
 *   diagnosticoOpenFinance()  fotografia de agora, com os três saltos
 *   historicoSync()           a cadência observada, dia a dia
 *
 * Nenhuma das duas escreve em OF_TRANSACOES. `diagnosticoOpenFinance` só
 * acrescenta uma linha em OF_SYNC_LOG.
 */

function _horasEntre(a, b) {
  var ta = new Date(a).getTime(), tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return null;
  return (tb - ta) / 3600000;
}

function _idade(iso) {
  var h = _horasEntre(iso, new Date());
  if (h === null) return '?';
  if (h < 1) return Math.round(h * 60) + ' min atrás';
  if (h < 48) return h.toFixed(1) + 'h atrás';
  return (h / 24).toFixed(1) + ' dias atrás';
}

function _quando(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '—');
  return Utilities.formatDate(d, FUSO, 'dd/MM HH:mm');
}

function diagnosticoOpenFinance() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  garantirAbas();
  var agora = new Date();
  p('=== DIAGNÓSTICO DO OPEN FINANCE ===');
  p('Agora: ' + _quando(agora));
  p('');

  var items = pluggyItems();
  var linhasLog = [];

  items.ids.forEach(function (itemId) {
    var r = pluggyItem(itemId);
    if (!r.ok) {
      p('❌ item ' + itemId + ': HTTP ' + r.code);
      return;
    }
    var it = r.body || {};
    var conector = it.connector ? it.connector.name : '?';

    p('════════════════════════════════════════');
    p('📦 ' + conector + '  (' + itemId + ')');
    p('   status: ' + it.status + (it.executionStatus ? ' · ' + it.executionStatus : ''));
    p('');
    p('   SALTO 1 — banco → Pluggy');
    p('     última visita ao banco: ' + _quando(it.lastUpdatedAt) + '  (' + _idade(it.lastUpdatedAt) + ')');
    if (it.nextAutoSyncAt) {
      p('     próxima visita agendada: ' + _quando(it.nextAutoSyncAt));
      var faltam = _horasEntre(agora, it.nextAutoSyncAt);
      if (faltam !== null) {
        p('     ' + (faltam > 0 ? 'faltam ' + faltam.toFixed(1) + 'h'
                                : 'já passou da hora (' + (-faltam).toFixed(1) + 'h)'));
      }
    } else {
      p('     próxima visita: o Pluggy não informa (sem nextAutoSyncAt)');
    }

    // Cada produto tem o próprio lastUpdatedAt. Interessa porque cartão pode
    // atualizar em ritmo diferente de investimento — e é o cartão que importa
    // aqui. Vinha truncado junto com o resto do statusDetail.
    if (it.statusDetail && typeof it.statusDetail === 'object') {
      p('');
      p('   ATUALIZAÇÃO POR PRODUTO:');
      Object.keys(it.statusDetail).sort().forEach(function (prod) {
        var d = it.statusDetail[prod] || {};
        var marca = (prod === 'creditCards') ? ' ← o que nos interessa' : '';
        p('     ' + prod + ': ' + (d.isUpdated ? 'ok' : 'NÃO atualizado') +
          '  ' + _quando(d.lastUpdatedAt) +
          ((d.warnings && d.warnings.length) ? '  ⚠️ ' + d.warnings.length + ' aviso(s)' : '') +
          marca);
      });
    }

    // Todos os campos do item, sem filtro: se o Pluggy passar a expor algo
    // novo sobre agendamento, aparece aqui sem precisar mexer no código.
    p('');
    p('   CAMPOS CRUS DO ITEM:');
    Object.keys(it).sort().forEach(function (k) {
      if (k === 'statusDetail') return;              // já detalhado acima
      var v = it[k];
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'object') {
        v = (k === 'connector') ? (v.name + ' #' + v.id) : JSON.stringify(v);
      }
      p('     ' + k + ': ' + String(v).slice(0, 400));
    });

    linhasLog.push({ itemId: itemId, conector: conector, item: it });
  });

  // ── Salto 2: quando NÓS lemos, e o que temos ────────────────────────────
  var st = statusLer();
  p('');
  p('════════════════════════════════════════');
  p('   SALTO 2 — Pluggy → planilha (nosso sync)');
  p('     último sync nosso: ' + _quando(st.ultimo_sync) + '  (' + _idade(st.ultimo_sync) + ')');
  p('     motivo: ' + (st.ultimo_sync_motivo || '?'));
  p('     resumo: ' + (st.ultimo_sync_resumo || '?'));

  var gatilhos = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'syncDiario';
  });
  p('     gatilhos de sync diário: ' + gatilhos.length);

  // A transação mais recente que temos, por cartão. É o teto do que o app
  // consegue mostrar, não importa quantas vezes se aperte Atualizar.
  var n = COLS_TRANSACOES.length;
  var iData = col(COLS_TRANSACOES, 'data');
  var iConta = col(COLS_TRANSACOES, 'account_id');
  var iId = col(COLS_TRANSACOES, 'pluggy_tx_id');
  var maisRecente = {};
  var hojeMs = agora.getTime();
  lerLinhas(aba(ABA_TRANSACOES, COLS_TRANSACOES), n).forEach(function (l) {
    if (!l[iId]) return;
    var t = new Date(l[iData]).getTime();
    // Parcela futura não conta: ela é agendamento, não movimento do cartão.
    if (isNaN(t) || t > hojeMs) return;
    var c = String(l[iConta]);
    if (!maisRecente[c] || t > maisRecente[c]) maisRecente[c] = t;
  });

  var nomes = {};
  lerLinhas(aba(ABA_CARTOES, COLS_CARTOES), COLS_CARTOES.length).forEach(function (c) {
    nomes[String(c[0])] = String(c[2] || '') + (c[3] ? ' ·' + c[3] : '');
  });

  p('');
  p('   COMPRA MAIS RECENTE QUE TEMOS (ignorando parcelas futuras):');
  var hojeIso = _isoData(agora);
  var txTopo = '';
  Object.keys(maisRecente).forEach(function (c) {
    var iso = _isoData(new Date(maisRecente[c]));
    if (iso > txTopo) txTopo = iso;
    // Data de transação não tem hora, então idade em horas engana: uma compra
    // de hoje apareceria como "17h atrás" só porque conta desde a meia-noite.
    var dias = Math.round((new Date(hojeIso) - new Date(iso)) / 86400000);
    var quanto = dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : 'há ' + dias + ' dias';
    p('     ' + (nomes[c] || c) + ': ' + iso + '  (' + quanto + ')');
  });
  if (!Object.keys(maisRecente).length) p('     (nenhuma)');

  // ── Veredito ────────────────────────────────────────────────────────────
  p('');
  p('════════════════════════════════════════');
  p('   VEREDITO');
  var lu = linhasLog.length ? linhasLog[0].item.lastUpdatedAt : null;
  var idadeBanco = lu ? _horasEntre(lu, agora) : null;
  var idadeNossa = st.ultimo_sync ? _horasEntre(st.ultimo_sync, agora) : null;

  if (idadeBanco !== null && idadeBanco > 24) {
    p('   ⚠️ O Pluggy não vai ao banco há ' + (idadeBanco / 24).toFixed(1) + ' dias.');
    p('      Compra mais nova que isso NÃO existe para nós. Sincronizar não');
    p('      adianta — o gargalo é o salto 1, que não controlamos.');
  } else if (idadeBanco !== null) {
    p('   ✅ O Pluggy visitou o banco há ' + idadeBanco.toFixed(1) + 'h.');
  }

  if (idadeNossa !== null && lu && new Date(st.ultimo_sync) < new Date(lu)) {
    p('   ⚠️ NOSSO SYNC RODOU ANTES DA ÚLTIMA VISITA DO PLUGGY AO BANCO.');
    p('      Ou seja: existe dado no Pluggy que ainda não trouxemos.');
    p('      Rode sincronizarAgora() para pegar agora, e considere mover o');
    p('      horário do gatilho para depois da visita do Pluggy.');
  } else if (idadeNossa !== null) {
    p('   ✅ Nosso sync é mais recente que a visita do Pluggy: temos tudo que');
    p('      o Pluggy tem.');
  }

  // ── Registra a observação, para a cadência aparecer com o tempo ─────────
  var s = aba(ABA_SYNC_LOG, COLS_SYNC_LOG);
  linhasLog.forEach(function (x) {
    s.appendRow([agora, x.conector, x.item.status || '',
      x.item.lastUpdatedAt || '', x.item.nextAutoSyncAt || '',
      st.ultimo_sync || '', txTopo, 'diagnostico']);
  });
  p('');
  p('   📝 Observação registrada em ' + ABA_SYNC_LOG + '.');
  p('      Rode historicoSync() depois de alguns dias para ver a cadência.');

  return log.join('\n');
}

/**
 * Dá para embutir o widget do Pluggy Connect no app e atualizar por lá?
 *
 * A pergunta tem duas metades independentes:
 *
 *   a) MINTAR O TOKEN — o widget precisa de um connect_token, e emitir um
 *      exige clientId/clientSecret. O app é estático e público, então o
 *      segredo não pode ir para o bundle. Contornável: o Apps Script emite
 *      (é o que esta função faz) e devolve pela planilha, como o pedido_sync.
 *
 *   b) O ITEM SER NOSSO — modo update exige `itemId` no token, e a doc diz
 *      que itemId de outra aplicação devolve 404 ITEM_NOT_FOUND. O nosso é do
 *      Meu Pluggy (clientUserId: my-pluggy:<email>), a mesma fronteira que já
 *      derruba o PATCH com 400 "MeuPluggy item cant be updated".
 *
 * MEDIDO EM 16/08/2026: 403 Forbidden nos DOIS modos, create inclusive.
 * Ou seja, nem chegamos em (b) — a credencial do Meu Pluggy não emite
 * connect_token de jeito nenhum. É leitura das suas conexões e mais nada.
 * Assunto encerrado num nível acima do que eu supunha.
 *
 * Vale rodar de novo se o Pluggy mudar os termos do Meu Pluggy — é o único
 * cenário em que isso destrava.
 *
 * Não escreve nada. connect_token é de leitura curta e some sozinho.
 */
function testarWidgetUpdate() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  p('=== O WIDGET DO PLUGGY CONNECT CABE NO APP? ===');
  p('');

  // Modo create primeiro: separa "não sabemos emitir token" de "não podemos
  // tocar NESTE item". Sem isso, um 404 no update seria ambíguo.
  var criar = pluggyConnectToken(null);
  p('1) Emitir connect_token (modo create, sem itemId)');
  p('   HTTP ' + criar.code + (criar.ok ? ' ✅' : ' ❌'));
  if (criar.ok) {
    p('   → Sabemos emitir token. O widget rodaria; o segredo fica aqui no');
    p('     Apps Script, nunca no bundle.');
  } else {
    p('   → ' + JSON.stringify(criar.body).slice(0, 300));
    if (criar.code === 403) {
      // Medido em 16/08/2026: 403 aqui, com credencial que sincroniza normal.
      // Não é erro de credencial — é escopo. Meu Pluggy dá leitura das suas
      // conexões e nada além disso.
      p('   → 403 = autenticado, mas o endpoint não é nosso. A credencial do');
      p('     Meu Pluggy é SOMENTE LEITURA: sem connect_tokens, sem widget.');
      p('     Encerra o assunto antes mesmo da questão de posse do item.');
    } else if (criar.code === 401) {
      p('   → 401 = credencial inválida. Confira PLUGGY_CLIENT_ID/SECRET.');
    } else {
      p('   → Sem isto, nem modo create funciona.');
    }
  }

  var items = pluggyItems();
  items.ids.forEach(function (itemId) {
    p('');
    p('2) Emitir connect_token em modo UPDATE para ' + itemId);
    var up = pluggyConnectToken(itemId);
    p('   HTTP ' + up.code + (up.ok ? ' ✅' : ' ❌'));
    p('   ' + JSON.stringify(up.body).slice(0, 300));

    if (up.ok) {
      p('');
      p('   🎉 INESPERADO — e ótimo. O token saiu, então o widget PODE abrir');
      p('      em modo update para este item. Vale construir: app pede token');
      p('      pela planilha, Apps Script emite, widget abre, o usuário');
      p('      atualiza sem sair do app.');
    } else if (up.code === 404) {
      p('');
      p('   ⛔ 404 ITEM_NOT_FOUND — confirma o esperado: para efeito de');
      p('      escrita, este item não existe para a nossa aplicação. Ele é do');
      p('      Meu Pluggy. Widget embutido está fora enquanto for assim.');
      p('      O caminho segue sendo o botão em meu.pluggy.ai e depois 🔄.');
    } else {
      p('');
      p('   ⛔ Recusado (HTTP ' + up.code + '). Mesma conclusão prática do 404.');
    }
  });

  p('');
  p('Obs.: reconectar o Itaú sob a NOSSA aplicação resolveria tudo (aí o item');
  p('seria nosso e o PATCH bastaria, sem widget). Mas sai do Meu Pluggy, que');
  p('é o tier gratuito — o plano pago do Pluggy começa na casa dos milhares');
  p('de reais por mês. Para um app doméstico, não fecha.');

  return log.join('\n');
}

/**
 * A cadência observada. Só faz sentido depois de alguns dias de registro —
 * é a diferença entre "acho que atualiza de manhã" e saber a que horas.
 */
function historicoSync() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var linhas = lerLinhas(aba(ABA_SYNC_LOG, COLS_SYNC_LOG), COLS_SYNC_LOG.length)
    .filter(function (l) { return l[0]; });

  p('=== HISTÓRICO DE ATUALIZAÇÃO DO PLUGGY ===');
  p('Registros: ' + linhas.length);
  if (linhas.length < 2) {
    p('');
    p('Poucos dados ainda. Cada sync grava uma linha aqui; volte em alguns dias.');
    return log.join('\n');
  }

  p('');
  p('  observado em      conector              visita ao banco     nossa leitura');
  var vistos = {};
  var horas = [];
  linhas.slice(-40).forEach(function (l) {
    p('  ' + _quando(l[0]).padEnd(16) + '  ' + String(l[1]).slice(0, 20).padEnd(20) +
      '  ' + _quando(l[3]).padEnd(16) + '  ' + _quando(l[5]));
    // Cada visita distinta do Pluggy conta uma vez, para a hora não ser
    // enviesada por termos observado a mesma visita várias vezes.
    var chave = String(l[1]) + '|' + String(l[3]);
    if (l[3] && !vistos[chave]) {
      vistos[chave] = true;
      var d = new Date(l[3]);
      if (!isNaN(d.getTime())) horas.push(Number(Utilities.formatDate(d, FUSO, 'H')));
    }
  });

  p('');
  if (horas.length >= 2) {
    horas.sort(function (a, b) { return a - b; });
    var cont = {};
    horas.forEach(function (h) { cont[h] = (cont[h] || 0) + 1; });
    p('  VISITAS DISTINTAS DO PLUGGY AO BANCO: ' + horas.length);
    p('  Horário (hora do dia → quantas vezes):');
    Object.keys(cont).sort(function (a, b) { return a - b; }).forEach(function (h) {
      p('    ' + String(h).padStart(2, '0') + 'h  ' + new Array(cont[h] + 1).join('█') + ' ' + cont[h]);
    });
    p('');
    p('  → Agende nosso sync para DEPOIS do horário mais frequente acima.');
    p('    Use configurarHorariosSync() com as horas escolhidas.');
  } else {
    p('  Ainda não há visitas distintas suficientes para inferir horário.');
  }

  return log.join('\n');
}
