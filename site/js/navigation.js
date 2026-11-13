// Wakabi Performance Center — Navigation, adresse des écrans, cloche, filtres partagés, relevé de référence.
"use strict";
// ---------- Navigation, adresse de la page, cloche ----------
// Chaque écran a une adresse (#/contenus…) : retour arrière du navigateur, lien partageable avec ses filtres.
const VIEWS={home:"Aujourd’hui",tasks:"Mes tâches",contents:"Contenus",calendar:"Calendrier",entry:"Saisie",analytics:"Performance",reports:"Rapports",objectives:"Objectifs",app:"Application",direction:"Direction",admin:"Équipe",lists:"Listes",imports:"Imports",connections:"Connexions",help:"Guide"};
const FILTERABLE=["contents","calendar","analytics","direction"];
// Écrans visibles selon le rôle et les migrations présentes (09 : tâches ; 10 : objectifs, imports, connexions).
const isProductionMember=()=>me.role==="platform_manager"&&!(me.platformIds||[]).length;
function mainNavIds(){return ["home",...(data.has09?["tasks"]:[]),"contents","calendar",...(isProductionMember()&&data.has09?[]:["entry"]),"analytics","reports",...(data.has10?["objectives"]:[]),"app","direction"]}
function adminNavIds(){return [...(me.role==="admin"?["admin","lists"]:[]),...(data.has10&&isOrganizer()?["imports"]:[]),...(data.has10&&["admin","editor","direction"].includes(me.role)?["connections"]:[])]}
function bottomNavIds(){return isProductionMember()&&data.has09?["home","tasks","contents","calendar"]:["home","contents","entry","analytics"]}
function viewAllowed(id){return !!VIEWS[id]&&(!["admin","lists"].includes(id)||me.role==="admin")&&(id!=="imports"||isOrganizer())&&(id!=="connections"||["admin","editor","direction"].includes(me.role))}
function navBtn(id,cls){
 const n=id==="entry"?taskCount():id==="tasks"&&data.has09?openTasksCount():0,what=id==="tasks"?"tâche":"relevé";
 return `<button type="button" class="${cls}${active===id?" is-active":""}" data-id="${id}"${active===id?' aria-current="page"':""}>${icon(id,20)}<span class="nav-text">${VIEWS[id]}</span>${n?`<span class="nav-count" aria-label="${n} ${what}${n>1?"s":""} à traiter">${n>99?"99+":n}</span>`:""}</button>`;
}
function buildNav(){
 const adm=adminNavIds(),BOTTOM_NAV=bottomNavIds();
 $("#nav").innerHTML=`<div class="nav-group">${mainNavIds().map(id=>navBtn(id,"nav-btn")).join("")}</div>
 ${adm.length?`<div class="nav-group"><div class="nav-title">Administration</div>${adm.map(id=>navBtn(id,"nav-btn")).join("")}</div>`:""}
 <div class="nav-group">${navBtn("help","nav-btn")}</div>`;
 $("#bottomNav").innerHTML=BOTTOM_NAV.map(id=>navBtn(id,"bnav-btn")).join("")+
  `<button type="button" class="bnav-btn${BOTTOM_NAV.includes(active)?"":" is-active"}" data-act="more" aria-haspopup="dialog">${icon("more",20)}<span class="nav-text">Plus</span></button>`;
}
// Menu « Plus » du téléphone : les autres écrans, le profil et la déconnexion.
function moreMenu(){
 const ids=[...mainNavIds(),...adminNavIds(),"help"].filter(id=>!bottomNavIds().includes(id));
 modal("Menu",`<div class="menu-list">${ids.map(id=>`<button type="button" class="menu-item${active===id?" is-active":""}" data-id="${id}" data-menu="1">${icon(id,20)}<span>${VIEWS[id]}</span>${icon("chevron",16)}</button>`).join("")}</div>
 <div class="menu-profile"><div class="avatar">${esc((me.full_name||"W")[0].toUpperCase())}</div><div><strong>${esc(me.full_name||me.email)}</strong><span>${esc(roleLabel(me))}</span></div></div>
 <button type="button" class="btn danger-ghost full" data-act="logout">${icon("logout",18)}Se déconnecter</button>`);
}
function setHead(t,s){$("#pageTitle").textContent=t;$("#pageSubtitle").textContent=s}
function degradedHtml(){
 const out=[];
 if(!data.readingsOk)out.push(`<strong>Mode dégradé : les relevés (metric_readings) n’ont pas pu être lus</strong> (${esc(data.readingsError)}). ${data.metricsError?`L’ancienne table metrics est aussi illisible (${esc(data.metricsError)}) : aucun chiffre n’est affiché.`:"Les chiffres affichés viennent de l’ancienne table metrics : J+7 seulement, sans J+1 ni corrections. L’historique est donc incomplet."} La saisie est désactivée. Rechargez la page ; si le problème continue, prévenez l’administrateur.`);
 if(data.loadErrors?.length)out.push(`<strong>Données incomplètes</strong> : ${data.loadErrors.map(esc).join(" ; ")}.`);
 return out.map(t=>`<div class="callout warn" role="alert">${icon("alert",18)}<div>${t}</div></div>`).join("");
}
function render(id,{push=false,focus=false}={}){
 if(!viewAllowed(id))id="home";
 active=id;closeBell();buildNav();
 ({home,tasks:tasksView,contents,calendar,entry,analytics,reports,objectives:objectivesView,app:appKpis,direction,admin,lists,imports:importsView,connections:connectionsView,help}[id])();
 const d=degradedHtml();if(d)$("#page").insertAdjacentHTML("afterbegin",d);
 const qs=viewQuery(id),url=`#/${id}${qs?"?"+qs:""}`;
 if(location.hash!==url)history[push?"pushState":"replaceState"](null,"",url);
 if(focus){window.scrollTo(0,0);$("#page").focus({preventScroll:true})}
 updateBell();
}
function parseRoute(){const h=location.hash;if(!h.startsWith("#/"))return null;const [v,qs]=h.slice(2).split("?");return {view:v,qs:qs||""}}
window.addEventListener("popstate",()=>{if(!me)return;const r=parseRoute();if(!r)return;filters=filtersFromQuery(r.qs);readViewQuery(r.view,r.qs);closeModal();render(r.view)});

