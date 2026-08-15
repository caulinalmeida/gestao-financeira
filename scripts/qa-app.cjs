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
].filter(Boolean);
ok('todas as funções alvo foram encontradas', faltou.length === 0, faltou.join(', '));
ok('constantes MESES/ANO_LEGADO/chaveAjuste encontradas', linhas.length === 3);

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

console.log('\n' + '='.repeat(52));
console.log('RESULTADO: ' + passes + ' passaram, ' + falhas + ' falharam');
console.log('='.repeat(52));
process.exit(falhas ? 1 : 0);
