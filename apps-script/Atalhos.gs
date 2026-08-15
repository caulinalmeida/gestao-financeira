/**
 * Atalhos sem parâmetro.
 *
 * O botão ▷ Executar do editor do Apps Script não permite passar argumentos,
 * então funções como investigarMes("2026-06") não podem ser chamadas direto.
 * Este arquivo expõe versões de zero argumentos.
 *
 * DUAS FORMAS DE USAR
 *
 *   a) Relativas — não precisam de configuração nenhuma:
 *        investigarUltimaFatura()      última fatura fechada
 *        investigarPenultimaFatura()   a anterior a essa
 *        detalharUltimaFatura()        lista transação a transação
 *
 *   b) Mês específico — defina a propriedade do script MES_ALVO (ex.: 2026-06)
 *      em ⚙ Configurações do projeto → Propriedades do script, e rode:
 *        investigarMesAlvo()
 *        detalharMesAlvo()
 *      Para trocar de mês, basta editar a propriedade e rodar de novo.
 */

/** Chave ANO-MÊS deslocada N meses a partir de hoje. */
function _mesKeyRelativo(offset) {
  var d = new Date();
  var ano = d.getFullYear(), mes = d.getMonth() + (offset || 0);
  while (mes < 0)  { mes += 12; ano -= 1; }
  while (mes > 11) { mes -= 12; ano += 1; }
  return _mesKey(ano, mes);
}

// ── (a) Relativas ────────────────────────────────────────────────────────────

/**
 * Última fatura fechada. Como a fatura fecha no começo do mês e vence no meio,
 * a fatura fechada mais recente é a que vence no mês corrente.
 */
function investigarUltimaFatura()    { return investigarMes(_mesKeyRelativo(0)); }
function investigarPenultimaFatura() { return investigarMes(_mesKeyRelativo(-1)); }
function investigarFatura3MesesAtras(){ return investigarMes(_mesKeyRelativo(-2)); }

function detalharUltimaFatura()        { return conferirFaturaDetalhe(_mesKeyRelativo(0)); }
function detalharPenultimaFatura()     { return conferirFaturaDetalhe(_mesKeyRelativo(-1)); }
function detalharFatura3MesesAtras()   { return conferirFaturaDetalhe(_mesKeyRelativo(-2)); }
function detalharFaturaEmAberto()      { return conferirFaturaDetalhe(_mesKeyRelativo(1)); }

// ── (b) Mês específico, via propriedade MES_ALVO ─────────────────────────────

function _mesAlvo() {
  var m = _prop('MES_ALVO', false);
  if (!m || !/^\d{4}-\d{2}$/.test(String(m).trim())) {
    throw new Error(
      'Defina a propriedade do script MES_ALVO no formato ANO-MÊS.\n\n' +
      '  ⚙ Configurações do projeto → Propriedades do script\n' +
      '  MES_ALVO = 2026-06\n\n' +
      'Ou use os atalhos relativos: investigarUltimaFatura(), ' +
      'investigarPenultimaFatura().'
    );
  }
  return String(m).trim();
}

function investigarMesAlvo() { return investigarMes(_mesAlvo()); }
function detalharMesAlvo()   { return conferirFaturaDetalhe(_mesAlvo()); }

/** Mostra quais meses os atalhos relativos apontam agora. */
function ondeEstouNoTempo() {
  var log = [
    'Hoje: ' + _isoData(new Date()),
    '',
    'investigarUltimaFatura()     → ' + _mesKeyRelativo(0),
    'investigarPenultimaFatura()  → ' + _mesKeyRelativo(-1),
    'investigarFatura3MesesAtras()→ ' + _mesKeyRelativo(-2),
    'detalharFaturaEmAberto()     → ' + _mesKeyRelativo(1)
  ].join('\n');
  Logger.log(log);
  return log;
}
