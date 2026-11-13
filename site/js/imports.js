// Wakabi Performance Center — Imports et connexions (Phase 4, migration 10).
// Import CSV / Excel (fichier enregistré en CSV) : aperçu, correspondance des colonnes, détection des doublons par
// identifiant externe puis par lien, « Associer à un contenu existant » ou « Créer un nouveau contenu ».
// Aucun relevé existant n'est modifié : un relevé J+1 / J+7 déjà saisi est ignoré (une correction se fait sur la fiche).
// Connexions aux plateformes : état seulement ; les API officielles demandent des démarches (comptes développeur).
"use strict";
const {parseCsv,parseCount,parseDateFr,normalizeUrl}=window.WakabiCalc;
const IMPORT_FIELDS=[
 ["title","Titre du contenu",["titre","contenu","title","content","nom"]],["platform","Plateforme",["plateforme","platform","reseau"]],
 ["url","Lien de la publication",["lien","url","link","permalien","permalink"]],["external_id","Identifiant de la publication",["identifiant","external_id","id","post id","video id","identifiant externe"]],
 ["published_on","Date de publication",["date de publication","publication","publie le","published","date"]],["measured_on","Date du relevé",["date du releve","date releve","releve le","measured","date de mesure"]],
 ["reading_type","Type de relevé",["type de releve","type","releve","reading"]],["views","Vues",["vues","views","lectures","video views"]],
 ["likes","Likes",["likes","j'aime","mentions j'aime","reactions"]],["comments","Commentaires",["commentaires","comments"]],["shares","Partages",["partages","shares"]],
 ["reposts","Republications",["republications","reposts"]],["saves","Enregistrements",["enregistrements","saves","sauvegardes"]],
 ["country","Pays",["pays","country"]],["rubrique","Rubrique",["rubrique","categorie"]]];
const REQUIRED=["views","likes","comments","shares","measured_on"];
let imp={file:"",headers:[],rows:[],map:{},plan:null,defaults:{country:"Togo",rubrique:"",type:"j7"},choices:{}};
const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
// Correspondance automatique en deux passes : d'abord les intitulés exacts (tous les champs), ensuite les débuts
// d'intitulés, jamais avec des mots trop généraux (« date », « id »…) qui captureraient la mauvaise colonne.
const GENERIC=["date","id","nom","type","publication","releve","content","contenu"];
function guessMap(headers){const map={},h=headers.map(norm),used=new Set();
 for(const [k,,syn] of IMPORT_FIELDS){const i=h.findIndex((x,j)=>!used.has(j)&&syn.includes(x));if(i>=0){map[k]=i;used.add(i)}}
 for(const [k,,syn] of IMPORT_FIELDS){if(map[k]!=null)continue;const i=h.findIndex((x,j)=>!used.has(j)&&syn.some(s=>!GENERIC.includes(s)&&x.startsWith(s)));if(i>=0){map[k]=i;used.add(i)}}
 return map}
