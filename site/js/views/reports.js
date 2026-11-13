// Wakabi Performance Center — Écran : reports
"use strict";
// ---------- Rapports (mêmes calculs que les écrans ; impression PDF ; export CSV protégé contre les formules) ----------
const REPORT_TYPES={week:"Hebdomadaire",month:"Mensuel",campaign:"Campagne",custom:"Période libre"};
let repState={type:"month",ref:"",from:"",to:"",campaign:"",platform:"",country:""};
function reportSpec(){
 const t=todayIn(me.country||"Togo"),r=repState;
 if(r.type==="week"){const ws=/^\d{4}-\d{2}-\d{2}$/.test(r.ref)?weekStart(r.ref):addDays(weekStart(t),-7),we=addDays(ws,6);
  return {start:ws,end:we>t?t:we,prevStart:addDays(ws,-7),prevEnd:addDays(we>t?t:we,-7),label:`Semaine du ${frDate(ws)} au ${frDate(we)}${we>t?" (en cours)":""}`,prevLabel:"semaine précédente"}}
 if(r.type==="month"){const m=/^\d{4}-\d{2}$/.test(r.ref)?r.ref:shiftMonth(t.slice(0,7),-1),b=monthBounds(m),pb=monthBounds(shiftMonth(m,-1)),end=b.end>t?t:b.end,pe=addDays(pb.start,daysBetween(b.start,end));
  return {start:b.start,end,prevStart:pb.start,prevEnd:pe<pb.end?pe:pb.end,label:monthLabel(m+"-01")+(b.end>t?" (en cours)":""),prevLabel:monthLabel(shiftMonth(m,-1)+"-01")+(b.end>t?" (mêmes jours)":"")}}
 if(r.type==="campaign"){const c=(data.campaigns||[]).find(x=>x.id===r.campaign);if(!c)return {need:"Choisissez une campagne pour produire le rapport."};
  if(c.start_date){const end=c.end_date&&c.end_date<t?c.end_date:t;return {start:c.start_date,end,campaign:c.id,label:`Campagne « ${c.name} » · ${frDate(c.start_date)} → ${frDate(end)}`}}
  return {start:null,end:null,campaign:c.id,label:`Campagne « ${c.name} » · toute la période`}}
 if(!r.from||!r.to||r.to<r.from)return {need:"Choisissez une date de début et une date de fin (la fin après le début)."};
 const n=daysBetween(r.from,r.to)+1;return {start:r.from,end:r.to,prevStart:addDays(r.from,-n),prevEnd:addDays(r.from,-1),label:`Du ${frDate(r.from)} au ${frDate(r.to)}`,prevLabel:`${n} jours précédents`};
}
function reportData(spec){
 const base={...EMPTY_FILTERS,platform:repState.platform,country:repState.country,campaign:spec.campaign||""};
 const res=applyFilters(spec.start?{...base,period:"custom",from:spec.start,to:spec.end}:base,filterCtx());
 const prev=spec.prevStart?applyFilters({...base,period:"custom",from:spec.prevStart,to:spec.prevEnd},filterCtx()):null;
 return {res,prev,s:statsOf(res.pubs),p:prev?statsOf(prev.pubs):null};
}
function reports(){
 setHead("Rapports","Les mêmes chiffres que les écrans, à imprimer ou exporter");
 const r=repState,t=todayIn(me.country||"Togo"),spec=reportSpec(),sel=(k,v)=>v===r[k]?" selected":"";
 const curWeek=/^\d{4}-\d{2}-\d{2}$/.test(r.ref)?weekStart(r.ref):addDays(weekStart(t),-7),curMonth=/^\d{4}-\d{2}$/.test(r.ref)?r.ref:shiftMonth(t.slice(0,7),-1);
 const weeks=[...Array(13)].map((_,i)=>addDays(weekStart(t),-7*i)),months=[...Array(13)].map((_,i)=>shiftMonth(t.slice(0,7),-i));
 const controls=`<section class="filters no-print" aria-label="Choix du rapport"><div class="filters-row">
  <label class="fld"><span>Rapport</span><select id="r_type" data-rep="type">${Object.entries(REPORT_TYPES).map(([k,l])=>`<option value="${k}"${sel("type",k)}>${l}</option>`).join("")}</select></label>
  ${r.type==="week"?`<label class="fld wide"><span>Semaine</span><select id="r_ref" data-rep="ref">${weeks.map(w=>`<option value="${w}"${w===curWeek?" selected":""}>du ${frDate(w)} au ${frDate(addDays(w,6))}</option>`).join("")}</select></label>`:""}
  ${r.type==="month"?`<label class="fld"><span>Mois</span><select id="r_ref" data-rep="ref">${months.map(m=>`<option value="${m}"${m===curMonth?" selected":""}>${monthLabel(m+"-01")}</option>`).join("")}</select></label>`:""}
  ${r.type==="campaign"?`<label class="fld wide"><span>Campagne</span><select id="r_campaign" data-rep="campaign"><option value="">Choisir…</option>${(data.campaigns||[]).filter(c=>c.status!=="archived"||c.id===r.campaign).map(c=>`<option value="${c.id}"${sel("campaign",c.id)}>${esc(c.name)}</option>`).join("")}</select></label>`:""}
  ${r.type==="custom"?`<label class="fld"><span>Du</span><input id="r_from" type="date" data-rep="from" value="${esc(r.from)}"></label><label class="fld"><span>Au</span><input id="r_to" type="date" data-rep="to" value="${esc(r.to)}"></label>`:""}
  <label class="fld"><span>Plateforme</span><select id="r_platform" data-rep="platform"><option value="">Toutes</option>${data.platforms.filter(f=>f.status!=="archived"||f.id===r.platform).map(f=>`<option value="${f.id}"${sel("platform",f.id)}>${esc(f.name)}</option>`).join("")}</select></label>
  <label class="fld"><span>Pays</span><select id="r_country" data-rep="country"><option value="">Tous</option>${COUNTRIES.map(c=>`<option${sel("country",c)}>${c}</option>`).join("")}</select></label>
 </div><div class="filters-foot"><span class="count">Relevé de référence : ${REF_LABEL[refType]}</span><span class="report-actions"><button type="button" class="btn ghost sm" data-act="export-csv"${spec.need?" disabled":""}>${icon("download",16)}Export CSV (Excel)</button><button type="button" class="btn ghost sm" data-act="print"${spec.need?" disabled":""}>${icon("printer",16)}Imprimer / PDF</button></span></div></section>`;
 if(spec.need){$("#page").innerHTML=`${pageBar(refSwitch())}${controls}<section class="card">${emptyState(spec.need,"reports")}</section>`;return}
 const {res,prev,s,p}=reportData(spec),cMap=new Map(data.contents.map(c=>[c.id,c])),lbl=prev?`vs ${spec.prevLabel}`:"";
 const planned=res.contents.filter(c=>!spec.start||inRange(c.publish_date,spec.start,spec.end)),withLink=planned.filter(c=>pubsFor(c.id).length).length;
 const st=res.pubs.map(x=>{const c=cMap.get(x.content_id);return {j1:rstate(x,c,"j1"),j7:rstate(x,c,"j7")}}),cnt=(k,v)=>st.filter(x=>x[k]===v).length;
 const j7due=st.filter(x=>x.j7!=="upcoming").length,j7done=st.filter(x=>isDone(x.j7)).length;
 const crit=[repState.platform?(data.platforms.find(f=>f.id===repState.platform)||{}).name:"toutes plateformes",repState.country||"tous pays"].join(" · ");
 const appMonths=spec.start?(()=>{const out=[];for(let m=spec.start.slice(0,7);m<=spec.end.slice(0,7);m=shiftMonth(m,1))out.push(m+"-01");return out})():[];
 const appRows=appMonths.map(m=>({m,rs:data.appKpis.filter(x=>x.month===m&&(!repState.country||x.country===repState.country))})).filter(x=>x.rs.length);
 const ranked=rankContents(res).sort((a,b)=>b.s.views-a.s.views);
 $("#page").innerHTML=`${pageBar(refSwitch())}${controls}
 <article class="report" aria-label="Rapport">
  <header class="report-head"><div><p class="eyebrow">Rapport ${REPORT_TYPES[r.type].toLowerCase()} · Wakabi Performance Center</p><h2>${esc(spec.label)}</h2>
  <p class="meta">${esc(crit)} · relevé de référence ${REF_LABEL[refType]}${prev?` · comparaison : ${esc(spec.prevLabel)}`:""} · généré le ${frDate(t)} par ${esc(me.full_name||me.email||"")}</p></div></header>
  ${trendTiles(s,p,{label:lbl})}
  <div class="grid two">
   ${card("Production et mesure",`<dl class="defs compact">
    <dt>Contenus prévus</dt><dd>${fmt(planned.length)} <span class="meta">dont ${fmt(withLink)} avec au moins un lien</span></dd>
    <dt>Publications</dt><dd>${fmt(res.pubs.length)} <span class="meta">datées par la date effective, sinon prévue</span></dd>
    <dt>J+1</dt><dd>${fmt(cnt("j1","done"))} à temps · ${fmt(cnt("j1","done_late"))} en retard · ${fmt(cnt("j1","missed"))} manqués · ${fmt(cnt("j1","due")+cnt("j1","late"))} à saisir</dd>
    <dt>J+7</dt><dd>${fmt(j7done)} saisis sur ${fmt(j7due)} attendus${j7due>j7done?` <span class="meta">(${plural(j7due-j7done,"manquant")})</span>`:""}</dd></dl>`)}
   ${card("Par plateforme",platformTable(res,prev),{cls:"flush-body"})}
  </div>
  ${card("Par rubrique",groupTable(res,"rubrique"),{cls:"flush-body"})}
  ${card("Contenus",ranked.length?`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Contenus de la période</caption><thead><tr><th scope="col" class="num">#</th><th scope="col">Contenu</th><th scope="col">Pays</th><th scope="col">Rubrique</th><th scope="col" class="num">Mesurées</th><th scope="col" class="num">Vues</th><th scope="col" class="num">Interactions</th><th scope="col" class="num">Taux</th></tr></thead><tbody>${ranked.map((x,i)=>`<tr><td class="num" data-label="Rang">${i+1}</td><td class="title-cell" data-label="Contenu">${esc(x.c.title)}${x.c.archived_at?` <span class="badge neutral">Archivé</span>`:""}</td><td data-label="Pays">${esc(x.c.country)}</td><td data-label="Rubrique">${esc(x.c.rubrique||"—")}</td><td class="num" data-label="Mesurées">${fmt(x.s.n)} / ${fmt((res.byContent.get(x.c.id)||[]).length)}</td><td class="num" data-label="Vues">${fmt(x.s.views)}</td><td class="num" data-label="Interactions">${fmt(x.s.interactions)}</td><td class="num" data-label="Taux">${pctv(x.s.rate)}</td></tr>`).join("")}</tbody></table></div>`:emptyState("Aucune publication mesurée sur la période.","analytics"),{cls:"flush-body",sub:"Classés par vues"})}
  ${appRows.length?card("Application Wakabi",`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">KPI de l’application</caption><thead><tr><th scope="col">Mois</th><th scope="col" class="num">Téléchargements</th><th scope="col" class="num">Inscriptions</th><th scope="col" class="num">Utilisateurs actifs</th><th scope="col" class="num">Désinstallations</th></tr></thead><tbody>${appRows.map(x=>`<tr><th scope="row" data-label="Mois">${esc(monthLabel(x.m))}</th>${["downloads","signups","active_users","uninstalls"].map((k,i)=>`<td class="num" data-label="${["Téléchargements","Inscriptions","Utilisateurs actifs","Désinstallations"][i]}">${fmt(sum(x.rs.map(y=>y[k])))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,{cls:"flush-body",sub:`${esc(repState.country||"Togo + Bénin")} · mois entiers`}):""}
  <p class="foot-note">Taux d’interaction = (likes + commentaires + partages) ÷ vues ; taux d’un ensemble pondéré (somme des interactions ÷ somme des vues). Republications et enregistrements hors taux. Une somme de vues sur plusieurs plateformes est un volume de vues, pas un nombre de personnes. Chiffres calculés avec les mêmes règles que les écrans de l’application.</p>
 </article>`;
}
function exportReportCsv(){
 const spec=reportSpec();if(spec.need)return;
 const {res}=reportData(spec),cMap=new Map(data.contents.map(c=>[c.id,c])),s=statsOf(res.pubs);
 const head=["Contenu","Pays","Rubrique","Type","Campagne","Objectif","Plateforme","Lien","Date de publication","Date estimée","Relevé de référence","Date du relevé","Vues","Likes","Commentaires","Partages","Interactions","Taux d'interaction (%)","Republications","Enregistrements","Contenu archivé"];
 const num=v=>v==null||v===""?null:Number(v);
 const rows=res.pubs.map(p=>{const c=cMap.get(p.content_id),r=refReading(p),v=r?num(r.views):null,it=r?interactionsOf(r):null;
  return [c.title,c.country,c.rubrique||"",nameOf("content_types",c.content_type_id)||"",nameOf("campaigns",c.campaign_id)||"",nameOf("content_objectives",c.objective_id)||"",platformName(p),p.url||"",basisDate(p,c),p.published_on?"non":"oui",REF_LABEL[refType],r?.measured_on||"",v,r?num(r.likes):null,r?num(r.comments):null,r?num(r.shares):null,it,v>0?Math.round(it/v*1e4)/100:null,r?num(r.reposts):null,r?num(r.saves):null,c.archived_at?"oui":"non"]});
 rows.push([],["Total (taux pondéré)","","","","","","","","","","",`${s.n} publication(s) mesurée(s) sur ${res.pubs.length}`,s.n?s.views:null,s.n?s.likes:null,s.n?s.comments:null,s.n?s.shares:null,s.n?s.interactions:null,s.rate==null?null:Math.round(s.rate*1e4)/100,s.reposts,s.saves,""]);
 rows.unshift([`Wakabi Performance Center — Rapport ${REPORT_TYPES[repState.type].toLowerCase()} — ${spec.label}`],[]);
 const url=URL.createObjectURL(new Blob([toCsv([...rows.slice(0,2),head,...rows.slice(2)])],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");
 a.href=url;a.download=`wakabi_rapport_${repState.type}_${spec.start||"campagne"}${spec.end?"_"+spec.end:""}.csv`;document.body.appendChild(a);a.click();
 setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},1000);toast("Fichier CSV téléchargé : séparateur « ; », s’ouvre dans Excel.");
}
