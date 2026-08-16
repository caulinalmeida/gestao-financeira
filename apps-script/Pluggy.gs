/**
 * Cliente HTTP da API do Pluggy.
 *
 * Autenticação: POST /auth troca clientId+clientSecret por uma apiKey válida
 * por ~2h, enviada depois no header X-API-KEY. A apiKey fica em cache para não
 * gastar uma chamada de /auth a cada execução do poller (que roda de 5 em 5 min).
 */

var _apiKeyMemo = null;

function pluggyApiKey() {
  if (_apiKeyMemo) return _apiKeyMemo;

  var cache = CacheService.getScriptCache();
  var cacheada = cache.get('pluggy_api_key');
  if (cacheada) { _apiKeyMemo = cacheada; return cacheada; }

  var resp = UrlFetchApp.fetch(PLUGGY_API + '/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      clientId: _prop('PLUGGY_CLIENT_ID', true),
      clientSecret: _prop('PLUGGY_CLIENT_SECRET', true)
    }),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error(
      'Falha na autenticação com o Pluggy (HTTP ' + code + '). ' +
      'Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.\n' +
      resp.getContentText().slice(0, 300)
    );
  }

  var apiKey = JSON.parse(resp.getContentText()).apiKey;
  // 100 min < validade de 2h, com folga para uma execução longa.
  cache.put('pluggy_api_key', apiKey, 100 * 60);
  _apiKeyMemo = apiKey;
  return apiKey;
}

/**
 * GET autenticado. Devolve { ok, code, body }.
 * Não lança em erro HTTP — quem chama decide, porque alguns 404 são esperados
 * (ex.: endpoint de listagem de items pode não existir no plano).
 */
function pluggyGet(caminho, params) {
  var url = PLUGGY_API + caminho;
  if (params) {
    var qs = Object.keys(params)
      .filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    if (qs) url += (url.indexOf('?') === -1 ? '?' : '&') + qs;
  }

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-API-KEY': pluggyApiKey() },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var texto = resp.getContentText();
  var body = null;
  try { body = JSON.parse(texto); } catch (e) { body = { raw: texto }; }

  return { ok: code >= 200 && code < 300, code: code, body: body };
}

/**
 * Pede ao Pluggy que vá AO BANCO buscar dados novos.
 *
 * Distinção que importa: `sincronizarAgora()` lê o que o Pluggy já tem
 * guardado. Se o Pluggy não visitou o banco desde ontem, uma compra de hoje
 * não existe para nós por mais que a gente sincronize. Este PATCH é o que
 * dispara a visita.
 *
 * ⚠️ ITEM DO MEU PLUGGY RECUSA: devolve 400 "MeuPluggy item cant be updated".
 *
 * É restrição de AUTORIZAÇÃO, não impedimento técnico. O item pertence à
 * aplicação Meu Pluggy; nossa clientId é outra aplicação, com permissão de
 * leitura mas não de escrita sobre ele. Verificado na prática: pelo site do
 * Meu Pluggy a mesma atualização roda sem pedir senha nenhuma — o widget abre
 * com o CPF já preenchido e coleta sozinho em ~1 min.
 *
 * Caminho manual enquanto isso: https://meu.pluggy.ai/connections/<itemId> →
 * botão Atualizar, e depois sincronizarAgora() aqui.
 *
 * Embutir o widget do Pluggy Connect no app não escapa disso: modo update
 * exige itemId no connect_token, e itemId de outra aplicação devolve 404.
 * Mesma fronteira. Ver testarWidgetUpdate() em Diagnostico.gs.
 *
 * A função fica porque conector fora do Meu Pluggy aceita: aí o item entra em
 * UPDATING e leva de segundos a minutos. Manual de propósito — forçar todo dia
 * sem necessidade só gasta a conexão.
 */
