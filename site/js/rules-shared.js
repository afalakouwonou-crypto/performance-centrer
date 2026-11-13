// Wakabi Performance Center — Règles métier partagées : droits d'affichage, relevés à saisir, tendances, classements, tableaux par plateforme.
"use strict";
// ---------- Règles métier partagées ----------
function pubStatus(p,c){const j7=rstate(p,c,"j7"),j1=rstate(p,c,"j1");
 if(isDone(j7))return ["J+7 saisi","good","check"];if(j7==="due"||j7==="late")return ["J+7 à saisir","bad","alert"];if(j1==="due"||j1==="late")return ["J+1 à saisir","bad","alert"];return ["En attente du J+7","neutral","clock"]}
function pubBadges(c,kept){const all=pubsFor(c.id);if(!all.length)return `<span class="meta">Aucun lien</span>`;
 return `<span class="pub-badges">${all.map(p=>{const [l,t,i]=pubStatus(p,c);return `<span class="badge ${t}${kept&&!kept.includes(p)?" dim":""}" title="${esc(platformName(p))} : ${l}">${icon(i,13)}${esc(platformName(p))}</span>`}).join("")}</span>`}
// Même règle que la base (wakabi_can_manage_platform) : la base reste seule juge, ceci ne sert qu'à l'affichage.
function canMetric(pub){return me.role==="admin"||me.role==="editor"||(me.role==="platform_manager"&&(me.platformIds?me.platformIds.includes(pub.platform_id):me.platform===pub.platform))}
function myScope(){
 if(me.role==="admin"||me.role==="editor")return "Toutes";
 if(me.role!=="platform_manager")return "Lecture seule";
 if(!me.platformIds)return me.platform||"Aucune";
 return data.platforms.filter(f=>me.platformIds.includes(f.id)).map(f=>f.name).join(", ")||"Aucune";
}
// Relevés à saisir maintenant (contenus non archivés) : ceux que l'utilisateur peut renseigner, ou toute l'équipe (all).
function tasks(all=false){
 const out=[];for(const c of data.contents.filter(x=>!x.archived_at))for(const p of pubsFor(c.id))if(all||canMetric(p))for(const type of ["j1","j7"]){
  const state=rstate(p,c,type);if(state==="due"||state==="late")out.push({c,p,type,state,due:dueOf(p,c,type)})}
 return out.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:0);
}
function upcomingTasks(days=7){
 const out=[];for(const c of data.contents.filter(x=>!x.archived_at))for(const p of pubsFor(c.id))if(canMetric(p))for(const type of ["j1","j7"]){
  const due=dueOf(p,c,type);if(rstate(p,c,type)==="upcoming"&&due<=addDays(todayIn(c.country),days))out.push({c,p,type,state:"upcoming",due})}
 return out.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:0);
}
const plannedToday=()=>data.contents.filter(c=>!c.archived_at&&c.publish_date===todayIn(c.country));
const lateToPublish=(days=30)=>data.contents.filter(c=>{const t=todayIn(c.country);return !c.archived_at&&c.publish_date<t&&c.publish_date>=addDays(t,-days)&&!pubsFor(c.id).length});
function ownersOf(platformId){return (data.assignments||[]).filter(a=>a.platform_id===platformId&&!a.revoked_at).map(a=>data.profiles.find(p=>p.id===a.profile_id)).filter(p=>p&&!p.archived_at&&p.active!==false).map(p=>p.full_name)}
function taskList(list,{showPlatform=true,showTitle=true,action=true}={}){
 return `<ul class="rows">${list.map(x=>`<li class="row"><div class="row-main">${showTitle?`<strong>${esc(x.c.title)}</strong>`:""}<span class="meta">${showPlatform?`${esc(platformName(x.p))} · `:""}${TYPE_LABEL[x.type]} · échéance ${frDate(x.due)}${x.p.published_on?"":" (estimée)"}</span></div>${stateBadge(x.state)}${action&&x.state!=="upcoming"?`<button type="button" class="btn sm primary" data-act="metric" data-pid="${x.p.id}" data-type="${x.type}">Saisir</button>`:""}</li>`).join("")}</ul>`;
}
// 30 derniers jours comparés aux 30 précédents (publications datées par leur date effective, sinon prévue).
function trend30(ref=refType){
 const f={...EMPTY_FILTERS,period:"30"},cur=applyFilters(f,filterCtx()),prev=applyFilters(previousPeriodFilters(f,cur.range),filterCtx());
 return {cur,prev,s:statsOf(cur.pubs,ref),p:statsOf(prev.pubs,ref)};
}
function rankContents(res,ref=refType){
 return res.contents.map(c=>({c,s:statsOf(res.byContent.get(c.id)||[],ref)})).filter(x=>x.s.n>0);
}
function topFlop(res){
 const ok=rankContents(res).filter(x=>x.s.views>=MIN_VIEWS_RANK&&x.s.rate!=null).sort((a,b)=>b.s.rate-a.s.rate);
 const top=ok.slice(0,3),flop=ok.slice(3).reverse().slice(0,3);return {top,flop};
}
function contentLine(x,extra=""){return `<li class="row"><div class="row-main"><button type="button" class="cell-link" data-act="content" data-cid="${x.c.id}">${esc(x.c.title)}</button><span class="meta">${esc(x.c.rubrique||"")} · ${plural(x.s.n,"publication mesurée","publications mesurées")}</span></div><div class="row-figs"><strong>${pctv(x.s.rate)}</strong><span class="meta">${compact(x.s.views)} vues</span></div>${extra}</li>`}
function platformTable(res,prev){
 const rows=shownPlatforms().map(f=>{const ps=res.pubs.filter(p=>platformIdOf(p)===f.id),s=statsOf(ps),pv=prev?statsOf(prev.pubs.filter(p=>platformIdOf(p)===f.id)):null;return {f,ps,s,pv}}).filter(x=>x.ps.length);
 if(!rows.length)return emptyState("Aucune publication sur la période.","analytics");
 return `<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Indicateurs par plateforme</caption><thead><tr><th scope="col">Plateforme</th><th scope="col" class="num">Publications</th><th scope="col" class="num">Mesurées</th><th scope="col" class="num">Vues</th>${prev?`<th scope="col" class="num">Évolution</th>`:""}<th scope="col" class="num">Taux</th></tr></thead><tbody>${rows.map(x=>`<tr><th scope="row" data-label="Plateforme">${esc(x.f.name)}</th><td class="num" data-label="Publications">${fmt(x.ps.length)}</td><td class="num" data-label="Mesurées">${fmt(x.s.n)}</td><td class="num" data-label="Vues">${x.s.n?fmt(x.s.views):ND}</td>${prev?`<td class="num" data-label="Évolution">${x.pv&&x.pv.n&&x.s.n?deltaHtml(x.pv.views,x.s.views,{label:""}):ND}</td>`:""}<td class="num" data-label="Taux">${x.s.n?pctv(x.s.rate):ND}</td></tr>`).join("")}</tbody></table></div>`;
}
function trendTiles(s,p,{label="vs 30 jours précédents",unitNote=""}={}){
 return `<div class="grid kpis">
  ${tile(`Vues (${REF_LABEL[refType]})`,s.n?compact(s.views):ND,{note:unitNote||"volume de vues, pas un nombre de personnes",delta:p?deltaHtml(p.n?p.views:null,s.n?s.views:null,{label}):""})}
  ${tile("Interactions",s.n?compact(s.interactions):ND,{note:"likes + commentaires + partages",delta:p?deltaHtml(p.n?p.interactions:null,s.n?s.interactions:null,{label}):""})}
  ${tile("Taux d’interaction",pctv(s.rate),{note:"pondéré : interactions ÷ vues",delta:p?deltaHtml(p.rate,s.rate,{rate:true,label}):""})}
  ${tile("Publications mesurées",`${fmt(s.n)}<small> / ${fmt(s.N)}</small>`,{note:`ayant un relevé ${REF_LABEL[refType]}`})}
 </div>`;
}