// Toutes les actions passent par des attributs data-* : aucun « onclick » dans le HTML (compatible avec une CSP stricte).
document.addEventListener("click",e=>{
 const nav=e.target.closest(".nav-btn,.bnav-btn,.menu-item");
 if(nav&&nav.dataset.id){if(nav.dataset.menu)closeModal();render(nav.dataset.id,{push:true,focus:true});return}
 const a=e.target.closest("[data-act]");if(!a||!me&&a.dataset.act!=="logout")return;
 const act=a.dataset.act;
 if(act==="metric"){closeBell();metricForm(a.dataset.pid,a.dataset.type,a.dataset.correct||null)}
 else if(act==="content"){closeBell();contentDetail(a.dataset.cid)}
 else if(act==="new-content")openNewContent();
 else if(act==="go"){closeModal();render(a.dataset.view,{push:true,focus:true})}
 else if(act==="more")moreMenu();
 else if(act==="logout"){closeModal();logout()}
 else if(act==="bell")toggleBell();
 else if(act==="ref")setRef(a.dataset.ref,a.dataset.cid);
 else if(act==="reset-filters"){filters={...EMPTY_FILTERS};render(active)}
 else if(act==="toggle-filters"){filtersOpen=!filtersOpen;render(active)}
});
document.addEventListener("change",e=>{
 const f=e.target.closest("[data-filter]");if(!f||f.dataset.filter==="q")return;
 filters[f.dataset.filter]=f.value;if(f.dataset.filter==="period"&&f.value!=="custom"){filters.from="";filters.to=""}
 const keep=f.id;render(active);document.getElementById(keep)?.focus();
});
let qTimer=null;
document.addEventListener("input",e=>{
 const f=e.target.closest('[data-filter="q"]');if(!f)return;clearTimeout(qTimer);
 qTimer=setTimeout(()=>{filters.q=f.value;const pos=f.selectionStart;render(active);const n=$("#fq");if(n){n.focus();n.setSelectionRange(pos,pos)}},250);
});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(!$("#modal").classList.contains("hidden"))closeModal();else closeBell()});

