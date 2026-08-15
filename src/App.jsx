import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from "react";

const CLIENT_ID = "551652083809-p6o9ch2bvn8ipg508b7nu2afu5fn1ho1.apps.googleusercontent.com";
const SHEET_ID  = "19qO91TbQQJMLd_ONeP--Gdh7NwliuYuYQ-GuA-PNen8";
const SCOPES    = "https://www.googleapis.com/auth/spreadsheets";
const API_BASE  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
const DONOS = ["Caulin","Luanna","Dividido"];
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
  bg:"#0F1115", surface:"#171A20", surfaceAlt:"#1E222A", surfaceHi:"#252A34",
  border:"#2A2F3A", borderSoft:"#21252D",
  text:"#E7EAF0", textDim:"#98A0AE", textMuted:"#666E7D",

  teal50:"#0E3B31",  teal100:"#1C5C4B", teal600:"#2DD4A7", tealSoft:"rgba(45,212,167,0.10)",
  purple50:"#2A2445",purple100:"#3B3468",purple600:"#A78BFA",purpleSoft:"rgba(167,139,250,0.10)",
  amber50:"#3A2E14", amber100:"#5A4720", amber600:"#FBBF24",amberSoft:"rgba(251,191,36,0.10)",
  red50:"#3B1F22",   red100:"#5C2E33",  red600:"#F87171",  redSoft:"rgba(248,113,113,0.10)",
  green50:"#16301F", green100:"#22482F",green600:"#4ADE80",greenSoft:"rgba(74,222,128,0.10)",
  blue50:"#16283F",  blue100:"#23405F", blue600:"#60A5FA", blueSoft:"rgba(96,165,250,0.10)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBRL(v){return"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});}
