/* QA do Módulo 1: sintaxe dos .gs + testes da lógica pura. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.join(__dirname, '..', 'apps-script');
let falhas = 0, passes = 0;

function ok(nome, cond, extra) {
  if (cond) { passes++; console.log('  ✅ ' + nome); }
  else { falhas++; console.log('  ❌ ' + nome + (extra ? '  → ' + extra : '')); }
}
function eq(nome, atual, esperado) {
  ok(nome + ' = ' + JSON.stringify(esperado), atual === esperado,
     'obteve ' + JSON.stringify(atual));
}

// ── 1. Sintaxe de todos os .gs ───────────────────────────────────────────────
console.log('\n=== 1. SINTAXE ===');
const arquivos = fs.readdirSync(DIR).filter(f => f.endsWith('.gs'));
for (const f of arquivos) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  try { new vm.Script(src, { filename: f }); ok(f, true); }
  catch (e) { ok(f, false, e.message); }
}

// ── 2. Carrega tudo num sandbox com stubs dos globais do Apps Script ─────────
console.log('\n=== 2. CARGA COM STUBS ===');
const sandbox = {
  console,
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  UrlFetchApp: { fetch: () => { throw new Error('rede não deve ser chamada no QA'); } },
  SpreadsheetApp: { getActive: () => { throw new Error('planilha não deve ser tocada no QA'); } },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { throw new Error('no-op'); } },
};
vm.createContext(sandbox);
try {
  for (const f of arquivos) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  }
  ok('todos os .gs carregam juntos sem colisão de nomes', true);
} catch (e) {
  ok('carga conjunta', false, e.message);
  console.log('\nAbortando — não dá para testar a lógica.');
  process.exit(1);
}

// ── 3. Migração de mês ───────────────────────────────────────────────────────
console.log('\n=== 3. _converterMes (migração ANO-MÊS) ===');
const cm = s => sandbox._converterMes(s).novo;
eq('MAIO', cm('MAIO'), '2026-05');
eq('JANEIRO', cm('JANEIRO'), '2026-01');
eq('DEZEMBRO', cm('DEZEMBRO'), '2026-12');
eq('SETEMBRO', cm('SETEMBRO'), '2026-09');
eq('OUTUBRO', cm('OUTUBRO'), '2026-10');
eq('MARÇO (com cedilha)', cm('MARÇO'), '2026-03');
eq('MARCO (sem acento)', cm('MARCO'), '2026-03');
eq('maio minúsculo', cm('maio'), '2026-05');
eq('"  MAIO  " com espaços', cm('  MAIO  '), '2026-05');
eq('idempotente: 2026-05', cm('2026-05'), '2026-05');
eq('idempotente: 2027-11', cm('2027-11'), '2027-11');
ok('vazio não converte', sandbox._converterMes('').motivo === 'vazio');
ok('lixo não converte', sandbox._converterMes('XPTO').motivo === 'não reconhecido');
ok('lixo preserva (novo=null)', sandbox._converterMes('XPTO').novo === null);

// ── 4. Normalização (precisa casar com o App.jsx p/ o fingerprint) ──────────
console.log('\n=== 4. _normalizar ===');
eq('acentos', sandbox._normalizar('Café São Paulo'), 'CAFE SAO PAULO');
eq('pontuação vira espaço', sandbox._normalizar('IFOOD*RESTAURANTE'), 'IFOOD RESTAURANTE');
eq('espaços colapsam', sandbox._normalizar('A   B'), 'A B');
eq('null é seguro', sandbox._normalizar(null), '');

// Compara com a implementação real do App.jsx
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
const mNorm = appSrc.match(/function normalize\(s\)\{[^}]*\}/);
if (mNorm) {
  const appNorm = vm.runInNewContext('(' + mNorm[0].replace('function normalize', 'function') + ')');
  const amostras = ['Café São Paulo', 'IFOOD*REST', 'AMAZON PRIME BR', 'Uber   *Trip', 'ç~á'];
  const iguais = amostras.every(a => appNorm(a) === sandbox._normalizar(a));
  ok('normalize do App.jsx === _normalizar do Apps Script (fingerprint casa)', iguais,
     iguais ? '' : amostras.map(a => a + ': app=' + appNorm(a) + ' gs=' + sandbox._normalizar(a)).join(' | '));
} else {
  ok('achou normalize() no App.jsx', false);
}

// ── 5. Derivação do mês da fatura ────────────────────────────────────────────
console.log('\n=== 5. _derivarMes ===');
const dm = sandbox._derivarMes;

let r = dm({ date: '2026-08-10T00:00:00Z', creditCardMetadata: { billId: 'b1' } },
           { b1: '2026-09-05T00:00:00Z' }, 15);
ok('billId conhecido → BILL', r.origem === 'BILL', JSON.stringify(r));
eq('  mês vem do vencimento da fatura', r.mes, '2026-09');

// Casos ancorados nos dados REAIS do Itaú: fecha dia 3, vence dia 10.
// Verificado contra a fatura do banco em 15/08/2026.
console.log('     -- ciclo real do Itaú: fecha 3, vence 10 --');
r = dm({ date: '2026-07-02T00:00:00Z', creditCardMetadata: {} }, {}, 3, 10);
eq('compra 02/07 (véspera do fechamento) → fatura de julho', r.mes, '2026-07');
r = dm({ date: '2026-07-03T00:00:00Z', creditCardMetadata: {} }, {}, 3, 10);
eq('compra 03/07 (NO dia do fechamento) → fatura de agosto', r.mes, '2026-08');
r = dm({ date: '2026-08-10T00:00:00Z', creditCardMetadata: {} }, {}, 3, 10);
eq('compra 10/08 (fatura em aberto) → fatura de setembro', r.mes, '2026-09');
ok('sem billId mas com fechamento → CICLO', r.origem === 'CICLO', JSON.stringify(r));

r = dm({ date: '2026-12-05T00:00:00Z', creditCardMetadata: {} }, {}, 3, 10);
eq('virada de ano: 05/12 c/ fech. 3 → jan seguinte', r.mes, '2027-01');

// O billForecastDate usa outra convenção de mês; só entra se não houver ciclo.
r = dm({ date: '2026-08-10T00:00:00Z', creditCardMetadata: { billForecastDate: '2026-08' } }, {}, 3, 10);
eq('ciclo TEM precedência sobre billForecastDate', r.mes, '2026-09');
ok('  e a regra registrada é CICLO', r.origem === 'CICLO');

r = dm({ date: '2026-08-10T00:00:00Z', creditCardMetadata: { billForecastDate: '2026-09' } }, {}, null);
ok('sem dia de fechamento → cai em FORECAST', r.origem === 'FORECAST', JSON.stringify(r));
eq('  e usa a previsão do Pluggy', r.mes, '2026-09');

r = dm({ date: '2026-08-20T00:00:00Z', creditCardMetadata: { billId: 'inexistente' } }, {}, 3, 10);
ok('billId desconhecido cai no ciclo', r.origem === 'CICLO');

r = dm({ date: '2026-08-20T00:00:00Z', creditCardMetadata: { billForecastDate: 'lixo' } }, {}, null);
ok('billForecastDate malformado é rejeitado', r.origem === 'FORECAST');
eq('  e usa o mês da transação', r.mes, '2026-08');

// Banco que vence ANTES de fechar (vencimento no mês seguinte ao fechamento).
r = dm({ date: '2026-08-10T00:00:00Z', creditCardMetadata: {} }, {}, 25, 5);
eq('fecha 25 / vence 5 do mês seguinte: compra 10/08 → set', r.mes, '2026-09');

// ── 5c. Natureza da transação ───────────────────────────────────────────────
console.log('\n=== 5c. _tipoTransacao (o banco não soma o pagamento) ===');
const tt = sandbox._tipoTransacao;
eq('compra comum', tt({ description: 'IFOOD *REST', amount: 57.9 }), 'COMPRA');
eq('"Pagamento recebido" → PAGAMENTO', tt({ description: 'Pagamento recebido', amount: -5645.77 }), 'PAGAMENTO');
eq('"PGTO FATURA" → PAGAMENTO', tt({ description: 'PGTO FATURA ANTERIOR', amount: -1240 }), 'PAGAMENTO');
eq('estorno → ESTORNO', tt({ description: 'ESTORNO IFOOD', amount: -94.6 }), 'ESTORNO');
eq('crédito sem palavra-chave → ESTORNO', tt({ description: 'DEVOLUCAO LOJA', amount: -30 }), 'ESTORNO');
ok('"PAGAMENTO" positivo NÃO vira pagamento (é compra numa loja com esse nome)',
   tt({ description: 'CASA DE PAGAMENTOS LTDA', amount: 50 }) === 'COMPRA');

// ── 5b. Dia de fechamento (Itaú devolve balanceCloseDate nulo) ──────────────
console.log('\n=== 5b. _diaFechamento ===');
const df = sandbox._diaFechamento;
eq('usa balanceCloseDate quando existe',
   df({ balanceCloseDate: '2026-08-18T00:00:00Z' }, []), 18);
eq('deriva das faturas quando balanceCloseDate é nulo',
   df({ balanceCloseDate: null },
      [{ billClosingDate: '2026-07-12T00:00:00Z' }, { billClosingDate: '2026-08-12T00:00:00Z' }]), 12);
eq('escolhe o dia mais frequente (fechamento cai em fim de semana)',
   df({}, [{ billClosingDate: '2026-06-12T00:00:00Z' },
            { billClosingDate: '2026-07-12T00:00:00Z' },
            { billClosingDate: '2026-08-14T00:00:00Z' }]), 12);
eq('sem nada devolve null', df({}, []), null);
eq('creditData nulo é seguro', df(null, []), null);
eq('ignora billClosingDate inválido',
   df({}, [{ billClosingDate: 'lixo' }, { billClosingDate: '2026-08-09T00:00:00Z' }]), 9);
ok('conta sem fechamento não quebra a derivação do mês',
   sandbox._derivarMes({ date: '2026-08-20T00:00:00Z', creditCardMetadata: {} }, {}, null).mes === '2026-08');

// ── 6. Mapeamento da transação ───────────────────────────────────────────────
console.log('\n=== 6. _mapearTransacao ===');
const tx = {
  id: 'tx-1', date: '2026-08-10T12:00:00Z', description: 'IFOOD *RESTAURANTE',
  amount: 57.9, status: 'POSTED',
  creditCardMetadata: { billId: 'b1', installmentNumber: 3, totalInstallments: 12,
                        totalAmount: 694.8, purchaseDate: '2026-06-08T00:00:00Z' }
};
const m = sandbox._mapearTransacao(tx, { id: 'acc-1' }, { b1: '2026-09-05T00:00:00Z' }, 15);
eq('valor preserva o sinal (sem Math.abs)', m.valor, 57.9);
eq('parcela_num', m.parcela_num, 3);
eq('parcela_total', m.parcela_total, 12);
eq('data em ISO', m.data, '2026-08-10');
eq('data_compra em ISO', m.data_compra, '2026-06-08');
eq('mes_ref', m.mes_ref, '2026-09');
ok('fingerprint tem 3 partes', m.fingerprint.split('|').length === 3, m.fingerprint);

const estorno = sandbox._mapearTransacao(
  { id: 'tx-2', date: '2026-08-11T00:00:00Z', description: 'ESTORNO', amount: -30, status: 'POSTED' },
  { id: 'acc-1' }, {}, 15);
eq('ESTORNO continua negativo', estorno.valor, -30);

// ── 7. Consistência de chave de mês entre app e script ───────────────────────
console.log('\n=== 7. CONSISTÊNCIA App.jsx ↔ Apps Script ===');
// Extrai uma função equilibrando chaves — regex simples trunca em corpo aninhado.
function extrairFuncao(src, assinatura) {
  const i = src.indexOf(assinatura);
  if (i === -1) return null;
  let j = src.indexOf('{', i), nivel = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') nivel++;
    else if (src[k] === '}') { nivel--; if (nivel === 0) return src.slice(i, k + 1); }
  }
  return null;
}
const mParse = extrairFuncao(appSrc, 'function parseMesRef(raw)');
const mKey = extrairFuncao(appSrc, 'function mesKey(ano,mesIdx)');
if (mParse && mKey) {
  const ctx = { MESES: ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'], ANO_LEGADO: 2026 };
  vm.createContext(ctx);
  vm.runInContext(mKey + '\n' + mParse, ctx);
  const casos = ['MAIO', 'DEZEMBRO', '2026-08', '2027-01'];
  const iguais = casos.every(c => {
    const app = ctx.parseMesRef(c);
    const gs = sandbox._converterMes(c).novo;
    return app === gs;
  });
  ok('parseMesRef(App.jsx) === _converterMes(Apps Script)', iguais,
     iguais ? '' : casos.map(c => c + ': app=' + ctx.parseMesRef(c) + ' gs=' + sandbox._converterMes(c).novo).join(' | '));
} else {
  ok('achou parseMesRef/mesKey no App.jsx', false);
}

// ── 8. Contrato de colunas ───────────────────────────────────────────────────
console.log('\n=== 8. CONTRATO DE COLUNAS ===');
ok('COLS_TRANSACOES sem duplicata',
   new Set(sandbox.COLS_TRANSACOES).size === sandbox.COLS_TRANSACOES.length);
const camposMapeados = Object.keys(m);
const faltando = sandbox.COLS_TRANSACOES.filter(c => c !== 'atualizado_em' && !camposMapeados.includes(c));
ok('toda coluna de OF_TRANSACOES é preenchida por _mapearTransacao',
   faltando.length === 0, 'faltando: ' + faltando.join(', '));

// ── 9. Gerador de dados de exemplo ───────────────────────────────────────────
console.log('\n=== 9. popularDadosExemplo (fixtures do Módulo 2) ===');
const escritas = {};
sandbox.aba = (nome) => ({ __nome: nome });
sandbox.escreverLinhas = (sheet, linhas) => { escritas[sheet.__nome] = linhas; };
sandbox.lerLinhas = () => [];
sandbox.statusGravar = () => {};
try {
  sandbox.popularDadosExemplo();
  const txs = escritas['OF_TRANSACOES'] || [];
  const cards = escritas['OF_CARTOES'] || [];

  ok('gerou transações', txs.length > 20, 'gerou ' + txs.length);
  ok('gerou 2 cartões', cards.length === 2, 'gerou ' + cards.length);
  ok('toda linha tem o nº de colunas do contrato',
     txs.every(l => l.length === sandbox.COLS_TRANSACOES.length));
  ok('ids únicos', new Set(txs.map(l => l[0])).size === txs.length);

  const iMes = sandbox.COLS_TRANSACOES.indexOf('mes_ref');
  const iStatus = sandbox.COLS_TRANSACOES.indexOf('status');
  const iValor = sandbox.COLS_TRANSACOES.indexOf('valor');
  const iData = sandbox.COLS_TRANSACOES.indexOf('data');
  const iOrigem = sandbox.COLS_TRANSACOES.indexOf('origem_mes');

  ok('todo mes_ref no formato ANO-MÊS',
     txs.every(l => /^\d{4}-\d{2}$/.test(l[iMes])),
     txs.filter(l => !/^\d{4}-\d{2}$/.test(l[iMes])).map(l => l[iMes]).join(','));
  ok('toda data no formato ISO',
     txs.every(l => /^\d{4}-\d{2}-\d{2}$/.test(l[iData])),
     txs.filter(l => !/^\d{4}-\d{2}-\d{2}$/.test(l[iData])).map(l => l[iData]).join(','));
  ok('tem POSTED e PENDING (fatura fechada e aberta)',
     txs.some(l => l[iStatus] === 'POSTED') && txs.some(l => l[iStatus] === 'PENDING'));
  ok('tem valor negativo (estorno/pagamento)', txs.some(l => l[iValor] < 0));
  ok('tem compra parcelada em andamento',
     txs.some(l => l[sandbox.COLS_TRANSACOES.indexOf('parcela_total')] > 1));
  ok('cobre as 3 regras de mês',
     new Set(txs.map(l => l[iOrigem])).size === 3,
     [...new Set(txs.map(l => l[iOrigem]))].join(','));
  ok('todo valor é número', txs.every(l => typeof l[iValor] === 'number'));

  const iTipo = sandbox.COLS_TRANSACOES.indexOf('tipo');
  const tipos = new Set(txs.map(l => l[iTipo]));
  ok('fixtures cobrem COMPRA, PAGAMENTO e ESTORNO',
     tipos.has('COMPRA') && tipos.has('PAGAMENTO') && tipos.has('ESTORNO'),
     [...tipos].join(','));
  // O total da fatura ignora o pagamento — é assim que o banco calcula.
  const totalComPagto = txs.reduce((a, l) => a + l[iValor], 0);
  const totalSemPagto = txs.filter(l => l[iTipo] !== 'PAGAMENTO').reduce((a, l) => a + l[iValor], 0);
  ok('excluir PAGAMENTO muda o total (senão o valor não bate com o banco)',
     Math.abs(totalComPagto - totalSemPagto) > 1);

  const meses = [...new Set(txs.map(l => l[iMes]))].sort();
  ok('cobre 3 meses distintos', meses.length === 3, meses.join(','));
  console.log('     meses gerados: ' + meses.join(', '));
} catch (e) {
  ok('popularDadosExemplo executa', false, e.message);
}

console.log('\n' + '='.repeat(52));
console.log('RESULTADO: ' + passes + ' passaram, ' + falhas + ' falharam');
console.log('='.repeat(52));
process.exit(falhas ? 1 : 0);