// Cloche (Phase 1) : relevés J+1 / J+7 à saisir maintenant, calculés comme la page Saisie, un seul par publication et par type.
// Rien n'est enregistré en base (les notifications lues / non lues arrivent en Phase 2).
function taskCount(){return me&&me.role!=="direction"?tasks().length:0}
function updateBell(){
 const b=$("#bellBtn"),rel=me&&me.role!=="direction";if(!me||(!rel&&!data.has09)){b.classList.add("hidden");return}
 b.classList.remove("hidden");const t=rel?tasks():[],late=t.filter(x=>x.state==="late").length,un=unreadNotifs().length,n=t.length+un;
 $("#bellCount").textContent=n>99?"99+":String(n);$("#bellCount").classList.toggle("hidden",!n);$("#bellCount").classList.toggle("is-late",late>0);
 const parts=[t.length?`Relevés à saisir : ${t.length}${late?`, dont ${late} en retard`:""}`:"",un?`${un} notification${un>1?"s":""} non lue${un>1?"s":""}`:""].filter(Boolean);
 b.setAttribute("aria-label",parts.length?parts.join(" ; "):"Rien de nouveau");
 if(!$("#bellPanel").classList.contains("hidden"))fillBell();
}
function fillBell(){
 const rel=me.role!=="direction",t=rel?tasks():[],late=t.filter(x=>x.state==="late"),due=t.filter(x=>x.state==="due"),notes=(data.notifications||[]).slice(0,15),un=unreadNotifs();
 const nItem=n=>`<button type="button" class="bell-item${n.read_at?"":" unread"}" data-act="notif" data-nid="${n.id}"${n.content_id?` data-cid="${n.content_id}"`:""}><span class="bell-main"><strong>${esc(n.message)}</strong><span>${NOTIF_LABEL[n.kind]||""} · ${relTime(n.created_at)}</span></span>${n.read_at?"":`<span class="dot" aria-label="non lue"></span>`}</button>`;
 const item=x=>`<button type="button" class="bell-item" data-act="metric" data-pid="${x.p.id}" data-type="${x.type}"><span class="bell-main"><strong>${esc(x.c.title)}</strong><span>${esc(platformName(x.p))} · ${TYPE_LABEL[x.type]} · échéance ${frDate(x.due)}</span></span>${stateBadge(x.state)}</button>`;
 $("#bellPanel").innerHTML=`<div class="bell-head"><h2>${data.has09?"Notifications":"Relevés à saisir"}</h2>${un.length?`<button type="button" class="link sm" data-act="notif-all">Tout marquer comme lu</button>`:""}<button type="button" class="icon-btn" data-act="bell" aria-label="Fermer">${icon("x")}</button></div>
 <div class="bell-body">${notes.length?`<div class="bell-group">Équipe${un.length?` · ${un.length} non lue${un.length>1?"s":""}`:""}</div>${notes.map(nItem).join("")}`:""}${t.length?`${late.length?`<div class="bell-group">Relevés en retard · ${late.length}</div>${late.map(item).join("")}`:""}${due.length?`<div class="bell-group">Relevés à saisir aujourd’hui · ${due.length}</div>${due.map(item).join("")}`:""}`:""}${!notes.length&&!t.length?emptyState("Rien de nouveau.","check"):""}</div>
 <div class="bell-foot">${rel?`<button type="button" class="btn ghost" data-act="go" data-view="entry">Page Saisie</button>`:""}${data.has09?`<button type="button" class="btn ghost" data-act="go" data-view="tasks">Mes tâches</button>`:""}</div>`;
}
function toggleBell(){const p=$("#bellPanel");if(p.classList.contains("hidden")){fillBell();p.classList.remove("hidden");$("#bellBtn").setAttribute("aria-expanded","true");p.querySelector(".bell-item,button")?.focus()}else{closeBell();$("#bellBtn").focus()}}
function closeBell(){$("#bellPanel")?.classList.add("hidden");$("#bellBtn")?.setAttribute("aria-expanded","false")}
document.addEventListener("click",e=>{if(!$("#bellPanel").classList.contains("hidden")&&!e.target.closest("#bellPanel,#bellBtn"))closeBell()},true);
// Toutes les 5 minutes : relecture des données pour la cloche et les compteurs (la page affichée n'est pas redessinée).
setInterval(async()=>{if(!me||document.hidden||!$("#modal").classList.contains("hidden"))return;await refresh();buildNav();updateBell()},5*60e3);

// ---------- Filtres partagés et relevé de référence ----------
const FKEY={rubrique:"rubriques",platform:"platforms",type:"content_types",campaign:"campaigns",objective:"content_objectives"};
function filterCtx(){return {contents:data.contents,pubsOf:pubsFor,basisDate,platformIdOf,today:todayIn(me.country||"Togo"),
 ownerPlatforms:id=>new Set((data.assignments||[]).filter(a=>a.profile_id===id&&!a.revoked_at).map(a=>a.platform_id)),
 states:(p,c)=>({j1:rstate(p,c,"j1"),j7:rstate(p,c,"j7")})}}
