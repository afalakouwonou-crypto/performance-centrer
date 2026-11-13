// Wakabi Performance Center — Organisation de l'équipe (Phase 2, migration 09) : états de production, tâches,
// validation, échanges, fichiers, notifications. Chaque écran vérifie que la migration est appliquée
// (data.has09) et l'indique clairement sinon. Les droits sont appliqués par la base ; l'écran ne fait que masquer.
"use strict";
const PROD_STATUS={idee:"Idée",a_produire:"À produire",en_production:"En production",a_valider:"À valider",valide:"Validé",programme:"Programmé",publie:"Publié"};
const PROD_TONE={idee:"neutral",a_produire:"neutral",en_production:"blue",a_valider:"warn",valide:"good",programme:"blue",publie:"good"};
const TASK_KIND={redaction:"Rédaction",tournage:"Tournage",montage:"Montage",graphisme:"Graphisme",publication:"Publication",validation:"Validation",autre:"Autre"};
const TASK_STATUS={a_faire:"À faire",en_cours:"En cours",fait:"Fait",annule:"Annulée"};
const NOTIF_LABEL={tache_affectee:"Nouvelle tâche",a_valider:"À valider",a_corriger:"À corriger",valide:"Validé",commentaire:"Commentaire"};
const FILE_MAX=25*1024*1024,BUCKET="wakabi-fichiers";
const isOrganizer=()=>["admin","editor"].includes(me?.role);
const personName=id=>{if(!id)return "Personne";if(id===me?.id)return me.full_name||"Vous";const p=(data.profiles||[]).find(x=>x.id===id);return p?p.full_name:"Membre de l’équipe"};
const activeMembers=()=>(data.profiles||[]).filter(p=>p.active&&!p.archived_at).sort((a,b)=>String(a.full_name).localeCompare(b.full_name,"fr"));
function prodBadge(s){if(!s)return "";const i=s==="publie"||s==="valide"?"check":s==="a_valider"?"clock":"layers";return `<span class="badge ${PROD_TONE[s]||"neutral"}">${icon(i,13)}${PROD_STATUS[s]||esc(s)}</span>`}
function taskBadge(t){const late=t.status!=="fait"&&t.status!=="annule"&&t.due_on&&t.due_on<todayIn(me.country||"Togo");
 if(late)return `<span class="badge bad">${icon("alert",13)}En retard</span>`;
 return `<span class="badge ${t.status==="fait"?"good":t.status==="en_cours"?"blue":t.status==="annule"?"neutral":"warn"}">${icon(t.status==="fait"?"check":t.status==="annule"?"minus":"clock",13)}${TASK_STATUS[t.status]}</span>`}
function unavailable(what,mig){return `<section class="card">${emptyState(`${what} : disponible après l’application de la migration ${mig} sur la base (en attente de l’accord d’Andréas). Rien n’est perdu en attendant.`,"info")}</section>`}
const relTime=ts=>{if(!ts)return "";const d=(Date.now()-Date.parse(ts))/6e4;if(d<1)return "à l’instant";if(d<60)return `il y a ${Math.round(d)} min`;if(d<1440)return `il y a ${Math.round(d/60)} h`;return frDate(ts.slice(0,10))};
const fileSize=n=>n==null?"":n<1024?`${n} o`:n<1048576?`${(n/1024).toFixed(0)} Ko`:`${(n/1048576).toFixed(1).replace(".",",")} Mo`;

