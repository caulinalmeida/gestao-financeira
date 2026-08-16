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
 * Dia de fechamento do cartão.
 *
 * O conector do Itaú via Meu Pluggy devolve `balanceCloseDate` NULO, então não
 * dá para depender só dele. Quando falta, derivamos do `billClosingDate` das
 * faturas — que é dado real do banco, não chute.
 */
function _diaFechamento(cd, faturas) {
  if (cd && cd.balanceCloseDate) {
    var d = new Date(cd.balanceCloseDate);
    if (!isNaN(d.getTime())) return d.getUTCDate();
  }

  var dias = (faturas || [])
    .map(function (b) { return b && b.billClosingDate ? new Date(b.billClosingDate) : null; })
    .filter(function (d) { return d && !isNaN(d.getTime()); })
    .map(function (d) { return d.getUTCDate(); });

  return _maisFrequente(dias);
}

/** Dia de vencimento, pela mesma lógica. */
function _diaVencimento(cd, faturas) {
  var dias = (faturas || [])
    .map(function (b) { return b && b.dueDate ? new Date(b.dueDate) : null; })
    .filter(function (d) { return d && !isNaN(d.getTime()); })
    .map(function (d) { return d.getUTCDate(); });
  if (dias.length) return _maisFrequente(dias);

  if (cd && cd.balanceDueDate) {
    var d = new Date(cd.balanceDueDate);
    if (!isNaN(d.getTime())) return d.getUTCDate();
  }
  return null;
}

/** Valor mais frequente — robusto a fechamento/vencimento caindo em feriado. */
function _maisFrequente(valores) {
  if (!valores || !valores.length) return null;
  var cont = {}, melhor = null, max = 0;
  valores.forEach(function (x) {
    cont[x] = (cont[x] || 0) + 1;
    if (cont[x] > max) { max = cont[x]; melhor = x; }
  });
  return melhor;
}

/**
 * Mês da fatura pelo CICLO do cartão.
 *
 * Convenção do projeto: o mês é o do VENCIMENTO da fatura — a mesma que o
 * banco usa e que a regra BILL reproduz.
 *
 * Verificado contra os dados reais do Itaú (fecha dia 3, vence dia 10):
 *   compra 02/07 → fatura que fecha 03/07, vence 10/07 → 2026-07
 *   compra 03/07 → fatura que fecha 03/08, vence 10/08 → 2026-08
 *
 * Ou seja, a compra NO dia do fechamento já entra no ciclo seguinte: o teste
 * é `dia >= diaFechamento`, não `>`.
 */
function _mesPorCiclo(dataTx, diaFechamento, diaVencimento) {
  var d = new Date(dataTx);
  if (isNaN(d.getTime())) return null;

  var ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  if (diaFechamento && d.getUTCDate() >= diaFechamento) {
    mes += 1;
  }
  // Vencimento antes do fechamento significa que a fatura vence no mês
  // seguinte ao do fechamento (não é o caso do Itaú, mas outros bancos usam).
  if (diaVencimento && diaFechamento && diaVencimento < diaFechamento) {
    mes += 1;
  }
  while (mes > 11) { mes -= 12; ano += 1; }
  return _mesKey(ano, mes);
}

/**
 * Em que fatura a transação cai. `origem_mes` registra a regra usada, o que
 * torna o QA possível.
 *
 *   BILL      tem billId e sabemos o vencimento da fatura — autoritativo
 *   CICLO     calculado pelo dia de fechamento, mesma convenção do BILL
 *   FORECAST  billForecastDate do Pluggy — último recurso
 *
 * Por que FORECAST caiu para último: o `billForecastDate` usa uma convenção de
 * mês DIFERENTE do vencimento (aparentemente o início do período de apuração).
 * Confiar nele misturava duas convenções e jogava as compras em aberto um mês
 * para trás. O ciclo é determinístico e concorda com o banco.
 */