function platformFrom(v){const t=norm(v);if(!t)return null;return data.platforms.find(f=>norm(f.name)===t||norm(f.code)===t)||data.platforms.find(f=>t.includes(norm(f.code)))||null}
function typeFrom(v){const t=norm(v).replace(/\s/g,"");if(!t)return imp.defaults.type;if(["j+1","j1","1"].includes(t))return "j1";if(["j+7","j7","7"].includes(t))return "j7";if(["suivi","other","autre"].includes(t))return "other";return null}
// Plan d'import : une ligne du fichier = un relevé (et, si besoin, un contenu et une publication à créer).
function buildPlan(){
 const cell=(r,k)=>imp.map[k]==null?"":String(r[imp.map[k]]??"").trim(),byExt=new Map(),byUrl=new Map(),seen=new Set(),t=todayIn("Togo");
 for(const p of data.publications){if(p.external_id)byExt.set(String(p.external_id).trim(),p);if(p.url)byUrl.set(normalizeUrl(p.url),p)}
 return imp.rows.map((r,i)=>{
  const line=i+2,errs=[],x={line,title:cell(r,"title"),url:cell(r,"url"),ext:cell(r,"external_id"),f:platformFrom(cell(r,"platform")),type:typeFrom(cell(r,"reading_type")),
   published_on:parseDateFr(cell(r,"published_on")),measured_on:parseDateFr(cell(r,"measured_on")),country:COUNTRIES.find(c=>norm(c)===norm(cell(r,"country")))||imp.defaults.country,
   rub:data.rubriques.find(x=>norm(x.name)===norm(cell(r,"rubrique")))||data.rubriques.find(x=>x.id===imp.defaults.rubrique)||null};
  for(const k of ["views","likes","comments","shares","reposts","saves"])x[k]=parseCount(cell(r,k));
  for(const k of REQUIRED.filter(k=>k!=="measured_on"))if(x[k]==null||Number.isNaN(x[k]))errs.push(`${IMPORT_FIELDS.find(f=>f[0]===k)[1]} manquant ou invalide`);
  for(const k of ["reposts","saves"])if(Number.isNaN(x[k]))errs.push(`${IMPORT_FIELDS.find(f=>f[0]===k)[1]} invalide`);
  if(!x.measured_on)errs.push("Date du relevé manquante ou invalide");else if(x.measured_on>addDays(t,1))errs.push("Date du relevé dans le futur");
  if(!x.type)errs.push("Type de relevé inconnu (J+1, J+7 ou Suivi)");
  x.pub=(x.ext&&byExt.get(x.ext))||(x.url&&byUrl.get(normalizeUrl(x.url)))||null;
  if(x.pub){x.content=data.contents.find(c=>c.id===x.pub.content_id);x.action="match"}
  else{const ch=imp.choices[line]||"";
   if(!x.f)errs.push("Plateforme inconnue");if(!x.url||!/^https?:\/\//i.test(x.url))errs.push("Lien manquant (https://…)");
   if(ch&&ch!=="new"){x.content=data.contents.find(c=>c.id===ch);const same=x.content&&x.f&&pubsFor(x.content.id).find(p=>onPlatform(p,x.f));if(same){x.pub=same;x.action="match"}else x.action="attach"}
   else{x.action="create";if(!x.title)errs.push("Titre manquant pour créer le contenu");if(!x.rub)errs.push("Rubrique à choisir (colonne ou valeur par défaut)")}}
  const key=`${x.pub?.id||x.url}|${x.type}`;
  if(!errs.length&&x.type!=="other"){
   if(x.pub&&data.readings.some(rd=>rd.publication_id===x.pub.id&&rd.reading_type===x.type&&!rd.corrects_reading_id)){x.skip=`Relevé ${TYPE_LABEL[x.type]} déjà saisi (corriger sur la fiche si besoin)`}
   else if(seen.has(key))x.skip="Doublon dans le fichier";
  }
  seen.add(key);x.errs=errs;return x;
 });
}
function importsView(){
 setHead("Imports","Reprendre l’historique ou des statistiques exportées, sans ressaisie");
 if(!isOrganizer()){$("#page").innerHTML=`<section class="card">${emptyState("Réservé à la rédaction et à l’administrateur.","imports")}</section>`;return}
 if(!data.has10){$("#page").innerHTML=unavailable("L’import","10");return}
 const mapUi=imp.headers.length?`<div class="form-grid map-grid">${IMPORT_FIELDS.map(([k,l])=>`<div><label for="map_${k}">${l}${REQUIRED.includes(k)?" *":""}</label><select id="map_${k}" data-map="${k}"><option value="">—</option>${imp.headers.map((h,i)=>`<option value="${i}"${imp.map[k]===i?" selected":""}>${esc(h)}</option>`).join("")}</select></div>`).join("")}</div>`:"";
 const plan=imp.headers.length?buildPlan():[],ok=plan.filter(x=>!x.errs.length&&!x.skip),bad=plan.filter(x=>x.errs.length),skip=plan.filter(x=>!x.errs.length&&x.skip);
 const ctOpts=cur=>`<option value="new"${!cur||cur==="new"?" selected":""}>Créer un nouveau contenu</option>`+data.contents.filter(c=>!c.archived_at).slice(0,300).map(c=>`<option value="${c.id}"${c.id===cur?" selected":""}>Associer à : ${esc(c.title)}</option>`).join("");
 const rowHtml=x=>`<tr${x.errs.length?' class="row-error"':x.skip?' class="is-archived"':""}><td class="num" data-label="Ligne">${x.line}</td><td data-label="Publication">${x.f?esc(x.f.name):"?"} · ${TYPE_LABEL[x.type]||"?"} · ${x.measured_on?frDate(x.measured_on):"?"}<span class="meta">${x.url?esc(x.url.slice(0,60)):""}</span></td>
  <td data-label="Vues" class="num">${x.views==null||Number.isNaN(x.views)?ND:fmt(x.views)}</td>
  <td data-label="Action">${x.errs.length?`<span class="badge bad">${icon("alert",13)}${esc(x.errs.join(" · "))}</span>`:x.skip?`<span class="badge neutral">${icon("minus",13)}${esc(x.skip)}</span>`
   :x.action==="match"?`<span class="badge good">${icon("check",13)}Relevé ajouté à « ${esc(x.content?.title||"")} »</span>`
   :`<label class="sr-only" for="ch_${x.line}">Contenu pour la ligne ${x.line}</label><select id="ch_${x.line}" data-choice="${x.line}">${ctOpts(imp.choices[x.line])}</select>${x.action==="create"?`<span class="meta">« ${esc(x.title)} »</span>`:""}`}</td></tr>`;
 $("#page").innerHTML=`${pageBar(`<span class="scope">${icon("info",16)}Fichier CSV (Excel : « Enregistrer sous » → CSV). Une ligne = un relevé.</span>`,`<button type="button" class="btn ghost" data-act="imp-template">${icon("download",16)}Modèle CSV</button>`)}
 <section class="card"><div class="upload"><label for="imp_file" class="btn primary">${icon("imports",16)}Choisir un fichier</label><input id="imp_file" type="file" accept=".csv,text/csv" class="sr-only"><span class="meta">${imp.file?`${esc(imp.file)} · ${plural(imp.rows.length,"ligne")}`:"Aucun fichier choisi"}</span></div>
 ${imp.headers.length?`<div class="form-grid"><div><label for="imp_ct">Pays par défaut</label><select id="imp_ct" data-def="country">${COUNTRIES.map(c=>`<option${c===imp.defaults.country?" selected":""}>${c}</option>`).join("")}</select></div>
  <div><label for="imp_rb">Rubrique par défaut (nouveaux contenus)</label><select id="imp_rb" data-def="rubrique"><option value="">—</option>${activeOf("rubriques").map(r=>`<option value="${r.id}"${r.id===imp.defaults.rubrique?" selected":""}>${esc(r.name)}</option>`).join("")}</select></div>
  <div><label for="imp_ty">Type de relevé par défaut</label><select id="imp_ty" data-def="type">${[["j7","J+7"],["j1","J+1"],["other","Suivi"]].map(([k,l])=>`<option value="${k}"${k===imp.defaults.type?" selected":""}>${l}</option>`).join("")}</select></div></div>
  <details class="help-box" open><summary>Correspondance des colonnes</summary>${mapUi}</details>`:""}</section>
 ${imp.headers.length?`<div class="grid kpis">${tile("À importer",fmt(ok.length),{tone:ok.length?"good":"",note:"relevés valides"})}${tile("Ignorées",fmt(skip.length),{note:"déjà saisies ou doublons"})}${tile("En erreur",fmt(bad.length),{tone:bad.length?"bad":"",note:"à corriger dans le fichier"})}${tile("Nouveaux contenus",fmt(ok.filter(x=>x.action==="create").length))}</div>
 ${card("Aperçu",`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Aperçu de l’import</caption><thead><tr><th scope="col" class="num">Ligne</th><th scope="col">Publication</th><th scope="col" class="num">Vues</th><th scope="col">Action</th></tr></thead><tbody>${plan.slice(0,200).map(rowHtml).join("")}</tbody></table></div>${plan.length>200?`<p class="meta">Aperçu limité aux 200 premières lignes ; toutes seront traitées.</p>`:""}`,{cls:"flush-body",action:`<button type="button" class="btn primary" data-act="imp-run"${ok.length?"":" disabled"}>Importer ${plural(ok.length,"relevé")}</button>`})}`:""}
 ${impHistory()}`;
}
let impBatches=null;
function impHistory(){
 if(impBatches===null){db.from("import_batches").select("*").order("created_at",{ascending:false}).limit(20).then(r=>{impBatches=r.data||[];if(active==="imports")importsView()});return ""}
 return impBatches.length?card("Derniers imports",`<ul class="rows">${impBatches.map(b=>`<li class="row"><div class="row-main"><strong>${esc(b.file_name)}</strong><span class="meta">${relTime(b.created_at)} · ${esc(personName(b.created_by))}</span></div><span class="meta">${plural(b.readings_created,"relevé")} · ${plural(b.contents_created,"contenu")} · ${plural(b.rows_skipped,"ignorée","ignorées")}</span></li>`).join("")}</ul>`):"";
}
async function importRun(btn){
 const plan=buildPlan().filter(x=>!x.errs.length&&!x.skip);if(!plan.length)return;
 if(!confirm(`Importer ${plan.length} relevé(s) ? Les contenus et publications manquants seront créés.`))return;
 await busy(btn,"Import en cours…",async()=>{
  const res={contents:0,pubs:0,readings:0,errors:[]},created=new Map();
  for(const x of plan){
   try{
    let contentId=x.content?.id,pub=x.pub;
    if(x.action==="create"){const key=norm(x.title)+"|"+x.country;contentId=created.get(key);
     if(!contentId){const {data:c,error}=await db.from("contents").insert({title:x.title,rubrique:x.rub.name,rubrique_id:x.rub.id,country:x.country,publish_date:x.published_on||x.measured_on}).select("id").single();if(error)throw error;contentId=c.id;created.set(key,contentId);res.contents++}}
    if(!pub){const {data:p,error}=await db.from("publications").insert({content_id:contentId,platform:x.f.code,url:x.url,external_id:x.ext||null,...(x.published_on?{published_on:x.published_on}:{})}).select("*").single();if(error)throw error;pub=p;res.pubs++;data.publications.push(p)}
    const {error}=await db.from("metric_readings").insert({publication_id:pub.id,reading_type:x.type,views:x.views,likes:x.likes,comments:x.comments,shares:x.shares,reposts:x.reposts,saves:x.saves,measured_on:x.measured_on}).select("id").single();
    if(error)throw error;res.readings++;
   }catch(e){res.errors.push({ligne:x.line,erreur:e.message})}
  }
  const plat=[...new Set(plan.map(x=>x.f?.id).filter(Boolean))];
  await db.from("import_batches").insert({file_name:imp.file,platform_id:plat.length===1?plat[0]:null,rows_total:imp.rows.length,contents_created:res.contents,publications_created:res.pubs,readings_created:res.readings,rows_skipped:imp.rows.length-res.readings,report:{erreurs:res.errors}});
  impBatches=null;imp={...imp,headers:[],rows:[],file:"",map:{},choices:{}};await refresh();render("imports");
  toast(`Import terminé : ${res.readings} relevé(s), ${res.contents} contenu(s), ${res.pubs} publication(s) créés${res.errors.length?`, ${res.errors.length} erreur(s)`:""}.`);
 });
}
function importTemplate(){
 const head=IMPORT_FIELDS.map(f=>f[1]);
 const ex=["On va où là ? — Restaurant X","TikTok","https://www.tiktok.com/@wakabi/video/123","123","05/11/2026","12/11/2026","J+7","12500","640","35","22","","",COUNTRIES[0],"SPOT"];
 const url=URL.createObjectURL(new Blob([toCsv([head,ex])],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="wakabi_modele_import.csv";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},1000);
}

// ---------- Connexions aux plateformes ----------
const CONN_STATUS={non_configuree:["Non configurée","neutral","minus"],connectee:["Connectée","good","check"],erreur:["Erreur","bad","alert"],deconnectee:["Déconnectée","warn","clock"]};
function connectionsView(){
 setHead("Connexions","État des liaisons avec les plateformes");
 if(!data.has10){$("#page").innerHTML=unavailable("Les connexions","10");return}
 const rows=data.platforms.filter(f=>f.status!=="archived").map(f=>({f,c:(data.connections||[]).find(x=>x.platform_id===f.id)||{status:"non_configuree"}}));
 $("#page").innerHTML=`<div class="callout">${icon("info",18)}<div><strong>Synchronisation automatique : pas encore disponible.</strong> Elle passera uniquement par les API officielles de chaque plateforme (TikTok, Meta pour Instagram et Facebook, YouTube, Snapchat), avec un compte développeur validé par la plateforme. Les jetons resteront côté serveur (fonction Supabase) ; aucun mot de passe de réseau social ne sera jamais demandé ni enregistré. En attendant : saisie J+1 / J+7 ou <button type="button" class="link" data-act="go" data-view="imports">import CSV</button>. La publication directe dépend des mêmes accès.</div></div>
 ${card("Plateformes",`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Connexions aux plateformes</caption><thead><tr><th scope="col">Plateforme</th><th scope="col">État</th><th scope="col">Compte</th><th scope="col">Dernière synchronisation</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(({f,c})=>{const [l,t,i]=CONN_STATUS[c.status]||CONN_STATUS.non_configuree;
  return `<tr><th scope="row" data-label="Plateforme">${esc(f.name)}</th><td data-label="État"><span class="badge ${t}">${icon(i,13)}${l}</span>${c.last_error?`<span class="meta">${esc(c.last_error)}</span>`:""}</td><td data-label="Compte">${c.account_label?esc(c.account_label):`<span class="meta">—</span>`}</td><td data-label="Dernière synchronisation">${c.last_sync_at?relTime(c.last_sync_at):`<span class="meta">jamais</span>`}</td>
  <td class="act">${me.role==="admin"?`<button type="button" class="btn sm ghost" data-act="conn-label" data-pid="${f.id}">Compte</button>`:""}<button type="button" class="btn sm ghost" disabled title="API non configurée">Synchroniser</button></td></tr>`}).join("")}</tbody></table></div>`,{cls:"flush-body",sub:"« Synchroniser » s’activera quand l’accès officiel d’une plateforme sera configuré"})}`;
}
function connLabelForm(pid){
 const f=data.platforms.find(x=>x.id===pid),c=(data.connections||[]).find(x=>x.platform_id===pid)||{};
 modal(`Compte ${f?.name||""}`,`<label for="cn_l">Nom du compte Wakabi sur la plateforme</label><input id="cn_l" value="${esc(c.account_label||"")}" placeholder="ex. @wakabi.togo"><p class="field-hint">Simple repère pour l’équipe : aucun mot de passe ni jeton n’est demandé.</p><div class="modal-actions"><button id="cn_ok" type="button" class="btn primary">Enregistrer</button></div>`);
 $("#cn_ok").onclick=()=>busy($("#cn_ok"),"…",async()=>{const {error}=await db.from("platform_connections").update({account_label:$("#cn_l").value.trim()||null}).eq("platform_id",pid).select("platform_id").single();if(error){toast(error.message);return}closeModal();await refresh();toast("Compte enregistré.");render("connections")});
}
document.addEventListener("click",e=>{
 const a=e.target.closest("[data-act]");if(!a||!me)return;const act=a.dataset.act;
 if(act==="imp-template")importTemplate();else if(act==="imp-run")importRun(a);else if(act==="conn-label")connLabelForm(a.dataset.pid);
});
document.addEventListener("change",async e=>{
 const el=e.target;
 if(el.id==="imp_file"){const f=el.files&&el.files[0];if(!f)return;if(f.size>5*1024*1024){toast("Fichier trop lourd (5 Mo maximum).");return}
  const text=await f.text(),p=parseCsv(text);if(p.rows.length<2){toast("Fichier vide ou illisible : une ligne d’en-têtes puis une ligne par relevé.");return}
  imp={...imp,file:f.name,headers:p.rows[0].map(h=>String(h).trim()),rows:p.rows.slice(1),choices:{}};imp.map=guessMap(imp.headers);render("imports");return}
 if(el.dataset.map){const v=el.value;imp.map[el.dataset.map]=v===""?undefined:+v;render("imports");document.getElementById(el.id)?.focus();return}
 if(el.dataset.def){imp.defaults[el.dataset.def]=el.value;render("imports");document.getElementById(el.id)?.focus();return}
 if(el.dataset.choice){imp.choices[el.dataset.choice]=el.value;render("imports");document.getElementById(el.id)?.focus()}
});
