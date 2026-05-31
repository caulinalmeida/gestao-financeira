import { useState, useRef, useCallback, useEffect } from "react";

const CLIENT_ID = "551652083809-p6o9ch2bvn8ipg508b7nu2afu5fn1ho1.apps.googleusercontent.com";
const SHEET_ID  = "19qO91TbQQJMLd_ONeP--Gdh7NwliuYuYQ-GuA-PNen8";
const SCOPES    = "https://www.googleapis.com/auth/spreadsheets";
const API_BASE  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

const MESES = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
const DONOS = ["Caulin","Luanna","Dividido"];
const PARC_OPTS = ["VARIÁVEL","PARCELADO","RECORRENTE"];
const TIPOS_CONTA = ["RENDA","DESPESA FIXA","DESPESA","INVESTIMENTO"];

const C = {
  teal50:"#E1F5EE",teal100:"#9FE1CB",teal600:"#0F6E56",
  purple50:"#EEEDFE",purple600:"#534AB7",
  amber50:"#FAEEDA",amber600:"#854F0B",
  red50:"#FCEBEB",red600:"#A32D2D",
  green50:"#EAF3DE",green600:"#3B6D11",
  blue50:"#E6F1FB",blue600:"#185FA5",
};

function fmtBRL(v){return"R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});}
function parseBRL(s){if(!s&&s!==0)return 0;const str=String(s).replace(/R\$\s*/g,"").trim();if(str.includes(","))return parseFloat(str.replace(/\./g,"").replace(",","."))||0;return parseFloat(str)||0;}
function normalize(s){return(s||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9\s]/g," ").replace(/\s+/g," ").trim();}
function extractParcela(s){const m=String(s).match(/(\d{2}\/\d{2})\s*$/);return m?m[1]:"";}
function stripParcela(s){return String(s).replace(/\s*\d{2}\/\d{2}\s*$/,"").trim();}
function matchDict(t,dict){const n=normalize(t);return dict.find(d=>n.includes(normalize(d.key)));}
function parseCSVLine(l){const sep=l.includes(";")?";":",";return l.split(sep).map(c=>c.replace(/^["']|["']$/g,"").trim());}
function sumArr(arr){return(arr||[]).reduce((a,b)=>a+(b.valor||0),0);}
function uid(){return Math.random().toString(36).slice(2,9);}

// ── Google Auth ───────────────────────────────────────────────────────────────
let tokenClient=null;
let accessToken=null;

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
  return new Promise((res,rej)=>{
    if(!tokenClient){
      tokenClient=window.google.accounts.oauth2.initTokenClient({
        client_id:CLIENT_ID,scope:SCOPES,
        callback:resp=>{
          if(resp.error){rej(resp.error);return;}
          accessToken=resp.access_token;
          setTimeout(()=>{accessToken=null;},3500*1000);
          res(accessToken);
        }
      });
    }
    if(accessToken&&!forceConsent){res(accessToken);return;}
    tokenClient.requestAccessToken({prompt:forceConsent?"consent":""});
  });
}

// ── Sheets helpers ────────────────────────────────────────────────────────────
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
function faturaToRow(mes,r){return[mes,r.data||"",r.nome,r.parcela||"",String(r.valor),r.dono,r.tipo||"DESPESA",r.parcelas||"VARIÁVEL",r.obs||"",r.cartao||"Itaú Black"];}
function rowToFatura(row){return{id:uid(),data:row[1]||"",nome:row[2]||"",parcela:row[3]||"",valor:parseBRL(row[4]),dono:row[5]||"",tipo:row[6]||"DESPESA",parcelas:row[7]||"VARIÁVEL",obs:row[8]||"",cartao:row[9]||"Itaú Black",isNew:false};}
function invToRow(mes,r){return[mes,r.descricao,String(parseBRL(r.valor)),r.dono,r.obs||""];}
function dictToRow(d){return[d.key,d.dono,d.parcelas,d.obs||""];}
function rowToDict(row){return{key:row[0]||"",dono:row[1]||"Caulin",parcelas:row[2]||"VARIÁVEL",obs:row[3]||""};}

// ── Styles ────────────────────────────────────────────────────────────────────
const inp={fontSize:13,padding:"5px 10px",borderRadius:8,border:"1px solid #e0e0e0",background:"#fff",color:"#1a1a1a",width:"100%",boxSizing:"border-box",outline:"none"};
const sel={...inp,cursor:"pointer"};
const card={background:"#fff",border:"1px solid #f0f0f0",borderRadius:12,padding:"1rem 1.25rem",marginBottom:12,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"};
const th={padding:"8px 10px",textAlign:"left",color:"#888",fontWeight:500,fontSize:11,whiteSpace:"nowrap",borderBottom:"1px solid #f0f0f0",textTransform:"uppercase",letterSpacing:"0.04em"};
const td={padding:"7px 10px",fontSize:13,borderBottom:"1px solid #f8f8f8"};

function Btn({active,danger,small,children,onClick,style={},disabled}){
  const base={fontSize:small?11:13,padding:small?"4px 10px":"8px 18px",borderRadius:8,border:"1px solid #e0e0e0",cursor:disabled?"not-allowed":"pointer",fontWeight:active?500:400,display:"inline-flex",alignItems:"center",gap:5,opacity:disabled?0.5:1,transition:"all 0.15s",...style};
  const theme=danger?{background:"transparent",color:"#c0392b",borderColor:"#f5c6c6"}:active?{background:C.teal50,color:C.teal600,borderColor:C.teal100}:{background:"#f8f8f8",color:"#444",borderColor:"#e8e8e8"};
  return<button onClick={disabled?undefined:onClick} style={{...base,...theme}}>{children}</button>;
}

function Badge({color,children}){
  const t=color==="new"?{bg:C.amber50,c:C.amber600}:{bg:C.green50,c:C.green600};
  return<span style={{fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:600,background:t.bg,color:t.c}}>{children}</span>;
}

function MetricCard({label,value,sub,accent,icon}){
  const a={
    teal:{bg:C.teal50,color:C.teal600,border:C.teal100},
    red:{bg:C.red50,color:C.red600,border:"#fadadd"},
    green:{bg:C.green50,color:C.green600,border:"#c8e6c9"},
    purple:{bg:C.purple50,color:C.purple600,border:"#d1c4e9"},
    blue:{bg:C.blue50,color:C.blue600,border:"#bbdefb"},
    none:{bg:"#f8f8f8",color:"#444",border:"#eee"},
  }[accent||"none"];
  return(
    <div style={{background:a.bg,border:`1px solid ${a.border}`,borderRadius:12,padding:"1rem"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        {icon&&<span style={{fontSize:16}}>{icon}</span>}
        <span style={{fontSize:10,color:a.color,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>{label}</span>
      </div>
      <div style={{fontSize:22,fontWeight:600,color:a.color,lineHeight:1.2}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:a.color,opacity:0.7,marginTop:4}}>{sub}</div>}
    </div>
  );
}

function ProgressBar({pct,color}){
  return(
    <div style={{height:4,borderRadius:4,background:"rgba(0,0,0,0.06)",overflow:"hidden"}}>
      <div style={{height:"100%",borderRadius:4,background:color||C.teal600,width:`${Math.min(100,pct)}%`,transition:"width 0.4s ease"}}/>
    </div>
  );
}

function SectionLabel({children}){
  return<div style={{fontSize:10,fontWeight:600,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.08em",padding:"12px 0 5px"}}>{children}</div>;
}

function Modal({onClose,children}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div style={{...card,maxWidth:460,width:"92%",maxHeight:"80vh",overflowY:"auto",margin:0}} onClick={e=>e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function CopyMesModal({dadosMes,mesRef,onClose,onImport}){
  const idx=MESES.indexOf(mesRef);
  const prevNome=idx>0?MESES[idx-1]:null;
  const prev=prevNome?dadosMes[prevNome]:null;
  const [sel2,setSel2]=useState({contas:{},investimentos:{},manual:{}});
  if(!prev||!prevNome)return(<div style={{padding:"1rem"}}><p style={{fontSize:13,marginBottom:12,color:"#666"}}>Não há dados no mês anterior.</p><Btn onClick={onClose}>Fechar</Btn></div>);
  const toggle=(sec,id)=>setSel2(p=>({...p,[sec]:{...p[sec],[id]:!p[sec][id]}}));
  const allToggle=(sec,items)=>{const allOn=items.every(i=>sel2[sec][i.id]);const nx={};items.forEach(i=>nx[i.id]=!allOn);setSel2(p=>({...p,[sec]:nx}));};
  const sections=[{key:"contas",label:"Contas / Renda",items:prev.contas||[]},{key:"investimentos",label:"Investimentos",items:prev.investimentos||[]},{key:"manual",label:"Outros cartões",items:prev.manual||[]}].filter(s=>s.items.length>0);
  const doImport=()=>{const res={};sections.forEach(s=>{res[s.key]=s.items.filter(i=>sel2[s.key][i.id]).map(i=>({...i,id:uid()}));});onImport(res);onClose();};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h3 style={{fontSize:15,fontWeight:600,margin:0}}>Copiar de {prevNome}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#999",fontSize:20,lineHeight:1}}>✕</button>
      </div>
      {sections.map(sec=>(
        <div key={sec.key} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <SectionLabel>{sec.label}</SectionLabel>
            <Btn small onClick={()=>allToggle(sec.key,sec.items)}>Todos</Btn>
          </div>
          {sec.items.map(item=>(
            <label key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",cursor:"pointer",fontSize:13,borderTop:"1px solid #f5f5f5"}}>
              <input type="checkbox" checked={!!sel2[sec.key][item.id]} onChange={()=>toggle(sec.key,item.id)} style={{accentColor:C.teal600}}/>
              <span style={{flex:1}}>{item.transacao||item.descricao||item.nome}</span>
              <span style={{color:"#999",fontSize:12}}>{fmtBRL(parseBRL(item.valor||0))}</span>
            </label>
          ))}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:14,paddingTop:12,borderTop:"1px solid #f0f0f0"}}>
        <Btn active onClick={doImport}>Importar selecionados</Btn>
        <Btn onClick={onClose}>Cancelar</Btn>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState(0);
  const [faturaTab,setFaturaTab]=useState(0);
  const [mesRef,setMesRef]=useState("MAIO");
  const [dict,setDict]=useState([]);
  const [dadosMes,setDadosMes]=useState({});
  const [csvRaw,setCsvRaw]=useState("");
  const [csvError,setCsvError]=useState("");
  const [filtro,setFiltro]=useState("TODOS");
  const [copied,setCopied]=useState(false);
  const [showCopy,setShowCopy]=useState(false);
  const [modal,setModal]=useState(null);
  const [pago,setPago]=useState({});
  const [faturaLixo,setFaturaLixo]=useState(null);
  const [authStatus,setAuthStatus]=useState("idle");
  const [syncStatus,setSyncStatus]=useState("");
  const fileRef=useRef();
  const syncTimer=useRef(null);

  const getMes=m=>dadosMes[m]||{fatura:[],manual:[],contas:[],investimentos:[]};
  const setMesField=(m,f,v)=>setDadosMes(p=>({...p,[m]:{...getMes(m),[f]:v}}));
  const cur=getMes(mesRef);
  const fatura=cur.fatura,manual=cur.manual,contas=cur.contas,invest=cur.investimentos;
  const setFatura=v=>setMesField(mesRef,"fatura",v);
  const setManual=v=>setMesField(mesRef,"manual",v);
  const setContas=v=>setMesField(mesRef,"contas",v);
  const setInvest=v=>setMesField(mesRef,"investimentos",v);
  const togglePago=id=>setPago(p=>({...p,[id]:!p[id]}));
  const mesesComDados=Object.keys(dadosMes);
  const vPessoa=(v,dono,pessoa)=>dono==="Dividido"?v/2:dono===pessoa?v:0;

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

  const loadAllData=async()=>{
    setSyncStatus("carregando...");
    try{
      const dictRows=await sheetsGet("DICIONARIO!A2:D");
      if(dictRows.length) setDict(dictRows.filter(r=>r[0]).map(rowToDict));
      const rdRows=await sheetsGet("RENDA_DESPESAS!A2:H");
      const byMesRD={};
      rdRows.filter(r=>r[0]).forEach(row=>{
        const mes=row[0].toUpperCase();
        if(!byMesRD[mes]) byMesRD[mes]={contas:[],investimentos:[]};
        const c=rowToConta(row);
        if((row[5]||"").toUpperCase()==="INVESTIMENTO") byMesRD[mes].investimentos.push(c);
        else byMesRD[mes].contas.push(c);
      });
      const ccRows=await sheetsGet("CARTAO_CREDITO!A2:J");
      const byMesCC={};
      ccRows.filter(r=>r[0]).forEach(row=>{
        const mes=row[0].toUpperCase();
        if(!byMesCC[mes]) byMesCC[mes]=[];
        byMesCC[mes].push(rowToFatura(row));
      });
      const allMeses=new Set([...Object.keys(byMesRD),...Object.keys(byMesCC)]);
      const novo={};
      allMeses.forEach(mes=>{
        novo[mes]={contas:(byMesRD[mes]?.contas)||[],investimentos:(byMesRD[mes]?.investimentos)||[],fatura:(byMesCC[mes])||[],manual:[]};
      });
      setDadosMes(novo);
      if(allMeses.size>0){
        const ultimo=[...allMeses].sort((a,b)=>MESES.indexOf(a)-MESES.indexOf(b)).pop();
        setMesRef(ultimo);
      }
      setSyncStatus("salvo ✓");
      setTimeout(()=>setSyncStatus(""),2500);
    }catch(e){
      setSyncStatus("erro ao carregar");
    }
  };

  const syncAll=useCallback((dadosMesAtual,dictAtual,field)=>{
    if(authStatus!=="ok") return;
    clearTimeout(syncTimer.current);
    syncTimer.current=setTimeout(async()=>{
      setSyncStatus("salvando...");
      try{
        if(field!=="dict"){
          await sheetsClear("CARTAO_CREDITO!A2:J");
          const ccRows=[];
          Object.entries(dadosMesAtual).forEach(([m,d])=>{
            [...(d.fatura||[]),...(d.manual||[])].forEach(r=>ccRows.push(faturaToRow(m,r)));
          });
          if(ccRows.length) await sheetsAppend("CARTAO_CREDITO!A2",ccRows);
          await sheetsClear("RENDA_DESPESAS!A2:H");
          const rdRows=[];
          Object.entries(dadosMesAtual).forEach(([m,d])=>{
            (d.contas||[]).forEach(r=>rdRows.push(contaToRow(m,r)));
            (d.investimentos||[]).forEach(r=>rdRows.push(contaToRow(m,{...r,transacao:r.descricao,tipo:"INVESTIMENTO",parcelas:"RECORRENTE"})));
          });
          if(rdRows.length) await sheetsAppend("RENDA_DESPESAS!A2",rdRows);
        }
        if(field==="dict"||field==="all"){
          await sheetsClear("DICIONARIO!A2:D");
          const dr=dictAtual.map(dictToRow);
          if(dr.length) await sheetsAppend("DICIONARIO!A2",dr);
        }
        setSyncStatus("salvo ✓");
        setTimeout(()=>setSyncStatus(""),2500);
      }catch(e){
        setSyncStatus("erro ao salvar");
      }
    },1200);
  },[authStatus]);

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
    const newFatura=[...fatura,...rows];
    setFatura(newFatura);
    const novosDados={...dadosMes,[mesRef]:{...getMes(mesRef),fatura:newFatura}};
    syncAll(novosDados,dict,"fatura");
    setCsvError(erros.length?`${rows.length} importadas. Avisos: ${erros.join(", ")}`:"");
  },[csvRaw,dict,fatura,mesRef,dadosMes,syncAll]);

  const withSync=(setter,field)=>(newVal)=>{
    setter(newVal);
    const novosDados={...dadosMes,[mesRef]:{...getMes(mesRef),[field]:newVal}};
    syncAll(novosDados,dict,field);
  };

  const updF=(id,f,v)=>{const nf=fatura.map(r=>r.id===id?{...r,[f]:v}:r);withSync(setFatura,"fatura")(nf);};
  const rmF=id=>withSync(setFatura,"fatura")(fatura.filter(r=>r.id!==id));
  const learnRow=row=>{
    const key=normalize(row.nome).substring(0,25);
    if(key&&!dict.find(d=>d.key===key)){
      const nd=[...dict,{key,dono:row.dono,parcelas:row.parcelas,obs:row.obs}];
      setDict(nd);syncAll(dadosMes,nd,"dict");
    }
    updF(row.id,"isNew",false);
  };

  const updM=(id,f,v)=>{const nm=manual.map(r=>r.id===id?{...r,[f]:v}:r);withSync(setManual,"manual")(nm);};
  const rmM=id=>withSync(setManual,"manual")(manual.filter(r=>r.id!==id));
  const addM=()=>withSync(setManual,"manual")([...manual,{id:uid(),data:"",nome:"",parcela:"",valor:0,dono:"Caulin",parcelas:"VARIÁVEL",obs:"",cartao:""}]);

  const updC=(id,f,v)=>{const nc=contas.map(r=>r.id===id?{...r,[f]:v}:r);withSync(setContas,"contas")(nc);};
  const rmC=id=>withSync(setContas,"contas")(contas.filter(r=>r.id!==id));
  const addC=()=>withSync(setContas,"contas")([...contas,{id:uid(),transacao:"",valor:"",dono:"Dividido",tipo:"DESPESA FIXA",obs:""}]);

  const updI=(id,f,v)=>{const ni=invest.map(r=>r.id===id?{...r,[f]:v}:r);withSync(setInvest,"investimentos")(ni);};
  const rmI=id=>withSync(setInvest,"investimentos")(invest.filter(r=>r.id!==id));
  const addI=()=>withSync(setInvest,"investimentos")([...invest,{id:uid(),descricao:"",valor:"",dono:"Caulin",obs:""}]);

  const handleCopyImport=data=>{
    const nc=data.contas?.length?[...contas,...data.contas]:contas;
    const ni=data.investimentos?.length?[...invest,...data.investimentos]:invest;
    const nm=data.manual?.length?[...manual,...data.manual]:manual;
    setContas(nc);setInvest(ni);setManual(nm);
    const novosDados={...dadosMes,[mesRef]:{...getMes(mesRef),contas:nc,investimentos:ni,manual:nm}};
    syncAll(novosDados,dict,"all");
  };

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
    [...contasList,...invList].forEach(r=>{const v=r.valor;if(r.dono==="Dividido"){despCaulin+=v/2;despLuanna+=v/2;}else if(r.dono==="Caulin")despCaulin+=v;else if(r.dono==="Luanna")despLuanna+=v;});
    const cartoesMap={};
    allCartao.forEach(r=>{
      if(!r.valor||!r.dono)return;
      const nome=r.cartao||"Outros";
      if(!cartoesMap[nome])cartoesMap[nome]={fixos:[],parcelados:[],variaveis:[]};
      const sub=r.parcelas==="RECORRENTE"?"fixos":r.parcelas==="PARCELADO"?"parcelados":"variaveis";
      cartoesMap[nome][sub].push(r);
      const v=r.valor;
      if(r.dono==="Dividido"){despCaulin+=v/2;despLuanna+=v/2;}else if(r.dono==="Caulin")despCaulin+=v;else if(r.dono==="Luanna")despLuanna+=v;
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

  const filtros=["TODOS","PARCELADO","RECORRENTE","VARIÁVEL","NOVO"];
  const faturaFilt=fatura.filter(r=>filtro==="TODOS"?true:filtro==="NOVO"?r.isNew:r.parcelas===filtro);
  const newCount=fatura.filter(r=>r.isNew).length;
  const TABS=[{l:"Fatura",i:"💳"},{l:"Contas",i:"🏠"},{l:"Investimentos",i:"📈"},{l:"Checklist",i:"✅"}];

  if(authStatus!=="ok"){
    return(
      <div style={{minHeight:"100vh",background:"#f7f8fa",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif"}}>
        <div style={{background:"#fff",borderRadius:20,padding:"2.5rem 2rem",maxWidth:380,width:"90%",textAlign:"center",boxShadow:"0 4px 24px rgba(0,0,0,0.08)"}}>
          <div style={{width:56,height:56,borderRadius:14,background:C.teal50,border:`1px solid ${C.teal100}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 16px"}}>📊</div>
          <h2 style={{fontSize:20,fontWeight:700,margin:"0 0 6px",color:"#1a1a1a"}}>Gestão Financeira</h2>
          <p style={{fontSize:13,color:"#888",margin:"0 0 24px"}}>Caulin & Luanna</p>
          <p style={{fontSize:13,color:"#666",marginBottom:24,lineHeight:1.6}}>Conecte sua conta Google para carregar e salvar os dados automaticamente na planilha.</p>
          {authStatus==="error"&&<p style={{fontSize:12,color:C.red600,marginBottom:12,background:C.red50,padding:"8px 12px",borderRadius:8}}>Erro ao conectar. Verifique as permissões e tente novamente.</p>}
          <button onClick={handleLogin} disabled={authStatus==="loading"} style={{width:"100%",padding:"12px",borderRadius:10,border:`1px solid ${C.teal100}`,background:C.teal600,color:"#fff",cursor:"pointer",fontSize:15,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {authStatus==="loading"?"Conectando...":"🔑 Entrar com Google"}
          </button>
        </div>
      </div>
    );
  }

  return(
    <div style={{minHeight:"100vh",background:"#f7f8fa",fontFamily:"system-ui,sans-serif"}}>
      {/* Topbar */}
      <div style={{background:C.teal600,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>📊</span>
          <div>
            <span style={{fontSize:15,fontWeight:600,color:"#fff"}}>Gestão Financeira</span>
            <span style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginLeft:8}}>Caulin & Luanna</span>
          </div>
          {syncStatus&&<span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.9)",marginLeft:8}}>{syncStatus}</span>}
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
          {MESES.map(m=>{
            const hasDados=mesesComDados.includes(m);
            const isActive=mesRef===m;
            return(
              <button key={m} onClick={()=>setMesRef(m)} style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:`1px solid ${isActive?"#fff":"rgba(255,255,255,0.25)"}`,background:isActive?"rgba(255,255,255,0.2)":"transparent",color:isActive?"#fff":"rgba(255,255,255,0.5)",cursor:"pointer",fontWeight:isActive?600:400,opacity:hasDados?1:0.4,position:"relative"}}>
                {m.substring(0,3)}
                {hasDados&&!isActive&&<span style={{position:"absolute",top:1,right:1,width:4,height:4,borderRadius:"50%",background:"rgba(255,255,255,0.8)"}}/>}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"24px 16px"}}>
        {/* Nav tabs */}
        <div style={{display:"flex",gap:4,background:"#fff",borderRadius:12,padding:4,marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
          {TABS.map((t,i)=>(
            <button key={t.l} onClick={()=>setTab(i)} style={{flex:1,fontSize:13,padding:"8px 4px",border:"none",borderRadius:8,background:tab===i?C.teal600:"transparent",color:tab===i?"#fff":"#888",cursor:"pointer",fontWeight:tab===i?600:400,display:"flex",alignItems:"center",justifyContent:"center",gap:5,transition:"all 0.15s"}}>
              <span>{t.i}</span>{t.l}
            </button>
          ))}
        </div>

        {/* FATURA */}
        {tab===0&&(
          <div>
            <div style={{display:"flex",gap:0,marginBottom:16}}>
              {["📥 Importar CSV","✏️ Lançar manualmente"].map((t,i)=>(
                <button key={t} onClick={()=>setFaturaTab(i)} style={{fontSize:12,padding:"6px 16px",border:`1px solid ${faturaTab===i?C.teal600:"#e0e0e0"}`,borderRadius:i===0?"8px 0 0 8px":"0 8px 8px 0",background:faturaTab===i?C.teal50:"#f8f8f8",color:faturaTab===i?C.teal600:"#888",cursor:"pointer",fontWeight:faturaTab===i?600:400}}>
                  {t}
                </button>
              ))}
            </div>

            {faturaTab===0&&(
              <div>
                <div style={card}>
                  <p style={{fontSize:13,color:"#666",marginBottom:10}}>Importando para <strong>{mesRef}</strong> — CSV Itaú (separador <code>;</code> ou <code>,</code>).</p>
                  <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                    <Btn onClick={()=>fileRef.current.click()}>📁 Importar arquivo</Btn>
                    <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{setCsvRaw(ev.target.result);setCsvError("");};r.readAsText(f,"utf-8");}}/>
                    {fatura.length>0&&!faturaLixo&&<Btn danger small onClick={()=>{setFaturaLixo(fatura);withSync(setFatura,"fatura")([]);}}>🗑 Limpar fatura</Btn>}
                    {faturaLixo&&<Btn small onClick={()=>{withSync(setFatura,"fatura")(faturaLixo);setFaturaLixo(null);}} style={{color:C.amber600,borderColor:C.amber600,background:C.amber50}}>↩ Desfazer</Btn>}
                  </div>
                  <textarea value={csvRaw} onChange={e=>{setCsvRaw(e.target.value);setCsvError("");}} placeholder={"data;lançamento;valor\n05/05/2026;AMAZON PRIME;39,90"} style={{...inp,height:90,resize:"vertical",fontFamily:"monospace",fontSize:12}}/>
                  {csvError&&<p style={{fontSize:12,color:C.red600,marginTop:6,background:C.red50,padding:"6px 10px",borderRadius:6}}>{csvError}</p>}
                  <div style={{marginTop:10}}><Btn active onClick={parseCSV}>⚡ Processar fatura</Btn></div>
                </div>
                {fatura.length>0&&(
                  <div style={card}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:14,fontWeight:600}}>{fatura.length} transações</span>
                        {newCount>0&&<Badge color="new">{newCount} para revisar</Badge>}
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {filtros.map(f=>(
                          <button key={f} onClick={()=>setFiltro(f)} style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:`1px solid ${filtro===f?C.teal600:"#e0e0e0"}`,background:filtro===f?C.teal50:"transparent",color:filtro===f?C.teal600:"#888",cursor:"pointer",fontWeight:filtro===f?600:400}}>
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:520}}>
                        <thead><tr style={{background:"#fafafa"}}>{["Data","Descrição","Valor","Dono","Parcelas","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {faturaFilt.map(r=>(
                            <tr key={r.id} style={{background:r.isNew?"#fffbf0":"#fff"}}>
                              <td style={{...td,color:"#999"}}>{r.data}</td>
                              <td style={td}><div style={{fontWeight:500}}>{r.nome}</div>{r.parcela&&<div style={{fontSize:10,color:"#aaa"}}>{r.parcela}</div>}</td>
                              <td style={{...td,fontWeight:600}}>{fmtBRL(r.valor)}</td>
                              <td style={td}><select value={r.dono} onChange={e=>updF(r.id,"dono",e.target.value)} style={{...sel,width:85}}><option value="">—</option>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                              <td style={td}><select value={r.parcelas} onChange={e=>updF(r.id,"parcelas",e.target.value)} style={{...sel,width:95}}>{PARC_OPTS.map(d=><option key={d}>{d}</option>)}</select></td>
                              <td style={td}><input value={r.obs} onChange={e=>updF(r.id,"obs",e.target.value)} style={{...inp,width:85}}/></td>
                              <td style={td}><div style={{display:"flex",gap:4}}>
                                {r.isNew&&<Btn small onClick={()=>learnRow(r)} style={{color:C.green600,borderColor:"#c8e6c9",background:C.green50}}>Aprender</Btn>}
                                <Btn danger small onClick={()=>rmF(r.id)}>✕</Btn>
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
                  <div><span style={{fontSize:14,fontWeight:600}}>Outros cartões</span><span style={{fontSize:12,color:"#aaa",marginLeft:8}}>{mesRef}</span></div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                    <Btn active small onClick={addM}>+ Adicionar</Btn>
                  </div>
                </div>
                {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
                {manual.length===0
                  ?<div style={{textAlign:"center",padding:"2rem 0",color:"#ccc"}}><div style={{fontSize:36,marginBottom:8}}>💳</div><p style={{fontSize:13}}>Nenhum lançamento. Clique em "+ Adicionar".</p></div>
                  :<div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:540}}>
                    <thead><tr style={{background:"#fafafa"}}>{["Data","Descrição","Valor","Cartão","Dono","Parcelas","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{manual.map(r=>(
                      <tr key={r.id}>
                        <td style={td}><input value={r.data} onChange={e=>updM(r.id,"data",e.target.value)} placeholder="dd/mm" style={{...inp,width:65}}/></td>
                        <td style={td}><input value={r.nome} onChange={e=>updM(r.id,"nome",e.target.value)} placeholder="Descrição" style={{...inp,width:110}}/></td>
                        <td style={td}><input value={r.valor||""} onChange={e=>updM(r.id,"valor",parseFloat(e.target.value)||0)} type="number" style={{...inp,width:70}}/></td>
                        <td style={td}><input value={r.cartao} onChange={e=>updM(r.id,"cartao",e.target.value)} placeholder="Nubank…" style={{...inp,width:80}}/></td>
                        <td style={td}><select value={r.dono} onChange={e=>updM(r.id,"dono",e.target.value)} style={{...sel,width:82}}>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                        <td style={td}><select value={r.parcelas} onChange={e=>updM(r.id,"parcelas",e.target.value)} style={{...sel,width:90}}>{PARC_OPTS.map(d=><option key={d}>{d}</option>)}</select></td>
                        <td style={td}><input value={r.obs} onChange={e=>updM(r.id,"obs",e.target.value)} style={{...inp,width:80}}/></td>
                        <td style={td}><Btn danger small onClick={()=>rmM(r.id)}>✕</Btn></td>
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
              <div><span style={{fontSize:14,fontWeight:600}}>Contas e renda</span><span style={{fontSize:12,color:"#aaa",marginLeft:8}}>{mesRef}</span></div>
              <div style={{display:"flex",gap:6}}>
                <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                <Btn active small onClick={addC}>+ Adicionar</Btn>
              </div>
            </div>
            {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
            {contas.length===0
              ?<div style={{textAlign:"center",padding:"2rem 0",color:"#ccc"}}><div style={{fontSize:36,marginBottom:8}}>🏠</div><p style={{fontSize:13}}>Nenhuma conta.</p></div>
              :<div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:440}}>
                <thead><tr style={{background:"#fafafa"}}>{["Transação","Valor (R$)","Dono","Tipo","Obs",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{contas.map(r=>(
                  <tr key={r.id}>
                    <td style={td}><input value={r.transacao} onChange={e=>updC(r.id,"transacao",e.target.value)} style={{...inp,width:140}}/></td>
                    <td style={td}><input value={r.valor} onChange={e=>updC(r.id,"valor",e.target.value)} placeholder="0,00" style={{...inp,width:85}}/></td>
                    <td style={td}><select value={r.dono} onChange={e=>updC(r.id,"dono",e.target.value)} style={{...sel,width:85}}>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                    <td style={td}><select value={r.tipo} onChange={e=>updC(r.id,"tipo",e.target.value)} style={{...sel,width:115}}>{TIPOS_CONTA.map(d=><option key={d}>{d}</option>)}</select></td>
                    <td style={td}><input value={r.obs} onChange={e=>updC(r.id,"obs",e.target.value)} style={{...inp,width:95}}/></td>
                    <td style={td}><Btn danger small onClick={()=>rmC(r.id)}>✕</Btn></td>
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
              <div><span style={{fontSize:14,fontWeight:600}}>Investimentos</span><span style={{fontSize:12,color:"#aaa",marginLeft:8}}>{mesRef}</span></div>
              <div style={{display:"flex",gap:6}}>
                <Btn small onClick={()=>setShowCopy(true)}>📋 Copiar mês anterior</Btn>
                <Btn active small onClick={addI}>+ Adicionar</Btn>
              </div>
            </div>
            {showCopy&&<Modal onClose={()=>setShowCopy(false)}><CopyMesModal dadosMes={dadosMes} mesRef={mesRef} onClose={()=>setShowCopy(false)} onImport={handleCopyImport}/></Modal>}
            {invest.length===0
              ?<div style={{textAlign:"center",padding:"2rem 0",color:"#ccc"}}><div style={{fontSize:36,marginBottom:8}}>📈</div><p style={{fontSize:13}}>Nenhum investimento.</p></div>
              :<table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                <thead><tr style={{background:"#fafafa"}}>{["Descrição","Valor (R$)","Dono","Onde",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{invest.map(r=>(
                  <tr key={r.id}>
                    <td style={td}><input value={r.descricao} onChange={e=>updI(r.id,"descricao",e.target.value)} style={{...inp,width:140}}/></td>
                    <td style={td}><input value={r.valor} onChange={e=>updI(r.id,"valor",e.target.value)} placeholder="0,00" style={{...inp,width:85}}/></td>
                    <td style={td}><select value={r.dono} onChange={e=>updI(r.id,"dono",e.target.value)} style={{...sel,width:85}}>{DONOS.map(d=><option key={d}>{d}</option>)}</select></td>
                    <td style={td}><input value={r.obs} onChange={e=>updI(r.id,"obs",e.target.value)} placeholder="CDB, Tesouro…" style={{...inp,width:130}}/></td>
                    <td style={td}><Btn danger small onClick={()=>rmI(r.id)}>✕</Btn></td>
                  </tr>
                ))}</tbody>
              </table>
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
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderTop:"1px solid #f5f5f5"}}>
                <input type="checkbox" checked={isPago} onChange={()=>togglePago(id)} style={{flexShrink:0,cursor:"pointer",accentColor:C.teal600,width:15,height:15}}/>
                <span onClick={onClick} style={{flex:1,fontSize:13,textDecoration:isPago?"line-through":"none",color:isPago?"#bbb":"#333",cursor:onClick?"pointer":"default",userSelect:"none"}}>
                  {label}{sub&&<span style={{fontSize:11,color:"#bbb",marginLeft:5}}>{sub}</span>}
                  {onClick&&<span style={{fontSize:11,color:"#ccc",marginLeft:4}}>›</span>}
                </span>
                <span style={{fontSize:13,fontWeight:600,color:isPago?"#ccc":"#333",whiteSpace:"nowrap"}}>{fmtBRL(valor)}</span>
              </div>
            );
          };

          return(
            <div>
              {modal&&(
                <Modal onClose={()=>setModal(null)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <h3 style={{fontSize:14,fontWeight:600,margin:0}}>{modal.title}</h3>
                    <button onClick={()=>setModal(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#aaa",fontSize:20}}>✕</button>
                  </div>
                  {modal.rows.map(r=>{
                    const v=vPessoa(r.valor,r.dono,modal.pessoa);
                    return(
                      <div key={r.id} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"7px 0",borderTop:"1px solid #f5f5f5"}}>
                        <span style={{flex:1,color:"#333"}}>{r.nome||r.transacao}{r.parcela?" "+r.parcela:""}{r.obs&&<span style={{color:"#aaa",marginLeft:6}}>— {r.obs}</span>}</span>
                        <span style={{fontWeight:600,marginLeft:12}}>{fmtBRL(v)}</span>
                      </div>
                    );
                  })}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:600,borderTop:`2px solid ${C.teal100}`,paddingTop:10,marginTop:6,color:C.teal600}}>
                    <span>Total</span><span>{fmtBRL(modal.rows.reduce((a,r)=>a+vPessoa(r.valor,r.dono,modal.pessoa),0))}</span>
                  </div>
                </Modal>
              )}

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:20}}>
                <MetricCard label="Renda total" value={fmtBRL(rendaTotal)} sub={`C: ${fmtBRL(rendaCaulin)}`} accent="teal" icon="💰"/>
                <MetricCard label="Despesas Caulin" value={fmtBRL(despCaulin)} accent="red" icon="📉"/>
                <MetricCard label="Despesas Luanna" value={fmtBRL(despLuanna)} accent="purple" icon="📉"/>
                <MetricCard label="Saldo Caulin" value={fmtBRL(saldoCaulin)} sub="após pagamentos" accent={saldoCaulin>=0?"green":"red"} icon="💵"/>
                {totalFaturaCartoes.map(({nome,total,pagos})=>{
                  const pct=total>0?Math.round((pagos/total)*100):0;
                  return(
                    <div key={nome} style={{background:C.blue50,border:"1px solid #bbdefb",borderRadius:12,padding:"1rem"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                        <span style={{fontSize:14}}>💳</span>
                        <span style={{fontSize:10,color:C.blue600,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>{nome}</span>
                      </div>
                      <div style={{fontSize:22,fontWeight:600,color:C.blue600}}>{fmtBRL(total)}</div>
                      <div style={{margin:"8px 0"}}><ProgressBar pct={pct} color={C.blue600}/></div>
                      <div style={{fontSize:10,color:C.blue600,opacity:0.7}}>{pct}% pago</div>
                    </div>
                  );
                })}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {["Caulin","Luanna"].map(pessoa=>{
                  const accent=pessoa==="Caulin"?{bg:C.teal50,color:C.teal600,border:C.teal100}:{bg:C.purple50,color:C.purple600,border:"#d1c4e9"};
                  return(
                    <div key={pessoa} style={card}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${accent.border}`}}>
                        <div style={{width:34,height:34,borderRadius:"50%",background:accent.bg,border:`1px solid ${accent.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:accent.color}}>{pessoa.charAt(0)}</div>
                        <div><div style={{fontSize:14,fontWeight:600,color:"#1a1a1a"}}>{pessoa}</div><div style={{fontSize:11,color:"#aaa"}}>{mesRef}</div></div>
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
                        if(!hasAny)return null;
                        return(
                          <div key={nome} style={{marginBottom:4}}>
                            <div style={{fontSize:11,color:"#aaa",padding:"6px 0 2px",fontWeight:600}}>{nome}</div>
                            {[{key:`fixos-${nome}-${pessoa}`,label:"Fixos",rows:fixos},{key:`parc-${nome}-${pessoa}`,label:"Parcelados",rows:parcelados},{key:`var-${nome}-${pessoa}`,label:"Variáveis",rows:variaveis}].map(g=>{
                              const gRows=g.rows.filter(r=>vPessoa(r.valor,r.dono,pessoa)>0);
                              if(!gRows.length)return null;
                              const gTotal=gRows.reduce((a,r)=>a+vPessoa(r.valor,r.dono,pessoa),0);
                              const gPago=!!pago[g.key];
                              return(
                                <div key={g.key} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderTop:"1px solid #f5f5f5"}}>
                                  <input type="checkbox" checked={gPago} onChange={()=>{togglePago(g.key);gRows.forEach(r=>setPago(p=>({...p,[r.id]:!gPago})));}} style={{flexShrink:0,cursor:"pointer",accentColor:C.teal600,width:15,height:15}}/>
                                  <span onClick={()=>setModal({title:`${nome} — ${g.label} (${pessoa})`,rows:gRows,pessoa})} style={{flex:1,fontSize:13,fontWeight:500,textDecoration:gPago?"line-through":"none",color:gPago?"#bbb":accent.color,cursor:"pointer",userSelect:"none"}}>
                                    {g.label} <span style={{fontSize:11,color:"#ccc"}}>›</span>
                                  </span>
                                  <span style={{fontSize:13,fontWeight:600,color:gPago?"#ccc":"#333"}}>{fmtBRL(gTotal)}</span>
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

              <button onClick={()=>{
                const{rendaCaulin,rendaLuanna,despCaulin,despLuanna,saldoCaulin,totalFaturaCartoes}=calcChecklist();
                const txt=[`📊 CHECK LIST — ${mesRef}`,"",`💰 Renda total → ${fmtBRL(rendaCaulin+rendaLuanna)}`,`   Caulin: ${fmtBRL(rendaCaulin)} · Luanna: ${fmtBRL(rendaLuanna)}`,"",`📉 Despesas`,`   Caulin: ${fmtBRL(despCaulin)} · Luanna: ${fmtBRL(despLuanna)}`,"",`💵 Saldo Caulin → ${fmtBRL(saldoCaulin)}`,"",`💳 Faturas`,...totalFaturaCartoes.map(c=>`   ${c.nome}: ${fmtBRL(c.total)}`)].join("\n");
                navigator.clipboard.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
              }} style={{width:"100%",marginTop:16,padding:"12px",borderRadius:10,border:`1px solid ${C.teal600}`,background:copied?C.teal600:C.teal50,color:copied?"#fff":C.teal600,cursor:"pointer",fontSize:14,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all 0.2s"}}>
                {copied?"✅ Copiado!":"📱 Copiar resumo para WhatsApp"}
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}