// Données de la Phase 2 et suivantes (lues seulement si les migrations sont présentes).
async function refreshExtras(){
 data.has09=false;data.has10=false;data.tasks=[];data.notifications=[];data.objectives=[];data.savedViews=[];data.connections=[];
 const [t,n]=await Promise.all([db.from("content_tasks").select("*").order("due_on",{ascending:true}),db.from("notifications").select("*").order("created_at",{ascending:false}).limit(60)]);
 if(!t.error){data.has09=true;data.tasks=t.data||[];data.notifications=n.error?[]:(n.data||[])}
 const o=await db.from("objectives").select("*").is("archived_at",null).order("period_start",{ascending:false});
 if(!o.error){data.has10=true;data.objectives=o.data||[];
  const [v,cn]=await Promise.all([db.from("saved_views").select("*").order("created_at"),
   ["admin","editor","direction"].includes(me?.role)?db.from("platform_connections").select("*"):Promise.resolve({data:[]})]);
  data.savedViews=v.data||[];data.connections=cn.data||[]}
}
const unreadNotifs=()=>(data.notifications||[]).filter(n=>!n.read_at);
async function markRead(ids){
 ids=ids.filter(Boolean);if(!ids.length)return;
 const {error}=await db.from("notifications").update({read_at:new Date().toISOString()}).in("id",ids);
 if(error){toast(error.message);return}
 const now=new Date().toISOString();data.notifications.forEach(n=>{if(ids.includes(n.id)&&!n.read_at)n.read_at=now});updateBell();buildNav();
}
const myTasks=()=>(data.tasks||[]).filter(t=>t.assignee===me.id&&t.status!=="annule");
const lateTask=t=>t.status!=="fait"&&t.status!=="annule"&&t.due_on&&t.due_on<todayIn(me.country||"Togo");
const openTasksCount=()=>myTasks().filter(t=>t.status!=="fait").length;