function parseBRL(s){if(!s&&s!==0)return 0;const str=String(s).replace(/R\$\s*/g,"").trim();if(str.includes(","))return parseFloat(str.replace(/\./g,"").replace(",","."))||0;return parseFloat(str)||0;}
function normalize(s){return(s||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9\s]/g," ").replace(/\s+/g," ").trim();}
function extractParcela(s){const m=String(s).match(/(\d{2}\/\d{2})\s*$/);return m?m[1]:"";}
function stripParcela(s){return String(s).replace(/\s*\d{2}\/\d{2}\s*$/,"").trim();}
function matchDict(t,dict){const n=normalize(t);return dict.find(d=>n.includes(normalize(d.key)));}
function parseCSVLine(l){const sep=l.includes(";")?";":",";return l.split(sep).map(c=>c.replace(/^["']|["']$/g,"").trim());}
function sumArr(arr){return(arr||[]).reduce((a,b)=>a+(b.valor||0),0);}
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
  }catch(e){}
  return null;
}

function storeToken(token){
  try{
    sessionStorage.setItem("gf_token",token);
    sessionStorage.setItem("gf_token_exp",String(Date.now()+3500*1000));
  }catch(e){}
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

// ── Row converters ────────────────────────────────────────────────────────────
function contaToRow(mes,r){return[mes,r.data||"",r.transacao,String(parseBRL(r.valor)),r.dono,r.tipo,r.parcelas||"",r.obs||""];}
function rowToConta(row){return{id:uid(),transacao:row[2]||"",valor:String(parseBRL(row[3])),dono:row[4]||"Caulin",tipo:row[5]||"DESPESA",parcelas:row[6]||"",obs:row[7]||""};}
// Coluna K = Origem ("MANUAL" | "LEGADO"). Aditiva: linhas antigas leem vazio = LEGADO.
function faturaToRow(mes,r,origem){return[mes,r.data||"",r.nome,r.parcela||"",String(r.valor),r.dono,r.tipo||"DESPESA",r.parcelas||"VARIÁVEL",r.obs||"",r.cartao||"",origem||"LEGADO"];}
function rowToFatura(row){return{id:uid(),data:row[1]||"",nome:row[2]||"",parcela:row[3]||"",valor:parseBRL(row[4]),dono:row[5]||"",tipo:row[6]||"DESPESA",parcelas:row[7]||"VARIÁVEL",obs:row[8]||"",cartao:row[9]||"",isNew:false};}
function dictToRow(d){return[d.key,d.dono,d.parcelas,d.obs||""];}
function rowToDict(row){return{key:row[0]||"",dono:row[1]||"Caulin",parcelas:row[2]||"VARIÁVEL",obs:row[3]||""};}

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
  const [csvRaw,setCsvRaw]=useState("");
  const [csvError,setCsvError]=useState("");
  const [filtro,setFiltro]=useState("TODOS");
  const [copied,setCopied]=useState(false);
  const [showCopy,setShowCopy]=useState(false);
  const [showMeses,setShowMeses]=useState(false);
  const [confirmar,setConfirmar]=useState(null);
  const [modal,setModal]=useState(null);
  const [pago,setPago]=useState({});
  const [faturaLixo,setFaturaLixo]=useState(null);
  const [authStatus,setAuthStatus]=useState(()=>getStoredToken()?"ok":"idle");
  const [syncStatus,setSyncStatus]=useState("");
  const fileRef=useRef();
  const syncTimer=useRef(null);
  const isMobile=useMediaQuery("(max-width: 720px)");

  // ── Auto-load se já tem token ─────────────────────────────────────────────
  useEffect(()=>{
    if(authStatus==="ok") loadAllData();
  },[]);

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
        setSyncStatus("erro ao salvar");
      }
    },1200);
  },[]);

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

      const allMeses=new Set([...Object.keys(byMesRD),...Object.keys(byMesInv),...Object.keys(byMesCC),...Object.keys(byMesMan)]);
      const novo={};
      allMeses.forEach(mes=>{
        novo[mes]={contas:byMesRD[mes]||[],investimentos:byMesInv[mes]||[],fatura:byMesCC[mes]||[],manual:byMesMan[mes]||[]};
      });
      setDadosMes(novo);
      if(allMeses.size>0){
        // Chaves ANO-MÊS ordenam corretamente como string.
        const ultimo=[...allMeses].sort().pop();
        setMesRef(ultimo);
      }
      setSyncStatus("salvo ✓");
      setTimeout(()=>setSyncStatus(""),2500);
    }catch(e){
      console.error(e);
      setSyncStatus("erro ao carregar");
    }
  }

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

  const updF=(id,f,v)=>withSync(mesRef,"fatura",c=>({fatura:c.fatura.map(r=>r.id===id?{...r,[f]:v}:r)}));
  const rmF=id=>withSync(mesRef,"fatura",c=>({fatura:c.fatura.filter(r=>r.id!==id)}));
  const learnRow=row=>{
    const key=normalize(row.nome).substring(0,25);
    if(key&&!dict.find(d=>d.key===key)){
      const nd=[...dict,{key,dono:row.dono,parcelas:row.parcelas,obs:row.obs}];
      setDict(nd);
      syncAll(dadosMes,nd,"dict");
    }
    updF(row.id,"isNew",false);
  };

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

  const parseCSV=useCallback(()=>{
    setCsvError("");
    const text=csvRaw.trim();
    if(!text){setCsvError("Cole ou importe o CSV.");return;}
    const allLines=text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
    let dataLines=allLines;
    const first=parseCSVLine(allLines[0]).map(c=>c.toLowerCase());
    if(first.some(c=>["data","date","lançamento","lancamento","valor","description"].includes(c))) dataLines=allLines.slice(1);
    const rows=[],erros=[];
    for(let i=0;i<dataLines.length;i++){
      const cols=parseCSVLine(dataLines[i]);
      if(cols.length<3){erros.push(`L${i+2}`);continue;}
      const[rawData,rawDesc,rawValor]=cols;
      const vs=String(rawValor).replace(/\s/g,"");
      let valor=vs.includes(",")?parseFloat(vs.replace(/\./g,"").replace(",",".")):parseFloat(vs);
      if(isNaN(valor)){erros.push(`L${i+2}`);continue;}
      valor=Math.abs(valor);
      const parcela=extractParcela(rawDesc),nome=stripParcela(rawDesc);
      const hit=matchDict(nome,dict);
      rows.push({id:uid(),data:rawData.trim(),nome,parcela,valor,dono:hit?.dono||"",parcelas:hit?(parcela?"PARCELADO":hit.parcelas):(parcela?"PARCELADO":"VARIÁVEL"),obs:hit?.obs||(hit?"":"NOVO"),cartao:"Itaú Black",isNew:!hit});
    }
    if(!rows.length){setCsvError("Nenhuma linha válida.");return;}
    withSync(mesRef,"fatura",c=>({fatura:[...c.fatura,...rows]}));
    setCsvError(erros.length?`${rows.length} importadas. Avisos: ${erros.join(", ")}`:"");
  },[csvRaw,dict,mesRef,dadosMes]);

  // ── Checklist calc ────────────────────────────────────────────────────────
  const calcChecklist=()=>{
    const allCartao=[...fatura,...manual];
    let rendaCaulin=0,rendaLuanna=0,despCaulin=0,despLuanna=0;
    const contasList=[],invList=[];
    contas.forEach(r=>{
      const v=parseBRL(r.valor);
      if(r.tipo==="RENDA"){if(r.dono==="Caulin")rendaCaulin+=v;else if(r.dono==="Luanna")rendaLuanna+=v;else{rendaCaulin+=v/2;rendaLuanna+=v/2;}return;}
      if(r.tipo==="INVESTIMENTO"){invList.push({...r,valor:v});return;}
      contasList.push({...r,valor:v});
    });
    invest.forEach(r=>invList.push({...r,valor:parseBRL(r.valor)}));
    [...contasList,...invList].forEach(r=>{
      const v=r.valor;
      if(r.dono==="Dividido"){despCaulin+=v/2;despLuanna+=v/2;}
      else if(r.dono==="Caulin")despCaulin+=v;
      else if(r.dono==="Luanna")despLuanna+=v;
    });
    const cartoesMap={};
    allCartao.forEach(r=>{
      if(!r.valor||!r.dono)return;
      const nome=r.cartao||"Outros";
      if(!cartoesMap[nome])cartoesMap[nome]={fixos:[],parcelados:[],variaveis:[]};
      const sub=r.parcelas==="RECORRENTE"?"fixos":r.parcelas==="PARCELADO"?"parcelados":"variaveis";
      cartoesMap[nome][sub].push(r);
      const v=r.valor;
      if(r.dono==="Dividido"){despCaulin+=v/2;despLuanna+=v/2;}
      else if(r.dono==="Caulin")despCaulin+=v;
      else if(r.dono==="Luanna")despLuanna+=v;
    });
    const pagoCaulin=[...contasList,...invList].filter(r=>pago[r.id]).reduce((a,r)=>a+(r.dono==="Dividido"?r.valor/2:r.dono==="Caulin"?r.valor:0),0);
    const pagoCartaoCaulin=allCartao.filter(r=>pago[r.id]).reduce((a,r)=>a+(r.dono==="Dividido"?r.valor/2:r.dono==="Caulin"?r.valor:0),0);
    const saldoCaulin=rendaCaulin-pagoCaulin-pagoCartaoCaulin;
    const totalFaturaCartoes=Object.entries(cartoesMap).map(([nome,g])=>{
      const rows=[...g.fixos,...g.parcelados,...g.variaveis];
      return{nome,total:rows.reduce((a,r)=>a+r.valor,0),pagos:rows.filter(r=>pago[r.id]).reduce((a,r)=>a+r.valor,0),fixos:g.fixos,parcelados:g.parcelados,variaveis:g.variaveis};
    });
    return{rendaCaulin,rendaLuanna,despCaulin,despLuanna,saldoCaulin,contasList,invList,totalFaturaCartoes};
  };

  const vPessoa=(v,dono,pessoa)=>dono==="Dividido"?v/2:dono===pessoa?v:0;
  const filtros=["TODOS","PARCELADO","RECORRENTE","VARIÁVEL","NOVO"];
  const faturaFilt=fatura.filter(r=>filtro==="TODOS"?true:filtro==="NOVO"?r.isNew:r.parcelas===filtro);
  const newCount=fatura.filter(r=>r.isNew).length;
  const mesesComDados=Object.keys(dadosMes);
  // Anos que têm dados + o ano do mês selecionado, para o seletor sempre poder voltar.
  const anosComDados=[...new Set([...mesesComDados.map(k=>mesPartes(k).ano),mesPartes(mesRef).ano])].filter(a=>!isNaN(a)).sort((a,b)=>b-a);
  const TABS=[{l:"Fatura",i:"💳"},{l:"Contas",i:"🏠"},{l:"Investimentos",i:"📈"},{l:"Checklist",i:"✅"}];

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
            <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",
              background:syncStatus.startsWith("erro")?C.red50:C.tealSoft,
              border:`1px solid ${syncStatus.startsWith("erro")?C.red100:C.teal100}`,
              color:syncStatus.startsWith("erro")?C.red600:C.teal600}}>{syncStatus}</span>
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
            <div style={{display:"flex",gap:0,marginBottom:16}}>
              {["📥 Importar CSV","✏️ Lançar manualmente"].map((t,i)=>(
                <button key={t} className="gf-btn" onClick={()=>setFaturaTab(i)} style={{fontSize:12,padding:"7px 16px",border:`1px solid ${faturaTab===i?C.teal100:C.border}`,borderRadius:i===0?"8px 0 0 8px":"0 8px 8px 0",background:faturaTab===i?C.teal50:C.surfaceAlt,color:faturaTab===i?C.teal600:C.textDim,cursor:"pointer",fontWeight:faturaTab===i?700:500}}>
                  {t}
                </button>
              ))}
            </div>

            {faturaTab===0&&(
              <div>
                <div style={card}>
                  <p style={{fontSize:13,color:C.textDim,marginBottom:10}}>Importando para <strong style={{color:C.text}}>{mesLabel(mesRef)}</strong> — CSV Itaú (separador <code>;</code> ou <code>,</code>).</p>
                  <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                    <Btn onClick={()=>fileRef.current.click()}>📁 Importar arquivo</Btn>
                    <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{setCsvRaw(ev.target.result);setCsvError("");};r.readAsText(f,"utf-8");}}/>
                    {fatura.length>0&&!faturaLixo&&<Btn danger small onClick={()=>{setFaturaLixo(fatura);withSync(mesRef,"fatura",()=>({fatura:[]}));}}>🗑 Limpar fatura</Btn>}
                    {faturaLixo&&<Btn small onClick={()=>{withSync(mesRef,"fatura",()=>({fatura:faturaLixo}));setFaturaLixo(null);}} style={{color:C.amber600,borderColor:C.amber600,background:C.amber50}}>↩ Desfazer</Btn>}
                  </div>
                  <textarea value={csvRaw} onChange={e=>{setCsvRaw(e.target.value);setCsvError("");}} placeholder={"data;lançamento;valor\n05/05/2026;AMAZON PRIME;39,90"} style={{...inp,height:90,resize:"vertical",fontFamily:"monospace",fontSize:12}}/>
                  {csvError&&<p style={{fontSize:12,color:C.red600,marginTop:6,background:C.red50,border:`1px solid ${C.red100}`,padding:"7px 10px",borderRadius:8}}>{csvError}</p>}
                  <div style={{marginTop:10}}><Btn active onClick={parseCSV}>⚡ Processar fatura</Btn></div>
                </div>

                {fatura.length>0&&(
                  <div style={card}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:14,fontWeight:600,color:C.text}}>{fatura.length} transações</span>
                        {newCount>0&&<Badge color="new">{newCount} para revisar</Badge>}
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {filtros.map(f=>(
                          <button key={f} className="gf-btn" onClick={()=>setFiltro(f)} style={{fontSize:11,padding:"5px 10px",borderRadius:20,border:`1px solid ${filtro===f?C.teal100:C.border}`,background:filtro===f?C.teal50:"transparent",color:filtro===f?C.teal600:C.textDim,cursor:"pointer",fontWeight:filtro===f?700:500}}>
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:520}}>
                        <thead><tr style={{background:C.surfaceAlt}}>{["Data","Descrição","Valor","Dono","Parcelas","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {faturaFilt.map(r=>(
                            <tr key={r.id} style={{background:r.isNew?C.amberSoft:"transparent"}}>
                              <td style={{...td,color:C.textMuted,whiteSpace:"nowrap"}}>{r.data}</td>
                              <td style={td}><div style={{fontWeight:500}}>{r.nome}</div>{r.parcela&&<div style={{fontSize:10,color:C.textMuted}}>{r.parcela}</div>}</td>
                              <td style={{...td,fontWeight:600,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{fmtBRL(r.valor)}</td>
                              <td style={td}><select value={r.dono} onChange={e=>updF(r.id,"dono",e.target.value)} style={{...sel,width:88,borderColor:r.dono?C.border:C.amber100}}><option value="">—</option>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                              <td style={td}><select value={r.parcelas} onChange={e=>updF(r.id,"parcelas",e.target.value)} style={{...sel,width:98}}>{PARC_OPTS.map(d=><option key={d}>{d}</option>)}</select></td>
                              <td style={td}><input value={r.obs} onChange={e=>updF(r.id,"obs",e.target.value)} style={{...inp,width:85}}/></td>
                              <td style={td}><div style={{display:"flex",gap:4}}>
                                {r.isNew&&<Btn small onClick={()=>learnRow(r)} style={{color:C.green600,borderColor:C.green100,background:C.green50}}>Aprender</Btn>}
                                <Btn danger small title="Remover" onClick={()=>rmF(r.id)}>✕</Btn>
                              </div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {faturaTab===1&&(
              <div style={card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div><span style={{fontSize:14,fontWeight:600,color:C.text}}>Outros cartões</span><span style={{fontSize:12,color:C.textMuted,marginLeft:8}}>{mesLabel(mesRef)}</span></div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                    <Btn active small onClick={addM}>+ Adicionar</Btn>
                  </div>
                </div>
                {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
                {manual.length===0
                  ?<EmptyState icon="💳">Nenhum lançamento. Clique em “+ Adicionar”.</EmptyState>
                  :<div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:540}}>
                    <thead><tr style={{background:C.surfaceAlt}}>{["Data","Descrição","Valor","Cartão","Dono","Parcelas","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{manual.map(r=>(
                      <tr key={r.id}>
                        <td style={td}><input value={r.data} onChange={e=>updM(r.id,"data",e.target.value)} placeholder="dd/mm" style={{...inp,width:65}}/></td>
                        <td style={td}><input value={r.nome} onChange={e=>updM(r.id,"nome",e.target.value)} placeholder="Descrição" style={{...inp,width:110}}/></td>
                        <td style={td}><input value={r.valor||""} onChange={e=>updM(r.id,"valor",parseFloat(e.target.value)||0)} type="number" step="0.01" style={{...inp,width:70}}/></td>
                        <td style={td}><input value={r.cartao} onChange={e=>updM(r.id,"cartao",e.target.value)} placeholder="Nubank…" style={{...inp,width:80}}/></td>
                        <td style={td}><select value={r.dono} onChange={e=>updM(r.id,"dono",e.target.value)} style={{...sel,width:82}}>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                        <td style={td}><select value={r.parcelas} onChange={e=>updM(r.id,"parcelas",e.target.value)} style={{...sel,width:90}}>{PARC_OPTS.map(d=><option key={d}>{d}</option>)}</select></td>
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

        {/* CONTAS */}
        {tab===1&&(
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
                    <td style={td}><select value={r.dono} onChange={e=>updC(r.id,"dono",e.target.value)} style={{...sel,width:85}}>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
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
        {tab===2&&(
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
                    <td style={td}><select value={r.dono} onChange={e=>updI(r.id,"dono",e.target.value)} style={{...sel,width:85}}>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                    <td style={td}><input value={r.obs} onChange={e=>updI(r.id,"obs",e.target.value)} placeholder="CDB, Tesouro…" style={{...inp,width:130}}/></td>
                    <td style={td}><Btn danger small title="Remover" onClick={()=>setConfirmar({titulo:"Remover investimento?",texto:`“${r.descricao||"(sem descrição)"}” será removido de ${mesLabel(mesRef)}.`,onConfirm:()=>rmI(r.id)})}>✕</Btn></td>
                  </tr>
                ))}</tbody>
              </table></div>
            }
          </div>
        )}

        {/* CHECKLIST */}
        {tab===3&&(()=>{
          const{rendaCaulin,rendaLuanna,despCaulin,despLuanna,saldoCaulin,contasList,invList,totalFaturaCartoes}=calcChecklist();
          const rendaTotal=rendaCaulin+rendaLuanna;

          const CheckRow=({id,label,valor,sub,onClick})=>{
            const isPago=!!pago[id];
            return(
              <div style={{display:"flex",alignItems:"center",gap:9,padding:"9px 0",borderTop:`1px solid ${C.borderSoft}`}}>
                <input type="checkbox" checked={isPago} onChange={()=>setPago(p=>({...p,[id]:!p[id]}))} style={{flexShrink:0,cursor:"pointer",accentColor:C.teal600,width:15,height:15}}/>
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

              {/* Summary cards */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:20}}>
                <MetricCard label="Renda total" value={fmtBRL(rendaTotal)} sub={`C: ${fmtBRL(rendaCaulin)}`} accent="teal" icon="💰"/>
                <MetricCard label="Despesas Caulin" value={fmtBRL(despCaulin)} accent="red" icon="📉"/>
                <MetricCard label="Despesas Luanna" value={fmtBRL(despLuanna)} accent="purple" icon="📉"/>
                <MetricCard label="Saldo Caulin" value={fmtBRL(saldoCaulin)} sub="após pagamentos" accent={saldoCaulin>=0?"green":"red"} icon="💵"/>
                {totalFaturaCartoes.map(({nome,total,pagos})=>{
                  const pct=total>0?Math.round((pagos/total)*100):0;
                  return(
                    <MetricCard key={nome} label={nome} value={fmtBRL(total)} accent="blue" icon="💳">
                      <div style={{margin:"8px 0 4px"}}><ProgressBar pct={pct} color={C.blue600}/></div>
                      <div style={{fontSize:10,color:C.blue600,opacity:0.7}}>{pct}% pago</div>
                    </MetricCard>
                  );
                })}
              </div>

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
                          <CheckRow key={r.id} id={r.id} label={r.descricao||r.transacao} valor={vPessoa(r.valor,r.dono,pessoa)} sub={r.dono==="Dividido"?"(÷2)":undefined}/>
                        ))}
                      </>}

                      {contasList.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0).length>0&&<>
                        <SectionLabel>Contas</SectionLabel>
                        {contasList.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0).map(r=>(
                          <CheckRow key={r.id} id={r.id} label={r.transacao} valor={vPessoa(r.valor,r.dono,pessoa)} sub={r.dono==="Dividido"?"(÷2)":undefined}/>
                        ))}
                      </>}

                      <SectionLabel>Cartão</SectionLabel>
                      {totalFaturaCartoes.map(({nome,fixos,parcelados,variaveis})=>{
                        const hasAny=[...fixos,...parcelados,...variaveis].some(r=>vPessoa(r.valor,r.dono,pessoa)>0);
                        if(!hasAny) return null;
                        return(
                          <div key={nome} style={{marginBottom:4}}>
                            <div style={{fontSize:11,color:C.textMuted,padding:"6px 0 2px",fontWeight:600}}>{nome}</div>
                            {[
                              {key:`fixos-${nome}-${pessoa}`,label:"Fixos",rows:fixos},
                              {key:`parc-${nome}-${pessoa}`,label:"Parcelados",rows:parcelados},
                              {key:`var-${nome}-${pessoa}`,label:"Variáveis",rows:variaveis},
                            ].map(g=>{
                              const gRows=g.rows.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0);
                              if(!gRows.length) return null;
                              const gTotal=gRows.reduce((a,r)=>a+vPessoa(r.valor,r.dono,pessoa),0);
                              const gPago=!!pago[g.key];
                              return(
                                <div key={g.key} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 0",borderTop:`1px solid ${C.borderSoft}`}}>
                                  <input type="checkbox" checked={gPago} onChange={()=>{setPago(p=>({...p,[g.key]:!gPago}));gRows.forEach(r=>setPago(p=>({...p,[r.id]:!gPago})));}} style={{flexShrink:0,cursor:"pointer",accentColor:C.teal600,width:15,height:15}}/>
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

              <button className="gf-btn" onClick={()=>{
                const{rendaCaulin,rendaLuanna,despCaulin,despLuanna,saldoCaulin,totalFaturaCartoes}=calcChecklist();
                const txt=[`📊 CHECK LIST — ${mesLabel(mesRef)}`,"",`💰 Renda total → ${fmtBRL(rendaCaulin+rendaLuanna)}`,`   Caulin: ${fmtBRL(rendaCaulin)} · Luanna: ${fmtBRL(rendaLuanna)}`,"",`📉 Despesas`,`   Caulin: ${fmtBRL(despCaulin)} · Luanna: ${fmtBRL(despLuanna)}`,"",`💵 Saldo Caulin → ${fmtBRL(saldoCaulin)}`,"",`💳 Faturas`,...totalFaturaCartoes.map(c=>`   ${c.nome}: ${fmtBRL(c.total)}`)].join("\n");
                navigator.clipboard.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
              }} style={{width:"100%",marginTop:16,padding:"13px",borderRadius:10,border:`1px solid ${copied?C.green100:C.teal100}`,background:copied?C.green50:C.teal50,color:copied?C.green600:C.teal600,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"background .2s,color .2s"}}>
                {copied?"✅ Copiado!":"📱 Copiar resumo para WhatsApp"}
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}