function _derivarMes(tx, mapaFaturas, diaFechamento, diaVencimento) {
  var meta = tx.creditCardMetadata || {};

  if (meta.billId && mapaFaturas && mapaFaturas[meta.billId]) {
    var venc = new Date(mapaFaturas[meta.billId]);
    if (!isNaN(venc.getTime())) {
      return { mes: _mesKey(venc.getUTCFullYear(), venc.getUTCMonth()), origem: 'BILL' };
    }
  }

  // AGENDADA — parcela futura que o banco já programou.
  //
  // Verificado contra dados reais: as parcelas futuras do Itaú chegam datadas
  // com o VENCIMENTO da fatura em que vão cair (10/09, 13/10 — e 13/10 é dia
  // útil porque 10/10/2026 cai num sábado), não com a data da compra. Aplicar
  // a regra de ciclo nelas empurra tudo um mês para a frente: o Airbnb tinha
  // 01/06 em agosto e 02/06 em OUTUBRO, pulando setembro inteiro.
  //
  // Exige as DUAS condições — ser parcela e estar no futuro. Só "data no
  // futuro" seria largo demais: pega compra com data alguns dias à frente,
  // que é compra de verdade e precisa do ciclo.
  var dt = new Date(tx.date);
  if (Number(meta.totalInstallments) > 1 && !isNaN(dt.getTime()) && dt.getTime() > Date.now()) {
    return { mes: _mesKey(dt.getUTCFullYear(), dt.getUTCMonth()), origem: 'AGENDADA' };
  }

  if (diaFechamento) {
    var m = _mesPorCiclo(tx.date, diaFechamento, diaVencimento);
    if (m) return { mes: m, origem: 'CICLO' };
  }

  if (meta.billForecastDate && /^\d{4}-\d{2}$/.test(meta.billForecastDate)) {
    return { mes: meta.billForecastDate, origem: 'FORECAST' };
  }

  var d = new Date(tx.date);
  return { mes: _mesKey(d.getUTCFullYear(), d.getUTCMonth()), origem: 'FORECAST' };
}

/**
 * Natureza da transação — o banco NÃO soma o pagamento da fatura no total.
 *
 *   PAGAMENTO  "Pagamento recebido": quitação da fatura anterior. Não é
 *              despesa; entra na fatura como crédito e precisa ficar fora
 *              do total, senão o valor não bate com o app do banco.
 *   ESTORNO    devolução de compra. Abate do total, corretamente.
 *   COMPRA     tudo o mais.
 */
function _tipoTransacao(tx) {
  var desc = _normalizar(tx.description || tx.descriptionRaw);
  var meta = tx.creditCardMetadata || {};

  if (meta.otherCreditsType === 'BILL_INSTALLMENT' || meta.otherCreditsType === 'REVOLVING_CREDIT') {
    return 'COMPRA';
  }
  if (Number(tx.amount) < 0 && /\b(PAGAMENTO|PGTO|PAGTO)\b/.test(desc)) {
    return 'PAGAMENTO';
  }
  if (Number(tx.amount) < 0) return 'ESTORNO';
  return 'COMPRA';
}

