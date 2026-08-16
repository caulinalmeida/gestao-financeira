import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from "react";

const CLIENT_ID = "551652083809-p6o9ch2bvn8ipg508b7nu2afu5fn1ho1.apps.googleusercontent.com";
const SHEET_ID  = "19qO91TbQQJMLd_ONeP--Gdh7NwliuYuYQ-GuA-PNen8";
const SCOPES    = "https://www.googleapis.com/auth/spreadsheets";
const API_BASE  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
// O casal é fixo por design (ver CLAUDE.md). "Dividido" é o apelido histórico
// de "Caulin+Luanna" e continua sendo gravado assim para não quebrar o legado.
const CASAL = ["Caulin","Luanna"];
const DIVIDIDO = "Dividido";
const DONOS = [...CASAL,DIVIDIDO];
const PARC_OPTS = ["VARIÁVEL","PARCELADO","RECORRENTE"];
const TIPOS_CONTA = ["RENDA","DESPESA FIXA","DESPESA","INVESTIMENTO"];

// Ano assumido para linhas antigas gravadas só com o nome do mês ("MAIO").
// Depois que a migração rodar, nenhuma linha nova usa esse fallback.
const ANO_LEGADO = 2026;

// ── Paleta dark ───────────────────────────────────────────────────────────────
// As chaves *50 (antes fundos pastel claros) viraram fundos escuros translúcidos;
// as *600 (antes texto escuro) viraram tons vivos, legíveis sobre superfície escura.
const C = {
  // superfícies e texto
  bg:"#0F1115", surface:"#171A20", surfaceAlt:"#1E222A",
  border:"#2A2F3A", borderSoft:"#21252D",
  text:"#E7EAF0", textDim:"#98A0AE", textMuted:"#666E7D",

  teal50:"#0E3B31",  teal100:"#1C5C4B", teal600:"#2DD4A7", tealSoft:"rgba(45,212,167,0.10)",
  purple50:"#2A2445",purple100:"#3B3468",purple600:"#A78BFA",
  amber50:"#3A2E14", amber100:"#5A4720", amber600:"#FBBF24",amberSoft:"rgba(251,191,36,0.10)",
  red50:"#3B1F22",   red100:"#5C2E33",  red600:"#F87171",  redSoft:"rgba(248,113,113,0.10)",
  green50:"#16301F", green100:"#22482F",green600:"#4ADE80",
  blue50:"#16283F",  blue100:"#23405F", blue600:"#60A5FA",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBRL(v){return"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});}
function parseBRL(s){if(!s&&s!==0)return 0;const str=String(s).replace(/R\$\s*/g,"").trim();if(str.includes(","))return parseFloat(str.replace(/\./g,"").replace(",","."))||0;return parseFloat(str)||0;}
function normalize(s){return(s||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9\s]/g," ").replace(/\s+/g," ").trim();}
function matchDict(t,dict){const n=normalize(t);return dict.find(d=>n.includes(normalize(d.key)));}
function uid(){return Math.random().toString(36).slice(2,9);}

// ── Modelo de mês: chave "ANO-MÊS" (ex.: "2026-08") ───────────────────────────
// Tolerante ao formato legado ("MAIO"), para o app funcionar antes e depois da
// migração da planilha. Só o formato novo é gravado.
function mesKey(ano,mesIdx){return`${ano}-${String(mesIdx+1).padStart(2,"0")}`;}
function parseMesRef(raw){
  const s=String(raw||"").trim().toUpperCase();
  const m=s.match(/^(\d{4})-(\d{1,2})$/);
  if(m){const mi=parseInt(m[2],10);if(mi>=1&&mi<=12)return mesKey(parseInt(m[1],10),mi-1);return null;}
  const idx=MESES.indexOf(s);
  return idx>=0?mesKey(ANO_LEGADO,idx):null;
}
function mesPartes(key){const[a,m]=String(key).split("-");return{ano:parseInt(a,10),mesIdx:parseInt(m,10)-1};}
function mesLabel(key){const{ano,mesIdx}=mesPartes(key);return`${MESES[mesIdx]||"?"} ${ano}`;}
function mesLabelCurto(key){const{ano,mesIdx}=mesPartes(key);return`${(MESES[mesIdx]||"?").substring(0,3)}/${String(ano).slice(2)}`;}
function mesAnterior(key){const{ano,mesIdx}=mesPartes(key);return mesIdx===0?mesKey(ano-1,11):mesKey(ano,mesIdx-1);}
function mesProximo(key){const{ano,mesIdx}=mesPartes(key);return mesIdx===11?mesKey(ano+1,0):mesKey(ano,mesIdx+1);}
function mesAtualKey(){const d=new Date();return mesKey(d.getFullYear(),d.getMonth());}

// ── Google Auth ───────────────────────────────────────────────────────────────
let tokenClient = null;

function getStoredToken(){
  try{
    const t=sessionStorage.getItem("gf_token");
    const exp=sessionStorage.getItem("gf_token_exp");
    if(t&&exp&&Date.now()<parseInt(exp)) return t;
  }catch{
    // sessionStorage bloqueado (aba anônima, cookies de terceiros): sem token.
  }
  return null;
}

function storeToken(token){
  try{
    sessionStorage.setItem("gf_token",token);
    sessionStorage.setItem("gf_token_exp",String(Date.now()+3500*1000));
  }catch{
    // Sem storage, o login vale só enquanto a página estiver aberta.
  }
}

function loadGsiScript(){
  return new Promise(res=>{
    if(window.google?.accounts){res();return;}
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";
    s.onload=res;
    document.head.appendChild(s);
  });
}

async function getToken(forceConsent=false){
  await loadGsiScript();
  const stored=getStoredToken();
  if(stored&&!forceConsent) return stored;
  return new Promise((res,rej)=>{
    if(!tokenClient){
      tokenClient=window.google.accounts.oauth2.initTokenClient({
        client_id:CLIENT_ID,scope:SCOPES,
        callback:resp=>{
          if(resp.error){rej(resp.error);return;}
          storeToken(resp.access_token);
          res(resp.access_token);
        }
      });
    }
    tokenClient.requestAccessToken({prompt:forceConsent?"consent":""});
  });
}

// ── Sheets API ────────────────────────────────────────────────────────────────
async function sheetsGet(range){
  const tok=await getToken();
  const r=await fetch(`${API_BASE}/values/${encodeURIComponent(range)}`,{headers:{Authorization:`Bearer ${tok}`}});
  const d=await r.json();
  return d.values||[];
}

async function sheetsAppend(range,values){
  const tok=await getToken();
  await fetch(`${API_BASE}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{
    method:"POST",headers:{Authorization:`Bearer ${tok}`,"Content-Type":"application/json"},
    body:JSON.stringify({range,majorDimension:"ROWS",values}),
  });
}

async function sheetsClear(range){
  const tok=await getToken();
  await fetch(`${API_BASE}/values/${encodeURIComponent(range)}:clear`,{
    method:"POST",headers:{Authorization:`Bearer ${tok}`},
  });
}

// Atualiza um intervalo pontual, sem apagar o resto da aba. Usado só para a
// célula `pedido_sync` em OF_STATUS — a única coisa que o app escreve numa
// aba que pertence ao Apps Script.
async function sheetsUpdate(range,values){
  const tok=await getToken();
  await fetch(`${API_BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{
    method:"PUT",headers:{Authorization:`Bearer ${tok}`,"Content-Type":"application/json"},
    body:JSON.stringify({range,majorDimension:"ROWS",values}),
  });
}

// ── Row converters ────────────────────────────────────────────────────────────
function contaToRow(mes,r){return[mes,r.data||"",r.transacao,String(parseBRL(r.valor)),r.dono,r.tipo,r.parcelas||"",r.obs||""];}
function rowToConta(row){return{id:uid(),transacao:row[2]||"",valor:String(parseBRL(row[3])),dono:row[4]||"Caulin",tipo:row[5]||"DESPESA",parcelas:row[6]||"",obs:row[7]||""};}
// Coluna K = Origem ("MANUAL" | "LEGADO"). Aditiva: linhas antigas leem vazio = LEGADO.
function faturaToRow(mes,r,origem){return[mes,r.data||"",r.nome,r.parcela||"",String(r.valor),r.dono,r.tipo||"DESPESA",r.parcelas||"VARIÁVEL",r.obs||"",r.cartao||"",origem||"LEGADO"];}
function rowToFatura(row){return{id:uid(),data:row[1]||"",nome:row[2]||"",parcela:row[3]||"",valor:parseBRL(row[4]),dono:row[5]||"",tipo:row[6]||"DESPESA",parcelas:row[7]||"VARIÁVEL",obs:row[8]||"",cartao:row[9]||"",isNew:false};}
function dictToRow(d){return[d.key,d.dono,d.parcelas,d.obs||""];}
function rowToDict(row){return{key:row[0]||"",dono:row[1]||"Caulin",parcelas:row[2]||"VARIÁVEL",obs:row[3]||""};}

// ── Open Finance ──────────────────────────────────────────────────────────────
// Abas OF_* são escritas SÓ pelo Apps Script; o app apenas lê. As decisões do
// usuário (dono, classificação, obs, ignorada) vivem em OF_AJUSTES, escrita SÓ
// pelo app. Um escritor por aba — é o que evita os dois se atropelarem.

// A API do Sheets devolve valor já formatado, então a data pode vir como
// "2026-07-03" ou "03/07/2026" dependendo de o Sheets ter interpretado a
// célula como texto ou data.
function parseDataFlex(v){
  const s=String(v==null?"":v).trim();
  if(!s) return "";
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  return s;
}
function dataCurta(iso){const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}`:String(iso||"");}

/**
 * Tira o "06/21" que o Itaú carimba no fim da descrição das parceladas.
 *
 * O sufixo é redundante — parcela_num e parcela_total já vêm estruturados do
 * Pluggy — e quebrava tudo que agrupa por descrição: cada parcela virava uma
 * compra diferente na aba Parcelas (SAMSUNG 06/21, 07/21 e 08/21 eram três
 * compras de 21x), e o dicionário nunca conseguia aprender uma parcelada,
 * porque a chave mudava de mês em mês.
 *
 * Só remove quando os números batem exatamente com a parcela conhecida, para
 * não comer um "01/06" que faça parte do nome de verdade do estabelecimento.
 */
function semSufixoParcela(desc,num,total){
  const s=String(desc||"").trim();
  if(!(total>1)||!(num>0)) return s;
  return s.replace(new RegExp(`\\s*0*${num}\\s*/\\s*0*${total}\\s*$`),"").trim()||s;
}

function rowToOfTx(row){
  const parcelaNum=parseInt(row[10],10)||0;
  const parcelaTotal=parseInt(row[11],10)||0;
  return{
    id:row[0]||"",accountId:row[1]||"",mesRef:parseMesRef(row[2])||"",origemMes:row[3]||"",
    natureza:String(row[4]||"COMPRA").toUpperCase(),data:parseDataFlex(row[5]),
    // Nome limpo. O fingerprint vem pronto da planilha e usa a descrição crua,
    // então limpar aqui não desliga nenhum ajuste já gravado.
    nome:semSufixoParcela(row[6],parcelaNum,parcelaTotal),
    valor:parseBRL(row[7]),status:String(row[8]||"").toUpperCase(),
    billId:row[9]||"",parcelaNum,parcelaTotal,
    valorTotal:parseBRL(row[12]),dataCompra:parseDataFlex(row[13]),fingerprint:row[14]||"",
  };
}
function rowToOfCartao(row){
  return{accountId:row[0]||"",itemId:row[1]||"",nome:row[2]||"",ultimos:String(row[3]||""),
    limite:parseBRL(row[4]),fechamento:row[5]||"",vencimento:row[6]||""};
}
function rowToOfFatura(row){
  return{accountId:row[0]||"",mesRef:parseMesRef(row[1])||"",vencimento:parseDataFlex(row[2]),
    fechamento:parseDataFlex(row[3]),totalBanco:parseBRL(row[4])};
}

// OF_AJUSTES: tipo | ref_id | dono | classificacao | obs | ignorada |
//             mes_ref_override | apelido | fingerprint
// O fingerprint é guardado junto para religar o ajuste quando o Pluggy troca o
// id da transação (ele deleta e recria quando data/descrição/valor mudam).
const chaveAjuste=(tipo,refId)=>`${tipo}:${refId}`;
function rowToAjuste(row){
  return{tipo:String(row[0]||"TX").toUpperCase(),refId:row[1]||"",dono:row[2]||"",
    classificacao:row[3]||"",obs:row[4]||"",
    ignorada:String(row[5]||"").toUpperCase()==="TRUE",
    mesRefOverride:row[6]?(parseMesRef(row[6])||""):"",apelido:row[7]||"",
    fingerprint:row[8]||""};
}
function ajusteToRow(a){
  return[a.tipo||"TX",a.refId,a.dono||"",a.classificacao||"",a.obs||"",
    a.ignorada?"TRUE":"FALSE",a.mesRefOverride||"",a.apelido||"",a.fingerprint||""];
}
// Ajuste sem nenhuma decisão do usuário não precisa ocupar linha na planilha.
function ajusteVazio(a){
  return !a||(!a.dono&&!a.classificacao&&!a.obs&&!a.ignorada&&!a.mesRefOverride&&!a.apelido);
}

/**
 * Quem participa do rateio de um lançamento.
 *
 * O campo Dono guarda os participantes separados por "+", então terceiros
 * cabem sem mudar coluna nenhuma da planilha:
 *
 *   "Caulin"                  → só Caulin
 *   "Dividido"                → Caulin e Luanna (apelido histórico, ÷2)
 *   "Rafael"                  → 100% do Rafael, vira "a receber"
 *   "Caulin+Rafael"           → ÷2 entre os dois
 *   "Caulin+Luanna+Rafael"    → ÷3
 *
 * O valor é sempre dividido igualmente entre os participantes.
 */
function participantes(dono){
  const s=String(dono||"").trim();
  if(!s) return [];
  if(s===DIVIDIDO) return [...CASAL];
  return [...new Set(s.split("+").map(x=>x.trim()).filter(Boolean))];
}
/** Quanto desse lançamento cabe a uma pessoa. */
function valorDe(valor,dono,pessoa){
  const p=participantes(dono);
  return p.includes(pessoa)?(valor||0)/p.length:0;
}
/** Grava a forma canônica: o casal inteiro volta a ser "Dividido". */
function donoCanonico(lista){
  const p=[...new Set(lista.filter(Boolean))];
  if(p.length===2&&CASAL.every(c=>p.includes(c))) return DIVIDIDO;
  return p.join("+");
}
/** Todo mundo que não é do casal — os terceiros a cobrar. */
function terceirosDe(dono){
  return participantes(dono).filter(p=>!CASAL.includes(p));
}
function rotuloDono(dono){
  const p=participantes(dono);
  return p.length>1?p.join(" + "):(p[0]||"");
}

/**
 * Chave estável de uma linha do checklist, para o "pago" sobreviver ao F5.
 *
 * Não dá para usar o id da linha: contas, investimentos e lançamentos manuais
 * recebem um uid() novo a cada carregamento da planilha. A chave é derivada do
 * conteúdo — se você editar o valor ou a descrição, a marcação de pago some, o
 * que é o comportamento certo: virou outro lançamento.
 *
 * Transação do Open Finance usa o id do Pluggy, que é estável, com fallback no
 * fingerprint para quando o Pluggy recria a transação.
 */
function chavePago(mes,secao,r){
  if(r.origem==="OPEN_FINANCE"&&r.id) return `TX|${r.id}`;
  const nome=normalize(r.transacao||r.descricao||r.nome||"");
  return `${secao}|${mes}|${nome}|${Number(r.valor||0).toFixed(2)}`;
}
/** Chave do total agrupado (Fixos/Parcelados/Variáveis) de um cartão. */
function chaveGrupo(mes,cartao,pessoa,grupo){
  return `G|${grupo}|${mes}|${normalize(cartao)}|${pessoa}`;
}

// Nome de exibição do cartão: apelido do usuário vence o nome do banco.
function nomeCartao(accountId,cartoes,ajustes){
  const ap=ajustes[chaveAjuste("CARTAO",accountId)];
  if(ap?.apelido) return ap.apelido;
  const c=cartoes.find(x=>x.accountId===accountId);
  if(!c) return "Outros";
  return c.ultimos?`${c.nome} ·${c.ultimos}`:c.nome;
}

// PARCELADO vem do próprio Pluggy; o resto cai no dicionário.
function classificaAuto(tx,hit){
  if(tx.parcelaTotal>1) return "PARCELADO";
  return hit?.parcelas||"VARIÁVEL";
}

/**
 * Junta o que o Pluggy trouxe com o que o usuário decidiu.
 *
 * Pluggy é dono de: data, descrição, valor, parcela, cartão, status.
 * O usuário é dono de: dono, classificação, obs, ignorada.
 * Ajuste NUNCA é sobrescrito pelo sync — é o que torna a categorização durável.
 *
 * Quando o Pluggy troca o id de uma transação (ele deleta e recria se data,
 * descrição ou valor mudam), o ajuste é religado pelo fingerprint.
 */
function mergeFatura(transacoes,ajustes,dict,cartoes,opts){
  const{mesRef,status,mostrarIgnoradas,mostrarPagamentos}=opts||{};

  // Índice por fingerprint para religar ajuste órfão.
  const porFingerprint={};
  Object.values(ajustes).forEach(a=>{if(a.tipo==="TX"&&a.fingerprint)porFingerprint[a.fingerprint]=a;});

  const linhas=transacoes
    .filter(t=>{
      if(mesRef){
        const ov=ajustes[chaveAjuste("TX",t.id)];
        const mes=ov?.mesRefOverride||t.mesRef;
        if(mes!==mesRef) return false;
      }
      if(status&&t.status!==status) return false;
      return true;
    })
    .map(t=>{
      const ov=ajustes[chaveAjuste("TX",t.id)]||porFingerprint[t.fingerprint];
      const hit=ov?.dono?null:matchDict(t.nome,dict);
      return{
        ...t,
        cartao:nomeCartao(t.accountId,cartoes,ajustes),
        dono:ov?.dono??hit?.dono??"",
        parcelas:ov?.classificacao||classificaAuto(t,hit),
        obs:ov?.obs??hit?.obs??"",
        ignorada:!!ov?.ignorada,
        // Só é "novo" se o usuário nunca decidiu E o dicionário não conhece.
        isNew:!ov?.dono&&!hit,
        parcela:t.parcelaTotal>1?`${String(t.parcelaNum).padStart(2,"0")}/${String(t.parcelaTotal).padStart(2,"0")}`:"",
        origem:"OPEN_FINANCE",
      };
    })
    .filter(t=>{
      if(!mostrarIgnoradas&&t.ignorada) return false;
      // Pagamento da fatura não é despesa de ninguém: o banco não soma no
      // total e nós também não. Fica escondido por padrão.
      if(!mostrarPagamentos&&t.natureza==="PAGAMENTO") return false;
      return true;
    });

  linhas.sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  return linhas;
}

// Total conforme o banco calcula: sem o pagamento, e sem o que foi ignorado.
function totalFatura(linhas){
  return linhas.filter(t=>t.natureza!=="PAGAMENTO"&&!t.ignorada)
               .reduce((a,t)=>a+(t.valor||0),0);
}

/**
 * Identidade de uma compra parcelada, para juntar as parcelas dela.
 *
 * O valor total é arredondado para reais inteiros DE PROPÓSITO: R$ 100 em 3x
 * vira 33,34 + 33,33 + 33,33, e um centavo de diferença não pode quebrar o
 * agrupamento. Duas compras iguais no mesmo comerciante, mesmo número de
 * parcelas e mesmo valor são indistinguíveis — e tratá-las como uma só seria
 * errado, então o número da parcela é que decide (ver projetarParcelas).
 */
function chaveCompra(t){
  const total=t.valorTotal||(t.valor*t.parcelaTotal);
  return `${t.accountId}|${normalize(t.nome)}|${t.parcelaTotal}|${Math.round(total)}`;
}

/**
 * Projeta as parcelas que ainda vão cair, derivando tudo de OF_TRANSACOES.
 *
 * Não guarda nada: a projeção só preenche os buracos. Alguns bancos lançam
 * todas as parcelas de uma vez — nesse caso as reais já estão na lista e nada
 * é projetado por cima, senão o comprometido contaria dobrado. É o único
 * jeito seguro, porque a janela de sync (−120/+90 dias) materializa só parte
 * das parcelas futuras, e qual parte varia por banco.
 *
 * Devolve, para o mês-base em diante:
 *   compras — uma linha por compra ainda em curso
 *   porMes  — quanto cada mês já tem comprometido
 *   terminando — as que quitam no próprio mês-base
 */
function projetarParcelas(transacoes,ajustes,dict,cartoes,mesBase,horizonte){
  const meses=horizonte||12;
  const porFingerprint={};
  Object.values(ajustes).forEach(a=>{if(a.tipo==="TX"&&a.fingerprint)porFingerprint[a.fingerprint]=a;});

  // 1. Agrupa as parcelas conhecidas por compra.
  const compras=new Map();
  transacoes.forEach(t=>{
    if(t.natureza!=="COMPRA") return;
    if(!(t.parcelaTotal>1)||!(t.parcelaNum>0)) return;
    if(t.parcelaNum>t.parcelaTotal) return;               // dado inconsistente
    const ov=ajustes[chaveAjuste("TX",t.id)]||porFingerprint[t.fingerprint];
    if(ov?.ignorada) return;                              // ignorada não compromete nada
    const mes=ov?.mesRefOverride||t.mesRef;
    if(!mes) return;

    const k=chaveCompra(t);
    let c=compras.get(k);
    if(!c){
      const hit=ov?.dono?null:matchDict(t.nome,dict);
      c={chave:k,nome:t.nome,accountId:t.accountId,
        cartao:nomeCartao(t.accountId,cartoes,ajustes),
        dono:ov?.dono??hit?.dono??"",
        obs:ov?.obs??hit?.obs??"",
        parcelaTotal:t.parcelaTotal,valorTotal:t.valorTotal||0,
        conhecidas:new Map()};
      compras.set(k,c);
    }
    // Mesmo número de parcela vindo duas vezes: a última lida vence.
    c.conhecidas.set(t.parcelaNum,{mesRef:mes,valor:t.valor});
    if(!c.dono&&ov?.dono) c.dono=ov.dono;
    // A obs vem da parcela que o usuário anotou — pode ser qualquer uma delas.
    if(!c.obs&&ov?.obs) c.obs=ov.obs;
  });

  // 2. O banco agenda as parcelas futuras com antecedência — elas chegam
  // datadas com o vencimento da fatura. Se ele está agendando (existe alguma
  // parcela de mesBase em diante), então uma compra SEM nenhuma parcela daqui
  // para a frente foi quitada: antecipada ou liquidada. Projetar aí inventa
  // parcela que o banco não vai cobrar.
  //
  // Caso real: o SAMSUNG NO ITAU 21x teve as parcelas 09 a 16 lançadas juntas
  // em agosto (com três estornos "DESC ANTECIPA PARCELAS"), e some da fatura
  // de setembro em diante. Sem esta regra o app projetava 17 a 21.
  //
  // A condição de o banco estar agendando é a trava: num conjunto de dados
  // velho, sem nada futuro, ninguém é dado como quitado por engano.
  let bancoAgendando=false;
  compras.forEach(c=>{
    c.conhecidas.forEach(p=>{ if(p.mesRef>=mesBase) bancoAgendando=true; });
  });

  // 3. Completa cada compra com as parcelas que faltam.
  const itens=[];
  const resumo=[];
  compras.forEach(c=>{
    const nums=[...c.conhecidas.keys()].sort((a,b)=>a-b);
    const ultimoNum=nums[nums.length-1];
    const ancora=c.conhecidas.get(ultimoNum);
    const proprias=[];

    nums.forEach(n=>{
      const p=c.conhecidas.get(n);
      proprias.push({chave:c.chave,nome:c.nome,cartao:c.cartao,dono:c.dono,
        num:n,total:c.parcelaTotal,mesRef:p.mesRef,valor:p.valor,projetada:false});
    });

    // Quitada: o banco está agendando parcelas, mas nenhuma é desta compra.
    const temFuturo=proprias.some(p=>p.mesRef>=mesBase);
    const quitada=bancoAgendando&&!temFuturo;

    // A partir da última conhecida, uma parcela por mês, com o mesmo valor.
    if(!quitada){
      let mes=ancora.mesRef;
      for(let n=ultimoNum+1;n<=c.parcelaTotal;n++){
        mes=mesProximo(mes);
        proprias.push({chave:c.chave,nome:c.nome,cartao:c.cartao,dono:c.dono,
          num:n,total:c.parcelaTotal,mesRef:mes,valor:ancora.valor,projetada:true});
      }
    }
    itens.push(...proprias);

    // "Em curso" é relativo ao mês-base: o que já passou não interessa aqui.
    const restantes=proprias.filter(p=>p.mesRef>=mesBase).sort((a,b)=>a.num-b.num);
    if(!restantes.length) return;
    const mesFinal=proprias.reduce((a,p)=>p.mesRef>a?p.mesRef:a,proprias[0].mesRef);
    resumo.push({
      chave:c.chave,nome:c.nome,cartao:c.cartao,dono:c.dono,obs:c.obs,
      parcelaTotal:c.parcelaTotal,valorParcela:ancora.valor,
      proximaNum:restantes[0].num,restantes:restantes.length,
      falta:restantes.reduce((a,p)=>a+p.valor,0),
      mesFinal,terminaEsteMes:mesFinal===mesBase,
      projetadas:restantes.filter(p=>p.projetada).length,
    });
  });

  // 3. Quanto cada mês da janela já tem comprometido.
  const janela=[];
  let m=mesBase;
  for(let i=0;i<meses;i++){ janela.push(m); m=mesProximo(m); }
  const porMes=janela.map(mesJ=>{
    const doMes=itens.filter(x=>x.mesRef===mesJ).sort((a,b)=>b.valor-a.valor);
    return{mesRef:mesJ,qtd:doMes.length,itens:doMes,
      total:doMes.reduce((a,x)=>a+x.valor,0),
      projetado:doMes.filter(x=>x.projetada).reduce((a,x)=>a+x.valor,0)};
  });

  resumo.sort((a,b)=>a.mesFinal===b.mesFinal?b.falta-a.falta:a.mesFinal.localeCompare(b.mesFinal));
  return{
    compras:resumo,
    porMes,
    terminando:resumo.filter(c=>c.terminaEsteMes),
    totalFalta:resumo.reduce((a,c)=>a+c.falta,0),
    totalMesBase:porMes[0]?porMes[0].total:0,
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const inp={fontSize:13,padding:"6px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surfaceAlt,color:C.text,width:"100%",boxSizing:"border-box",outline:"none"};
const sel={...inp,cursor:"pointer"};
const card={background:C.surface,border:`1px solid ${C.borderSoft}`,borderRadius:14,padding:"1rem 1.25rem",marginBottom:12,boxShadow:"0 1px 3px rgba(0,0,0,0.35)"};
const th={padding:"9px 10px",textAlign:"left",color:C.textMuted,fontWeight:600,fontSize:10,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`,textTransform:"uppercase",letterSpacing:"0.06em"};
const td={padding:"8px 10px",fontSize:13,color:C.text,borderBottom:`1px solid ${C.borderSoft}`};

// ── UI Components ─────────────────────────────────────────────────────────────
function Btn({active,danger,small,children,onClick,style={},disabled,title}){
  const base={fontSize:small?11:13,padding:small?"5px 10px":"8px 18px",borderRadius:8,border:"1px solid",cursor:disabled?"not-allowed":"pointer",fontWeight:active?600:500,display:"inline-flex",alignItems:"center",gap:5,opacity:disabled?0.45:1,transition:"background .15s,border-color .15s,color .15s",...style};
  const theme=danger
    ?{background:C.redSoft,color:C.red600,borderColor:C.red100}
    :active?{background:C.teal50,color:C.teal600,borderColor:C.teal100}
    :{background:C.surfaceAlt,color:C.textDim,borderColor:C.border};
  return <button className="gf-btn" title={title} onClick={disabled?undefined:onClick} style={{...base,...theme}}>{children}</button>;
}

function Badge({color,children}){
  const t=color==="new"?{bg:C.amber50,c:C.amber600,b:C.amber100}
    :color==="info"?{bg:C.blue50,c:C.blue600,b:C.blue100}
    :{bg:C.green50,c:C.green600,b:C.green100};
  return <span style={{fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:600,background:t.bg,color:t.c,border:`1px solid ${t.b}`}}>{children}</span>;
}

const ACCENTS={
  teal:{bg:C.teal50,color:C.teal600,border:C.teal100},
  red:{bg:C.red50,color:C.red600,border:C.red100},
  green:{bg:C.green50,color:C.green600,border:C.green100},
  purple:{bg:C.purple50,color:C.purple600,border:C.purple100},
  blue:{bg:C.blue50,color:C.blue600,border:C.blue100},
  amber:{bg:C.amber50,color:C.amber600,border:C.amber100},
  none:{bg:C.surfaceAlt,color:C.textDim,border:C.border},
};

function MetricCard({label,value,sub,accent,icon,children}){
  const a=ACCENTS[accent||"none"];
  return(
    <div style={{background:a.bg,border:`1px solid ${a.border}`,borderRadius:14,padding:"0.9rem 1rem"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        {icon&&<span style={{fontSize:15}}>{icon}</span>}
        <span style={{fontSize:10,color:a.color,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:700,opacity:0.85}}>{label}</span>
      </div>
      <div style={{fontSize:21,fontWeight:700,color:a.color,lineHeight:1.2,letterSpacing:"-0.02em",fontVariantNumeric:"tabular-nums"}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:a.color,opacity:0.65,marginTop:4}}>{sub}</div>}
      {children}
    </div>
  );
}

/**
 * Linhas de detalhe dentro de um MetricCard.
 *
 * Herdam a cor do card, com opacidade menor, para o número grande continuar
 * sendo o que se lê primeiro — a quebra é apoio, não concorrente.
 */
function DetalheCard({cor,linhas}){
  const visiveis=linhas.filter(l=>l&&(l.sempre||Math.abs(l.valor)>=0.01));
  if(!visiveis.length) return null;
  return(
    <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${cor}22`}}>
      {visiveis.map(l=>(
        <div key={l.rot} style={{display:"flex",justifyContent:"space-between",gap:8,
          fontSize:11,color:cor,opacity:l.forte?0.95:0.7,padding:"2px 0",
          fontWeight:l.forte?700:400}}>
          <span>{l.rot}</span>
          <span style={{fontVariantNumeric:"tabular-nums"}}>{fmtBRL(l.valor)}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({pct,color}){
  return(
    <div style={{height:4,borderRadius:4,background:"rgba(255,255,255,0.10)",overflow:"hidden"}}>
      <div style={{height:"100%",borderRadius:4,background:color||C.teal600,width:`${Math.min(100,pct)}%`,transition:"width 0.4s ease"}}/>
    </div>
  );
}

function SectionLabel({children}){
  return <div style={{fontSize:10,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.09em",padding:"14px 0 5px"}}>{children}</div>;
}

function EmptyState({icon,children}){
  return(
    <div style={{textAlign:"center",padding:"2.5rem 0",color:C.textMuted}}>
      <div style={{fontSize:34,marginBottom:10,opacity:0.5}}>{icon}</div>
      <p style={{fontSize:13,margin:0}}>{children}</p>
    </div>
  );
}

function Modal({onClose,children,wide}){
  useEffect(()=>{
    const onKey=e=>{if(e.key==="Escape")onClose();};
    window.addEventListener("keydown",onKey);
    const prev=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow=prev;};
  },[onClose]);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(2px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={onClose}>
      <div style={{...card,maxWidth:wide?680:460,width:"100%",maxHeight:"82vh",overflowY:"auto",margin:0,boxShadow:"0 18px 50px rgba(0,0,0,0.6)"}} onClick={e=>e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function tempoRelativo(iso){
  const t=new Date(iso).getTime();
  if(isNaN(t)) return "";
  const min=Math.round((Date.now()-t)/60000);
  if(min<1) return "agora";
  if(min<60) return `há ${min} min`;
  const h=Math.round(min/60);
  if(h<24) return `há ${h}h`;
  return `há ${Math.round(h/24)}d`;
}

/** Idade em horas, ou null se a data não der para ler. */
function horasDesde(iso){
  const t=new Date(iso).getTime();
  return isNaN(t)?null:(Date.now()-t)/3600000;
}

/** Faixa de status do Open Finance: frescor do dado e conciliação com o banco. */
function BarraOpenFinance({temOF,ultimoSync,pluggyEm,erroSync,conciliacao,pedindoSync,onAtualizar,onCartoes,isMobile}){
  if(!temOF) return(
    <div style={{...card,borderColor:C.amber100,background:C.amberSoft}}>
      <div style={{fontSize:13,color:C.amber600,fontWeight:600,marginBottom:4}}>Open Finance não configurado</div>
      <div style={{fontSize:12,color:C.textDim,lineHeight:1.6}}>
        Instale o Apps Script e rode <code>sincronizarAgora()</code>. Passo a passo em <code>docs/SETUP-PLUGGY.md</code>.
      </div>
    </div>
  );
  const divergentes=conciliacao.filter(c=>Math.abs(c.dif)>=0.01);
  // Duas idades diferentes, e confundi-las já custou tempo: `ultimoSync` é
  // quando NÓS lemos o Pluggy; `pluggyEm` é quando o PLUGGY leu o banco. É a
  // segunda que limita o que dá para ver — sincronizar não faz o Pluggy ir ao
  // banco. Acima de 24h, o dado do banco está velho e a fatura vai divergir.
  const hSync=horasDesde(ultimoSync);
  const hBanco=horasDesde(pluggyEm);
  const syncVelho=hSync!==null&&hSync>=48;
  const bancoVelho=hBanco!==null&&hBanco>=24;
  return(
    <div style={{...card,padding:"0.85rem 1rem"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:syncVelho?C.amber600:C.textMuted,
            fontWeight:syncVelho?600:400}}>
            {ultimoSync?`Sincronizado ${tempoRelativo(ultimoSync)}`:"Nunca sincronizado"}
          </span>
          {pluggyEm&&(
            <span style={{fontSize:11,color:bancoVelho?C.amber600:C.textMuted,
              fontWeight:bancoVelho?600:400}}
              title="Quando o Pluggy foi ao banco. Sincronizar relê o Pluggy, não o banco.">
              · banco lido {tempoRelativo(pluggyEm)}
            </span>
          )}
          {conciliacao.length>0&&(divergentes.length===0
            ?<Badge>confere com o banco</Badge>
            :<Badge color="new">{divergentes.length} cartão(ões) divergindo</Badge>)}
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn small onClick={onCartoes}>💳 Cartões</Btn>
          <Btn small active onClick={onAtualizar} disabled={pedindoSync}>
            {pedindoSync?"Pedindo…":"🔄 Atualizar"}
          </Btn>
        </div>
      </div>

      {erroSync&&(
        <div style={{marginTop:10,fontSize:12,color:C.red600,background:C.red50,border:`1px solid ${C.red100}`,padding:"8px 10px",borderRadius:8}}>
          ⚠️ {erroSync}
        </div>
      )}

      {bancoVelho&&(
        <div style={{marginTop:10,fontSize:12,color:C.amber600,background:C.amberSoft,border:`1px solid ${C.amber100}`,padding:"8px 10px",borderRadius:8,lineHeight:1.6}}>
          <strong>O Pluggy não vai ao banco desde {tempoRelativo(pluggyEm)}.</strong>{" "}
          Compras mais recentes que isso ainda não existem aqui — e o botão
          Atualizar não resolve, ele só relê o Pluggy. Para forçar, rode{" "}
          <code>atualizarDoBancoESincronizar()</code> no Apps Script.
        </div>
      )}

      {divergentes.length>0&&(
        <div style={{marginTop:10,fontSize:12,color:C.amber600,background:C.amber50,border:`1px solid ${C.amber100}`,padding:"8px 10px",borderRadius:8,lineHeight:1.7}}>
          <strong>Total diferente do banco</strong>
          {divergentes.map(c=>(
            <div key={c.accountId} style={{color:C.textDim}}>
              {c.nome}: nós {fmtBRL(c.nosso)} · banco {fmtBRL(c.banco)} ·{" "}
              <strong style={{color:C.amber600}}>{c.dif>0?"+":""}{fmtBRL(c.dif)}</strong>
            </div>
          ))}
          <div style={{color:C.textMuted,fontSize:11,marginTop:4}}>
            Normalmente é lançamento que o Pluggy não entregou. Confira na fatura do banco.
          </div>
        </div>
      )}

      {!isMobile&&conciliacao.length>0&&divergentes.length===0&&(
        <div style={{marginTop:8,fontSize:11,color:C.textMuted}}>
          {conciliacao.map(c=>`${c.nome}: ${fmtBRL(c.nosso)}`).join("  ·  ")}
        </div>
      )}
    </div>
  );
}

/** Tabela de fatura. Serve tanto para Open Finance quanto para linhas legadas. */
function TabelaFatura({titulo,subtitulo,linhas,isMobile,pessoas,filtro,setFiltro,
  mostrarIgnoradas,setMostrarIgnoradas,mostrarPagamentos,setMostrarPagamentos,
  onCampo,onIgnorar,onAprender,onLegado,onRemoverLegado}){

  const filtros=["TODOS","PARCELADO","RECORRENTE","VARIÁVEL","NOVO"];
  const vis=linhas.filter(r=>filtro==="TODOS"?true:filtro==="NOVO"?r.isNew:r.parcelas===filtro);
  const novos=linhas.filter(r=>r.isNew).length;
  const semDono=linhas.filter(r=>!r.dono&&!r.ignorada&&r.natureza!=="PAGAMENTO").length;
  const total=totalFatura(linhas);

  return(
    <div style={card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:14,fontWeight:600,color:C.text}}>{titulo}</span>
            {novos>0&&<Badge color="new">{novos} para revisar</Badge>}
          </div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:3}}>
            {linhas.length} lançamentos · {subtitulo}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:19,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums",letterSpacing:"-0.02em"}}>{fmtBRL(total)}</div>
          <div style={{fontSize:10,color:C.textMuted}}>total da fatura</div>
        </div>
      </div>

      {semDono>0&&(
        <div style={{fontSize:12,color:C.amber600,background:C.amberSoft,border:`1px solid ${C.amber100}`,padding:"7px 10px",borderRadius:8,marginBottom:10}}>
          {semDono} lançamento(s) sem dono — <strong>não entram no checklist</strong> até você classificar.
        </div>
      )}

      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10,alignItems:"center"}}>
        {filtros.map(f=>(
          <button key={f} className="gf-btn" onClick={()=>setFiltro(f)}
            style={{fontSize:11,padding:"5px 10px",borderRadius:20,cursor:"pointer",
              border:`1px solid ${filtro===f?C.teal100:C.border}`,
              background:filtro===f?C.teal50:"transparent",
              color:filtro===f?C.teal600:C.textDim,fontWeight:filtro===f?700:500}}>{f}</button>
        ))}
        <span style={{flex:1}}/>
        <label style={{fontSize:11,color:C.textDim,display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
          <input type="checkbox" checked={mostrarIgnoradas} onChange={e=>setMostrarIgnoradas(e.target.checked)} style={{accentColor:C.teal600}}/>
          ignoradas
        </label>
        <label style={{fontSize:11,color:C.textDim,display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
          <input type="checkbox" checked={mostrarPagamentos} onChange={e=>setMostrarPagamentos(e.target.checked)} style={{accentColor:C.teal600}}/>
          pagamentos
        </label>
      </div>

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:isMobile?620:680}}>
          <thead><tr style={{background:C.surfaceAlt}}>
            {["Data","Descrição","Cartão","Valor","Dono","Classificação","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {vis.map(r=>{
              const leg=r.origem==="LEGADO";
              const pag=r.natureza==="PAGAMENTO";
              return(
                <tr key={r.id} style={{
                  background:r.ignorada?"transparent":r.isNew?C.amberSoft:"transparent",
                  opacity:r.ignorada?0.42:1}}>
                  <td style={{...td,color:C.textMuted,whiteSpace:"nowrap"}}>{dataCurta(r.data)||r.data}</td>
                  <td style={td}>
                    <div style={{fontWeight:500,textDecoration:r.ignorada?"line-through":"none"}}>{r.nome}</div>
                    <div style={{fontSize:10,color:C.textMuted,display:"flex",gap:6}}>
                      {r.parcela&&<span>{r.parcela}</span>}
                      {pag&&<span style={{color:C.blue600}}>pagamento</span>}
                      {r.natureza==="ESTORNO"&&<span style={{color:C.green600}}>estorno</span>}
                      {leg&&<span style={{color:C.textMuted}}>legado</span>}
                    </div>
                  </td>
                  <td style={{...td,color:C.textDim,whiteSpace:"nowrap",fontSize:11}}>{r.cartao||"—"}</td>
                  <td style={{...td,fontWeight:600,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap",
                    color:r.valor<0?C.green600:C.text}}>{fmtBRL(r.valor)}</td>
                  <td style={td}>
                    <DonoSelect value={r.dono} pessoas={pessoas} width={104}
                      onChange={v=>leg?onLegado(r.id,"dono",v):onCampo(r,"dono",v)}
                      style={{opacity:pag?0.4:1,borderColor:!r.dono&&!pag?C.amber100:C.border}}/>
                  </td>
                  <td style={td}>
                    <select value={r.parcelas} disabled={pag}
                      onChange={e=>leg?onLegado(r.id,"parcelas",e.target.value):onCampo(r,"classificacao",e.target.value)}
                      style={{...sel,width:100,opacity:pag?0.4:1}}>{PARC_OPTS.map(d=><option key={d}>{d}</option>)}</select>
                  </td>
                  <td style={td}>
                    <input value={r.obs} disabled={pag}
                      onChange={e=>leg?onLegado(r.id,"obs",e.target.value):onCampo(r,"obs",e.target.value)}
                      style={{...inp,width:85,opacity:pag?0.4:1}}/>
                  </td>
                  <td style={td}><div style={{display:"flex",gap:4}}>
                    {!leg&&r.isNew&&r.dono&&(
                      <Btn small onClick={()=>onAprender(r)} title="Salvar no dicionário"
                        style={{color:C.green600,borderColor:C.green100,background:C.green50}}>Aprender</Btn>
                    )}
                    {leg
                      ?<Btn danger small title="Remover" onClick={()=>onRemoverLegado(r.id)}>✕</Btn>
                      :<Btn small danger={!r.ignorada} title={r.ignorada?"Voltar a contar":"Ignorar — sai dos totais"}
                          onClick={()=>onIgnorar(r,!r.ignorada)}>{r.ignorada?"↩":"🚫"}</Btn>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {vis.length===0&&<EmptyState icon="🔍">Nenhum lançamento com esse filtro.</EmptyState>}
    </div>
  );
}

// Modal de confirmação — substitui as deleções instantâneas sem aviso.
function ConfirmModal({titulo,texto,onConfirm,onClose}){
  return(
    <Modal onClose={onClose}>
      <h3 style={{fontSize:15,fontWeight:600,margin:"0 0 8px",color:C.text}}>{titulo}</h3>
      <p style={{fontSize:13,color:C.textDim,margin:"0 0 18px",lineHeight:1.6}}>{texto}</p>
      <div style={{display:"flex",gap:8}}>
        <Btn danger onClick={()=>{onConfirm();onClose();}}>Confirmar</Btn>
        <Btn onClick={onClose}>Cancelar</Btn>
      </div>
    </Modal>
  );
}

/**
 * Aba Parcelas: o que já está comprometido nos próximos meses.
 *
 * A pergunta que ela responde é "quanto do meu mês que vem já está gasto", e a
 * segunda é "o que vai sair da conta em breve" — por isso o alerta de quitação
 * fica no topo, antes da lista.
 */
function PainelParcelas({proj,mesRef,isMobile,onVerMes}){
  const{compras,porMes,terminando,totalFalta,totalMesBase}=proj;
  const pico=Math.max(...porMes.map(m=>m.total),1);
  const mesesComAlgo=porMes.filter(m=>m.total>0);
  const liberaNoMes=terminando.reduce((a,c)=>a+c.valorParcela,0);

  if(!compras.length) return(
    <div style={card}><EmptyState icon="📅">
      Nenhuma compra parcelada em andamento a partir de {mesLabel(mesRef)}.
    </EmptyState></div>
  );

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,1fr)",gap:10,marginBottom:14}}>
        <MetricCard label={`Parcelas em ${mesLabelCurto(mesRef)}`} icon="📅"
          value={fmtBRL(totalMesBase)} accent="blue"
          sub={`${porMes[0]?.qtd||0} parcela${(porMes[0]?.qtd||0)===1?"":"s"}`}/>
        <MetricCard label="Falta pagar no total" icon="⏳"
          value={fmtBRL(totalFalta)} accent="amber"
          sub={`${compras.length} compra${compras.length===1?"":"s"} em curso`}/>
        <MetricCard label="Quita neste mês" icon="🎉"
          value={fmtBRL(liberaNoMes)} accent={liberaNoMes>0?"green":"none"}
          sub={liberaNoMes>0?`libera por mês a partir de ${mesLabelCurto(mesProximo(mesRef))}`:"nada termina agora"}/>
      </div>

      {terminando.length>0&&(
        <div style={{...card,background:C.green50,border:`1px solid ${C.green100}`}}>
          <div style={{fontSize:13,fontWeight:600,color:C.green600,marginBottom:8}}>
            🎉 Termina em {mesLabel(mesRef)}
          </div>
          {terminando.map(c=>(
            <div key={c.chave} style={{display:"flex",justifyContent:"space-between",gap:10,
              fontSize:12,color:C.green600,padding:"4px 0",flexWrap:"wrap"}}>
              <span>{c.nome} <span style={{opacity:0.6}}>· última de {c.parcelaTotal}</span></span>
              <strong style={{fontVariantNumeric:"tabular-nums"}}>{fmtBRL(c.valorParcela)}/mês</strong>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <SectionLabel>Comprometido por mês</SectionLabel>
        <p style={{fontSize:11,color:C.textMuted,margin:"0 0 12px",lineHeight:1.6}}>
          Só compras parceladas. Barra listrada é projeção — a parcela ainda não
          apareceu na fatura, mas vai. Clique num mês para ver o detalhe.
        </p>
        {mesesComAlgo.length===0
          ?<EmptyState icon="📅">Nada comprometido nos próximos meses.</EmptyState>
          :mesesComAlgo.map(m=>{
            const pctReal=((m.total-m.projetado)/pico)*100;
            const pctProj=(m.projetado/pico)*100;
            return(
              <button key={m.mesRef} className="gf-btn" onClick={()=>onVerMes(m)}
                style={{display:"block",width:"100%",textAlign:"left",background:"transparent",
                  border:"none",borderRadius:8,padding:"6px 4px",cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                  <span style={{color:m.mesRef===mesRef?C.blue600:C.textDim,
                    fontWeight:m.mesRef===mesRef?700:500}}>
                    {mesLabelCurto(m.mesRef)}
                    <span style={{color:C.textMuted,fontWeight:400,marginLeft:6}}>{m.qtd}×</span>
                  </span>
                  <strong style={{color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtBRL(m.total)}</strong>
                </div>
                <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",background:C.surfaceAlt}}>
                  <div style={{width:`${pctReal}%`,background:C.blue600}}/>
                  <div style={{width:`${pctProj}%`,backgroundColor:C.blue100,
                    backgroundImage:`repeating-linear-gradient(45deg,transparent,transparent 3px,${C.blue600}55 3px,${C.blue600}55 6px)`}}/>
                </div>
              </button>
            );
          })}
      </div>

      <div style={card}>
        <SectionLabel>Compras em andamento</SectionLabel>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:640}}>
            <thead><tr style={{background:C.surfaceAlt}}>
              {["Compra","Obs","Cartão","Dono","Próxima","Valor/mês","Restam","Falta","Termina"].map(h=>
                <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>{compras.map(c=>(
              <tr key={c.chave}>
                <td style={{...td,maxWidth:180}}>
                  <div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                    title={c.nome}>{c.nome}</div>
                </td>
                {/* A obs é o que você escreveu na fatura — costuma ser o nome
                    de verdade da compra, já que a descrição do banco é cifrada. */}
                <td style={{...td,maxWidth:150,color:c.obs?C.text:C.textMuted}}>
                  <div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                    title={c.obs||""}>{c.obs||"—"}</div>
                </td>
                <td style={{...td,color:C.textDim,whiteSpace:"nowrap"}}>{c.cartao}</td>
                <td style={td}>
                  {c.dono
                    ?<span style={{color:c.dono==="Luanna"?C.purple600:c.dono==="Caulin"?C.teal600:C.textDim}}>{c.dono}</span>
                    :<span style={{color:C.amber600}}>—</span>}
                </td>
                <td style={{...td,color:C.textDim,fontVariantNumeric:"tabular-nums"}}>
                  {String(c.proximaNum).padStart(2,"0")}/{String(c.parcelaTotal).padStart(2,"0")}
                </td>
                <td style={{...td,fontVariantNumeric:"tabular-nums"}}>{fmtBRL(c.valorParcela)}</td>
                <td style={{...td,color:C.textDim}}>{c.restantes}×</td>
                <td style={{...td,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{fmtBRL(c.falta)}</td>
                <td style={{...td,whiteSpace:"nowrap"}}>
                  {c.terminaEsteMes
                    ?<Badge color="ok">{mesLabelCurto(c.mesFinal)}</Badge>
                    :<span style={{color:C.textDim}}>{mesLabelCurto(c.mesFinal)}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Configurações — fica fora das abas de trabalho de propósito.
 *
 * Junta as duas coisas que você configura uma vez e quase não mexe: o
 * dicionário de categorização e o cadastro de pessoas.
 */
function PainelConfig({dict,onDict,pessoas,onPessoas,usoDoDict,isMobile}){
  const [nova,setNova]=useState("");
  const [filtroDict,setFiltroDict]=useState("");

  const addPessoa=()=>{
    const n=nova.trim();
    if(!n) return;
    // Nome do casal ou repetido não entra: viraria duplicata nos totais.
    if(CASAL.includes(n)||n===DIVIDIDO||pessoas.some(p=>normalize(p)===normalize(n))){
      setNova(""); return;
    }
    onPessoas([...pessoas,n]); setNova("");
  };
  const visiveis=filtroDict
    ? dict.filter(d=>normalize(d.key).includes(normalize(filtroDict)))
    : dict;

  return(
    <div>
      <div style={card}>
        <SectionLabel>Pessoas</SectionLabel>
        <p style={{fontSize:12,color:C.textMuted,margin:"0 0 12px",lineHeight:1.6}}>
          Quem mais usa o cartão de vocês. Aparecem no campo Dono e podem entrar
          na divisão de um lançamento. O que for atribuído a elas sai das despesas
          do casal e vira “a receber” no checklist.
        </p>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          <input value={nova} onChange={e=>setNova(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")addPessoa();}}
            placeholder="Nome (ex.: Rafael)" style={{...inp,maxWidth:220}}/>
          <Btn active small onClick={addPessoa} disabled={!nova.trim()}>+ Adicionar</Btn>
        </div>
        {pessoas.length===0
          ?<EmptyState icon="👥">Ninguém cadastrado ainda.</EmptyState>
          :pessoas.map(p=>(
            <div key={p} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              gap:10,padding:"9px 0",borderTop:`1px solid ${C.borderSoft}`}}>
              <span style={{fontSize:13,color:C.text}}>{p}</span>
              <Btn danger small title="Remover"
                onClick={()=>onPessoas(pessoas.filter(x=>x!==p))}>✕</Btn>
            </div>
          ))}
        {pessoas.length>0&&(
          <p style={{fontSize:11,color:C.textMuted,marginTop:10,lineHeight:1.5}}>
            Remover alguém daqui não mexe nos lançamentos já classificados —
            eles continuam com o nome gravado.
          </p>
        )}
      </div>

      <div style={card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          gap:8,flexWrap:"wrap",marginBottom:4}}>
          <SectionLabel>Dicionário ({dict.length})</SectionLabel>
          <input value={filtroDict} onChange={e=>setFiltroDict(e.target.value)}
            placeholder="filtrar…" style={{...inp,maxWidth:160,fontSize:12}}/>
        </div>
        <p style={{fontSize:12,color:C.textMuted,margin:"0 0 12px",lineHeight:1.6}}>
          Cada padrão casa por trecho da descrição, sem acento e sem
          maiúsculas. É o que faz a fatura chegar classificada sozinha.
        </p>
        {dict.length===0
          ?<EmptyState icon="🧠">Vazio. Use “Aprender” na fatura para ensinar.</EmptyState>
          :<div style={{overflowX:"auto"}}>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:isMobile?460:520}}>
              <thead><tr style={{background:C.surfaceAlt}}>
                {["Padrão","Dono","Classificação","Obs","Usos",""].map(h=><th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{visiveis.map((d,i)=>{
                const idx=dict.indexOf(d);
                const upd=(campo,v)=>onDict(dict.map((x,j)=>j===idx?{...x,[campo]:v}:x));
                return(
                  <tr key={d.key+i}>
                    <td style={td}>
                      <input value={d.key} onChange={e=>upd("key",e.target.value)}
                        style={{...inp,width:150,fontFamily:"ui-monospace,monospace"}}/>
                    </td>
                    <td style={td}>
                      <DonoSelect value={d.dono} pessoas={pessoas} width={104}
                        onChange={v=>upd("dono",v)}/>
                    </td>
                    <td style={td}>
                      <select value={d.parcelas} onChange={e=>upd("parcelas",e.target.value)}
                        style={{...sel,width:104}}>{PARC_OPTS.map(o=><option key={o}>{o}</option>)}</select>
                    </td>
                    <td style={td}>
                      <input value={d.obs||""} onChange={e=>upd("obs",e.target.value)}
                        style={{...inp,width:100}}/>
                    </td>
                    <td style={{...td,color:usoDoDict[d.key]?C.textDim:C.amber600,
                      whiteSpace:"nowrap"}}>
                      {usoDoDict[d.key]||0}
                    </td>
                    <td style={td}>
                      <Btn danger small title="Remover"
                        onClick={()=>onDict(dict.filter((_,j)=>j!==idx))}>✕</Btn>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>}
        <p style={{fontSize:11,color:C.textMuted,marginTop:10,lineHeight:1.5}}>
          “Usos” conta quantas transações carregadas casam com o padrão. Zero
          costuma ser padrão específico demais — normal em compra parcelada
          antiga, suspeito no resto.
        </p>
      </div>
    </div>
  );
}

/**
 * Texto do resumo, na ótica de UMA pessoa.
 *
 * Cada valor já vem dividido — quem recebe vê o que precisa pagar, não o total
 * do casal. O saldo é renda menos o que essa pessoa já marcou como pago.
 */
function resumoWhatsApp(pessoa,calc,mesRef,vPessoa){
  const{contasList,invList,totalFaturaCartoes,aReceber}=calc;
  const renda=pessoa==="Caulin"?calc.rendaCaulin:calc.rendaLuanna;
  const desp =pessoa==="Caulin"?calc.despCaulin :calc.despLuanna;
  const saldo=pessoa==="Caulin"?calc.saldoCaulin:calc.saldoLuanna;
  const meus=lista=>lista.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0);
  const linha=r=>`   ${r.transacao||r.descricao||r.nome}: ${fmtBRL(vPessoa(r.valor,r.dono,pessoa))}`;

  const L=[`📊 ${pessoa.toUpperCase()} — ${mesLabel(mesRef)}`,""];
  L.push(`💰 Renda: ${fmtBRL(renda)}`);
  L.push(`📉 A pagar: ${fmtBRL(desp)}`);
  L.push(`💵 Saldo: ${fmtBRL(saldo)}`,"");

  const inv=meus(invList);
  if(inv.length){ L.push("📈 Investimentos"); inv.forEach(r=>L.push(linha(r))); L.push(""); }

  const ct=meus(contasList);
  if(ct.length){ L.push("🏠 Contas"); ct.forEach(r=>L.push(linha(r))); L.push(""); }

  totalFaturaCartoes.forEach(c=>{
    const grupos=[["Fixos",c.fixos],["Parcelados",c.parcelados],["Variáveis",c.variaveis]]
      .map(([rot,rows])=>[rot,meus(rows).reduce((a,r)=>a+vPessoa(r.valor,r.dono,pessoa),0)])
      .filter(([,v])=>v>0);
    if(!grupos.length) return;
    L.push(`💳 ${c.nome}`);
    grupos.forEach(([rot,v])=>L.push(`   ${rot}: ${fmtBRL(v)}`));
    L.push(`   Total: ${fmtBRL(grupos.reduce((a,[,v])=>a+v,0))}`,"");
  });

  if(pessoa==="Caulin"&&aReceber.length){
    L.push("💰 A receber de terceiros");
    aReceber.forEach(p=>L.push(`   ${p.nome}: ${fmtBRL(p.total)}`));
  }
  return L.join("\n").trim();
}

/**
 * Seletor de Dono, único em todo o app.
 *
 * O caso simples (Caulin / Luanna / Dividido / uma pessoa cadastrada) resolve
 * no próprio select. A divisão customizada abre um modal de caixas de seleção
 * — com N pessoas, listar todas as combinações no select seria inviável.
 */
function DonoSelect({value,onChange,pessoas,width,style}){
  const [abrir,setAbrir]=useState(false);
  const [marcados,setMarcados]=useState([]);
  const atual=String(value||"");
  const simples=[...DONOS,...pessoas];
  // Combinação que não está na lista (ex.: "Caulin+Rafael") precisa aparecer
  // como opção, senão o select mostraria o item errado.
  const extra=atual&&!simples.includes(atual)?[atual]:[];

  const escolher=v=>{
    if(v==="__DIV__"){ setMarcados(participantes(atual)); setAbrir(true); return; }
    onChange(v);
  };
  const alternar=nome=>setMarcados(p=>p.includes(nome)?p.filter(x=>x!==nome):[...p,nome]);
  const confirmar=()=>{ if(marcados.length) onChange(donoCanonico(marcados)); setAbrir(false); };

  return(
    <>
      <select value={atual} onChange={e=>escolher(e.target.value)}
        style={{...sel,width:width||"100%",...style}}>
        {atual===""&&<option value="">—</option>}
        {DONOS.map(d=><option key={d} value={d}>{d}</option>)}
        {pessoas.length>0&&(
          <optgroup label="Outras pessoas">
            {pessoas.map(p=><option key={p} value={p}>{p}</option>)}
          </optgroup>
        )}
        {extra.map(d=><option key={d} value={d}>{rotuloDono(d)}</option>)}
        <option value="__DIV__">Dividir entre…</option>
      </select>

      {abrir&&(
        <Modal onClose={()=>setAbrir(false)}>
          <h3 style={{fontSize:15,fontWeight:600,margin:"0 0 4px",color:C.text}}>Dividir entre</h3>
          <p style={{fontSize:12,color:C.textMuted,margin:"0 0 14px",lineHeight:1.6}}>
            O valor é dividido igualmente entre quem estiver marcado.
          </p>
          {[...CASAL,...pessoas].map(nome=>(
            <label key={nome} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 0",
              borderTop:`1px solid ${C.borderSoft}`,cursor:"pointer",fontSize:13,color:C.text}}>
              <input type="checkbox" checked={marcados.includes(nome)} onChange={()=>alternar(nome)}
                style={{accentColor:C.teal600,width:15,height:15,cursor:"pointer"}}/>
              {nome}
            </label>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginTop:16,paddingTop:12,borderTop:`1px solid ${C.border}`,gap:8}}>
            <span style={{fontSize:12,color:C.textDim}}>
              {marcados.length?`÷${marcados.length} — ${marcados.join(" + ")}`:"ninguém selecionado"}
            </span>
            <div style={{display:"flex",gap:6}}>
              <Btn small onClick={()=>setAbrir(false)}>Cancelar</Btn>
              <Btn small active disabled={!marcados.length} onClick={confirmar}>Aplicar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CopyMesModal({dadosMes,mesRef,onClose,onImport}){
  // mesAnterior atravessa a virada de ano — antes, JANEIRO nunca achava DEZEMBRO.
  const prevNome=mesAnterior(mesRef);
  const prev=dadosMes[prevNome];
  const [sel2,setSel2]=useState({contas:{},investimentos:{},manual:{}});
  if(!prev) return(
    <div style={{padding:"0.5rem"}}>
      <p style={{fontSize:13,marginBottom:14,color:C.textDim}}>Não há dados em {mesLabel(prevNome)}.</p>
      <Btn onClick={onClose}>Fechar</Btn>
    </div>
  );
  const toggle=(sec,id)=>setSel2(p=>({...p,[sec]:{...p[sec],[id]:!p[sec][id]}}));
  const allToggle=(sec,items)=>{const allOn=items.every(i=>sel2[sec][i.id]);const nx={};items.forEach(i=>nx[i.id]=!allOn);setSel2(p=>({...p,[sec]:nx}));};
  const sections=[
    {key:"contas",label:"Contas / Renda",items:prev.contas||[]},
    {key:"investimentos",label:"Investimentos",items:prev.investimentos||[]},
    {key:"manual",label:"Outros cartões",items:prev.manual||[]},
  ].filter(s=>s.items.length>0);
  const doImport=()=>{
    const res={};
    sections.forEach(s=>{res[s.key]=s.items.filter(i=>sel2[s.key][i.id]).map(i=>({...i,id:uid()}));});
    onImport(res);
    onClose();
  };
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h3 style={{fontSize:15,fontWeight:600,margin:0,color:C.text}}>Copiar de {mesLabel(prevNome)}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize:20,lineHeight:1}}>✕</button>
      </div>
      {sections.map(sec=>(
        <div key={sec.key} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <SectionLabel>{sec.label}</SectionLabel>
            <Btn small onClick={()=>allToggle(sec.key,sec.items)}>Todos</Btn>
          </div>
          {sec.items.map(item=>(
            <label key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",cursor:"pointer",fontSize:13,color:C.text,borderTop:`1px solid ${C.borderSoft}`}}>
              <input type="checkbox" checked={!!sel2[sec.key][item.id]} onChange={()=>toggle(sec.key,item.id)} style={{accentColor:C.teal600,width:15,height:15}}/>
              <span style={{flex:1}}>{item.transacao||item.descricao||item.nome}</span>
              <span style={{color:C.textDim,fontSize:12,fontVariantNumeric:"tabular-nums"}}>{fmtBRL(parseBRL(item.valor||0))}</span>
            </label>
          ))}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
        <Btn active onClick={doImport}>Importar selecionados</Btn>
        <Btn onClick={onClose}>Cancelar</Btn>
      </div>
    </div>
  );
}

// Hook de media query — necessário porque o app usa inline styles (sem CSS-in-JS
// nem Tailwind), então não há como declarar breakpoint no próprio estilo.
// useSyncExternalStore é a API própria do React para assinar fonte externa:
// evita setState dentro de effect e não perde mudança ocorrida antes do mount.
function useMediaQuery(query){
  const subscribe=useCallback(cb=>{
    const mq=window.matchMedia(query);
    mq.addEventListener("change",cb);
    return()=>mq.removeEventListener("change",cb);
  },[query]);
  const getSnapshot=useCallback(()=>window.matchMedia(query).matches,[query]);
  return useSyncExternalStore(subscribe,getSnapshot,()=>false);
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState(0);
  const [faturaTab,setFaturaTab]=useState(0);
  const [mesRef,setMesRef]=useState(mesAtualKey);
  const [dict,setDict]=useState([]);
  const [dadosMes,setDadosMes]=useState({});
  const [filtro,setFiltro]=useState("TODOS");
  const [copied,setCopied]=useState("");
  const [showCopy,setShowCopy]=useState(false);
  const [showMeses,setShowMeses]=useState(false);
  const [confirmar,setConfirmar]=useState(null);
  // ── Open Finance ──────────────────────────────────────────────────────
  const [ofTransacoes,setOfTransacoes]=useState([]);
  const [ofCartoes,setOfCartoes]=useState([]);
  const [ofFaturas,setOfFaturas]=useState([]);
  const [ofStatus,setOfStatus]=useState({});
  const [ajustes,setAjustes]=useState({});
  const [mostrarIgnoradas,setMostrarIgnoradas]=useState(false);
  const [mostrarPagamentos,setMostrarPagamentos]=useState(false);
  const [pedindoSync,setPedindoSync]=useState(false);
  const [showCartoes,setShowCartoes]=useState(false);
  const [parcelaMes,setParcelaMes]=useState(null);
  const [modal,setModal]=useState(null);
  // Terceiros que usam o cartão. Cadastro reutilizável, para o mesmo nome
  // escrito de duas formas não virar duas pessoas nos totais.
  const [pessoas,setPessoas]=useState([]);
  // `pago` é por mês: {"2026-08":{chave:true}}. Antes era um mapa plano em
  // memória, então sumia no F5 e vazava entre meses.
  const [pago,setPago]=useState({});
  const [authStatus,setAuthStatus]=useState(()=>getStoredToken()?"ok":"idle");
  const [syncStatus,setSyncStatus]=useState("");
  const syncTimer=useRef(null);
  const ajusteTimer=useRef(null);
  const isMobile=useMediaQuery("(max-width: 720px)");

  // ── State helpers ─────────────────────────────────────────────────────────
  const getMes=useCallback(m=>dadosMes[m]||{fatura:[],manual:[],contas:[],investimentos:[]},[dadosMes]);

  // ── Sync to Sheets ────────────────────────────────────────────────────────
  const syncAll=useCallback((dadosMesAtual,dictAtual,field)=>{
    if(!getStoredToken()) return;
    clearTimeout(syncTimer.current);
    syncTimer.current=setTimeout(async()=>{
      setSyncStatus("salvando...");
      try{
        if(field!=="dict"){
          await sheetsClear("CARTAO_CREDITO!A2:K");
          const ccRows=[];
          Object.entries(dadosMesAtual).forEach(([m,d])=>{
            (d.fatura||[]).forEach(r=>ccRows.push(faturaToRow(m,r,"LEGADO")));
            (d.manual||[]).forEach(r=>ccRows.push(faturaToRow(m,r,"MANUAL")));
          });
          if(ccRows.length) await sheetsAppend("CARTAO_CREDITO!A2",ccRows);

          await sheetsClear("RENDA_DESPESAS!A2:H");
          const rdRows=[];
          Object.entries(dadosMesAtual).forEach(([m,d])=>{
            (d.contas||[]).forEach(r=>rdRows.push(contaToRow(m,r)));
          });
          if(rdRows.length) await sheetsAppend("RENDA_DESPESAS!A2",rdRows);

          await sheetsClear("INVESTIMENTOS!A2:E");
          const invRows=[];
          Object.entries(dadosMesAtual).forEach(([m,d])=>{
            (d.investimentos||[]).forEach(r=>invRows.push([m,r.descricao,String(parseBRL(r.valor)),r.dono,r.obs||""]));
          });
          if(invRows.length) await sheetsAppend("INVESTIMENTOS!A2",invRows);
        }
        if(field==="dict"||field==="all"){
          await sheetsClear("DICIONARIO!A2:D");
          if(dictAtual.length) await sheetsAppend("DICIONARIO!A2",dictAtual.map(dictToRow));
        }
        setSyncStatus("salvo ✓");
        setTimeout(()=>setSyncStatus(""),2500);
      }catch(e){
        console.error("Falha ao gravar na planilha.",e);
        setSyncStatus("⚠️ NÃO salvo");
      }
    },1200);
  },[]);

  // Escritores dedicados das abas pequenas. Cada um limpa e reescreve só a
  // sua, então nunca disputam com syncAll nem com o Apps Script.
  const gravarSimples=useCallback(async(faixaClear,faixaAppend,linhas,rotulo)=>{
    if(!getStoredToken()) return;
    setSyncStatus("salvando...");
    try{
      await sheetsClear(faixaClear);
      if(linhas.length) await sheetsAppend(faixaAppend,linhas);
      setSyncStatus("salvo ✓");
      setTimeout(()=>setSyncStatus(""),2500);
    }catch(e){
      console.error(`Falha ao gravar ${rotulo}. A aba existe? `+
        "Rode garantirAbas() no Apps Script.",e);
      setSyncStatus(`⚠️ ${rotulo} NÃO salvo`);
    }
  },[]);

  const pessoasTimer=useRef(null);
  const syncPessoas=useCallback(lista=>{
    clearTimeout(pessoasTimer.current);
    pessoasTimer.current=setTimeout(()=>{
      gravarSimples("PESSOAS!A2:A","PESSOAS!A2",lista.map(n=>[n]),"pessoas");
    },1200);
  },[gravarSimples]);

  const pagoTimer=useRef(null);
  const syncPago=useCallback(mapa=>{
    clearTimeout(pagoTimer.current);
    pagoTimer.current=setTimeout(()=>{
      const linhas=[];
      Object.entries(mapa).forEach(([mes,chaves])=>{
        Object.entries(chaves).forEach(([k,v])=>{ if(v) linhas.push([mes,k]); });
      });
      gravarSimples("CHECKLIST_PAGO!A2:B","CHECKLIST_PAGO!A2",linhas,"pagamentos");
    },1200);
  },[gravarSimples]);

  /** Marca/desmarca uma chave no mês corrente e agenda a gravação. */
  const alternarPago=useCallback((mes,chave,valor)=>{
    setPago(prev=>{
      const doMes={...(prev[mes]||{})};
      if(valor) doMes[chave]=true; else delete doMes[chave];
      const novo={...prev,[mes]:doMes};
      syncPago(novo);
      return novo;
    });
  },[syncPago]);

  // ── Sync dos ajustes (aba própria, escritor único: o app) ─────────────────
  const syncAjustes=useCallback(mapa=>{
    if(!getStoredToken()) return;
    clearTimeout(ajusteTimer.current);
    ajusteTimer.current=setTimeout(async()=>{
      setSyncStatus("salvando...");
      try{
        await sheetsClear("OF_AJUSTES!A2:I");
        const linhas=Object.values(mapa).filter(a=>!ajusteVazio(a)).map(ajusteToRow);
        if(linhas.length) await sheetsAppend("OF_AJUSTES!A2",linhas);
        setSyncStatus("salvo ✓");
        setTimeout(()=>setSyncStatus(""),2500);
      }catch(e){
        console.error("Falha ao gravar OF_AJUSTES. A aba existe? "+
          "Rode garantirAbas() no Apps Script.",e);
        setSyncStatus("⚠️ ajustes NÃO salvos");
      }
    },1200);
  },[]);

  /** Aplica uma alteração de ajuste e agenda a gravação. */
  const setAjuste=(tipo,refId,patch,fingerprint)=>{
    setAjustes(prev=>{
      const k=chaveAjuste(tipo,refId);
      const atual=prev[k]||{tipo,refId,dono:"",classificacao:"",obs:"",ignorada:false,
        mesRefOverride:"",apelido:"",fingerprint:fingerprint||""};
      const novo={...atual,...patch,tipo,refId,
        fingerprint:fingerprint||atual.fingerprint||""};
      const mapa={...prev,[k]:novo};
      syncAjustes(mapa);
      return mapa;
    });
  };

  /**
   * "Atualizar agora" sem endpoint público.
   *
   * O app grava a chave `pedido_sync` em OF_STATUS; um gatilho de 5 min do
   * Apps Script vê o pedido e roda o sync. Evita expor um Web App anônimo e
   * um shared secret no bundle — que é público, o site está no GitHub Pages.
   *
   * Escreve APENAS a célula do valor, para não apagar as chaves que o Apps
   * Script mantém nessa aba.
   */
  const pedirSync=async()=>{
    if(pedindoSync) return;
    setPedindoSync(true);
    setSyncStatus("pedindo atualização...");
    try{
      const linhas=await sheetsGet("OF_STATUS!A2:B");
      const idx=linhas.findIndex(r=>String(r[0]||"").trim()==="pedido_sync");
      const agora=new Date().toISOString();
      if(idx>=0) await sheetsUpdate(`OF_STATUS!B${idx+2}`,[[agora]]);
      else await sheetsAppend("OF_STATUS!A2",[["pedido_sync",agora]]);
      setSyncStatus("atualização pedida ✓");
      setTimeout(()=>setSyncStatus(""),4000);
    }catch(e){
      console.error(e);
      setSyncStatus("erro ao pedir atualização");
    }finally{
      setPedindoSync(false);
    }
  };

  // ── Load all data ─────────────────────────────────────────────────────────
  async function loadAllData(){
    setSyncStatus("carregando...");
    try{
      const dictRows=await sheetsGet("DICIONARIO!A2:D");
      if(dictRows.length) setDict(dictRows.filter(r=>r[0]).map(rowToDict));

      const rdRows=await sheetsGet("RENDA_DESPESAS!A2:H");
      const byMesRD={};
      rdRows.forEach(row=>{
        const mes=parseMesRef(row[0]);
        if(!mes) return;
        if(!byMesRD[mes]) byMesRD[mes]=[];
        byMesRD[mes].push(rowToConta(row));
      });

      const invRows=await sheetsGet("INVESTIMENTOS!A2:E");
      const byMesInv={};
      invRows.forEach(row=>{
        const mes=parseMesRef(row[0]);
        if(!mes) return;
        if(!byMesInv[mes]) byMesInv[mes]=[];
        byMesInv[mes].push({id:uid(),descricao:row[1]||"",valor:String(parseBRL(row[2])),dono:row[3]||"Caulin",obs:row[4]||""});
      });

      // Coluna K "Origem" separa lançamento manual de fatura importada.
      // Linhas antigas não têm a coluna → lidas como LEGADO (ficam em `fatura`).
      const ccRows=await sheetsGet("CARTAO_CREDITO!A2:K");
      const byMesCC={},byMesMan={};
      ccRows.forEach(row=>{
        const mes=parseMesRef(row[0]);
        if(!mes) return;
        const alvo=String(row[10]||"").toUpperCase()==="MANUAL"?byMesMan:byMesCC;
        if(!alvo[mes]) alvo[mes]=[];
        alvo[mes].push(rowToFatura(row));
      });

      // ── Open Finance (abas OF_*) ───────────────────────────────────────
      // Toleram ausência: quem ainda não instalou o Apps Script simplesmente
      // não tem essas abas, e o app segue funcionando com os dados legados.
      // Uma aba por vez: com Promise.all, uma única aba faltando derrubaria a
      // leitura inteira e o Open Finance sumiria da tela sem erro visível.
      let ofTx=[],ofCards=[],ofBills=[],ofAdj={},ofSt={},listaPessoas=[],mapaPago={};
      const lerAba=async(faixa,fn)=>{
        try{ return fn(await sheetsGet(faixa)); }
        catch(e){ console.warn(`Aba ${faixa.split("!")[0]} ausente ou ilegível.`,e); }
      };
      await Promise.all([
        lerAba("OF_TRANSACOES!A2:P",rows=>{ofTx=rows.filter(r=>r[0]).map(rowToOfTx);}),
        lerAba("OF_CARTOES!A2:H",   rows=>{ofCards=rows.filter(r=>r[0]).map(rowToOfCartao);}),
        lerAba("OF_FATURAS!A2:F",   rows=>{ofBills=rows.filter(r=>r[0]).map(rowToOfFatura);}),
        lerAba("OF_AJUSTES!A2:I",   rows=>{rows.filter(r=>r[1]).map(rowToAjuste)
          .forEach(a=>{ofAdj[chaveAjuste(a.tipo,a.refId)]=a;});}),
        lerAba("OF_STATUS!A2:B",    rows=>{rows.filter(r=>r[0]).forEach(r=>{ofSt[r[0]]=r[1];});}),
        lerAba("PESSOAS!A2:A",      rows=>{
          listaPessoas=[...new Set(rows.map(r=>String(r[0]||"").trim())
            .filter(n=>n&&!CASAL.includes(n)&&n!==DIVIDIDO))];}),
        lerAba("CHECKLIST_PAGO!A2:B",rows=>{rows.forEach(r=>{
          const m=parseMesRef(r[0]),k=String(r[1]||"");
          if(!m||!k) return;
          if(!mapaPago[m]) mapaPago[m]={};
          mapaPago[m][k]=true;});}),
      ]);
      setOfTransacoes(ofTx);
      setOfCartoes(ofCards);
      setOfFaturas(ofBills);
      setAjustes(ofAdj);
      setOfStatus(ofSt);
      setPessoas(listaPessoas);
      setPago(mapaPago);

      const mesesOF=new Set(ofTx.map(t=>t.mesRef).filter(Boolean));
      const allMeses=new Set([...Object.keys(byMesRD),...Object.keys(byMesInv),
        ...Object.keys(byMesCC),...Object.keys(byMesMan),...mesesOF]);
      const novo={};
      allMeses.forEach(mes=>{
        novo[mes]={contas:byMesRD[mes]||[],investimentos:byMesInv[mes]||[],fatura:byMesCC[mes]||[],manual:byMesMan[mes]||[]};
      });
      setDadosMes(novo);
      if(allMeses.size>0){
        // Chaves ANO-MÊS ordenam corretamente como string. Prefere o mês
        // corrente quando ele já tem dados; senão, o mais recente.
        const atual=mesAtualKey();
        const ordenados=[...allMeses].sort();
        setMesRef(ordenados.includes(atual)?atual:ordenados[ordenados.length-1]);
      }
      setSyncStatus("salvo ✓");
      setTimeout(()=>setSyncStatus(""),2500);
    }catch(e){
      console.error(e);
      setSyncStatus("erro ao carregar");
    }
  }

  // Sessão ainda válida (token no sessionStorage, ~58 min): carrega direto, sem
  // passar pela tela de login. Fica depois de loadAllData de propósito — antes,
  // o lint do React acusava uso de variável antes da declaração.
  //
  // O disable é consciente: a regra existe para evitar render em cascata, mas
  // aqui é o carregamento inicial acontecendo uma vez só, na montagem. O
  // setSyncStatus("carregando...") de dentro de loadAllData é o alvo dela.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ if(getStoredToken()) loadAllData(); },[]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const handleLogin=async()=>{
    setAuthStatus("loading");
    try{
      await getToken(true);
      setAuthStatus("ok");
      await loadAllData();
    }catch(e){
      console.error(e);
      setAuthStatus("error");
    }
  };

  // ── Data mutators ─────────────────────────────────────────────────────────
  const withSync=(mesAtual,field,updater)=>{
    setDadosMes(prev=>{
      const cur=prev[mesAtual]||{fatura:[],manual:[],contas:[],investimentos:[]};
      const updated=updater(cur);
      const next={...prev,[mesAtual]:{...cur,...updated}};
      syncAll(next,dict,field);
      return next;
    });
  };

  const cur=getMes(mesRef);
  const fatura=cur.fatura,manual=cur.manual,contas=cur.contas,invest=cur.investimentos;

  // ── Open Finance do mês selecionado ───────────────────────────────────────
  const optsMerge={mesRef,mostrarIgnoradas,mostrarPagamentos};
  const ofFechada=mergeFatura(ofTransacoes,ajustes,dict,ofCartoes,{...optsMerge,status:"POSTED"});
  const ofAberta =mergeFatura(ofTransacoes,ajustes,dict,ofCartoes,{...optsMerge,status:"PENDING"});
  const temOF=ofTransacoes.length>0;

  // Cartões que aparecem no mês, para o cadastro e o cabeçalho.
  const cartoesDoMes=[...new Set(
    ofTransacoes.filter(t=>t.mesRef===mesRef).map(t=>t.accountId)
  )].map(id=>ofCartoes.find(c=>c.accountId===id)||{accountId:id,nome:"Desconhecido",ultimos:""});

  // Conciliação: o que calculamos × o que o banco diz. Sem isso, uma lacuna
  // de dados do Pluggy viraria total errado em silêncio.
  const conciliacao=cartoesDoMes.map(c=>{
    const b=ofFaturas.find(f=>f.accountId===c.accountId&&f.mesRef===mesRef);
    const nosso=totalFatura(mergeFatura(ofTransacoes,ajustes,dict,ofCartoes,
      {mesRef,status:"POSTED",mostrarIgnoradas:true,mostrarPagamentos:true})
      .filter(t=>t.accountId===c.accountId));
    return{
      accountId:c.accountId,
      nome:nomeCartao(c.accountId,ofCartoes,ajustes),
      nosso,
      banco:b?b.totalBanco:null,
      dif:b?nosso-b.totalBanco:null,
    };
  }).filter(c=>c.banco!==null);

  const ultimoSync=ofStatus["ultimo_sync"]||"";
  // Quando o Pluggy foi ao banco — diferente de quando nós lemos o Pluggy.
  const pluggyEm=ofStatus["pluggy_atualizado_em"]||"";
  const erroSync=ofStatus["ultimo_erro"]||"";

  // Linhas legadas (importadas por CSV antes do Open Finance) entram na aba
  // "Fechada" junto com as do Pluggy, marcadas como tal.
  const faturaLegado=fatura.map(r=>({...r,origem:"LEGADO",natureza:"COMPRA",ignorada:false,
    cartao:r.cartao||"Outros"}));

  // O checklist usa a fatura FECHADA e SEMPRE ignora o que foi marcado como
  // ignorado e os pagamentos — independente dos toggles de exibição da tabela.
  //
  // Exceção: enquanto a fatura do mês não fechou não existe nenhuma POSTED, e
  // o checklist ficava com a seção Cartão vazia — inútil justamente no mês que
  // se está planejando. Nesse caso usa a aberta, avisando na tela que os
  // valores ainda podem mudar. Mês fechado continua exatamente como era.
  const semPosted=mergeFatura(ofTransacoes,ajustes,dict,ofCartoes,
    {mesRef,status:"POSTED",mostrarIgnoradas:false,mostrarPagamentos:false});
  const ofAbertaChecklist=mergeFatura(ofTransacoes,ajustes,dict,ofCartoes,
    {mesRef,status:"PENDING",mostrarIgnoradas:false,mostrarPagamentos:false});
  const checklistEmAberto=semPosted.length===0&&ofAbertaChecklist.length>0;
  const ofParaChecklist=checklistEmAberto?ofAbertaChecklist:semPosted;
  const totalEmAberto=totalFatura(
    mergeFatura(ofTransacoes,ajustes,dict,ofCartoes,
      {mesRef,status:"PENDING",mostrarIgnoradas:false,mostrarPagamentos:false}));

  // Parcelas futuras: derivadas, não armazenadas. Ver projetarParcelas.
  const proj=projetarParcelas(ofTransacoes,ajustes,dict,ofCartoes,mesRef,12);

  const updF=(id,f,v)=>withSync(mesRef,"fatura",c=>({fatura:c.fatura.map(r=>r.id===id?{...r,[f]:v}:r)}));
  const rmF=id=>withSync(mesRef,"fatura",c=>({fatura:c.fatura.filter(r=>r.id!==id)}));

  // ── Open Finance: as decisões do usuário vão para OF_AJUSTES ──────────────
  const updOF=(tx,campo,valor)=>setAjuste("TX",tx.id,{[campo]:valor},tx.fingerprint);
  const ignorarOF=(tx,val)=>setAjuste("TX",tx.id,{ignorada:val},tx.fingerprint);
  const learnOF=tx=>{
    const key=normalize(tx.nome).substring(0,25);
    if(key&&!dict.find(d=>d.key===key)){
      const nd=[...dict,{key,dono:tx.dono,parcelas:tx.parcelas,obs:tx.obs}];
      setDict(nd);
      syncAll(dadosMes,nd,"dict");
    }
    // Grava também como ajuste: a decisão desta transação não deve depender
    // de o dicionário continuar existindo.
    setAjuste("TX",tx.id,{dono:tx.dono,classificacao:tx.parcelas,obs:tx.obs},tx.fingerprint);
  };
  const renomearCartao=(accountId,apelido)=>setAjuste("CARTAO",accountId,{apelido});

  const updM=(id,f,v)=>withSync(mesRef,"manual",c=>({manual:c.manual.map(r=>r.id===id?{...r,[f]:v}:r)}));
  const rmM=id=>withSync(mesRef,"manual",c=>({manual:c.manual.filter(r=>r.id!==id)}));
  const addM=()=>withSync(mesRef,"manual",c=>({manual:[...c.manual,{id:uid(),data:"",nome:"",parcela:"",valor:0,dono:"Caulin",parcelas:"VARIÁVEL",obs:"",cartao:""}]}));

  const updC=(id,f,v)=>withSync(mesRef,"contas",c=>({contas:c.contas.map(r=>r.id===id?{...r,[f]:v}:r)}));
  const rmC=id=>withSync(mesRef,"contas",c=>({contas:c.contas.filter(r=>r.id!==id)}));
  const addC=()=>withSync(mesRef,"contas",c=>({contas:[...c.contas,{id:uid(),transacao:"",valor:"",dono:"Dividido",tipo:"DESPESA FIXA",obs:""}]}));

  const updI=(id,f,v)=>withSync(mesRef,"investimentos",c=>({investimentos:c.investimentos.map(r=>r.id===id?{...r,[f]:v}:r)}));
  const rmI=id=>withSync(mesRef,"investimentos",c=>({investimentos:c.investimentos.filter(r=>r.id!==id)}));
  const addI=()=>withSync(mesRef,"investimentos",c=>({investimentos:[...c.investimentos,{id:uid(),descricao:"",valor:"",dono:"Caulin",obs:""}]}));

  const handleCopyImport=data=>{
    setDadosMes(prev=>{
      const cur=prev[mesRef]||{fatura:[],manual:[],contas:[],investimentos:[]};
      const nc=data.contas?.length?[...cur.contas,...data.contas]:cur.contas;
      const ni=data.investimentos?.length?[...cur.investimentos,...data.investimentos]:cur.investimentos;
      const nm=data.manual?.length?[...cur.manual,...data.manual]:cur.manual;
      const next={...prev,[mesRef]:{...cur,contas:nc,investimentos:ni,manual:nm}};
      syncAll(next,dict,"all");
      return next;
    });
  };


  // ── Checklist calc ────────────────────────────────────────────────────────
  const pagoDoMes=pago[mesRef]||{};
  const estaPago=(secao,r)=>!!pagoDoMes[chavePago(mesRef,secao,r)];

  const calcChecklist=()=>{
    // Fatura fechada do Open Finance + lançamentos manuais + histórico legado.
    const allCartao=[...ofParaChecklist,...manual,...faturaLegado];
    const renda={},desp={},pagoPor={};
    const soma=(mapa,nome,v)=>{mapa[nome]=(mapa[nome]||0)+v;};
    // Distribui um valor entre os participantes. Serve para o casal e para
    // terceiros — a divisão é sempre igual entre quem está no rateio.
    const ratear=(mapa,r)=>{
      const p=participantes(r.dono);
      p.forEach(nome=>soma(mapa,nome,(r.valor||0)/p.length));
    };

    // Baldes por categoria. Cada um guarda o rateio por pessoa e o total, para
    // os cards do topo poderem abrir "Despesas" em Fixas / Despesas / Cartão
    // sem recalcular nada.
    const fixas={},variaveis={},cartaoPor={},investPor={};

    const contasList=[],invList=[];
    contas.forEach(r=>{
      const v=parseBRL(r.valor);
      if(r.tipo==="RENDA"){ratear(renda,{dono:r.dono||DIVIDIDO,valor:v});return;}
      if(r.tipo==="INVESTIMENTO"){invList.push({...r,valor:v,secao:"INV"});return;}
      contasList.push({...r,valor:v,secao:"CONTA",fixa:r.tipo==="DESPESA FIXA"});
    });
    invest.forEach(r=>invList.push({...r,valor:parseBRL(r.valor),secao:"INV"}));

    contasList.forEach(r=>{
      ratear(desp,r);
      ratear(r.fixa?fixas:variaveis,r);
      if(estaPago(r.secao,r)) ratear(pagoPor,r);
    });
    invList.forEach(r=>{
      ratear(desp,r);
      ratear(investPor,r);
      if(estaPago(r.secao,r)) ratear(pagoPor,r);
    });

    const cartoesMap={};
    // Sem dono, a linha não pode ser atribuída a ninguém e fica de fora da
    // conta. Contamos para avisar — antes, sumia em silêncio e o checklist
    // fechava com um valor menor do que a fatura, sem explicação.
    const semDono=allCartao.filter(r=>r.valor&&!r.dono);
    allCartao.forEach(r=>{
      if(!r.valor||!r.dono)return;
      const nome=r.cartao||"Outros";
      if(!cartoesMap[nome])cartoesMap[nome]={fixos:[],parcelados:[],variaveis:[]};
      const sub=r.parcelas==="RECORRENTE"?"fixos":r.parcelas==="PARCELADO"?"parcelados":"variaveis";
      cartoesMap[nome][sub].push(r);
      ratear(desp,r);
      ratear(cartaoPor,r);
      if(estaPago("CARTAO",r)) ratear(pagoPor,r);
    });

    const saldoDe=nome=>(renda[nome]||0)-(pagoPor[nome]||0);
    const totalFaturaCartoes=Object.entries(cartoesMap).map(([nome,g])=>{
      const rows=[...g.fixos,...g.parcelados,...g.variaveis];
      return{nome,total:rows.reduce((a,r)=>a+r.valor,0),
        pagos:rows.filter(r=>estaPago("CARTAO",r)).reduce((a,r)=>a+r.valor,0),
        fixos:g.fixos,parcelados:g.parcelados,variaveis:g.variaveis};
    });

    // Terceiros: quem não é do casal. Vira cobrança, não despesa de vocês.
    const nomesTerceiros=[...new Set([...contasList,...invList,...allCartao]
      .flatMap(r=>terceirosDe(r.dono)))].sort();
    const aReceber=nomesTerceiros.map(nome=>{
      const itens=[...contasList,...invList,...allCartao]
        .filter(r=>participantes(r.dono).includes(nome))
        .map(r=>({...r,valorPessoa:valorDe(r.valor,r.dono,nome)}));
      return{nome,total:itens.reduce((a,r)=>a+r.valorPessoa,0),itens};
    });

    // Só o casal entra nos totais — terceiro é cobrança, não despesa de vocês.
    const totalDo=mapa=>CASAL.reduce((a,n)=>a+(mapa[n]||0),0);
    const porPessoa=mapa=>({Caulin:mapa.Caulin||0,Luanna:mapa.Luanna||0,total:totalDo(mapa)});

    return{
      renda:porPessoa(renda), despesas:porPessoa(desp),
      fixas:porPessoa(fixas), variaveis:porPessoa(variaveis),
      cartao:porPessoa(cartaoPor), investimentos:porPessoa(investPor),
      saldo:{Caulin:saldoDe("Caulin"),Luanna:saldoDe("Luanna")},
      // Nomes antigos, ainda usados pelo resumo de WhatsApp.
      rendaCaulin:renda.Caulin||0, rendaLuanna:renda.Luanna||0,
      despCaulin:desp.Caulin||0,   despLuanna:desp.Luanna||0,
      saldoCaulin:saldoDe("Caulin"),saldoLuanna:saldoDe("Luanna"),
      contasList,invList,totalFaturaCartoes,semDono,
      valorSemDono:semDono.reduce((a,r)=>a+r.valor,0),
      aReceber,totalAReceber:aReceber.reduce((a,x)=>a+x.total,0),
    };
  };

  const syncFalhou=syncStatus.startsWith("erro")||syncStatus.includes("⚠️");
  const vPessoa=valorDe;
  // "(÷2)" virou "(÷3)" e afins agora que terceiros entram no rateio.
  const rotuloSub=dono=>{
    const n=participantes(dono).length;
    return n>1?`(÷${n})`:undefined;
  };
  const mesesComDados=Object.keys(dadosMes);
  // Anos que têm dados + o ano do mês selecionado, para o seletor sempre poder voltar.
  const anosComDados=[...new Set([...mesesComDados.map(k=>mesPartes(k).ano),mesPartes(mesRef).ano])].filter(a=>!isNaN(a)).sort((a,b)=>b-a);
  const TABS=[{l:"Fatura",i:"💳"},{l:"Parcelas",i:"📅"},{l:"Contas",i:"🏠"},
    {l:"Investimentos",i:"📈"},{l:"Checklist",i:"✅"},{l:"Config",i:"⚙️"}];

  // Quantas transações carregadas casam com cada padrão do dicionário — mostra
  // na aba Config quais padrões estão pegando de fato.
  const usoDoDict={};
  dict.forEach(d=>{usoDoDict[d.key]=0;});
  ofTransacoes.forEach(t=>{
    const hit=matchDict(t.nome,dict);
    if(hit) usoDoDict[hit.key]=(usoDoDict[hit.key]||0)+1;
  });

  const salvarDict=nd=>{setDict(nd);syncAll(dadosMes,nd,"dict");};
  const salvarPessoas=lista=>{setPessoas(lista);syncPessoas(lista);};

  // ── Tela de login ─────────────────────────────────────────────────────────
  if(authStatus!=="ok"){
    return(
      <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif",padding:16}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:"2.5rem 2rem",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 18px 50px rgba(0,0,0,0.5)"}}>
          <div style={{width:56,height:56,borderRadius:16,background:C.teal50,border:`1px solid ${C.teal100}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 16px"}}>📊</div>
          <h2 style={{fontSize:20,fontWeight:700,margin:"0 0 6px",color:C.text}}>Gestão Financeira</h2>
          <p style={{fontSize:13,color:C.textMuted,margin:"0 0 24px"}}>Caulin &amp; Luanna</p>
          <p style={{fontSize:13,color:C.textDim,marginBottom:24,lineHeight:1.6}}>Conecte sua conta Google para carregar e salvar os dados automaticamente na planilha.</p>
          {authStatus==="error"&&<p style={{fontSize:12,color:C.red600,marginBottom:12,background:C.red50,border:`1px solid ${C.red100}`,padding:"8px 12px",borderRadius:8}}>Erro ao conectar. Tente novamente.</p>}
          <button className="gf-btn" onClick={handleLogin} disabled={authStatus==="loading"} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:C.teal600,color:"#06231C",cursor:authStatus==="loading"?"wait":"pointer",fontSize:15,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {authStatus==="loading"?"Conectando...":"🔑 Entrar com Google"}
          </button>
        </div>
      </div>
    );
  }

  // ── App principal ─────────────────────────────────────────────────────────
  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"system-ui,sans-serif",color:C.text}}>

      {/* Topbar */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:isMobile?"0 14px":"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:58,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <span style={{fontSize:19}}>📊</span>
          {!isMobile&&(
            <div style={{lineHeight:1.25}}>
              <div style={{fontSize:14,fontWeight:600,color:C.text}}>Gestão Financeira</div>
              <div style={{fontSize:11,color:C.textMuted}}>Caulin &amp; Luanna</div>
            </div>
          )}
          {syncStatus&&(
            // syncFalhou cobre "erro ao..." e as mensagens com ⚠️. Antes olhava só
            // o prefixo "erro" e uma falha de gravação aparecia em verde.
            <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",
              background:syncFalhou?C.red50:C.tealSoft,
              border:`1px solid ${syncFalhou?C.red100:C.teal100}`,
              color:syncFalhou?C.red600:C.teal600}}>{syncStatus}</span>
          )}
        </div>

        {/* Seletor de mês: setas + rótulo clicável (substitui as 12 pílulas fixas) */}
        <div style={{display:"flex",alignItems:"center",gap:2,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,padding:2}}>
          <button className="gf-btn" title="Mês anterior" onClick={()=>setMesRef(mesAnterior(mesRef))}
            style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:16,padding:"2px 9px",borderRadius:8,lineHeight:1}}>‹</button>
          <button className="gf-btn" onClick={()=>setShowMeses(true)} title="Escolher mês"
            style={{background:"none",border:"none",color:C.text,cursor:"pointer",fontSize:13,fontWeight:600,padding:"4px 8px",borderRadius:8,minWidth:96,letterSpacing:"0.02em"}}>
            {isMobile?mesLabelCurto(mesRef):mesLabel(mesRef)}
          </button>
          <button className="gf-btn" title="Próximo mês" onClick={()=>setMesRef(mesProximo(mesRef))}
            style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:16,padding:"2px 9px",borderRadius:8,lineHeight:1}}>›</button>
        </div>
      </div>

      {showMeses&&(
        <Modal onClose={()=>setShowMeses(false)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <h3 style={{fontSize:15,fontWeight:600,margin:0,color:C.text}}>Escolher mês</h3>
            <button onClick={()=>setShowMeses(false)} style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize:20}}>✕</button>
          </div>
          <Btn small onClick={()=>{setMesRef(mesAtualKey());setShowMeses(false);}} style={{marginBottom:12}}>📅 Ir para o mês atual</Btn>
          {anosComDados.length===0&&<p style={{fontSize:13,color:C.textDim}}>Nenhum mês com dados ainda.</p>}
          {anosComDados.map(ano=>(
            <div key={ano} style={{marginBottom:12}}>
              <SectionLabel>{ano}</SectionLabel>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(78px,1fr))",gap:6}}>
                {MESES.map((nome,i)=>{
                  const k=mesKey(ano,i);
                  const tem=mesesComDados.includes(k);
                  const ativo=k===mesRef;
                  if(!tem&&!ativo) return null;
                  return(
                    <button key={k} className="gf-btn" onClick={()=>{setMesRef(k);setShowMeses(false);}}
                      style={{fontSize:11,padding:"7px 6px",borderRadius:8,cursor:"pointer",fontWeight:ativo?700:500,
                        border:`1px solid ${ativo?C.teal100:C.border}`,
                        background:ativo?C.teal50:C.surfaceAlt,
                        color:ativo?C.teal600:C.textDim}}>
                      {nome.substring(0,3)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Modal>
      )}

      {confirmar&&<ConfirmModal {...confirmar} onClose={()=>setConfirmar(null)}/>}

      {parcelaMes&&(
        <Modal onClose={()=>setParcelaMes(null)} wide>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <h3 style={{fontSize:15,fontWeight:600,margin:0,color:C.text}}>
              Parcelas de {mesLabel(parcelaMes.mesRef)}
            </h3>
            <button onClick={()=>setParcelaMes(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize:20}}>✕</button>
          </div>
          <p style={{fontSize:12,color:C.textMuted,margin:"0 0 14px"}}>
            {parcelaMes.qtd} parcela{parcelaMes.qtd===1?"":"s"} · total {fmtBRL(parcelaMes.total)}
            {parcelaMes.projetado>0&&<> · {fmtBRL(parcelaMes.projetado)} ainda projetado</>}
          </p>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:420}}>
              <thead><tr style={{background:C.surfaceAlt}}>
                {["Compra","Cartão","Parcela","Valor",""].map(h=><th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>{parcelaMes.itens.map(p=>(
                <tr key={p.chave+p.num}>
                  <td style={td}>{p.nome}</td>
                  <td style={{...td,color:C.textDim,whiteSpace:"nowrap"}}>{p.cartao}</td>
                  <td style={{...td,color:C.textDim,fontVariantNumeric:"tabular-nums"}}>
                    {String(p.num).padStart(2,"0")}/{String(p.total).padStart(2,"0")}
                  </td>
                  <td style={{...td,fontVariantNumeric:"tabular-nums"}}>{fmtBRL(p.valor)}</td>
                  <td style={td}>{p.projetada
                    ?<Badge color="info">projetada</Badge>
                    :<Badge color="ok">na fatura</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Modal>
      )}

      {showCartoes&&(
        <Modal onClose={()=>setShowCartoes(false)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <h3 style={{fontSize:15,fontWeight:600,margin:0,color:C.text}}>Cartões</h3>
            <button onClick={()=>setShowCartoes(false)} style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize:20}}>✕</button>
          </div>
          <p style={{fontSize:12,color:C.textMuted,margin:"0 0 14px",lineHeight:1.6}}>
            Vêm do Open Finance. O apelido é seu e aparece no checklist no lugar do nome do banco.
          </p>
          {ofCartoes.length===0&&<EmptyState icon="💳">Nenhum cartão sincronizado ainda.</EmptyState>}
          {ofCartoes.map(c=>(
            <div key={c.accountId} style={{borderTop:`1px solid ${C.borderSoft}`,padding:"11px 0"}}>
              <div style={{fontSize:13,color:C.text,fontWeight:500}}>
                {c.nome}{c.ultimos&&<span style={{color:C.textMuted,fontWeight:400}}> · final {c.ultimos}</span>}
              </div>
              <div style={{fontSize:11,color:C.textMuted,margin:"3px 0 7px"}}>
                {c.limite>0&&<>limite {fmtBRL(c.limite)} · </>}
                {c.fechamento&&<>fecha dia {c.fechamento} · </>}
                {c.vencimento&&<>vence dia {c.vencimento}</>}
              </div>
              <input value={ajustes[chaveAjuste("CARTAO",c.accountId)]?.apelido||""}
                onChange={e=>renomearCartao(c.accountId,e.target.value)}
                placeholder="Apelido (ex.: Black do Caulin)" style={{...inp,maxWidth:280}}/>
            </div>
          ))}
        </Modal>
      )}

      <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"16px 12px":"24px 16px"}}>

        {/* Nav tabs */}
        <div style={{display:"flex",gap:4,background:C.surface,border:`1px solid ${C.borderSoft}`,borderRadius:12,padding:4,marginBottom:20}}>
          {TABS.map((t,i)=>(
            <button key={t.l} className="gf-btn" onClick={()=>setTab(i)} style={{flex:1,fontSize:13,padding:"9px 4px",border:"none",borderRadius:9,background:tab===i?C.teal50:"transparent",color:tab===i?C.teal600:C.textDim,cursor:"pointer",fontWeight:tab===i?700:500,display:"flex",alignItems:"center",justifyContent:"center",gap:5,transition:"background .15s,color .15s"}}>
              <span>{t.i}</span>{!isMobile&&t.l}
            </button>
          ))}
        </div>

        {/* FATURA */}
        {tab===0&&(
          <div>
            <BarraOpenFinance
              temOF={temOF} ultimoSync={ultimoSync} pluggyEm={pluggyEm} erroSync={erroSync}
              conciliacao={conciliacao} pedindoSync={pedindoSync}
              onAtualizar={pedirSync} onCartoes={()=>setShowCartoes(true)}
              isMobile={isMobile}/>

            <div style={{display:"flex",gap:0,marginBottom:14,flexWrap:"wrap"}}>
              {[
                {l:"🔴 Em aberto",n:ofAberta.length},
                {l:"✅ Fechada",n:ofFechada.length+faturaLegado.length},
                {l:"✏️ Manual",n:manual.length},
              ].map((t,i)=>(
                <button key={t.l} className="gf-btn" onClick={()=>setFaturaTab(i)}
                  style={{fontSize:12,padding:"7px 14px",cursor:"pointer",
                    border:`1px solid ${faturaTab===i?C.teal100:C.border}`,
                    borderRadius:i===0?"8px 0 0 8px":i===2?"0 8px 8px 0":0,
                    borderLeftWidth:i===0?1:0,
                    background:faturaTab===i?C.teal50:C.surfaceAlt,
                    color:faturaTab===i?C.teal600:C.textDim,
                    fontWeight:faturaTab===i?700:500}}>
                  {t.l}{t.n>0&&<span style={{marginLeft:6,opacity:0.7}}>{t.n}</span>}
                </button>
              ))}
            </div>

            {/* Em aberto — compras que ainda vão entrar na próxima fatura */}
            {faturaTab===0&&(
              ofAberta.length===0
                ?<div style={card}><EmptyState icon="🔴">
                    {temOF?`Nenhuma compra em aberto para ${mesLabel(mesRef)}.`
                          :"Open Finance ainda não configurado. Veja docs/SETUP-PLUGGY.md."}
                  </EmptyState></div>
                :<TabelaFatura
                    titulo="Fatura em aberto" subtitulo="ainda não fechou — pode mudar"
                    linhas={ofAberta} cartoes={cartoesDoMes} isMobile={isMobile} pessoas={pessoas}
                    filtro={filtro} setFiltro={setFiltro}
                    mostrarIgnoradas={mostrarIgnoradas} setMostrarIgnoradas={setMostrarIgnoradas}
                    mostrarPagamentos={mostrarPagamentos} setMostrarPagamentos={setMostrarPagamentos}
                    onCampo={updOF} onIgnorar={ignorarOF} onAprender={learnOF}
                    onLegado={updF} onRemoverLegado={rmF}/>
            )}

            {/* Fechada — o que efetivamente vai ser pago */}
            {faturaTab===1&&(
              (ofFechada.length+faturaLegado.length)===0
                ?<div style={card}><EmptyState icon="✅">
                    Nenhuma fatura fechada em {mesLabel(mesRef)}.
                  </EmptyState></div>
                :<TabelaFatura
                    titulo="Fatura fechada" subtitulo="é o que entra no checklist"
                    linhas={[...ofFechada,...faturaLegado]} cartoes={cartoesDoMes} isMobile={isMobile} pessoas={pessoas}
                    filtro={filtro} setFiltro={setFiltro}
                    mostrarIgnoradas={mostrarIgnoradas} setMostrarIgnoradas={setMostrarIgnoradas}
                    mostrarPagamentos={mostrarPagamentos} setMostrarPagamentos={setMostrarPagamentos}
                    onCampo={updOF} onIgnorar={ignorarOF} onAprender={learnOF}
                    onLegado={updF} onRemoverLegado={rmF}/>
            )}

            {/* Manual — cartões sem conector, ou lançamento avulso */}
            {faturaTab===2&&(
              <div style={card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                  <div><span style={{fontSize:14,fontWeight:600,color:C.text}}>Lançamento manual</span><span style={{fontSize:12,color:C.textMuted,marginLeft:8}}>{mesLabel(mesRef)}</span></div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                    <Btn active small onClick={addM}>+ Adicionar</Btn>
                  </div>
                </div>
                <p style={{fontSize:12,color:C.textMuted,margin:"0 0 12px",lineHeight:1.6}}>
                  Para cartões sem conector no Open Finance, ou lançamentos que você queira somar à mão.
                </p>
                {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
                {manual.length===0
                  ?<EmptyState icon="💳">Nenhum lançamento manual. Clique em “+ Adicionar”.</EmptyState>
                  :<div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:540}}>
                    <thead><tr style={{background:C.surfaceAlt}}>{["Data","Descrição","Valor","Cartão","Dono","Classificação","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{manual.map(r=>(
                      <tr key={r.id}>
                        <td style={td}><input value={r.data} onChange={e=>updM(r.id,"data",e.target.value)} placeholder="dd/mm" style={{...inp,width:65}}/></td>
                        <td style={td}><input value={r.nome} onChange={e=>updM(r.id,"nome",e.target.value)} placeholder="Descrição" style={{...inp,width:110}}/></td>
                        <td style={td}><input value={r.valor||""} onChange={e=>updM(r.id,"valor",parseFloat(e.target.value)||0)} type="number" step="0.01" style={{...inp,width:70}}/></td>
                        <td style={td}><input value={r.cartao} onChange={e=>updM(r.id,"cartao",e.target.value)} placeholder="Nubank…" style={{...inp,width:80}}/></td>
                        <td style={td}><DonoSelect value={r.dono} pessoas={pessoas} width={96} onChange={v=>updM(r.id,"dono",v)}/></td>
                        <td style={td}><select value={r.parcelas} onChange={e=>updM(r.id,"parcelas",e.target.value)} style={{...sel,width:98}}>{PARC_OPTS.map(d=><option key={d}>{d}</option>)}</select></td>
                        <td style={td}><input value={r.obs} onChange={e=>updM(r.id,"obs",e.target.value)} style={{...inp,width:80}}/></td>
                        <td style={td}><Btn danger small title="Remover" onClick={()=>setConfirmar({titulo:"Remover lançamento?",texto:`“${r.nome||"(sem descrição)"}” será removido de ${mesLabel(mesRef)}.`,onConfirm:()=>rmM(r.id)})}>✕</Btn></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                }
              </div>
            )}
          </div>
        )}

        {/* PARCELAS */}
        {tab===1&&(
          temOF
            ?<PainelParcelas proj={proj} mesRef={mesRef} isMobile={isMobile}
               onVerMes={setParcelaMes}/>
            :<div style={card}><EmptyState icon="📅">
                As parcelas vêm do Open Finance, que ainda não foi configurado.
                Veja docs/SETUP-PLUGGY.md.
              </EmptyState></div>
        )}

        {/* CONTAS */}
        {tab===2&&(
          <div style={card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div><span style={{fontSize:14,fontWeight:600,color:C.text}}>Contas e renda</span><span style={{fontSize:12,color:C.textMuted,marginLeft:8}}>{mesLabel(mesRef)}</span></div>
              <div style={{display:"flex",gap:6}}>
                <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                <Btn active small onClick={addC}>+ Adicionar</Btn>
              </div>
            </div>
            {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
            {contas.length===0
              ?<EmptyState icon="🏠">Nenhuma conta lançada em {mesLabel(mesRef)}.</EmptyState>
              :<div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:440}}>
                <thead><tr style={{background:C.surfaceAlt}}>{["Transação","Valor (R$)","Dono","Tipo","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{contas.map(r=>(
                  <tr key={r.id}>
                    <td style={td}><input value={r.transacao} onChange={e=>updC(r.id,"transacao",e.target.value)} style={{...inp,width:140}}/></td>
                    <td style={td}><input value={r.valor} onChange={e=>updC(r.id,"valor",e.target.value)} placeholder="0,00" style={{...inp,width:85}}/></td>
                    <td style={td}><DonoSelect value={r.dono} pessoas={pessoas} width={100} onChange={v=>updC(r.id,"dono",v)}/></td>
                    <td style={td}><select value={r.tipo} onChange={e=>updC(r.id,"tipo",e.target.value)} style={{...sel,width:115}}>{TIPOS_CONTA.map(d=><option key={d}>{d}</option>)}</select></td>
                    <td style={td}><input value={r.obs} onChange={e=>updC(r.id,"obs",e.target.value)} style={{...inp,width:95}}/></td>
                    <td style={td}><Btn danger small title="Remover" onClick={()=>setConfirmar({titulo:"Remover conta?",texto:`“${r.transacao||"(sem descrição)"}” será removida de ${mesLabel(mesRef)}.`,onConfirm:()=>rmC(r.id)})}>✕</Btn></td>
                  </tr>
                ))}</tbody>
              </table></div>
            }
          </div>
        )}

        {/* INVESTIMENTOS */}
        {tab===3&&(
          <div style={card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div><span style={{fontSize:14,fontWeight:600,color:C.text}}>Investimentos</span><span style={{fontSize:12,color:C.textMuted,marginLeft:8}}>{mesLabel(mesRef)}</span></div>
              <div style={{display:"flex",gap:6}}>
                <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                <Btn active small onClick={addI}>+ Adicionar</Btn>
              </div>
            </div>
            {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
            {invest.length===0
              ?<EmptyState icon="📈">Nenhum aporte em {mesLabel(mesRef)}.</EmptyState>
              :<div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:440}}>
                <thead><tr style={{background:C.surfaceAlt}}>{["Descrição","Valor (R$)","Dono","Onde",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{invest.map(r=>(
                  <tr key={r.id}>
                    <td style={td}><input value={r.descricao} onChange={e=>updI(r.id,"descricao",e.target.value)} style={{...inp,width:140}}/></td>
                    <td style={td}><input value={r.valor} onChange={e=>updI(r.id,"valor",e.target.value)} placeholder="0,00" style={{...inp,width:85}}/></td>
                    <td style={td}><DonoSelect value={r.dono} pessoas={pessoas} width={100} onChange={v=>updI(r.id,"dono",v)}/></td>
                    <td style={td}><input value={r.obs} onChange={e=>updI(r.id,"obs",e.target.value)} placeholder="CDB, Tesouro…" style={{...inp,width:130}}/></td>
                    <td style={td}><Btn danger small title="Remover" onClick={()=>setConfirmar({titulo:"Remover investimento?",texto:`“${r.descricao||"(sem descrição)"}” será removido de ${mesLabel(mesRef)}.`,onConfirm:()=>rmI(r.id)})}>✕</Btn></td>
                  </tr>
                ))}</tbody>
              </table></div>
            }
          </div>
        )}

        {/* CONFIGURAÇÕES */}
        {tab===5&&(
          <PainelConfig dict={dict} onDict={salvarDict}
            pessoas={pessoas} onPessoas={salvarPessoas}
            usoDoDict={usoDoDict} isMobile={isMobile}/>
        )}

        {/* CHECKLIST */}
        {tab===4&&(()=>{
          const{renda,fixas,variaveis,cartao,investimentos,saldo,
            contasList,invList,totalFaturaCartoes,semDono,valorSemDono,
            aReceber,totalAReceber}=calcChecklist();

          // `chave` em vez de `id`: os ids de contas/investimentos são
          // regenerados a cada carregamento, então o pago não sobreviveria.
          const CheckRow=({chave,label,valor,sub,onClick})=>{
            const isPago=!!pagoDoMes[chave];
            return(
              <div style={{display:"flex",alignItems:"center",gap:9,padding:"9px 0",borderTop:`1px solid ${C.borderSoft}`}}>
                <input type="checkbox" checked={isPago}
                  onChange={()=>alternarPago(mesRef,chave,!isPago)}
                  style={{flexShrink:0,cursor:"pointer",accentColor:C.teal600,width:15,height:15}}/>
                <span onClick={onClick} style={{flex:1,fontSize:13,textDecoration:isPago?"line-through":"none",color:isPago?C.textMuted:C.text,cursor:onClick?"pointer":"default",userSelect:"none"}}>
                  {label}{sub&&<span style={{fontSize:11,color:C.textMuted,marginLeft:5}}>{sub}</span>}
                  {onClick&&<span style={{fontSize:11,color:C.textMuted,marginLeft:4}}>›</span>}
                </span>
                <span style={{fontSize:13,fontWeight:600,fontVariantNumeric:"tabular-nums",color:isPago?C.textMuted:C.text,whiteSpace:"nowrap"}}>{fmtBRL(valor)}</span>
              </div>
            );
          };

          return(
            <div>
              {modal&&(
                <Modal onClose={()=>setModal(null)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <h3 style={{fontSize:14,fontWeight:600,margin:0,color:C.text}}>{modal.title}</h3>
                    <button onClick={()=>setModal(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.textMuted,fontSize:20}}>✕</button>
                  </div>
                  {modal.rows.map(r=>{
                    const v=vPessoa(r.valor,r.dono,modal.pessoa);
                    return(
                      <div key={r.id} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0",borderTop:`1px solid ${C.borderSoft}`}}>
                        <span style={{flex:1,color:C.text}}>{r.nome||r.transacao}{r.parcela?" "+r.parcela:""}{r.obs&&<span style={{color:C.textMuted,marginLeft:6}}>— {r.obs}</span>}</span>
                        <span style={{fontWeight:600,marginLeft:12,color:C.text,fontVariantNumeric:"tabular-nums"}}>{fmtBRL(v)}</span>
                      </div>
                    );
                  })}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:600,borderTop:`2px solid ${C.teal100}`,paddingTop:10,marginTop:6,color:C.teal600}}>
                    <span>Total</span><span>{fmtBRL(modal.rows.reduce((a,r)=>a+vPessoa(r.valor,r.dono,modal.pessoa),0))}</span>
                  </div>
                </Modal>
              )}

              {/* ── Cards ──────────────────────────────────────────────────
                  Três leituras, da mais geral para a mais específica: o mês
                  inteiro, cada pessoa, e o que é cartão/cobrança. */}

              <div style={{display:"grid",
                gridTemplateColumns:isMobile?"1fr":"repeat(3,1fr)",gap:10,marginBottom:10}}>
                <MetricCard label="Renda total" value={fmtBRL(renda.total)} accent="teal" icon="💰">
                  <DetalheCard cor={C.teal600} linhas={[
                    {rot:"Caulin",valor:renda.Caulin,sempre:true},
                    {rot:"Luanna",valor:renda.Luanna,sempre:true},
                  ]}/>
                </MetricCard>

                <MetricCard label="Despesas totais" value={fmtBRL(fixas.total+variaveis.total+cartao.total)} accent="red" icon="📉">
                  <DetalheCard cor={C.red600} linhas={[
                    {rot:"Fixas",valor:fixas.total,sempre:true},
                    {rot:"Despesas",valor:variaveis.total,sempre:true},
                    {rot:"Cartão de crédito",valor:cartao.total,sempre:true},
                  ]}/>
                </MetricCard>

                <MetricCard label="Investimentos" value={fmtBRL(investimentos.total)} accent="green" icon="📈">
                  <DetalheCard cor={C.green600} linhas={[
                    {rot:"Caulin",valor:investimentos.Caulin,sempre:true},
                    {rot:"Luanna",valor:investimentos.Luanna,sempre:true},
                  ]}/>
                </MetricCard>
              </div>

              <div style={{display:"grid",
                gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:10}}>
                {CASAL.map(pessoa=>{
                  const cor=pessoa==="Caulin"?C.teal600:C.purple600;
                  const total=fixas[pessoa]+variaveis[pessoa]+cartao[pessoa];
                  const sld=saldo[pessoa];
                  return(
                    <MetricCard key={pessoa} label={`Despesas ${pessoa}`} value={fmtBRL(total)}
                      accent={pessoa==="Caulin"?"teal":"purple"} icon="🧾">
                      <DetalheCard cor={cor} linhas={[
                        {rot:"Fixas",valor:fixas[pessoa],sempre:true},
                        {rot:"Despesas",valor:variaveis[pessoa],sempre:true},
                        {rot:"CC",valor:cartao[pessoa],sempre:true},
                      ]}/>
                      {/* Saldo destacado: é a única linha que muda ao marcar
                          pago, e é o número que se olha no fim do mês. */}
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,
                        marginTop:8,paddingTop:8,borderTop:`1px solid ${cor}33`,
                        fontSize:12,fontWeight:700,
                        color:sld>=0?C.green600:C.red600}}>
                        <span>Saldo</span>
                        <span style={{fontVariantNumeric:"tabular-nums"}}>{fmtBRL(sld)}</span>
                      </div>
                    </MetricCard>
                  );
                })}
              </div>

              <div style={{display:"grid",
                gridTemplateColumns:isMobile?"1fr":"repeat(auto-fit,minmax(200px,1fr))",
                gap:10,marginBottom:20}}>
                {totalFaturaCartoes.map(({nome,total,pagos})=>{
                  const pct=total>0?Math.round((pagos/total)*100):0;
                  return(
                    <MetricCard key={nome} label={nome} value={fmtBRL(total)} accent="blue" icon="💳">
                      <div style={{margin:"10px 0 4px"}}><ProgressBar pct={pct} color={C.blue600}/></div>
                      <div style={{fontSize:10,color:C.blue600,opacity:0.7}}>{pct}% pago</div>
                    </MetricCard>
                  );
                })}

                {!checklistEmAberto&&totalEmAberto>0&&(
                  <MetricCard label="Fatura em aberto" value={fmtBRL(totalEmAberto)}
                    sub="ainda não fechou — fora do cálculo" accent="amber" icon="🔴"/>
                )}

                {aReceber.length>0&&(
                  <MetricCard label="A receber" value={fmtBRL(totalAReceber)} accent="blue" icon="💰">
                    <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${C.blue600}22`}}>
                      {aReceber.map(p=>(
                        <button key={p.nome} className="gf-btn"
                          onClick={()=>setModal({title:`A receber — ${p.nome}`,rows:p.itens,pessoa:p.nome})}
                          style={{display:"flex",width:"100%",justifyContent:"space-between",
                            gap:8,padding:"3px 0",background:"transparent",border:"none",
                            cursor:"pointer",fontSize:11,color:C.blue600,opacity:0.8}}>
                          <span>{p.nome} ›</span>
                          <span style={{fontVariantNumeric:"tabular-nums"}}>{fmtBRL(p.total)}</span>
                        </button>
                      ))}
                    </div>
                  </MetricCard>
                )}
              </div>

              {semDono.length>0&&(
                <button className="gf-btn" onClick={()=>{setTab(0);setFaturaTab(1);}}
                  style={{...card,width:"100%",textAlign:"left",cursor:"pointer",
                    background:C.amber50,border:`1px solid ${C.amber100}`}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.amber600,marginBottom:4}}>
                    ⚠️ {semDono.length} lançamento{semDono.length===1?"":"s"} sem dono ·
                    {" "}{fmtBRL(valorSemDono)} fora da conta
                  </div>
                  <div style={{fontSize:12,color:C.amber600,opacity:0.8,lineHeight:1.5}}>
                    Sem dono não dá para saber quem paga, então nada disso entra nos
                    totais acima. Clique para classificar na Fatura.
                  </div>
                </button>
              )}

              {checklistEmAberto&&(
                <div style={{...card,background:C.amberSoft,border:`1px solid ${C.amber100}`,
                  padding:"10px 14px"}}>
                  <div style={{fontSize:12,color:C.amber600,lineHeight:1.6}}>
                    🔴 <strong>A fatura de {mesLabel(mesRef)} ainda não fechou.</strong>{" "}
                    O cartão abaixo usa a fatura em aberto, então os valores podem
                    mudar até o fechamento. Marcar como pago já funciona.
                  </div>
                </div>
              )}

              {/* Checklists — empilham no mobile em vez de espremer duas colunas */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
                {["Caulin","Luanna"].map(pessoa=>{
                  const accent=pessoa==="Caulin"?ACCENTS.teal:ACCENTS.purple;
                  return(
                    <div key={pessoa} style={card}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${accent.border}`}}>
                        <div style={{width:34,height:34,borderRadius:"50%",background:accent.bg,border:`1px solid ${accent.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:accent.color}}>{pessoa.charAt(0)}</div>
                        <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{pessoa}</div><div style={{fontSize:11,color:C.textMuted}}>{mesLabel(mesRef)}</div></div>
                      </div>

                      {invList.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0).length>0&&<>
                        <SectionLabel>Investimentos</SectionLabel>
                        {invList.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0).map(r=>(
                          <CheckRow key={r.id} chave={chavePago(mesRef,"INV",r)} label={r.descricao||r.transacao} valor={vPessoa(r.valor,r.dono,pessoa)} sub={rotuloSub(r.dono)}/>
                        ))}
                      </>}

                      {contasList.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0).length>0&&<>
                        <SectionLabel>Contas</SectionLabel>
                        {contasList.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0).map(r=>(
                          <CheckRow key={r.id} chave={chavePago(mesRef,"CONTA",r)} label={r.transacao} valor={vPessoa(r.valor,r.dono,pessoa)} sub={rotuloSub(r.dono)}/>
                        ))}
                      </>}

                      <SectionLabel>Cartão</SectionLabel>
                      {totalFaturaCartoes.map(({nome,fixos,parcelados,variaveis})=>{
                        const hasAny=[...fixos,...parcelados,...variaveis].some(r=>vPessoa(r.valor,r.dono,pessoa)>0);
                        if(!hasAny) return null;
                        return(
                          <div key={nome} style={{marginBottom:4}}>
                            <div style={{fontSize:11,color:C.textMuted,padding:"6px 0 2px",fontWeight:600}}>{nome}</div>
                            {/* mesRef na chave: sem ele, marcar "Fixos" em agosto
                                deixava setembro já marcado ao trocar de mês. */}
                            {[
                              {key:chaveGrupo(mesRef,nome,pessoa,"fixos"),label:"Fixos",rows:fixos},
                              {key:chaveGrupo(mesRef,nome,pessoa,"parc"),label:"Parcelados",rows:parcelados},
                              {key:chaveGrupo(mesRef,nome,pessoa,"var"),label:"Variáveis",rows:variaveis},
                            ].map(g=>{
                              const gRows=g.rows.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0);
                              if(!gRows.length) return null;
                              const gTotal=gRows.reduce((a,r)=>a+vPessoa(r.valor,r.dono,pessoa),0);
                              const gPago=!!pagoDoMes[g.key];
                              return(
                                <div key={g.key} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 0",borderTop:`1px solid ${C.borderSoft}`}}>
                                  <input type="checkbox" checked={gPago} onChange={()=>{alternarPago(mesRef,g.key,!gPago);gRows.forEach(r=>alternarPago(mesRef,chavePago(mesRef,"CARTAO",r),!gPago));}} style={{flexShrink:0,cursor:"pointer",accentColor:C.teal600,width:15,height:15}}/>
                                  <span onClick={()=>setModal({title:`${nome} — ${g.label} (${pessoa})`,rows:gRows,pessoa})} style={{flex:1,fontSize:13,fontWeight:500,textDecoration:gPago?"line-through":"none",color:gPago?C.textMuted:accent.color,cursor:"pointer",userSelect:"none"}}>
                                    {g.label} <span style={{fontSize:11,color:C.textMuted}}>›</span>
                                  </span>
                                  <span style={{fontSize:13,fontWeight:600,fontVariantNumeric:"tabular-nums",color:gPago?C.textMuted:C.text}}>{fmtBRL(gTotal)}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Um resumo por pessoa: cada uma recebe só o que lhe cabe, com
                  os itens já divididos. O resumo conjunto virava um texto que
                  ninguém conseguia usar para pagar as próprias contas. */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",
                gap:10,marginTop:16}}>
                {CASAL.map(pessoa=>{
                  const eu=copied===pessoa;
                  const cor=pessoa==="Caulin"?ACCENTS.teal:ACCENTS.purple;
                  return(
                    <button key={pessoa} className="gf-btn"
                      onClick={()=>{
                        navigator.clipboard.writeText(
                          resumoWhatsApp(pessoa,calcChecklist(),mesRef,vPessoa)
                        ).then(()=>{setCopied(pessoa);setTimeout(()=>setCopied(""),2000);});
                      }}
                      style={{width:"100%",padding:"13px",borderRadius:10,
                        border:`1px solid ${eu?C.green100:cor.border}`,
                        background:eu?C.green50:cor.bg,color:eu?C.green600:cor.color,
                        cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",
                        alignItems:"center",justifyContent:"center",gap:8,
                        transition:"background .2s,color .2s"}}>
                      {eu?"✅ Copiado!":`📱 Resumo da ${pessoa}`}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}