// ---------- Mes tâches ----------
let taskTeamFilter={who:"",status:"open"};
function taskCard(t,{showWho=false}={}){
 const c=data.contents.find(x=>x.id===t.content_id),mine=t.assignee===me.id;
 const actions=[mine&&t.status==="a_faire"?`<button type="button" class="btn sm ghost" data-act="task-status" data-tid="${t.id}" data-s="en_cours">Commencer</button>`:"",
  mine&&(t.status==="a_faire"||t.status==="en_cours")?`<button type="button" class="btn sm ghost" data-act="task-status" data-tid="${t.id}" data-s="fait">${icon("check",14)}Terminé</button>`:"",
  isOrganizer()?`<button type="button" class="btn sm ghost" data-act="task-edit" data-tid="${t.id}">Modifier</button>`:""].join("");
 return `<li class="row task-row"><div class="row-main"><strong>${esc(t.title||TASK_KIND[t.kind])}</strong>
  <span class="meta">${esc(TASK_KIND[t.kind])} · ${c?`<button type="button" class="cell-link inline" data-act="content" data-cid="${c.id}">${esc(c.title)}</button>`:"contenu"}${showWho?` · ${esc(personName(t.assignee))}`:""}${t.due_on?` · échéance ${frDate(t.due_on)}`:""}${t.shoot_on?` · tournage le ${frDate(t.shoot_on)}`:""}${t.location?` · ${esc(t.location)}`:""}</span>
  ${t.brief?`<details class="brief"><summary>Brief</summary><div class="prewrap">${esc(t.brief)}</div></details>`:""}</div>${taskBadge(t)}<div class="row-actions">${actions}</div></li>`;
}
function tasksView(){
 setHead("Mes tâches",isOrganizer()?"Ce qui vous est confié, et le suivi de l’équipe":"Ce qui vous est confié");
 if(!data.has09){$("#page").innerHTML=unavailable("Les tâches","09");return}
 const mine=myTasks(),late=mine.filter(lateTask),todo=mine.filter(t=>t.status==="a_faire"&&!lateTask(t)),doing=mine.filter(t=>t.status==="en_cours"&&!lateTask(t));
 const since=addDays(todayIn(me.country||"Togo"),-30),done=mine.filter(t=>t.status==="fait"&&(t.done_at||"").slice(0,10)>=since).sort((a,b)=>(b.done_at||"").localeCompare(a.done_at||""));
 const list=(arr,empty)=>arr.length?`<ul class="rows">${arr.map(t=>taskCard(t)).join("")}</ul>`:emptyState(empty,"check");
 let team="";
 if(isOrganizer()){
  const f=taskTeamFilter,all=(data.tasks||[]).filter(t=>(!f.who||t.assignee===f.who)&&(f.status==="all"||(f.status==="open"?t.status==="a_faire"||t.status==="en_cours":f.status==="late"?lateTask(t):t.status===f.status)))
   .sort((a,b)=>(a.due_on||"9999").localeCompare(b.due_on||"9999"));
  team=`<div class="section-head"><div><h2>Équipe</h2><p class="card-sub">${plural(all.length,"tâche")} · triées par échéance</p></div><button type="button" class="btn primary" data-act="task-new">${icon("plus",16)}Nouvelle tâche</button></div>
  <section class="filters"><div class="filters-row"><label class="fld"><span>Personne</span><select id="tf_who" data-tf="who"><option value="">Toute l’équipe</option>${activeMembers().map(p=>`<option value="${p.id}"${p.id===f.who?" selected":""}>${esc(p.full_name)}</option>`).join("")}</select></label>
  <label class="fld"><span>État</span><select id="tf_status" data-tf="status">${[["open","À faire et en cours"],["late","En retard"],["fait","Faites"],["annule","Annulées"],["all","Toutes"]].map(([k,l])=>`<option value="${k}"${k===f.status?" selected":""}>${l}</option>`).join("")}</select></label></div></section>
  ${card("",all.length?`<ul class="rows">${all.map(t=>taskCard(t,{showWho:true})).join("")}</ul>`:emptyState("Aucune tâche pour ces critères.","tasks"))}`;
 }
 $("#page").innerHTML=`<div class="grid kpis">${tile("En retard",fmt(late.length),{tone:late.length?"bad":"good",note:"échéance dépassée"})}${tile("À faire",fmt(todo.length),{note:"pas encore commencées"})}${tile("En cours",fmt(doing.length))}${tile("Faites",fmt(done.length),{note:"30 derniers jours"})}</div>
 <div class="grid two">${card("À traiter maintenant",list([...late,...doing,...todo],"Aucune tâche ouverte : rien ne vous attend."))}${card("Faites récemment",list(done.slice(0,8),"Aucune tâche terminée ces 30 derniers jours."))}</div>${team}`;
}
async function setTaskStatus(tid,s){
 const {error}=await db.from("content_tasks").update({status:s}).eq("id",tid).select("id").single();
 if(error){toast(error.message);return}
 await refresh();toast(s==="fait"?"Tâche terminée.":"Tâche commencée.");render(active);updateBell();
}
function taskForm(tid,cid){
 const t=tid?(data.tasks||[]).find(x=>x.id===tid):{content_id:cid||"",kind:"autre",status:"a_faire"};if(!t)return;
 const contents=data.contents.filter(c=>!c.archived_at||c.id===t.content_id).sort((a,b)=>a.publish_date<b.publish_date?1:-1);
 modal(tid?"Modifier la tâche":"Nouvelle tâche",`<div class="form-grid">
  <div class="full-span"><label for="tk_c">Contenu</label><select id="tk_c">${contents.map(c=>`<option value="${c.id}"${c.id===t.content_id?" selected":""}>${esc(c.title)} · ${frDate(c.publish_date)}</option>`).join("")}</select></div>
  <div><label for="tk_k">Nature</label><select id="tk_k">${Object.entries(TASK_KIND).map(([k,l])=>`<option value="${k}"${k===t.kind?" selected":""}>${l}</option>`).join("")}</select></div>
  <div><label for="tk_t">Intitulé (facultatif)</label><input id="tk_t" value="${esc(t.title||"")}" placeholder="ex. Visuel de couverture"></div>
  <div><label for="tk_a">Confiée à</label><select id="tk_a"><option value="">Personne pour l’instant</option>${activeMembers().map(p=>`<option value="${p.id}"${p.id===t.assignee?" selected":""}>${esc(p.full_name)}${p.job_title?` · ${esc(p.job_title)}`:""}</option>`).join("")}</select></div>
  <div><label for="tk_d">Échéance</label><input id="tk_d" type="date" value="${esc(t.due_on||"")}"></div>
  <div><label for="tk_s">Date de tournage (si besoin)</label><input id="tk_s" type="date" value="${esc(t.shoot_on||"")}"></div>
  <div><label for="tk_l">Lieu</label><input id="tk_l" value="${esc(t.location||"")}"></div>
  ${tid?`<div><label for="tk_st">État</label><select id="tk_st">${Object.entries(TASK_STATUS).map(([k,l])=>`<option value="${k}"${k===t.status?" selected":""}>${l}</option>`).join("")}</select></div>`:""}
  <div class="full-span"><label for="tk_b">Brief</label><textarea id="tk_b" rows="4" placeholder="Ce qu’il faut produire, format, consignes…">${esc(t.brief||"")}</textarea></div>
  <div class="full-span"><button id="tk_save" type="button" class="btn primary">${tid?"Enregistrer":"Créer la tâche"}</button></div></div>`);
 $("#tk_save").onclick=()=>busy($("#tk_save"),"Enregistrement…",async()=>{
  if(!$("#tk_c").value){toast("Choisissez un contenu.");return}
  const row={content_id:$("#tk_c").value,kind:$("#tk_k").value,title:$("#tk_t").value.trim()||null,assignee:$("#tk_a").value||null,due_on:$("#tk_d").value||null,
   shoot_on:$("#tk_s").value||null,location:$("#tk_l").value.trim()||null,brief:$("#tk_b").value.trim()||null};
  if(tid)row.status=$("#tk_st").value;
  const {error}=tid?await db.from("content_tasks").update(row).eq("id",tid).select("id").single():await db.from("content_tasks").insert(row).select("id").single();
  if(error){toast(error.message);return}
  const back=cid||null;closeModal();await refresh();toast(tid?"Tâche mise à jour.":"Tâche créée : la personne est prévenue.");render(active);if(back)contentDetail(back);
 });
}