function pluggyAtualizarItem(itemId) {
  var resp = UrlFetchApp.fetch(PLUGGY_API + '/items/' + itemId, {
    method: 'patch',
    contentType: 'application/json',
    payload: '{}',
    headers: { 'X-API-KEY': pluggyApiKey() },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var body = null;
  try { body = JSON.parse(resp.getContentText()); } catch (e) { body = { raw: resp.getContentText() }; }
  return { ok: code >= 200 && code < 300, code: code, body: body };
}

/**
 * Emite um connect_token — a credencial de curta duração que o widget do
 * Pluggy Connect consome no browser. É o que permitiria embutir a atualização
 * no app sem expor clientId/clientSecret no bundle.
 *
 * Com `itemId`, o widget abre em modo update (atualiza a conexão existente).
 * Sem `itemId`, abre em modo create (conecta um banco novo).
 *
 * ⚠️ A doc é explícita: itemId que não pertence à aplicação que pede devolve
 * 404 ITEM_NOT_FOUND. Como o nosso item é do Meu Pluggy, é o resultado
 * esperado aqui. testarWidgetUpdate() confirma na prática.
 */
function pluggyConnectToken(itemId) {
  var payload = {};
  if (itemId) payload.itemId = itemId;

  var resp = UrlFetchApp.fetch(PLUGGY_API + '/connect_tokens', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'X-API-KEY': pluggyApiKey() },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = null;
  try { body = JSON.parse(resp.getContentText()); } catch (e) { body = { raw: resp.getContentText() }; }
  return { ok: code >= 200 && code < 300, code: code, body: body };
}

/**
 * Items (conexões bancárias) a sincronizar.
 *
 * A API do Pluggy NÃO expõe listagem de items — só `GET /items/{id}`. Por isso
 * os IDs precisam vir da propriedade do script PLUGGY_ITEM_IDS.
 * (Ainda tentamos `GET /items` por garantia, caso passe a existir; um 401/404
 * ali é o comportamento normal e não indica credencial errada.)
 */
function pluggyItems() {
  var manuais = _prop('PLUGGY_ITEM_IDS', false);
  if (manuais) {
    var ids = manuais.split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(String);
    if (ids.length) {
      return { origem: 'PLUGGY_ITEM_IDS', ids: ids };
    }
  }

  var r = pluggyGet('/items');
  if (r.ok && r.body && r.body.results && r.body.results.length) {
    return {
      origem: 'GET /items',
      ids: r.body.results.map(function (it) { return it.id; })
    };
  }

  throw new Error(
    'Falta configurar PLUGGY_ITEM_IDS.\n\n' +
    'A API do Pluggy não tem endpoint de listagem de items (o HTTP ' + r.code +
    ' acima é esperado), então os IDs precisam ser informados.\n\n' +
    'COMO OBTER:\n' +
    '  1. Acesse dashboard.pluggy.ai\n' +
    '  2. Abra sua aplicação → seção Items / Connections / Conexões\n' +
    '  3. Copie o ID de cada conexão (formato UUID, ex.: 3f9b1c2a-...-8d7e)\n' +
    '  4. ⚙ Configurações do projeto → Propriedades do script\n' +
    '     PLUGGY_ITEM_IDS = os IDs separados por vírgula\n\n' +
    'Como os 2 cartões são do mesmo banco, provavelmente é UM único ID.'
  );
}

function pluggyItem(itemId) {
  return pluggyGet('/items/' + itemId);
}

/** Só contas de cartão de crédito — conta corrente está fora do escopo por ora. */
function pluggyContasCredito(itemId) {
  var r = pluggyGet('/accounts', { itemId: itemId, type: 'CREDIT' });
  if (!r.ok) {
    throw new Error('Falha ao listar contas do item ' + itemId + ' (HTTP ' + r.code + ')');
  }
  return (r.body && r.body.results) || [];
}

/** Faturas fechadas da conta — usadas para saber em que mês cada transação cai. */
function pluggyFaturas(accountId) {
  var r = pluggyGet('/bills', { accountId: accountId });
  if (!r.ok) return []; // Nem todo conector expõe /bills; o sync tem fallback.
  return (r.body && r.body.results) || [];
}

/**
 * Transações da conta no período. A API v2 usa paginação por CURSOR:
 * a resposta traz `next`, uma query string pronta para a próxima página.
 */
function pluggyTransacoes(accountId, dataDe, dataAte) {
  var todas = [];
  var params = { accountId: accountId, dateFrom: dataDe, dateTo: dataAte };
  var caminho = '/v2/transactions';
  var guarda = 0;

  while (true) {
    var r = pluggyGet(caminho, params);
    if (!r.ok) {
      throw new Error('Falha ao listar transações da conta ' + accountId + ' (HTTP ' + r.code + ')');
    }
    var res = (r.body && r.body.results) || [];
    todas = todas.concat(res);

    var next = r.body && r.body.next;
    if (!next) break;

    // `next` já vem como query string completa; params vão embutidos nela.
    caminho = '/v2/transactions' + (next.charAt(0) === '?' ? next : '?' + next);
    params = null;

    if (++guarda > 100) break; // trava de segurança contra loop infinito
  }

  return todas;
}
