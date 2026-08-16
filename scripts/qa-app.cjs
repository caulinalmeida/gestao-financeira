/* QA da lógica de merge do App.jsx (Open Finance × ajustes do usuário).
   Extrai as funções puras do arquivo e as executa fora do React. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, '..', 'src', 'App.jsx');
const src = fs.readFileSync(APP, 'utf8');

let falhas = 0, passes = 0;
function ok(nome, cond, extra) {
  if (cond) { passes++; console.log('  ✅ ' + nome); }
  else { falhas++; console.log('  ❌ ' + nome + (extra ? '  → ' + extra : '')); }
}
function eq(nome, atual, esperado) {
  const bate = JSON.stringify(atual) === JSON.stringify(esperado);
  ok(nome + ' = ' + JSON.stringify(esperado), bate, 'obteve ' + JSON.stringify(atual));
}

/** Extrai uma declaração equilibrando chaves (regex trunca em corpo aninhado). */
function extrair(assinatura) {
  const i = src.indexOf(assinatura);
  if (i === -1) return null;
  const j = src.indexOf('{', i);
  if (j === -1) return null;
  let nivel = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') nivel++;
    else if (src[k] === '}') { nivel--; if (nivel === 0) return src.slice(i, k + 1); }
  }
  return null;
}
/** Extrai um const de uma linha só. */
function extrairLinha(prefixo) {
  const l = src.split('\n').find(x => x.trim().startsWith(prefixo));
  return l ? l.trim() : null;
}

console.log('\n=== 1. EXTRAÇÃO DAS FUNÇÕES PURAS ===');
const alvos = [
  'function fmtBRL(', 'function parseBRL(', 'function normalize(', 'function matchDict(',
  'function mesKey(', 'function parseMesRef(', 'function mesPartes(',
  'function parseDataFlex(', 'function dataCurta(',
  'function rowToOfTx(', 'function rowToOfCartao(', 'function rowToOfFatura(',
  'function rowToAjuste(', 'function ajusteToRow(', 'function ajusteVazio(',
  'function nomeCartao(', 'function classificaAuto(',
  'function mergeFatura(', 'function totalFatura(',
  'function mesProximo(', 'function chaveCompra(', 'function projetarParcelas(',
  'function semSufixoParcela(',
  'function participantes(', 'function valorDe(', 'function donoCanonico(',
  'function terceirosDe(', 'function chavePago(', 'function chaveGrupo(',
];
const pedacos = [];
let faltou = [];
for (const a of alvos) {
  const c = extrair(a);
  if (c) pedacos.push(c); else faltou.push(a);
}
const linhas = [
  extrairLinha('const MESES ='),
  extrairLinha('const ANO_LEGADO ='),
  extrairLinha('const chaveAjuste='),
  extrairLinha('const CASAL ='),
  extrairLinha('const DIVIDIDO ='),
].filter(Boolean);
ok('todas as funções alvo foram encontradas', faltou.length === 0, faltou.join(', '));
ok('constantes MESES/ANO_LEGADO/chaveAjuste/CASAL/DIVIDIDO encontradas', linhas.length === 5);

const ctx = {};
vm.createContext(ctx);
try {
  vm.runInContext(linhas.join('\n') + '\n' + pedacos.join('\n'), ctx);
  ok('funções carregam sem erro', true);
} catch (e) {
  ok('funções carregam sem erro', false, e.message);
  process.exit(1);
}

// ── 2. Leitura de dados vindos do Sheets ─────────────────────────────────────
console.log('\n=== 2. parseDataFlex (Sheets devolve valor FORMATADO) ===');
eq('ISO passa direto', ctx.parseDataFlex('2026-08-10'), '2026-08-10');
eq('formato BR é convertido', ctx.parseDataFlex('03/07/2026'), '2026-07-03');
eq('BR com um dígito', ctx.parseDataFlex('3/7/2026'), '2026-07-03');
eq('ISO com hora', ctx.parseDataFlex('2026-08-10T12:00:00Z'), '2026-08-10');
eq('vazio é seguro', ctx.parseDataFlex(''), '');
eq('null é seguro', ctx.parseDataFlex(null), '');