const filtered=(f=filters)=>applyFilters(f,filterCtx());
function previousOf(res,f=filters){const pf=previousPeriodFilters(f,res.range);return pf?applyFilters(pf,filterCtx()):null}
function listOptions(k){const list=data[FKEY[k]]||[];return `<option value="">Tous</option>`+list.filter(x=>x.status!=="archived"||x.id===filters[k]).map(x=>`<option value="${x.id}"${x.id===filters[k]?" selected":""}>${esc(x.name)}${x.status!=="active"?` (${(LIST_STATUS[x.status]||"").toLowerCase()})`:""}</option>`).join("")}
const fSelect=(k,label,options)=>`<label class="fld"><span>${label}</span><select id="f_${k}" data-filter="${k}">${options}</select></label>`;
function filterBar(res,{noPeriod=false}={}){
 const n=activeFilterCount(filters),sel=(k,v)=>v===filters[k]?" selected":"";
 const canOwner=["admin","editor","direction"].includes(me.role)&&(data.assignments||[]).length>0;
 const owners=canOwner?`<option value="">Tous</option>`+data.profiles.filter(p=>!p.archived_at&&(data.assignments||[]).some(a=>a.profile_id===p.id&&!a.revoked_at)).map(p=>`<option value="${p.id}"${sel("owner",p.id)}>${esc(p.full_name)}</option>`).join(""):"";
 const moreN=["rubrique","type","campaign","objective","status","measure","owner","prod","promo"].filter(k=>filters[k]).length;
 return `<section class="filters" aria-label="Filtres">
  <div class="filters-row">
   <label class="fld search"><span class="sr-only">Rechercher un contenu</span>${icon("search",16)}<input id="fq" type="search" data-filter="q" value="${esc(filters.q)}" placeholder="Rechercher un contenu…" autocomplete="off"></label>
   ${noPeriod?"":fSelect("period","Période",Object.entries(PERIODS).map(([k,l])=>`<option value="${k}"${sel("period",k)}>${l}</option>`).join(""))}
   ${fSelect("platform","Plateforme",listOptions("platform"))}
   ${fSelect("country","Pays",`<option value="">Tous</option>`+COUNTRIES.map(c=>`<option${sel("country",c)}>${c}</option>`).join(""))}
   <button type="button" class="btn ghost filters-more" data-act="toggle-filters" aria-expanded="${filtersOpen}" aria-controls="moreFilters">${icon("filter",16)}Plus de filtres${moreN?`<span class="pill">${moreN}</span>`:""}</button>
  </div>
  ${filters.period==="custom"&&!noPeriod?`<div class="filters-row"><label class="fld"><span>Du</span><input id="f_from" type="date" data-filter="from" value="${esc(filters.from)}"></label><label class="fld"><span>Au</span><input id="f_to" type="date" data-filter="to" value="${esc(filters.to)}"></label>${filters.from&&filters.to&&filters.to<filters.from?`<p class="field-error" role="alert">La date de fin doit suivre la date de début.</p>`:""}</div>`:""}
  <div id="moreFilters" class="filters-row${filtersOpen||moreN?"":" hidden"}">
   ${fSelect("rubrique","Rubrique",listOptions("rubrique"))}${fSelect("type","Type",listOptions("type"))}${fSelect("campaign","Campagne",listOptions("campaign"))}${fSelect("objective","Objectif",listOptions("objective"))}
   ${fSelect("status","Statut du contenu",`<option value="">Tous</option><option value="active"${sel("status","active")}>Actifs</option><option value="archived"${sel("status","archived")}>Archivés</option>`)}
   ${fSelect("measure","Mesure",`<option value="">Tous</option>`+Object.entries(MEASURES).map(([k,l])=>`<option value="${k}"${sel("measure",k)}>${l}</option>`).join(""))}
   ${canOwner?fSelect("owner","Responsable",owners):""}
   ${data.has09?fSelect("prod","État de production",`<option value="">Tous</option>`+Object.entries(PROD_STATUS).map(([k,l])=>`<option value="${k}"${sel("prod",k)}>${l}</option>`).join("")):""}
   ${data.has10?fSelect("promo","Diffusion",`<option value="">Toutes</option>`+Object.entries(PROMO).map(([k,l])=>`<option value="${k}"${sel("promo",k)}>${l}</option>`).join("")):""}
  </div>
  <div class="filters-foot"><span class="count" role="status" aria-live="polite">${res.contents.length} contenu${res.contents.length>1?"s":""} · ${res.pubs.length} publication${res.pubs.length>1?"s":""}</span><span class="foot-actions">${savedViewsBar()}${n?`<button type="button" class="link" data-act="reset-filters">${icon("x",14)}Réinitialiser les filtres (${n})</button>`:""}</span></div>
 </section>`;
}
function refSwitch(cid=""){return `<div class="seg" role="group" aria-label="Relevé de référence">${Object.entries(REF_LABEL).map(([k,l])=>`<button type="button" data-act="ref" data-ref="${k}"${cid?` data-cid="${cid}"`:""} aria-pressed="${k===refType}">${l}</button>`).join("")}</div>`}
function setRef(r,cid){if(!REF_LABEL[r])return;refType=r;try{localStorage.setItem("wakabi.ref",r)}catch(e){}render(active);if(cid)contentDetail(cid)}
function periodText(res){
 if(!res.range)return `Toute la période · relevé de référence ${REF_LABEL[refType]} · aucune comparaison`;
 return `${PERIODS[filters.period]||"Période"} : ${frDate(res.range.start)} → ${frDate(res.range.end)} · comparée aux ${res.range.days} jours précédents · relevé de référence ${REF_LABEL[refType]}`;
}
