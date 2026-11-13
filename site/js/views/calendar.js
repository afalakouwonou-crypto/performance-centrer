// Wakabi Performance Center — Écran : calendar
"use strict";
// ---------- Calendrier éditorial (lecture seule : dates prévues, dates effectives, échéances des relevés) ----------
const CAL_MODES={month:"Mois",week:"Semaine",day:"Jour"};
const CAL_LAYERS={planned:"Prévus",published:"Publiés",due:"Relevés",tasks:"Tâches"};
const WEEKDAYS=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
let calState={mode:"",d:"",layers:{planned:true,published:true,due:true,tasks:true}};
const dayLabel=(s,opt={weekday:"long",day:"numeric",month:"long"})=>{const t=new Date(s+"T12:00:00Z").toLocaleDateString("fr-FR",{...opt,timeZone:"UTC"});return t[0].toUpperCase()+t.slice(1)};
const chunk=(a,n)=>{const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out};
function calItems(res,start,end){
 const m=new Map(),L=calState.layers,push=(day,it)=>{if(!day||day<start||day>end)return;if(!m.has(day))m.set(day,[]);m.get(day).push(it)};
 for(const c of res.contents){
  if(L.planned)push(c.publish_date,{kind:"planned",c,n:pubsFor(c.id).length,o:0});
  for(const p of res.byContent.get(c.id)||[]){
   if(L.published&&p.published_on)push(p.published_on,{kind:"published",c,p,o:1});
   if(L.due&&!c.archived_at)for(const type of ["j1","j7"]){const st=rstate(p,c,type);if(st!=="not_tracked"&&st!=="unknown")push(dueOf(p,c,type),{kind:"due",c,p,type,st,o:2})}
  }
 }
 if(L.tasks&&data.has09){const kept=new Set(res.contents.map(c=>c.id));for(const t of data.tasks||[]){if(t.status==="annule"||!kept.has(t.content_id))continue;const c=data.contents.find(x=>x.id===t.content_id);if(!c)continue;
  if(t.due_on)push(t.due_on,{kind:"task",c,t,o:3});if(t.shoot_on&&t.shoot_on!==t.due_on)push(t.shoot_on,{kind:"shoot",c,t,o:3})}}
 for(const l of m.values())l.sort((a,b)=>a.o-b.o||String(a.c.title).localeCompare(b.c.title,"fr"));
 return m;
}
function plannedTone(it){return it.n?"good":it.c.publish_date<todayIn(it.c.country)?"bad":"neutral"}
function calChip(it){
 if(it.kind==="task"||it.kind==="shoot"){const lt=lateTask(it.t),tone=it.t.status==="fait"?"good":lt?"bad":"warn";return `<button type="button" class="ev tone-${tone}" data-act="content" data-cid="${it.c.id}" title="${it.kind==="shoot"?"Tournage":TASK_KIND[it.t.kind]} · ${esc(personName(it.t.assignee))} — ${esc(it.c.title)}">${icon(it.kind==="shoot"?"calendar2":"tasks",13)}<span>${it.kind==="shoot"?"Tournage":esc(TASK_KIND[it.t.kind])} · ${esc(it.c.title)}</span></button>`}
 if(it.kind==="planned")return `<button type="button" class="ev tone-${plannedTone(it)}" data-act="content" data-cid="${it.c.id}" title="Prévu : ${esc(it.c.title)}${it.n?"":" (aucun lien)"}">${icon("calendar",13)}<span>${esc(it.c.title)}</span></button>`;
 if(it.kind==="published")return `<button type="button" class="ev tone-info" data-act="content" data-cid="${it.c.id}" title="Publié sur ${esc(platformName(it.p))} : ${esc(it.c.title)}">${icon("check",13)}<span>${esc(platformName(it.p))} · ${esc(it.c.title)}</span></button>`;
 const [l,t,i]=STATE[it.st]||["","neutral","info"];
 return `<button type="button" class="ev tone-${t}" data-act="content" data-cid="${it.c.id}" title="${TYPE_LABEL[it.type]} ${esc(platformName(it.p))} : ${l} — ${esc(it.c.title)}">${icon(i,13)}<span>${TYPE_LABEL[it.type]} ${esc(platformName(it.p))} · ${esc(it.c.title)}</span></button>`;
}
function dayRow(it){
 if(it.kind==="task"||it.kind==="shoot")return taskCard(it.t,{showWho:true});
 const link=`<button type="button" class="cell-link" data-act="content" data-cid="${it.c.id}">${esc(it.c.title)}</button>`;
 if(it.kind==="planned"){const t=plannedTone(it);return `<li class="row"><span class="badge ${t}">${icon("calendar",13)}${t==="bad"?"Prévu, sans lien":"Prévu"}</span><div class="row-main">${link}<span class="meta">${esc(it.c.country)} · ${esc(it.c.rubrique||"")} · ${it.n?plural(it.n,"lien"):"aucun lien"}</span></div></li>`}
 if(it.kind==="published")return `<li class="row"><span class="badge blue">${icon("check",13)}Publié</span><div class="row-main">${link}<span class="meta">${esc(platformName(it.p))}</span></div></li>`;
 const can=canMetric(it.p)&&["due","late"].includes(it.st)&&data.readingsOk;
 return `<li class="row">${stateBadge(it.st)}<div class="row-main">${link}<span class="meta">${TYPE_LABEL[it.type]} · ${esc(platformName(it.p))}${it.p.published_on?"":" · échéance estimée"}</span></div>${can?`<button type="button" class="btn sm primary" data-act="metric" data-pid="${it.p.id}" data-type="${it.type}">Saisir</button>`:""}</li>`;
}
function calendar(){
 setHead("Calendrier","Contenus prévus, publications et échéances des relevés");
 const t=todayIn(me.country||"Togo");
 if(!calState.d)calState.d=t;if(!calState.mode)calState.mode=matchMedia("(max-width:640px)").matches?"week":"month";
 const res=filtered({...filters,period:"all",from:"",to:""}),d=calState.d,mode=calState.mode;
 let start,end,title;
 if(mode==="month"){const b=monthBounds(d.slice(0,7));start=weekStart(b.start);end=addDays(weekStart(b.end),6);title=monthLabel(d.slice(0,7)+"-01")}
 else if(mode==="week"){start=weekStart(d);end=addDays(start,6);title=`Semaine du ${frDate(start)} au ${frDate(end)}`}
 else{start=end=d;title=dayLabel(d,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
 const items=calItems(res,start,end),days=[];for(let x=start;x<=end;x=addDays(x,1))days.push(x);
 const bar=`<div class="cal-bar"><div class="cal-nav"><button type="button" class="icon-btn" data-act="cal-step" data-step="-1" aria-label="Période précédente">${icon("left")}</button><button type="button" class="btn ghost sm" data-act="cal-today">Aujourd’hui</button><button type="button" class="icon-btn" data-act="cal-step" data-step="1" aria-label="Période suivante">${icon("chevron")}</button><h2 class="cal-title" aria-live="polite">${esc(title)}</h2></div>
  <div class="cal-tools"><div class="seg" role="group" aria-label="Affichage">${Object.entries(CAL_MODES).map(([k,l])=>`<button type="button" data-act="cal-mode" data-mode="${k}" aria-pressed="${k===mode}">${l}</button>`).join("")}</div>
  <div class="cal-layers" role="group" aria-label="Éléments affichés">${Object.entries(CAL_LAYERS).filter(([k])=>k!=="tasks"||data.has09).map(([k,l])=>`<label class="check"><input type="checkbox" data-cal-layer="${k}"${calState.layers[k]?" checked":""}> ${l}</label>`).join("")}</div></div></div>`;
 let body;
 if(mode==="month"){
  body=`<div class="cal-grid"><div class="cal-head" aria-hidden="true">${WEEKDAYS.map(w=>`<div><span class="wd-long">${w}</span><span class="wd-short">${w.slice(0,3)}.</span></div>`).join("")}</div>
  ${chunk(days,7).map(wk=>`<div class="cal-week">${wk.map(x=>{const l=items.get(x)||[];return `<div class="cal-cell${x.slice(0,7)===d.slice(0,7)?"":" out"}${x===t?" today":""}"><button type="button" class="cal-day" data-act="cal-day" data-d="${x}" aria-label="${esc(dayLabel(x))} : ${l.length} élément${l.length>1?"s":""}"><span>${+x.slice(8)}</span>${l.length?`<span class="cal-count">${l.length}</span>`:""}</button><div class="cal-evs">${l.slice(0,3).map(calChip).join("")}${l.length>3?`<button type="button" class="ev ev-more" data-act="cal-day" data-d="${x}">+ ${l.length-3} autre${l.length-3>1?"s":""}</button>`:""}</div></div>`}).join("")}</div>`).join("")}</div>`;
 }else if(mode==="week"){
  body=`<div class="cal-weekview">${days.map(x=>{const l=items.get(x)||[];return `<section class="cal-col${x===t?" today":""}" aria-label="${esc(dayLabel(x))}"><button type="button" class="cal-col-head" data-act="cal-day" data-d="${x}"><span>${esc(dayLabel(x,{weekday:"short"}))}</span><strong>${+x.slice(8)}</strong></button><div class="cal-evs">${l.map(calChip).join("")||`<span class="meta cal-empty">Rien</span>`}</div></section>`}).join("")}</div>`;
 }else{
  const l=items.get(d)||[];
  body=card("",l.length?`<ul class="rows">${l.map(dayRow).join("")}</ul>`:emptyState("Rien de prévu ce jour-là pour ces filtres.","calendar"));
 }
 $("#page").innerHTML=`${filterBar(res,{noPeriod:true})}${bar}${body}
 <div class="legend cal-legend" aria-label="Légende"><span class="ev tone-neutral">${icon("calendar",13)}Prévu</span><span class="ev tone-good">${icon("calendar",13)}Prévu, lien enregistré</span><span class="ev tone-bad">${icon("calendar",13)}Date passée, aucun lien</span><span class="ev tone-info">${icon("check",13)}Publié (date effective)</span><span class="ev tone-bad">${icon("alert",13)}Relevé à saisir ou en retard</span><span class="ev tone-good">${icon("check",13)}Relevé saisi</span><span class="ev tone-neutral">${icon("clock",13)}Relevé à venir</span>${data.has09?`<span class="ev tone-warn">${icon("tasks",13)}Tâche (échéance)</span><span class="ev tone-warn">${icon("calendar2",13)}Tournage</span>`:""}</div>`;
}
function calStep(n){const d=calState.d||todayIn(me.country||"Togo"),m=calState.mode;calState.d=m==="month"?shiftMonth(d.slice(0,7),n)+"-01":addDays(d,m==="week"?7*n:n);render("calendar")}