console.log('\n=== 3. parseBRL nos valores do Sheets ===');
eq('formato BR com vírgula', ctx.parseBRL('55,9'), 55.9);
eq('negativo BR', ctx.parseBRL('-94,6'), -94.6);
eq('milhar BR', ctx.parseBRL('1.234,56'), 1234.56);
eq('número puro', ctx.parseBRL('1920.72'), 1920.72);
eq('negativo puro', ctx.parseBRL('-1240'), -1240);
eq('número nativo', ctx.parseBRL(57.9), 57.9);

// ── 4. Merge: a garantia central do módulo ───────────────────────────────────
console.log('\n=== 4. mergeFatura ===');
const cartoes = [{ accountId: 'acc-1', nome: 'Uniclass Black', ultimos: '3216' }];
const dict = [{ key: 'NETFLIX', dono: 'Dividido', parcelas: 'RECORRENTE', obs: 'streaming' }];

const tx = (o) => Object.assign({
  id: 'tx-1', accountId: 'acc-1', mesRef: '2026-08', origemMes: 'BILL', natureza: 'COMPRA',
  data: '2026-08-10', nome: 'LOJA XPTO', valor: 100, status: 'POSTED', billId: 'b1',
  parcelaNum: 0, parcelaTotal: 0, valorTotal: 0, dataCompra: '', fingerprint: 'LOJA XPTO|100|2026-08-10'
}, o);

const M = (txs, ajustes, opts) => ctx.mergeFatura(txs, ajustes || {}, dict, cartoes,
  Object.assign({ mesRef: '2026-08', mostrarIgnoradas: false, mostrarPagamentos: false }, opts));

let r = M([tx({})], {});
eq('transação sem ajuste e sem dicionário fica sem dono', r[0].dono, '');
ok('  e é marcada como NOVA', r[0].isNew === true);
eq('  cartão resolvido pelo accountId', r[0].cartao, 'Uniclass Black ·3216');

r = M([tx({ nome: 'NETFLIX.COM' })], {});
eq('dicionário preenche o dono', r[0].dono, 'Dividido');
eq('  e a classificação', r[0].parcelas, 'RECORRENTE');
ok('  e deixa de ser nova', r[0].isNew === false);