// ---------- Fiche contenu : état, tâches, validation, échanges, fichiers, historique ----------
async function loadWorkflow(cid){
 const box=$("#wfBox");if(!box)return;
 if(!data.has09){box.innerHTML=`<p class="meta">${icon("info",14)} État de production, tâches, échanges et fichiers : disponibles après la migration 09.</p>`;return}
 box.innerHTML=`<div class="skeleton small" aria-busy="true"><span></span></div>`;
 const [fb,hi,fi]=await Promise.all([db.from("content_feedback").select("*").eq("content_id",cid).order("created_at"),
  db.from("content_status_history").select("*").eq("content_id",cid).order("changed_at"),db.from("content_files").select("*").eq("content_id",cid).order("uploaded_at")]);
 if(!$("#wfBox"))return;
 const c=data.contents.find(x=>x.id===cid);if(!c)return;
 const tasksC=(data.tasks||[]).filter(t=>t.content_id===cid&&t.status!=="annule"),files=(fi.data||[]).filter(f=>!f.removed_at),feedback=fb.data||[],hist=hi.data||[];
 const canWork=isOrganizer()||tasksC.some(t=>t.assignee===me.id),st=c.production_status||"idee",archived=!!c.archived_at;
 const statusCtl=isOrganizer()&&!archived?`<label class="fld inline-fld"><span class="sr-only">Changer l’état</span><select id="wf_status">${Object.entries(PROD_STATUS).map(([k,l])=>`<option value="${k}"${k===st?" selected":""}>${l}</option>`).join("")}</select></label><button type="button" class="btn sm ghost" data-act="wf-status" data-cid="${cid}">Changer l’état</button>`
  :!archived&&canWork&&["a_produire","en_production"].includes(st)?`<button type="button" class="btn sm primary" data-act="wf-submit" data-cid="${cid}">${icon("send",14)}Proposer à la validation</button>`:"";
 const validate=isOrganizer()&&st==="a_valider"&&!archived?`<div class="callout warn">${icon("clock",18)}<div><strong>Ce contenu attend votre validation.</strong><div class="wf-actions"><button type="button" class="btn sm primary" data-act="wf-valid" data-cid="${cid}">${icon("check",14)}Valider</button><button type="button" class="btn sm danger-ghost" data-act="wf-fix" data-cid="${cid}">Demander une correction</button></div></div></div>`:"";
 box.innerHTML=`<div class="section-head"><h3>Production</h3><div class="wf-status">${prodBadge(st)}${statusCtl}</div></div>${validate}
 <h3 class="sub-title">Tâches${isOrganizer()&&!archived?` <button type="button" class="btn sm ghost" data-act="task-new" data-cid="${cid}">${icon("plus",14)}Ajouter</button>`:""}</h3>
 ${tasksC.length?`<ul class="rows">${tasksC.map(t=>taskCard(t,{showWho:true})).join("")}</ul>`:`<p class="meta">Aucune tâche sur ce contenu.</p>`}
 <h3 class="sub-title">Fichiers</h3>
 ${files.length?`<ul class="rows">${files.map(f=>`<li class="row"><span class="file-ico">${icon("file",16)}</span><div class="row-main"><strong>${esc(f.file_name)}</strong><span class="meta">${fileSize(f.size_bytes)} · ${esc(personName(f.uploaded_by))} · ${relTime(f.uploaded_at)}</span></div><button type="button" class="btn sm ghost" data-act="file-open" data-path="${esc(f.storage_path)}">Ouvrir</button>${isOrganizer()||f.uploaded_by===me.id?`<button type="button" class="link sm" data-act="file-remove" data-fid="${f.id}" data-cid="${cid}">Retirer</button>`:""}</li>`).join("")}</ul>`:`<p class="meta">Aucun fichier.</p>`}
 ${canWork&&!archived?`<div class="upload"><label for="wf_file" class="btn sm ghost">${icon("imports",14)}Déposer un fichier</label><input id="wf_file" type="file" class="sr-only" data-cid="${cid}"><span class="meta">25 Mo maximum · visible par l’équipe connectée seulement</span></div>`:""}
 <h3 class="sub-title">Échanges</h3>
 ${feedback.length?`<ul class="thread">${feedback.map(f=>`<li class="msg ${f.decision}"><div class="msg-head"><strong>${esc(personName(f.author))}</strong>${f.decision!=="commentaire"?` ${f.decision==="valide"?`<span class="badge good">${icon("check",13)}Validé</span>`:`<span class="badge warn">${icon("alert",13)}À corriger</span>`}`:""}<span class="meta">${relTime(f.created_at)}</span></div>${f.comment?`<div class="prewrap">${esc(f.comment)}</div>`:""}</li>`).join("")}</ul>`:`<p class="meta">Aucun échange pour l’instant.</p>`}
 ${!archived?`<div class="comment-box"><label for="wf_comment" class="sr-only">Ajouter un commentaire</label><textarea id="wf_comment" rows="2" placeholder="Ajouter un commentaire pour l’équipe…"></textarea><button type="button" class="btn sm ghost" data-act="wf-comment" data-cid="${cid}">${icon("message",14)}Envoyer</button></div>`:""}
 ${hist.length?`<details class="help-box"><summary>Historique des états (${hist.length})</summary><ul class="plain">${hist.map(h=>`<li>${frDate(h.changed_at.slice(0,10))} · ${h.from_status?`${PROD_STATUS[h.from_status]||h.from_status} → `:""}<strong>${PROD_STATUS[h.to_status]||h.to_status}</strong> · ${esc(personName(h.changed_by))}${h.comment?` · « ${esc(h.comment)} »`:""}</li>`).join("")}</ul></details>`:""}`;
}
async function wfAfter(cid,msg){await refresh();toast(msg);render(active);contentDetail(cid)}
function wfCommentForm(cid,decision){
 modal(decision==="valide"?"Valider le contenu":"Demander une correction",`<label for="wf_txt">${decision==="valide"?"Commentaire (facultatif)":"Ce qu’il faut corriger (obligatoire)"}</label><textarea id="wf_txt" rows="4"></textarea>
 <div class="modal-actions"><button type="button" class="btn ghost" data-close-modal2>Annuler</button><button id="wf_go" type="button" class="btn primary">${decision==="valide"?"Valider":"Envoyer la demande"}</button></div>`);
 $("[data-close-modal2]").onclick=()=>contentDetail(cid);
 $("#wf_go").onclick=()=>busy($("#wf_go"),"Envoi…",async()=>{const txt=$("#wf_txt").value.trim();if(decision!=="valide"&&!txt){toast("Indiquez ce qu’il faut corriger.");return}
  const {error}=await db.from("content_feedback").insert({content_id:cid,decision,comment:txt||null}).select("id").single();if(error){toast(error.message);return}
  await wfAfter(cid,decision==="valide"?"Contenu validé : l’équipe est prévenue.":"Correction demandée : l’équipe est prévenue.")});
}
async function wfUpload(input){
 const cid=input.dataset.cid,f=input.files&&input.files[0];if(!f)return;
 if(f.size>FILE_MAX){toast("Fichier trop lourd : 25 Mo maximum.");input.value="";return}
 const safe=f.name.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Za-z0-9._-]+/g,"_").slice(-80)||"fichier";
 const path=`contents/${cid}/${crypto.randomUUID()}-${safe}`;toast("Envoi du fichier…");
 const up=await db.storage.from(BUCKET).upload(path,f,{contentType:f.type||"application/octet-stream",upsert:false});
 if(up.error){toast("Envoi impossible : "+up.error.message);return}
 const {error}=await db.from("content_files").insert({content_id:cid,storage_path:path,file_name:f.name,mime_type:f.type||null,size_bytes:f.size}).select("id").single();
 if(error){toast("Fichier envoyé mais non enregistré : "+error.message);return}
 await wfAfter(cid,"Fichier déposé.");
}
async function wfOpenFile(path){
 const {data:d,error}=await db.storage.from(BUCKET).createSignedUrl(path,300);
 if(error||!d?.signedUrl){toast("Ouverture impossible : "+(error?.message||"lien indisponible"));return}
 window.open(d.signedUrl,"_blank","noopener");
}
document.addEventListener("click",e=>{
 const a=e.target.closest("[data-act]");if(!a||!me)return;const act=a.dataset.act,cid=a.dataset.cid;
 if(act==="task-status")setTaskStatus(a.dataset.tid,a.dataset.s);
 else if(act==="task-new")taskForm(null,cid);
 else if(act==="task-edit")taskForm(a.dataset.tid,$("#modal").classList.contains("hidden")?null:(document.querySelector("#wfBox [data-act=wf-comment]")?.dataset.cid||null));
 else if(act==="wf-status")busy(a,"…",async()=>{const s=$("#wf_status").value;const {error}=await db.from("contents").update({production_status:s}).eq("id",cid).select("id").single();if(error){toast(error.message);return}await wfAfter(cid,`État : ${PROD_STATUS[s]}.`)});
 else if(act==="wf-submit")busy(a,"…",async()=>{const {error}=await db.rpc("wakabi_content_submit",{p_content:cid,p_comment:null});if(error){toast(error.message);return}await wfAfter(cid,"Proposé à la validation : la rédaction est prévenue.")});
 else if(act==="wf-valid")wfCommentForm(cid,"valide");
 else if(act==="wf-fix")wfCommentForm(cid,"a_corriger");
 else if(act==="wf-comment")busy(a,"…",async()=>{const txt=$("#wf_comment").value.trim();if(!txt){toast("Écrivez d’abord votre commentaire.");return}
  const {error}=await db.from("content_feedback").insert({content_id:cid,decision:"commentaire",comment:txt}).select("id").single();if(error){toast(error.message);return}await wfAfter(cid,"Commentaire envoyé.")});
 else if(act==="file-open")wfOpenFile(a.dataset.path);
 else if(act==="file-remove"){if(confirm("Retirer ce fichier ? Il ne sera plus proposé, mais rien n’est supprimé."))busy(a,"…",async()=>{const {error}=await db.from("content_files").update({removed_at:new Date().toISOString()}).eq("id",a.dataset.fid).select("id").single();if(error){toast(error.message);return}await wfAfter(cid,"Fichier retiré.")})}
 else if(act==="notif"){markRead([a.dataset.nid]);closeBell();if(a.dataset.cid)contentDetail(a.dataset.cid)}
 else if(act==="notif-all")markRead(unreadNotifs().map(n=>n.id));
});
document.addEventListener("change",e=>{
 if(e.target.id==="wf_file")wfUpload(e.target);
 const tf=e.target.closest("[data-tf]");if(tf){taskTeamFilter[tf.dataset.tf]=tf.value;render("tasks");document.getElementById(tf.id)?.focus()}
});