function _mapearTransacao(tx, conta, mapaFaturas, diaFechamento, diaVencimento) {
  var meta = tx.creditCardMetadata || {};
  var m = _derivarMes(tx, mapaFaturas, diaFechamento, diaVencimento);
  var dataIso = _isoData(new Date(tx.date));

  return {
    pluggy_tx_id: tx.id,
    account_id: conta.id,
    mes_ref: m.mes,
    origem_mes: m.origem,
    tipo: _tipoTransacao(tx),
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
  p(garantirAbas());
  p('Autenticando...');
  pluggyApiKey();
  p('✅ Autenticação OK');

  var items = pluggyItems();
  p('Items configurados via ' + items.origem + ': ' + items.ids.length);

  var totalCartoes = 0, comProblema = 0;
  items.ids.forEach(function (itemId) {
    p('');
    p('📦 Item ' + itemId);

    var r = pluggyItem(itemId);
    if (!r.ok) {
      comProblema++;
      p('   ❌ HTTP ' + r.code);
      p('   Resposta: ' + JSON.stringify(r.body).slice(0, 300));
      if (r.code === 401 || r.code === 403) {
        p('   → 401/403 num ID válido normalmente significa que falta concluir a');
        p('     autorização OAuth do Meu Pluggy para esta aplicação.');
        p('     Refaça em dashboard.pluggy.ai (é uma vez por banco conectado).');
      } else if (r.code === 404) {
        p('   → ID não encontrado. Confira se copiou o item ID correto');
        p('     (não confundir com application ID ou connector ID).');
      }
      return;
    }

    var st = r.body.status || 'DESCONHECIDO';
    var conector = r.body.connector ? r.body.connector.name : '?';
    p('   Instituição: ' + conector);
    p('   Status: ' + st + (st === 'UPDATED' ? ' ✅' : ' ⚠️'));
    if (st === 'LOGIN_ERROR' || st === 'OUTDATED') {
      comProblema++;
      p('   → Reconecte em meu.pluggy.ai antes de sincronizar.');
    }
    if (r.body.lastUpdatedAt) p('   Última atualização no Pluggy: ' + r.body.lastUpdatedAt);

    var contas;
    try {
      contas = pluggyContasCredito(itemId);
    } catch (e) {
      comProblema++;
      p('   ❌ ' + e.message);
      return;
    }

    p('   Cartões de crédito: ' + contas.length);
    if (!contas.length) {
      p('   ⚠️  Nenhuma conta CREDIT. Se esperava cartões, verifique no');
      p('      meu.pluggy.ai se o compartilhamento inclui cartão de crédito.');
    }
    contas.forEach(function (c) {
      totalCartoes++;
      var cd = c.creditData || {};
      p('     💳 ' + (c.name || c.marketingName || '(sem nome)') +
        '  final ' + (c.number ? String(c.number).slice(-4) : '????'));
      p('        accountId: ' + c.id);

      // Amostra: confirma que dá para ler transação e que o mês está sendo
      // derivado por uma regra confiável (BILL/FORECAST) e não por chute.
      try {
        var hoje = new Date();
        var de = _isoData(new Date(hoje.getTime() - 45 * 86400000));
        var ate = _isoData(new Date(hoje.getTime() + 45 * 86400000));
        var faturas = pluggyFaturas(c.id);
        var mapa = {};
        faturas.forEach(function (b) { if (b && b.id && b.dueDate) mapa[b.id] = b.dueDate; });
        var diaFech = _diaFechamento(cd, faturas);

        p('        limite: ' + (cd.creditLimit || '?') +
          ' | vence: ' + (cd.balanceDueDate || '?'));
        p('        dia de fechamento: ' + (diaFech || '❌ desconhecido') +
          (cd.balanceCloseDate ? ' (da conta)' : (diaFech ? ' (derivado das faturas)' : '')));

        var txs = pluggyTransacoes(c.id, de, ate);
        var origens = {}, meses = {}, pend = 0, negativos = 0, parcelados = 0;
        txs.forEach(function (t) {
          var d = _derivarMes(t, mapa, diaFech);
          origens[d.origem] = (origens[d.origem] || 0) + 1;
          meses[d.mes] = (meses[d.mes] || 0) + 1;
          if (t.status === 'PENDING') pend++;
          if (t.amount < 0) negativos++;
          var mm = t.creditCardMetadata || {};
          if (mm.totalInstallments > 1) parcelados++;
        });

        p('        transações (±45d): ' + txs.length +
          '  | faturas: ' + faturas.length +
          '  | em aberto: ' + pend +
          '  | negativas: ' + negativos +
          '  | parceladas: ' + parcelados);
        p('        regra do mês: ' + JSON.stringify(origens));
        p('        meses: ' + JSON.stringify(meses));

        if (!txs.length) {
          p('        ⚠️  Nenhuma transação no período.');
        } else if (origens.ESTIMADO && !origens.BILL && !origens.FORECAST) {
          p('        ⚠️  Só ESTIMADO — sem billId nem previsão do Pluggy.');
          if (!diaFech) p('        ⚠️  E sem dia de fechamento: o mês vira o da compra.');
        }
      } catch (e) {
        p('        ⚠️  não consegui ler transações: ' + e.message);
      }
    });
  });

  p('');
  p('=== RESUMO: ' + items.ids.length + ' item(s), ' + totalCartoes + ' cartão(ões), ' +
    comProblema + ' problema(s) ===');
  p('Nada foi escrito na planilha.');
  if (!comProblema && totalCartoes) {
    p('Tudo certo. Pode seguir para simularMigracaoMeses().');
  }

  return log.join('\n');
}

// ── Sincronização ────────────────────────────────────────────────────────────

function sincronizarAgora() {
  return sincronizar('manual');
}

/**
 * Força o Pluggy a ir ao banco e só depois sincroniza.
 *
 * Use quando faltar transação recente: `sincronizarAgora()` sozinho relê o
 * cache do Pluggy, então uma compra que o Pluggy ainda não viu não aparece.
 *
 * O PATCH é assíncrono. Esperamos o item sair de UPDATING por até ~2 min; se
 * demorar mais, o sync roda com o que houver e basta rodar de novo depois.
 */
function atualizarDoBancoESincronizar() {
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  var items = pluggyItems();
  p('Pedindo atualização de ' + items.ids.length + ' item(s) no Pluggy...');

  var recusados = [];
  items.ids.forEach(function (itemId) {
    var r = pluggyAtualizarItem(itemId);
    if (!r.ok) {
      var msg = (r.body && r.body.message) ? r.body.message : 'sem detalhe';
      p('  ⚠️ ' + itemId + ': HTTP ' + r.code + ' — ' + msg);
      recusados.push(itemId);
      return;
    }
    p('  ' + itemId + ': ' + (r.body.status || '?') + ' (antes: ' + (r.body.lastUpdatedAt || '?') + ')');
  });

  if (recusados.length) {
    p('');
    p('  ℹ️ Item do Meu Pluggy não aceita atualização por API. É restrição de');
    p('     autorização: o item pertence à aplicação Meu Pluggy, e a nossa');
    p('     clientId só tem leitura sobre ele. Pelo site do Meu Pluggy a mesma');
    p('     atualização roda sem pedir senha, em ~1 min.');
    p('');
    p('     Caminho manual:');
    recusados.forEach(function (id) {
      p('       https://meu.pluggy.ai/connections/' + id + '  → botão Atualizar');
    });
    p('');
    p('     Depois volte aqui e rode sincronizarAgora() (ou clique 🔄 no app).');
  }

  // Espera terminar. 24 × 5s = 2 min de teto.
  var pendentes = items.ids.slice();
  for (var tentativa = 0; tentativa < 24 && pendentes.length; tentativa++) {
    Utilities.sleep(5000);
    pendentes = pendentes.filter(function (itemId) {
      var info = pluggyItem(itemId);
      var st = info.ok && info.body ? info.body.status : '?';
      if (st === 'UPDATING' || st === 'CREATING') return true;
      if (st === 'WAITING_USER_INPUT') {
        p('  ⏸️ ' + itemId + ': o banco pediu autenticação. Resolva em meu.pluggy.ai.');
      }
      return false;
    });
  }
  if (pendentes.length) {
    p('⏳ ' + pendentes.length + ' item(s) ainda atualizando. Sincronizando com o que houver;');
    p('   rode sincronizarAgora() daqui a pouco para pegar o resto.');
  } else {
    p('✅ Pluggy terminou de atualizar.');
  }

  p('');
  p('Sincronizando para a planilha...');
  sincronizar('manual-forcado');
  p('Pronto. Confira com conferirFatura().');
  return log.join('\n');
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
    garantirAbas();   // inclui OF_AJUSTES, sem a qual o app não lê nada de OF_*
    var hoje = new Date();
    var de = new Date(hoje.getTime() - JANELA_DIAS_ATRAS * 86400000);
    var ate = new Date(hoje.getTime() + JANELA_DIAS_FRENTE * 86400000);
    var dataDe = _isoData(de), dataAte = _isoData(ate);

    var items = pluggyItems();
    var cartoes = [], transacoes = [], accountIds = [], avisos = [], faturasOut = [];

    var maisAntigoNoPluggy = null;

    items.ids.forEach(function (itemId) {
      var info = pluggyItem(itemId);
      var st = info.ok && info.body ? info.body.status : 'ERRO_HTTP_' + info.code;
      var conector = info.ok && info.body && info.body.connector ? info.body.connector.name : itemId;
      statusGravar_um('item_' + itemId + '_status', st + ' — ' + conector);

      // QUANDO O PLUGGY LEU O BANCO — não é o mesmo que quando NÓS lemos o
      // Pluggy. `sincronizarAgora()` só relê o que o Pluggy já tem em cache;
      // se o Pluggy não foi ao banco hoje, uma compra de ontem não existe para
      // nós por mais que a gente sincronize. Sem esse dado gravado, a diferença
      // era invisível e parecia bug do app.
      var lu = info.ok && info.body ? info.body.lastUpdatedAt : null;
      if (lu) {
        statusGravar_um('item_' + itemId + '_pluggy_em', lu);
        if (!maisAntigoNoPluggy || String(lu) < String(maisAntigoNoPluggy)) maisAntigoNoPluggy = lu;
      }

      if (st === 'LOGIN_ERROR' || st === 'OUTDATED') {
        avisos.push(conector + ': ' + st + ' (renove a conexão em meu.pluggy.ai)');
      }

      pluggyContasCredito(itemId).forEach(function (c) {
        var cd = c.creditData || {};

        // Faturas primeiro: além do mapa billId→vencimento, elas são a fonte
        // do dia de fechamento quando balanceCloseDate vem nulo (caso do Itaú).
        var faturas = pluggyFaturas(c.id);
        var mapaFaturas = {};
        faturas.forEach(function (b) {
          if (b && b.id && b.dueDate) mapaFaturas[b.id] = b.dueDate;
        });
        var diaFech = _diaFechamento(cd, faturas);
        var diaVenc = _diaVencimento(cd, faturas);

        cartoes.push({
          account_id: c.id,
          item_id: itemId,
          nome: c.name || c.marketingName || conector,
          ultimos_digitos: c.number ? String(c.number).slice(-4) : '',
          limite: cd.creditLimit || '',
          fechamento: diaFech || '',
          vencimento: diaVenc || ''
        });
        accountIds.push(c.id);

        // Total oficial de cada fatura, para o app poder confrontar o que
        // calcula com o que o banco diz.
        faturas.forEach(function (b) {
          if (!b || !b.dueDate) return;
          var dv = new Date(b.dueDate);
          if (isNaN(dv.getTime())) return;
          faturasOut.push({
            account_id: c.id,
            mes_ref: _mesKey(dv.getUTCFullYear(), dv.getUTCMonth()),
            vencimento: String(b.dueDate).slice(0, 10),
            fechamento: b.billClosingDate ? String(b.billClosingDate).slice(0, 10) : '',
            total_banco: Number(b.totalAmount || 0)
          });
        });

        pluggyTransacoes(c.id, dataDe, dataAte).forEach(function (tx) {
          transacoes.push(_mapearTransacao(tx, c, mapaFaturas, diaFech, diaVenc));
        });
      });
    });

    gravarCartoes(cartoes);
    gravarFaturas(faturasOut);
    var res = gravarTransacoes(transacoes, accountIds, dataDe, dataAte);

    var segundos = Math.round((new Date() - inicio) / 1000);
    statusGravar({
      ultimo_sync: new Date(),
      ultimo_sync_motivo: motivo,
      ultimo_sync_resumo: cartoes.length + ' cartões · ' + res.gravadas + ' transações · ' +
                          segundos + 's · janela ' + dataDe + ' a ' + dataAte,
      // O mais desatualizado entre os items: é o que limita o que o app mostra.
      pluggy_atualizado_em: maisAntigoNoPluggy || '',
      ultimo_erro: avisos.length ? avisos.join(' | ') : ''
    });

    // Registra a observação. Duas colunas importam: quando NÓS lemos e quando o
    // PLUGGY visitou o banco. Com alguns dias disso dá para saber o horário em
    // que o Pluggy atualiza — e alinhar nosso gatilho — em vez de supor.
    try {
      var sLog = aba(ABA_SYNC_LOG, COLS_SYNC_LOG);
      var maisNova = '';
      transacoes.forEach(function (t) {
        var d = String(t.data || '');
        if (d && d <= _isoData(hoje) && d > maisNova) maisNova = d;   // ignora parcela futura
      });
      sLog.appendRow([new Date(), cartoes.length + ' cartão(ões)', '',
        maisAntigoNoPluggy || '', '', new Date(), maisNova, motivo]);
    } catch (eLog) {
      Logger.log('Aviso: não consegui registrar em ' + ABA_SYNC_LOG + ': ' + eLog);
    }

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