// A garantia nº 1: ajuste do usuário vence o dicionário e sobrevive ao sync.
r = M([tx({ nome: 'NETFLIX.COM' })], { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', dono: 'Caulin' } });
eq('AJUSTE vence o dicionário', r[0].dono, 'Caulin');

r = M([tx({ nome: 'NETFLIX.COM', valor: 999 })],
      { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', dono: 'Luanna' } });
eq('sync muda o VALOR mas o dono do usuário permanece', r[0].dono, 'Luanna');
eq('  e o valor novo do banco é respeitado', r[0].valor, 999);

// A garantia nº 2: ignorar é durável — o sync não ressuscita.
r = M([tx({})], { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', ignorada: true } });
eq('transação ignorada some da lista', r.length, 0);
r = M([tx({})], { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', ignorada: true } }, { mostrarIgnoradas: true });
eq('  mas reaparece com o toggle', r.length, 1);
ok('  marcada como ignorada', r[0].ignorada === true);

// Religação por fingerprint quando o Pluggy troca o id da transação.
r = M([tx({ id: 'tx-NOVO-ID' })],
      { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', dono: 'Caulin', fingerprint: 'LOJA XPTO|100|2026-08-10' } });
eq('id trocado pelo Pluggy: ajuste religa pelo fingerprint', r[0].dono, 'Caulin');

// Pagamento da fatura: escondido por padrão, e fora do total.
const comPagto = [tx({}), tx({ id: 'tx-2', natureza: 'PAGAMENTO', valor: -5000, nome: 'Pagamento recebido' })];
r = M(comPagto, {});
eq('pagamento fica escondido por padrão', r.length, 1);
r = M(comPagto, {}, { mostrarPagamentos: true });
eq('  aparece com o toggle', r.length, 2);

console.log('\n=== 5. totalFatura (tem que bater com o banco) ===');
eq('soma simples', ctx.totalFatura([{ valor: 100, natureza: 'COMPRA' }, { valor: 50, natureza: 'COMPRA' }]), 150);
eq('estorno abate', ctx.totalFatura([{ valor: 100, natureza: 'COMPRA' }, { valor: -30, natureza: 'ESTORNO' }]), 70);
eq('PAGAMENTO fica FORA do total (é assim que o banco calcula)',
   ctx.totalFatura([{ valor: 100, natureza: 'COMPRA' }, { valor: -5000, natureza: 'PAGAMENTO' }]), 100);
eq('ignorada fica fora do total',
   ctx.totalFatura([{ valor: 100, natureza: 'COMPRA' }, { valor: 70, natureza: 'COMPRA', ignorada: true }]), 100);

console.log('\n=== 6. Filtros de mês e status ===');
const multi = [
  tx({ id: 'a', mesRef: '2026-08', status: 'POSTED' }),
  tx({ id: 'b', mesRef: '2026-09', status: 'PENDING' }),
  tx({ id: 'c', mesRef: '2026-08', status: 'PENDING' }),
];
eq('filtra por mês', M(multi, {}, { mesRef: '2026-08' }).length, 2);
eq('filtra por mês + status POSTED', M(multi, {}, { mesRef: '2026-08', status: 'POSTED' }).length, 1);
eq('filtra por mês + status PENDING', M(multi, {}, { mesRef: '2026-08', status: 'PENDING' }).length, 1);
eq('mês sem dados devolve vazio', M(multi, {}, { mesRef: '2026-12' }).length, 0);

r = M([tx({})], { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', mesRefOverride: '2026-09' } }, { mesRef: '2026-08' });
eq('mes_ref_override move a transação de mês', r.length, 0);
r = M([tx({})], { 'TX:tx-1': { tipo: 'TX', refId: 'tx-1', mesRefOverride: '2026-09' } }, { mesRef: '2026-09' });
eq('  e ela aparece no mês de destino', r.length, 1);

console.log('\n=== 7. Parcelas e cartões ===');
r = M([tx({ parcelaNum: 3, parcelaTotal: 12 })], {});
eq('parcela formatada', r[0].parcela, '03/12');
eq('parcelada vira PARCELADO automaticamente', r[0].parcelas, 'PARCELADO');
r = M([tx({ parcelaNum: 0, parcelaTotal: 0 })], {});
eq('não parcelada não tem sufixo', r[0].parcela, '');

eq('apelido do usuário vence o nome do banco',
   ctx.nomeCartao('acc-1', cartoes, { 'CARTAO:acc-1': { tipo: 'CARTAO', refId: 'acc-1', apelido: 'Black do Caulin' } }),
   'Black do Caulin');
eq('cartão desconhecido vira "Outros"', ctx.nomeCartao('acc-999', cartoes, {}), 'Outros');

console.log('\n=== 8. ajusteVazio (não sujar a planilha) ===');
ok('ajuste sem decisão é vazio', ctx.ajusteVazio({ tipo: 'TX', refId: 'x' }) === true);
ok('com dono NÃO é vazio', ctx.ajusteVazio({ tipo: 'TX', refId: 'x', dono: 'Caulin' }) === false);
ok('só ignorada NÃO é vazio', ctx.ajusteVazio({ tipo: 'TX', refId: 'x', ignorada: true }) === false);
ok('só apelido NÃO é vazio', ctx.ajusteVazio({ tipo: 'CARTAO', refId: 'x', apelido: 'Black' }) === false);

console.log('\n=== 9. Ida e volta na planilha ===');
const a = { tipo: 'TX', refId: 'tx-9', dono: 'Luanna', classificacao: 'PARCELADO',
            obs: 'viagem', ignorada: true, mesRefOverride: '2026-09', apelido: '',
            fingerprint: 'X|1|2026-01-01' };
const volta = ctx.rowToAjuste(ctx.ajusteToRow(a));
eq('ajuste sobrevive à ida e volta', volta, a);

const linhaTx = ['tx-1', 'acc-1', '2026-08', 'BILL', 'COMPRA', '2026-08-10', 'IFOOD', '57,9',
                 'POSTED', 'b1', '3', '12', '694,8', '2026-06-08', 'IFOOD|57.9|2026-08-10', ''];
const lido = ctx.rowToOfTx(linhaTx);
eq('linha do Sheets → transação: valor', lido.valor, 57.9);
eq('  mês', lido.mesRef, '2026-08');
eq('  parcela', [lido.parcelaNum, lido.parcelaTotal], [3, 12]);
eq('  natureza', lido.natureza, 'COMPRA');

// ── 10. Projeção de parcelas (Módulo 4) ──────────────────────────────────────
console.log('\n=== 10. projetarParcelas ===');

let seq = 0;
function txP(o) {
  return Object.assign({
    id: 'tx-p' + (++seq), accountId: 'acc-1', mesRef: '2026-08', origemMes: 'BILL',
    natureza: 'COMPRA', data: '2026-08-10', nome: 'MAGALU',
    valor: 100, status: 'POSTED', billId: 'b1',
    parcelaNum: 1, parcelaTotal: 12, valorTotal: 1200,
    dataCompra: '2026-08-01', fingerprint: 'fp-' + seq,
  }, o);
}
const cartoesP = [{ accountId: 'acc-1', nome: 'Black', ultimos: '4417' }];
const projP = (txs, aj, dic, base) =>
  ctx.projetarParcelas(txs, aj || {}, dic || [], cartoesP, base || '2026-08', 12);

// Caso central: uma parcela conhecida, o resto projetado.
{
  const r = projP([txP({ parcelaNum: 3, parcelaTotal: 12, mesRef: '2026-08' })]);
  eq('uma compra em curso', r.compras.length, 1);
  eq('restam 10 parcelas (3..12, a partir do mês-base)', r.compras[0].restantes, 10);
  eq('9 delas são projetadas', r.compras[0].projetadas, 9);
  eq('próxima é a 3ª', r.compras[0].proximaNum, 3);
  eq('termina 9 meses depois de agosto/26', r.compras[0].mesFinal, '2027-05');
  eq('falta = 10 × 100', r.compras[0].falta, 1000);
  eq('mês-base tem 1 parcela', r.totalMesBase, 100);
}

// O RISCO do módulo: banco que lança todas as parcelas de uma vez.
{
  const todas = [];
  let mes = '2026-08';
  for (let n = 1; n <= 12; n++) { todas.push(txP({ parcelaNum: n, mesRef: mes })); mes = ctx.mesProximo(mes); }
  const r = projP(todas);
  eq('nada é projetado quando o banco já lançou tudo', r.compras[0].projetadas, 0);
  eq('  restam as 12 reais', r.compras[0].restantes, 12);
  eq('  falta = 12 × 100, não 24 × 100', r.compras[0].falta, 1200);
  const somaJanela = r.porMes.reduce((a, m) => a + m.total, 0);
  eq('  soma da janela não conta dobrado', somaJanela, 1200);
}

// Dedup parcial: banco lançou 1..6, projetamos só 7..12.
{
  const algumas = [];
  let mes = '2026-08';
  for (let n = 1; n <= 6; n++) { algumas.push(txP({ parcelaNum: n, mesRef: mes })); mes = ctx.mesProximo(mes); }
  const r = projP(algumas);
  eq('projeta só o que falta', r.compras[0].projetadas, 6);
  eq('  total continua 12 parcelas', r.compras[0].restantes, 12);
  eq('  última é jul/27', r.compras[0].mesFinal, '2027-07');
}

// Centavos: R$ 100 em 3x = 33,34 + 33,33 + 33,33 tem que agrupar junto.
{
  const r = projP([
    txP({ nome: 'LOJA X', parcelaNum: 1, parcelaTotal: 3, valor: 33.34, valorTotal: 100, mesRef: '2026-08' }),
    txP({ nome: 'LOJA X', parcelaNum: 2, parcelaTotal: 3, valor: 33.33, valorTotal: 100, mesRef: '2026-09' }),
  ]);
  eq('centavo de arredondamento não quebra o agrupamento', r.compras.length, 1);
  eq('  projeta a 3ª', r.compras[0].projetadas, 1);
}

// Ignorada não compromete nada.
{
  const t = txP({ parcelaNum: 3, mesRef: '2026-08' });
  const r = projP([t], { ['TX:' + t.id]: { tipo: 'TX', refId: t.id, ignorada: true } });
  eq('compra ignorada some da projeção', r.compras.length, 0);
  eq('  e não compromete o mês', r.totalMesBase, 0);
}

// Só compras parceladas entram.
{
  const r = projP([
    txP({ parcelaNum: 0, parcelaTotal: 0 }),                      // avulsa
    txP({ natureza: 'PAGAMENTO', valor: -500, parcelaTotal: 0 }),  // pagamento da fatura
    txP({ natureza: 'ESTORNO', valor: -80, parcelaTotal: 0 }),     // estorno
  ]);
  eq('avulsa, pagamento e estorno ficam de fora', r.compras.length, 0);
}
{
  const r = projP([txP({ parcelaNum: 13, parcelaTotal: 12 })]);
  eq('parcela maior que o total é descartada como inconsistente', r.compras.length, 0);
}

// Virada de ano na projeção.
{
  const r = projP([txP({ parcelaNum: 1, parcelaTotal: 4, mesRef: '2026-11' })], {}, [], '2026-11');
  eq('nov/26 + 3 parcelas = fev/27', r.compras[0].mesFinal, '2027-02');
  eq('  meses da janela seguem em ordem',
     r.porMes.slice(0, 4).map(m => m.mesRef), ['2026-11', '2026-12', '2027-01', '2027-02']);
}

// "Termina neste mês" — o alerta do backlog.
{
  const r = projP([txP({ parcelaNum: 12, parcelaTotal: 12, mesRef: '2026-08' })]);
  eq('última parcela cai no mês-base', r.terminando.length, 1);
  eq('  nada projetado depois dela', r.compras[0].projetadas, 0);
}
{
  const r = projP([txP({ parcelaNum: 1, parcelaTotal: 12, mesRef: '2026-08' })]);
  eq('compra recém-começada não aparece como terminando', r.terminando.length, 0);
}

// Parcelas já quitadas antes do mês-base não aparecem.
{
  const r = projP([txP({ parcelaNum: 12, parcelaTotal: 12, mesRef: '2026-05' })], {}, [], '2026-08');
  eq('compra já quitada some da lista', r.compras.length, 0);
}

// O dono vem do ajuste, senão do dicionário.
{
  const t = txP({ parcelaNum: 2, nome: 'IFOOD DELIVERY', mesRef: '2026-08' });
  const semAjuste = projP([t], {}, [{ key: 'IFOOD', dono: 'Dividido', parcelas: 'VARIÁVEL', obs: '' }]);
  eq('dono herdado do dicionário', semAjuste.compras[0].dono, 'Dividido');
  const comAjuste = projP([t], { ['TX:' + t.id]: { tipo: 'TX', refId: t.id, dono: 'Luanna' } },
                         [{ key: 'IFOOD', dono: 'Dividido', parcelas: 'VARIÁVEL', obs: '' }]);
  eq('ajuste do usuário vence o dicionário', comAjuste.compras[0].dono, 'Luanna');
}

// Compras diferentes não se misturam.
{
  const r = projP([
    txP({ nome: 'MAGALU', parcelaNum: 1, parcelaTotal: 6, valor: 50, valorTotal: 300, mesRef: '2026-08' }),
    txP({ nome: 'AMERICANAS', parcelaNum: 1, parcelaTotal: 6, valor: 50, valorTotal: 300, mesRef: '2026-08' }),
  ]);
  eq('comerciantes diferentes = compras diferentes', r.compras.length, 2);
  const r2 = projP([
    txP({ nome: 'MAGALU', parcelaNum: 1, parcelaTotal: 6, valor: 50, valorTotal: 300, mesRef: '2026-08' }),
    txP({ nome: 'MAGALU', parcelaNum: 1, parcelaTotal: 6, valor: 90, valorTotal: 540, mesRef: '2026-08' }),
  ]);
  eq('mesmo comerciante, valores diferentes = compras diferentes', r2.compras.length, 2);
  const r3 = projP([
    txP({ nome: 'MAGALU', accountId: 'acc-1', parcelaNum: 1, parcelaTotal: 6, valor: 50, valorTotal: 300 }),
    txP({ nome: 'MAGALU', accountId: 'acc-2', parcelaNum: 1, parcelaTotal: 6, valor: 50, valorTotal: 300 }),
  ]);
  eq('cartões diferentes = compras diferentes', r3.compras.length, 2);
}

// mesRefOverride do usuário move a parcela de mês.
{
  const t = txP({ parcelaNum: 1, parcelaTotal: 3, mesRef: '2026-08' });
  const r = projP([t], { ['TX:' + t.id]: { tipo: 'TX', refId: t.id, mesRefOverride: '2026-09' } },
                 [], '2026-08');
  eq('override move a âncora, e a projeção segue dela', r.compras[0].mesFinal, '2026-11');
  eq('  mês-base fica sem essa parcela', r.totalMesBase, 0);
}

// porMes: a soma por mês bate com o detalhe.
{
  const r = projP([
    txP({ nome: 'A', parcelaNum: 1, parcelaTotal: 3, valor: 10, valorTotal: 30, mesRef: '2026-08' }),
    txP({ nome: 'B', parcelaNum: 1, parcelaTotal: 2, valor: 25, valorTotal: 50, mesRef: '2026-08' }),
  ]);
  eq('agosto soma as duas primeiras parcelas', r.porMes[0].total, 35);
  eq('setembro também', r.porMes[1].total, 35);
  eq('outubro só tem a de 3x', r.porMes[2].total, 10);
  eq('novembro em diante, nada', r.porMes[3].total, 0);
  ok('itens do mês somam o total do mês',
     r.porMes.every(m => Math.abs(m.itens.reduce((a, i) => a + i.valor, 0) - m.total) < 0.001));
  eq('falta total = 30 + 50', r.totalFalta, 80);
}

// ── 11. Sufixo de parcela na descrição (bug real do Itaú) ───────────────────
console.log('\n=== 11. semSufixoParcela ===');
{
  const ss = ctx.semSufixoParcela;
  // Descrições exatamente como vieram da fatura real.
  eq('SAMSUNG NO ITAU   06/21', ss('SAMSUNG NO ITAU   06/21', 6, 21), 'SAMSUNG NO ITAU');
  eq('AIRBNB * HMP3QS4Y501/06', ss('AIRBNB * HMP3QS4Y501/06', 1, 6), 'AIRBNB * HMP3QS4Y5');
  eq('MERCADOLIVRE*MAIAR03/04', ss('MERCADOLIVRE*MAIAR03/04', 3, 4), 'MERCADOLIVRE*MAIAR');
  eq('aliexpress        03/05', ss('aliexpress        03/05', 3, 5), 'aliexpress');
  eq('OTICA MAX FRBSAO P01/07', ss('OTICA MAX FRBSAO P01/07', 1, 7), 'OTICA MAX FRBSAO P');
  eq('DL*Alipay MAGAZI  11/12', ss('DL*Alipay MAGAZI  11/12', 11, 12), 'DL*Alipay MAGAZI');

  // Só corta quando os números batem com a parcela conhecida.
  eq('números que não batem ficam', ss('LOJA 03/04', 5, 9), 'LOJA 03/04');
  eq('avulsa não é tocada', ss('POSTO SHELL 01/06', 0, 0), 'POSTO SHELL 01/06');
  eq('descrição que vira vazia é preservada', ss('06/21', 6, 21), '06/21');
  eq('sem sufixo passa direto', ss('NETFLIX.COM', 3, 12), 'NETFLIX.COM');
  eq('null é seguro', ss(null, 1, 2), '');

  // O que o bug causava: parcelas da MESMA compra em compras diferentes.
  const t = (n, tot, valor, desc) => ({
    id: 'x' + n, accountId: 'acc-1', natureza: 'COMPRA', mesRef: '2026-0' + n,
    nome: ctx.semSufixoParcela(desc, n, tot), valor, parcelaNum: n, parcelaTotal: tot,
    valorTotal: 0, fingerprint: 'f' + n, status: 'POSTED',
  });
  const samsung = [
    t(6, 21, 53.8, 'SAMSUNG NO ITAU   06/21'),
    t(7, 21, 53.8, 'SAMSUNG NO ITAU   07/21'),
    t(8, 21, 53.8, 'SAMSUNG NO ITAU   08/21'),
  ];
  const chaves = new Set(samsung.map(ctx.chaveCompra));
  eq('3 parcelas da mesma compra → 1 chave só', chaves.size, 1);

  const r11 = ctx.projetarParcelas(samsung, {}, [], [{ accountId: 'acc-1', nome: 'Black' }],
                                   '2026-08', 12);
  eq('vira UMA compra, não três', r11.compras.length, 1);
  // A 08 cai no próprio mês-base, então entra no que falta: 08 + as 13 projetadas.
  eq('  âncora é a 08; restam 14 (ela mais 13 projetadas)', r11.compras[0].restantes, 14);
  eq('  projetadas são 13', r11.compras[0].projetadas, 13);
  eq('  termina 13 meses depois de ago/26', r11.compras[0].mesFinal, '2027-09');
  eq('  falta 14 × 53,80 (antes as 3 compras somavam em triplicata)',
     Math.round(r11.compras[0].falta * 100) / 100, Math.round(14 * 53.8 * 100) / 100);
}

// ── 12. Rateio com terceiros ────────────────────────────────────────────────
console.log('\n=== 12. participantes / valorDe ===');
{
  const P = ctx.participantes, V = ctx.valorDe;
  eq('uma pessoa', P('Caulin'), ['Caulin']);
  eq('"Dividido" é apelido do casal', P('Dividido'), ['Caulin', 'Luanna']);
  eq('terceiro sozinho', P('Rafael'), ['Rafael']);
  eq('casal + terceiro', P('Caulin+Rafael'), ['Caulin', 'Rafael']);
  eq('os três', P('Caulin+Luanna+Rafael'), ['Caulin', 'Luanna', 'Rafael']);
  eq('espaços em volta são tolerados', P(' Caulin + Rafael '), ['Caulin', 'Rafael']);
  eq('repetido não conta duas vezes', P('Caulin+Caulin'), ['Caulin']);
  eq('vazio', P(''), []);
  eq('null', P(null), []);

  eq('100% de quem é dono', V(100, 'Caulin', 'Caulin'), 100);
  eq('quem não participa recebe 0', V(100, 'Caulin', 'Luanna'), 0);
  eq('dividido entre o casal → metade', V(100, 'Dividido', 'Luanna'), 50);
  eq('dividido entre três → um terço', V(300, 'Caulin+Luanna+Rafael', 'Rafael'), 100);
  eq('casal fora quando é só do terceiro', V(80, 'Rafael', 'Caulin'), 0);
  eq('terceiro no rateio com um do casal', V(80, 'Caulin+Rafael', 'Rafael'), 40);

  // A soma das partes tem que fechar o total — senão dinheiro some do checklist.
  const casos = ['Caulin', 'Luanna', 'Dividido', 'Rafael', 'Caulin+Rafael',
                 'Caulin+Luanna+Rafael'];
  const fecha = casos.every(d => {
    const soma = P(d).reduce((a, n) => a + V(999, d, n), 0);
    return Math.abs(soma - 999) < 0.0001;
  });
  ok('a soma das partes fecha o total em todos os arranjos', fecha);

  console.log('\n=== 12b. donoCanonico / terceirosDe ===');
  const DC = ctx.donoCanonico;
  eq('casal inteiro volta a ser "Dividido"', DC(['Caulin', 'Luanna']), 'Dividido');
  eq('  na ordem inversa também', DC(['Luanna', 'Caulin']), 'Dividido');
  eq('um só fica um só', DC(['Caulin']), 'Caulin');
  eq('três viram lista', DC(['Caulin', 'Luanna', 'Rafael']), 'Caulin+Luanna+Rafael');
  eq('casal + terceiro NÃO vira Dividido', DC(['Caulin', 'Rafael']), 'Caulin+Rafael');
  // Ida e volta: canonizar o que participantes() devolveu não muda nada.
  ok('donoCanonico(participantes(x)) é estável',
     casos.every(d => DC(P(d)) === DC(P(DC(P(d))))));

  const T = ctx.terceirosDe;
  eq('só o casal → nenhum terceiro', T('Dividido'), []);
  eq('terceiro sozinho', T('Rafael'), ['Rafael']);
  eq('mistura', T('Caulin+Luanna+Rafael'), ['Rafael']);
}

// ── 13. Chave estável do "pago" ─────────────────────────────────────────────
console.log('\n=== 13. chavePago (tem que sobreviver ao F5) ===');
{
  const CP = ctx.chavePago;
  // Contas e investimentos ganham id novo a cada load: a chave não pode usá-lo.
  const conta1 = { id: 'abc123', transacao: 'Aluguel', valor: 2500 };
  const conta2 = { id: 'zzz999', transacao: 'Aluguel', valor: 2500 };
  eq('mesmo conteúdo, ids diferentes → mesma chave',
     CP('2026-08', 'CONTA', conta1), CP('2026-08', 'CONTA', conta2));
  ok('  e a chave não contém o id',
     CP('2026-08', 'CONTA', conta1).indexOf('abc123') === -1);

  ok('mês diferente → chave diferente',
     CP('2026-08', 'CONTA', conta1) !== CP('2026-09', 'CONTA', conta1));
  ok('seção diferente → chave diferente',
     CP('2026-08', 'CONTA', conta1) !== CP('2026-08', 'INV', conta1));
  ok('valor diferente → chave diferente',
     CP('2026-08', 'CONTA', conta1) !== CP('2026-08', 'CONTA', { ...conta1, valor: 2600 }));
  ok('acento e caixa não mudam a chave',
     CP('2026-08', 'CONTA', { transacao: 'Água', valor: 90 }) ===
     CP('2026-08', 'CONTA', { transacao: 'AGUA', valor: 90 }));

  // Transação do Open Finance usa o id do Pluggy, que é estável.
  const tx = { id: 'tx-777', origem: 'OPEN_FINANCE', nome: 'IFOOD', valor: 50 };
  eq('transação do OF usa o id do Pluggy', CP('2026-08', 'CARTAO', tx), 'TX|tx-777');
  ok('  e não muda se o mês da tela mudar',
     CP('2026-09', 'CARTAO', tx) === CP('2026-08', 'CARTAO', tx));

  const CG = ctx.chaveGrupo;
  ok('grupo isola por mês',
     CG('2026-08', 'Black', 'Caulin', 'fixos') !== CG('2026-09', 'Black', 'Caulin', 'fixos'));
  ok('grupo isola por pessoa',
     CG('2026-08', 'Black', 'Caulin', 'fixos') !== CG('2026-08', 'Black', 'Luanna', 'fixos'));
  ok('grupo isola por tipo',
     CG('2026-08', 'Black', 'Caulin', 'fixos') !== CG('2026-08', 'Black', 'Caulin', 'var'));
  ok('grupo isola por cartão',
     CG('2026-08', 'Black', 'Caulin', 'fixos') !== CG('2026-08', 'Platinum', 'Caulin', 'fixos'));
  ok('chave de grupo não colide com chave de linha',
     CG('2026-08', 'Black', 'Caulin', 'fixos') !== CP('2026-08', 'CONTA', conta1));
}

console.log('\n' + '='.repeat(52));
console.log('RESULTADO: ' + passes + ' passaram, ' + falhas + ' falharam');
console.log('='.repeat(52));
process.exit(falhas ? 1 : 0);
