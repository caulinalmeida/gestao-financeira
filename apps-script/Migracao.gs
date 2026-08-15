/**
 * Migração única: coluna "Mes Ref" de nome do mês para ANO-MÊS.
 *
 *   "MAIO"  →  "2026-05"
 *
 * Por que: o modelo antigo tem só 12 baldes fixos, então JANEIRO/2027 sobrescreve
 * silenciosamente JANEIRO/2026. Com sync automático rodando todo dia, isso vira
 * problema rápido.
 *
 * COMO USAR — nesta ordem:
 *   1. Faça a cópia de segurança da planilha (Arquivo → Fazer uma cópia)
 *   2. Rode simularMigracaoMeses()   → mostra o que mudaria, NÃO escreve
 *   3. Confira o relatório
 *   4. Rode migrarMeses()            → aplica
 *
 * O App.jsx aceita os dois formatos (parseMesRef), então o app continua
 * funcionando antes e depois da migração. A migração é limpeza, não cutover.
 */

var ANO_LEGADO = 2026;  // ano assumido para as linhas que só têm o nome do mês

var MESES_NOMES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                   'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

var ABAS_MIGRAR = ['RENDA_DESPESAS','CARTAO_CREDITO','INVESTIMENTOS'];

function _converterMes(bruto) {
  var s = String(bruto == null ? '' : bruto).trim().toUpperCase();
  if (!s) return { novo: null, motivo: 'vazio' };
  if (/^\d{4}-\d{2}$/.test(s)) return { novo: s, motivo: 'já migrado' };

  // MARÇO pode estar gravado sem acento em planilhas antigas.
  var semAcento = function (x) {
    return x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };
  var normalizado = semAcento(s);
  var idx = -1;
  for (var i = 0; i < MESES_NOMES.length; i++) {
    if (semAcento(MESES_NOMES[i]) === normalizado) { idx = i; break; }
  }
  if (idx === -1) return { novo: null, motivo: 'não reconhecido' };

  var mm = idx + 1;
  return {
    novo: ANO_LEGADO + '-' + (mm < 10 ? '0' : '') + mm,
    motivo: 'convertido'
  };
}

function simularMigracaoMeses() { return _migracao(true); }
function migrarMeses()          { return _migracao(false); }

function _migracao(simular) {
  var ss = SpreadsheetApp.getActive();
  var log = [];
  function p(s) { log.push(s); Logger.log(s); }

  p(simular ? '=== SIMULAÇÃO (nada será escrito) ===' : '=== MIGRAÇÃO REAL ===');
  p('Ano assumido para meses sem ano: ' + ANO_LEGADO);
  p('');

  var totalGeral = 0, convertidoGeral = 0, problemaGeral = 0;

  ABAS_MIGRAR.forEach(function (nomeAba) {
    var s = ss.getSheetByName(nomeAba);
    if (!s) { p('⚠️  Aba "' + nomeAba + '" não existe — pulando.'); return; }

    var ultima = s.getLastRow();
    if (ultima < 2) { p('• ' + nomeAba + ': vazia'); return; }

    var rng = s.getRange(2, 1, ultima - 1, 1);
    var vals = rng.getValues();

    var contagem = {}, convertidas = 0, jaOk = 0, problemas = [];
    var saida = vals.map(function (linha, i) {
      var r = _converterMes(linha[0]);
      if (r.motivo === 'convertido') {
        convertidas++;
        contagem[String(linha[0]).trim().toUpperCase() + ' → ' + r.novo] =
          (contagem[String(linha[0]).trim().toUpperCase() + ' → ' + r.novo] || 0) + 1;
        return [r.novo];
      }
      if (r.motivo === 'já migrado') { jaOk++; return [r.novo]; }
      if (r.motivo === 'vazio')      { return [linha[0]]; }
      problemas.push('linha ' + (i + 2) + ': "' + linha[0] + '"');
      return [linha[0]];   // preserva o valor original — nunca destrói o que não entendeu
    });

    p('• ' + nomeAba + ': ' + vals.length + ' linhas');
    Object.keys(contagem).sort().forEach(function (k) {
      p('    ' + k + '  (' + contagem[k] + ')');
    });
    if (jaOk)              p('    já no formato novo: ' + jaOk);
    if (problemas.length)  p('    ⚠️  NÃO reconhecidos (mantidos como estão): ' + problemas.join(', '));

    if (!simular && convertidas > 0) {
      rng.setValues(saida);
      p('    ✅ gravado');
    }

    totalGeral += vals.length;
    convertidoGeral += convertidas;
    problemaGeral += problemas.length;
  });

  p('');
  p('=== RESUMO ===');
  p('linhas analisadas: ' + totalGeral);
  p('convertidas:       ' + convertidoGeral);
  p('não reconhecidas:  ' + problemaGeral + (problemaGeral ? '  ← revise antes de aplicar' : ''));
  if (simular) p('\nNada foi escrito. Se o relatório está certo, rode migrarMeses().');

  return log.join('\n');
}
