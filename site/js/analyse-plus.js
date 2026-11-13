// Wakabi Performance Center — Analyse (Phases 3 et 5, migration 10) : objectifs, organique / sponsorisé,
// pistes d'action (repères internes documentés), vues de filtres enregistrées.
"use strict";
const OBJ_METRIC={vues:"Vues",interactions:"Interactions",taux:"Taux d’interaction",publications:"Publications",telechargements:"Téléchargements",inscriptions:"Inscriptions",utilisateurs_actifs:"Utilisateurs actifs"};
const OBJ_KIND={mois:"Mensuel",trimestre:"Trimestriel",campagne:"Campagne"};
const PROMO={organique:"Organique",sponsorise:"Sponsorisé",inconnu:"Non précisé"};
const quarterStart=d=>`${d.slice(0,4)}-${String(Math.floor((+d.slice(5,7)-1)/3)*3+1).padStart(2,"0")}-01`;
const quarterLabel=d=>`${Math.floor((+d.slice(5,7)-1)/3)+1}ᵉ trimestre ${d.slice(0,4)}`;

// ---------- Objectifs ----------
function objectiveRange(o){
 if(o.period_kind==="campagne"){const c=(data.campaigns||[]).find(x=>x.id===o.campaign_id);return {start:c?.start_date||null,end:c?.end_date||null,label:`Campagne « ${c?.name||"inconnue"} »`}}
 return {start:o.period_start,end:o.period_end,label:o.period_kind==="mois"?monthLabel(o.period_start):quarterLabel(o.period_start)};
}
function objectiveActual(o){
 const r=objectiveRange(o),t=todayIn(me.country||"Togo");
 const appKey={telechargements:"downloads",inscriptions:"signups",utilisateurs_actifs:"active_users"}[o.metric];
 if(appKey){const rows=data.appKpis.filter(x=>(!o.country||x.country===o.country)&&(!r.start||x.month>=r.start.slice(0,7)+"-01")&&(!r.end||x.month<=r.end));
  return {value:rows.length?sum(rows.map(x=>x[appKey])):null,n:rows.length,unit:"mois saisis"}}
 const f={...EMPTY_FILTERS,country:o.country||"",platform:o.platform_id||"",campaign:o.period_kind==="campagne"?o.campaign_id:""};
 if(r.start){f.period="custom";f.from=r.start;f.to=r.end&&r.end<t?r.end:t}
 const res=applyFilters(f,filterCtx()),s=statsOf(res.pubs);
 if(o.metric==="publications")return {value:res.pubs.length,n:res.pubs.length,unit:"publications"};
 const v=o.metric==="vues"?(s.n?s.views:null):o.metric==="interactions"?(s.n?s.interactions:null):s.rate;
 return {value:v,n:s.n,unit:`publications mesurées (${REF_LABEL[refType]})`};
}
function objectiveRow(o){
 const r=objectiveRange(o),a=objectiveActual(o),t=todayIn(me.country||"Togo"),isRate=o.metric==="taux";
 const ratio=a.value==null||!o.target?null:a.value/o.target;
 const ended=r.end&&r.end<t,started=!r.start||r.start<=t;
 const elapsed=r.start&&r.end&&started&&!ended?Math.min(1,(daysBetween(r.start,t)+1)/(daysBetween(r.start,r.end)+1)):null;
 const state=ratio!=null&&ratio>=1?["Atteint","good","check"]:ended?["Non atteint","bad","alert"]:!started?["À venir","neutral","clock"]:["En cours","blue","clock"];
 const fmtV=v=>v==null?ND:isRate?pct(v):fmt(Math.round(v));
 const pace=!isRate&&elapsed&&a.value!=null&&elapsed>0.05?`À ce rythme : ${fmt(Math.round(a.value/elapsed))} en fin de période`:"";
 const scope=[o.country||"tous pays",o.platform_id?(data.platforms.find(f=>f.id===o.platform_id)||{}).name:"toutes plateformes"].join(" · ");
 return `<li class="row obj-row"><div class="row-main"><strong>${OBJ_METRIC[o.metric]} · ${esc(r.label)}</strong><span class="meta">${esc(scope)} · ${OBJ_KIND[o.period_kind]}${o.note?` · ${esc(o.note)}`:""}</span>
  <div class="meter" role="img" aria-label="${esc(`${OBJ_METRIC[o.metric]} : ${a.value==null?"non disponible":isRate?pct(a.value):fmt(Math.round(a.value))} sur un objectif de ${isRate?pct(o.target):fmt(o.target)}`)}"><span class="meter-fill ${state[1]}" style="width:${ratio==null?0:Math.min(100,ratio*100)}%"></span>${elapsed!=null?`<span class="meter-mark" style="left:${elapsed*100}%" title="Part de la période écoulée"></span>`:""}</div>
  <span class="meta">${fmtV(a.value)} / ${isRate?pct(o.target):fmt(o.target)}${ratio!=null?` · ${Math.round(ratio*100)} %`:""}${elapsed!=null?` · ${Math.round(elapsed*100)} % de la période écoulée`:""} · ${fmt(a.n)} ${a.unit}${pace?` · ${pace}`:""}</span></div>
  <span class="badge ${state[1]}">${icon(state[2],13)}${state[0]}</span>${isOrganizer()?`<div class="row-actions"><button type="button" class="btn sm ghost" data-act="obj-edit" data-oid="${o.id}">Modifier</button></div>`:""}</li>`;
}
function objectivesView(){
 setHead("Objectifs","Cibles mensuelles, trimestrielles ou par campagne — jamais obligatoires par contenu");
 if(!data.has10){$("#page").innerHTML=unavailable("Les objectifs","10");return}
 const t=todayIn(me.country||"Togo"),cur=[],past=[];
 for(const o of data.objectives){const r=objectiveRange(o);(r.end&&r.end<t?past:cur).push(o)}
 $("#page").innerHTML=`${pageBar(refSwitch(),isOrganizer()?`<button type="button" class="btn primary" data-act="obj-new">${icon("plus",16)}Nouvel objectif</button>`:"")}
 ${card("En cours et à venir",cur.length?`<ul class="rows">${cur.map(objectiveRow).join("")}</ul>`:emptyState(isOrganizer()?"Aucun objectif en cours. Fixez une cible pour suivre l’avancement.":"Aucun objectif en cours.","objectives"),{sub:"Le trait vertical marque la part de la période déjà écoulée"})}
 ${past.length?card("Terminés",`<ul class="rows">${past.map(objectiveRow).join("")}</ul>`):""}
 <p class="foot-note">Vues, interactions et taux : mêmes calculs que la page Performance (relevé ${REF_LABEL[refType]}, taux pondéré). Téléchargements, inscriptions et utilisateurs actifs : somme des mois saisis dans « Application ».</p>`;
}
function objectiveForm(oid){
 const o=oid?data.objectives.find(x=>x.id===oid):{period_kind:"mois",metric:"vues",period_start:todayIn(me.country||"Togo").slice(0,7)+"-01"};if(!o)return;
 const qs=[-1,0,1,2].map(k=>{const d=new Date(quarterStart(todayIn("Togo"))+"T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+3*k);return d.toISOString().slice(0,10)});
 modal(oid?"Modifier l’objectif":"Nouvel objectif",`<div class="form-grid">
  <div><label for="ob_k">Période</label><select id="ob_k">${Object.entries(OBJ_KIND).map(([k,l])=>`<option value="${k}"${k===o.period_kind?" selected":""}>${l}</option>`).join("")}</select></div>
  <div id="ob_when"></div>
  <div><label for="ob_m">Indicateur</label><select id="ob_m">${Object.entries(OBJ_METRIC).map(([k,l])=>`<option value="${k}"${k===o.metric?" selected":""}>${l}</option>`).join("")}</select></div>
  <div><label for="ob_t">Cible</label><input id="ob_t" type="number" min="0" step="any" inputmode="decimal" value="${o.target==null?"":o.metric==="taux"?o.target*100:o.target}"><p class="field-hint" id="ob_hint"></p></div>
  <div><label for="ob_c">Pays</label><select id="ob_c"><option value="">Tous</option>${COUNTRIES.map(c=>`<option${c===o.country?" selected":""}>${c}</option>`).join("")}</select></div>
  <div><label for="ob_p">Plateforme</label><select id="ob_p"><option value="">Toutes</option>${data.platforms.filter(f=>f.status!=="archived").map(f=>`<option value="${f.id}"${f.id===o.platform_id?" selected":""}>${esc(f.name)}</option>`).join("")}</select></div>
  <div class="full-span"><label for="ob_n">Note (facultatif)</label><input id="ob_n" value="${esc(o.note||"")}"></div>
  <div class="full-span modal-actions">${oid?`<button id="ob_arch" type="button" class="btn danger-ghost">${icon("archive",16)}Archiver</button>`:""}<button id="ob_save" type="button" class="btn primary">${oid?"Enregistrer":"Créer l’objectif"}</button></div></div>`);
 const when=()=>{const k=$("#ob_k").value;$("#ob_when").innerHTML=k==="mois"?`<label for="ob_mo">Mois</label><input id="ob_mo" type="month" value="${(o.period_start||todayIn("Togo")).slice(0,7)}">`
  :k==="trimestre"?`<label for="ob_q">Trimestre</label><select id="ob_q">${qs.map(q=>`<option value="${q}"${q===o.period_start?" selected":""}>${quarterLabel(q)}</option>`).join("")}</select>`
  :`<label for="ob_cp">Campagne</label><select id="ob_cp">${(data.campaigns||[]).filter(c=>c.status!=="archived"||c.id===o.campaign_id).map(c=>`<option value="${c.id}"${c.id===o.campaign_id?" selected":""}>${esc(c.name)}</option>`).join("")||`<option value="">Aucune campagne</option>`}</select>`};
 const hint=()=>{$("#ob_hint").textContent=$("#ob_m").value==="taux"?"En pourcentage (ex. 5 pour 5 %)":""};
 when();hint();$("#ob_k").onchange=when;$("#ob_m").onchange=hint;
 $("#ob_save").onclick=()=>busy($("#ob_save"),"Enregistrement…",async()=>{
  const k=$("#ob_k").value,m=$("#ob_m").value,raw=Number($("#ob_t").value);
  if(!(raw>=0)||$("#ob_t").value===""){toast("Indiquez une cible positive.");return}
  const row={period_kind:k,metric:m,target:m==="taux"?raw/100:raw,country:$("#ob_c").value||null,platform_id:$("#ob_p").value||null,note:$("#ob_n").value.trim()||null,period_start:null,period_end:null,campaign_id:null};
  if(m==="taux"&&raw>100){toast("Un taux ne peut pas dépasser 100 %.");return}
  if(k==="mois"){const v=$("#ob_mo").value;if(!v){toast("Choisissez le mois.");return}const b=monthBounds(v);row.period_start=b.start;row.period_end=b.end}
  else if(k==="trimestre"){const s=$("#ob_q").value,e=new Date(s+"T00:00:00Z");e.setUTCMonth(e.getUTCMonth()+3);e.setUTCDate(0);row.period_start=s;row.period_end=e.toISOString().slice(0,10)}
  else{row.campaign_id=$("#ob_cp").value||null;if(!row.campaign_id){toast("Choisissez une campagne (liste « Campagnes »).");return}}
  const {error}=oid?await db.from("objectives").update(row).eq("id",oid).select("id").single():await db.from("objectives").insert(row).select("id").single();
  if(error){toast(error.message);return}closeModal();await refresh();toast(oid?"Objectif mis à jour.":"Objectif créé.");render("objectives")});
 $("#ob_arch")?.addEventListener("click",()=>{if(confirm("Archiver cet objectif ? Il ne sera plus suivi ; rien n’est supprimé."))busy($("#ob_arch"),"…",async()=>{const {error}=await db.from("objectives").update({archived_at:new Date().toISOString()}).eq("id",oid).select("id").single();if(error){toast(error.message);return}closeModal();await refresh();toast("Objectif archivé.");render("objectives")})});
}
function objectivesSummary(){
 if(!data.has10||!data.objectives.length)return "";const t=todayIn(me.country||"Togo");
 const cur=data.objectives.filter(o=>{const r=objectiveRange(o);return (!r.start||r.start<=t)&&(!r.end||r.end>=t)});
 return cur.length?card("Objectifs en cours",`<ul class="rows">${cur.slice(0,4).map(objectiveRow).join("")}</ul>`,{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="objectives">Tous les objectifs</button>`}):"";
}

// ---------- Organique / sponsorisé ----------
function promotionCard(res){
 if(!data.has10)return "";
 const rows=Object.keys(PROMO).map(k=>{const ps=res.pubs.filter(p=>(p.promotion||"inconnu")===k);return {k,ps,s:statsOf(ps)}}).filter(x=>x.ps.length);
 if(!rows.length)return "";
 return card("Organique / sponsorisé",`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Organique et sponsorisé</caption><thead><tr><th scope="col">Diffusion</th><th scope="col" class="num">Publications</th><th scope="col" class="num">Mesurées</th><th scope="col" class="num">Vues</th><th scope="col" class="num">Taux</th></tr></thead><tbody>${rows.map(x=>`<tr><th scope="row" data-label="Diffusion">${PROMO[x.k]}</th><td class="num" data-label="Publications">${fmt(x.ps.length)}</td><td class="num" data-label="Mesurées">${fmt(x.s.n)}</td><td class="num" data-label="Vues">${x.s.n?fmt(x.s.views):ND}</td><td class="num" data-label="Taux">${x.s.n?pctv(x.s.rate):ND}</td></tr>`).join("")}</tbody></table></div>`,
  {cls:"flush-body",sub:"Analyse principalement organique · « Non précisé » tant que la publication n’est pas marquée sur la fiche"});
}

// ---------- Pistes d'action (repères internes, échantillon toujours affiché) ----------
const WEEKDAY=["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
function insightsCard(res){
 const cMap=new Map(data.contents.map(c=>[c.id,c])),out=[];
 const byDay=[0,1,2,3,4,5,6].map(d=>({d,ps:res.pubs.filter(p=>{const c=cMap.get(p.content_id);if(!c)return false;const b=basisDate(p,c);return (new Date(b+"T12:00:00Z").getUTCDay()+6)%7===d})})).map(x=>({...x,s:statsOf(x.ps)})).filter(x=>x.s.n>=MIN_SAMPLE&&x.s.rate!=null).sort((a,b)=>b.s.rate-a.s.rate);
 if(byDay.length>=2)out.push(["up",`Jour de publication le plus engageant : <strong>${WEEKDAY[byDay[0].d]}</strong> (${pct(byDay[0].s.rate)} sur ${plural(byDay[0].s.n,"publication mesurée","publications mesurées")}), contre ${pct(byDay[byDay.length-1].s.rate)} le ${WEEKDAY[byDay[byDay.length-1].d]}.`]);
 for(const r of shownRubriques()){const ps=res.contents.filter(c=>onRubrique(c,r)).flatMap(c=>res.byContent.get(c.id)||[]);
  const best=shownPlatforms().map(f=>({f,s:statsOf(ps.filter(p=>platformIdOf(p)===f.id))})).filter(x=>x.s.n>=MIN_SAMPLE&&x.s.rate!=null).sort((a,b)=>b.s.rate-a.s.rate)[0];
  if(best)out.push(["analytics",`Rubrique <strong>${esc(r.name)}</strong> : meilleur taux sur <strong>${esc(best.f.name)}</strong> (${pct(best.s.rate)}, ${plural(best.s.n,"publication mesurée","publications mesurées")}).`])}
 const t=todayIn(me.country||"Togo"),silent=activeOf("rubriques").filter(r=>!data.contents.some(c=>onRubrique(c,r)&&c.publish_date>=addDays(t,-30)&&c.publish_date<=t));
 if(silent.length)out.push(["clock",`Rubriques sans contenu depuis 30 jours : ${esc(namesFr(silent.map(r=>r.name)))}.`]);
 return card("Pistes d’action",out.length?`<ul class="rows">${out.map(([i,txt])=>`<li class="row"><span class="file-ico">${icon(i,16)}</span><div class="row-main"><span>${txt}</span></div></li>`).join("")}</ul>`:emptyState(`Pas encore assez de données : il faut au moins ${MIN_SAMPLE} publications mesurées par groupe.`,"idea"),
  {sub:`Repères internes à vérifier, calculés sur les filtres actuels · au moins ${MIN_SAMPLE} publications mesurées par groupe`});
}

// ---------- Vues de filtres enregistrées ----------
function savedViewsBar(){
 if(!data.has10)return "";const mine=(data.savedViews||[]).filter(v=>v.view===active);
 return `<span class="saved-views">${mine.length?`<label class="fld inline-fld"><span class="sr-only">Mes vues enregistrées</span><select id="sv_pick" data-sv="pick"><option value="">Mes vues…</option>${mine.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select></label>`:""}<button type="button" class="link sm" data-act="sv-save">${icon("bookmark",14)}Enregistrer cette vue</button></span>`;
}
function saveViewForm(){
 modal("Enregistrer cette vue",`<label for="sv_name">Nom de la vue</label><input id="sv_name" maxlength="80" placeholder="ex. TikTok du mois"><p class="field-hint">Les filtres et le relevé de référence actuels sont enregistrés pour vous seul.</p><div class="modal-actions"><button id="sv_ok" type="button" class="btn primary">Enregistrer</button></div>`);
 const view=active;
 $("#sv_ok").onclick=()=>busy($("#sv_ok"),"…",async()=>{const name=$("#sv_name").value.trim();if(!name){toast("Donnez un nom à la vue.");return}
  const {error}=await db.from("saved_views").insert({name,view,query:viewQuery(view)+`&ref=${refType}`}).select("id").single();if(error){toast(error.message);return}
  closeModal();await refresh();toast("Vue enregistrée.");render(view)});
}
function applySavedView(id){
 const v=(data.savedViews||[]).find(x=>x.id===id);if(!v)return;
 filters=filtersFromQuery(v.query);readViewQuery(v.view,v.query);const r=new URLSearchParams(v.query).get("ref");if(REF_LABEL[r]){refType=r;try{localStorage.setItem("wakabi.ref",r)}catch(e){}}
 render(v.view,{push:true});toast(`Vue « ${v.name} » appliquée.`);
}
document.addEventListener("click",e=>{
 const a=e.target.closest("[data-act]");if(!a||!me)return;const act=a.dataset.act;
 if(act==="obj-new")objectiveForm(null);else if(act==="obj-edit")objectiveForm(a.dataset.oid);else if(act==="sv-save")saveViewForm();
});
document.addEventListener("change",e=>{if(e.target.id==="sv_pick"&&e.target.value)applySavedView(e.target.value)});
