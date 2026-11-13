// Wakabi Performance Center — Briques d'affichage : tuiles, évolutions, badges, cartes, barres, états vides.
"use strict";
// ---------- Briques d'affichage ----------
// Repères internes (documentés dans le Guide, présentés comme des repères et non comme des métriques officielles).
const MIN_VIEWS_RANK=100;      // un contenu n'entre dans « ce qui marche / à surveiller » qu'à partir de 100 vues
const UNINSTALL_ALERT=0.25;    // désinstallations > 25 % des téléchargements du mois : signalé
const platformName=p=>(data.platforms.find(f=>f.id===p.platform_id)||{}).name||p.platform;
const platformIdOf=p=>p.platform_id||(data.platforms.find(f=>f.code===p.platform)||{}).id||null;
const effList=pid=>(data.effByPub&&data.effByPub.get(pid))||[];
// Relevé de référence d'une publication ; en mode dégradé, seul l'ancien J+7 (table metrics) existe.
function refReading(p,ref=refType){
 if(!data.readingsOk)return ref==="j1"?null:data.metrics.find(m=>m.publication_id===p.id&&m.snapshot==="j7")||null;
 return referenceReading(effList(p.id),ref);
}
function statsOf(pubs,ref=refType){const a=aggregate(pubs.map(p=>refReading(p,ref)));a.N=pubs.length;return a}
const ND=`<span class="nd" title="Non disponible">N/D</span>`;
const nd=(v,f=compact)=>v==null?ND:f(v);
const pctv=r=>r==null?`<span class="nd" title="Non disponible : aucune vue">N/D</span>`:pct(r);
const plural=(n,s,p=s+"s")=>`${fmt(n)} ${n>1?p:s}`;
function deltaHtml(prev,cur,{rate=false,label="vs période précédente",upGood=true}={}){
 const ev=evolution(prev,cur);
 if(!ev)return `<div class="delta flat"><span>${label} : N/D</span></div>`;
 const dir=ev.abs>0?"up":ev.abs<0?"down":"flat",good=dir==="flat"?"flat":(dir==="up")===upGood?"good":"bad";
 const sign=ev.abs>0?"+":ev.abs<0?"−":"±";
 const txt=rate?`${sign}${Math.abs(ev.abs*100).toFixed(1).replace(".",",")} pt`:ev.rel!=null?`${sign}${Math.abs(ev.rel*100).toFixed(0)} %`:`${sign}${compact(Math.abs(ev.abs))}`;
 const title=rate?`${pct(prev)} → ${pct(cur)}`:`${fmt(prev)} → ${fmt(cur)}`;
 return `<div class="delta ${good}" title="${esc(title)}">${dir==="flat"?"":icon(dir,14)}<span class="delta-val">${txt}</span><span class="delta-label">${label}</span></div>`;
}
// Tuile d'indicateur : libellé · valeur · précision (unité, période) · évolution signée.
function tile(label,value,{note="",delta="",tone=""}={}){
 const ic={bad:"alert",warn:"clock",good:"check"}[tone];
 return `<div class="kpi${tone?" tone-"+tone:""}"><div class="kpi-label">${ic?icon(ic,15):""}<span>${label}</span></div><div class="kpi-value">${value}</div>${note?`<div class="kpi-note">${note}</div>`:""}${delta}</div>`;
}
const statKpi=(l,v,n="")=>tile(l,v,{note:n});
const STATE={done:["Saisi","good","check"],done_late:["Saisi en retard","warn","clock"],due:["À saisir","bad","alert"],late:["En retard","bad","alert"],upcoming:["À venir","neutral","clock"],missed:["Manqué","bad","minus"],not_tracked:["Non suivi","neutral","minus"],unknown:["Indisponible","neutral","info"]};
function stateBadge(st,txt){const [l,t,i]=STATE[st]||["—","neutral","info"];return `<span class="badge ${t}">${icon(i,13)}${txt||l}</span>`}
function emptyState(text,ic="info",action=""){return `<div class="empty">${icon(ic,28)}<p>${text}</p>${action}</div>`}
function card(title,body,{action="",cls="",sub=""}={}){return `<section class="card ${cls}">${title||action||sub?`<div class="card-head"><div>${title?`<h2>${title}</h2>`:""}${sub?`<p class="card-sub">${sub}</p>`:""}</div>${action}</div>`:""}${body}</section>`}
function bars(items,{unit="vues"}={}){
 const rows=items.filter(x=>x.value!=null&&x.n!==0);if(!rows.length)return emptyState("Aucune publication mesurée pour ces filtres.","analytics");
 const mx=Math.max(1,...rows.map(x=>x.value)),tot=rows.reduce((a,x)=>a+x.value,0);
 return `<div class="bars" role="list">${rows.map(x=>{const share=tot?Math.round(x.value/tot*100):0,lab=`${x.label} : ${fmt(x.value)} ${unit}${tot?` (${share} % du total)`:""}${x.note?` · ${x.note}`:""}`;
  return `<div class="bar-row" role="listitem" title="${esc(lab)}" aria-label="${esc(lab)}"><span class="bar-label">${esc(x.label)}</span><span class="bar-area"><span class="bar-fill" style="width:${x.value?Math.max(1.5,x.value/mx*100):0}%"></span></span><span class="bar-value">${compact(x.value)}${x.note?`<small>${esc(x.note)}</small>`:""}</span></div>`}).join("")}</div>`;
}
const longDate=s=>{const t=new Date(s+"T12:00:00Z").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});return t[0].toUpperCase()+t.slice(1)};
const monthLabel=m=>m?new Date(m.slice(0,7)+"-15T12:00:00Z").toLocaleDateString("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}):"—";
const firstName=()=>String(me.full_name||"").trim().split(/\s+/)[0]||"";
function pageBar(left="",right=""){return left||right?`<div class="page-bar"><div class="page-bar-left">${left}</div><div class="page-bar-right">${right}</div></div>`:""}
