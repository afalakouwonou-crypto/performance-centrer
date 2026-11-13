// Wakabi Performance Center — Écran : team
"use strict";
let showArchived=false;
function memberStatus(p){
 if(p.archived_at)return `<span class="badge red">Retiré</span>`;
 return `<span class="badge ${p.active?"green":"gray"}">${p.active?"Actif":"Inactif"}</span>${p.must_change_password?` <span class="badge yellow">Mot de passe à choisir</span>`:""}`;
}
function admin(){
 if(me.role!=="admin"){home();return}setHead("Administration · Équipe","Membres, rôles et plateformes");
 const rows=data.profiles.filter(p=>showArchived||!p.archived_at);
 const nArch=data.profiles.filter(p=>p.archived_at).length;
 const intro=ID_MODE?`<div class="callout">Chaque membre a un <strong>identifiant personnel</strong> (jamais réattribué) et une adresse email privée pour la récupération. Vous créez le compte avec un mot de passe provisoire, à lui transmettre de vive voix ou par un canal sûr : il devra le changer à sa première connexion. Tout le monde se reconnecte chaque lundi.</div><button class="btn primary" id="newMember">+ Nouveau membre</button>`
  :`<div class="callout">Ajouter un membre : Supabase › Authentication › Users › <strong>Invite user</strong>. Il apparaît ici comme inactif : activez-le et choisissez son rôle. À sa première connexion, il choisit son mot de passe.</div>`;
 $("#page").innerHTML=`<div class="toolbar">${intro}${nArch?`<button class="btn soft" id="toggleArch">${showArchived?"Masquer":"Afficher"} les membres retirés (${nArch})</button>`:""}</div>
 <section class="card"><div class="table-wrap"><table><thead><tr><th>Nom</th>${ID_MODE?"<th>Identifiant</th>":""}<th>Email</th><th>Rôle</th><th>Pays</th><th>Plateformes</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map(p=>{
  const pf=(data.assignments||[]).filter(a=>a.profile_id===p.id&&!a.revoked_at).map(a=>data.platforms.find(f=>f.id===a.platform_id)).filter(Boolean);
  return `<tr><td><strong>${esc(p.full_name)}</strong>${p.id===me.id?` <span class="muted">(vous)</span>`:""}</td>${ID_MODE?`<td>${p.username?`<code>${esc(p.username)}</code>`:`<span class="muted">—</span>`}</td>`:""}<td>${esc(p.email)}</td><td>${esc(ROLES[p.role]||p.role)}${p.job_title?`<br><span class="muted">${esc(p.job_title)}</span>`:""}</td><td>${esc(p.country||"Global")}</td><td>${pf.length?pf.map(f=>`<span class="badge blue">${esc(f.name)}${f.code===p.platform?" ★":""}</span> `).join(""):"—"}</td><td>${memberStatus(p)}</td><td><button class="link" data-member="${p.id}">Modifier</button></td></tr>`}).join("")}</tbody></table></div>
 <p class="muted">★ plateforme principale. Un membre retiré garde tout son historique mais ne peut plus se connecter. La base refuse toute opération qui laisserait l’équipe sans administrateur actif.</p></section>`;
 $("#toggleArch")?.addEventListener("click",()=>{showArchived=!showArchived;admin()});
 $("#newMember")?.addEventListener("click",()=>newMemberForm());
 $$("[data-member]").forEach(b=>b.onclick=()=>memberForm(b.dataset.member));
}
// Toute écriture est contrôlée par la base (règles RLS et déclencheurs) ; son message d'erreur est affiché tel quel.
// Les boutons de la fenêtre sont désactivés pendant l'envoi (pas de double clic).
async function saveTeam(fn,okMsg,id,syncAccess=false){
 const btns=$$("#modalBody button");if(btns.some(b=>b.disabled))return false;btns.forEach(b=>b.disabled=true);
 try{
  const {error}=await fn();
  if(error){toast(error.message);return false}
  // Mode identifiant : bloque ou débloque aussi le compte dans Supabase Auth (la base refuse déjà l'accès).
  if(syncAccess&&ID_MODE){const r=await authFn({action:"sync_access",target:id});if(!r.ok)okMsg+=" Attention : "+(r.message||"blocage Auth non appliqué.")}
  await refresh();toast(okMsg);admin();if(id)memberForm(id);return true;
 }finally{btns.forEach(b=>b.disabled=false)}
}
function memberForm(id){
 const p=data.profiles.find(x=>x.id===id);if(!p)return;
 const self=p.id===me.id,arch=!!p.archived_at,dis=arch?"disabled":"";
 const roles=[...new Set([...ASSIGNABLE_ROLES,p.role])];
 const enumPlatforms=data.platforms.filter(f=>["TikTok","Instagram","Facebook","Snapchat","YouTube"].includes(f.code));
 const asg=(data.assignments||[]).filter(a=>a.profile_id===p.id);
 modal(p.full_name,`${arch?`<div class="callout warn">Membre retiré le ${frDate(p.archived_at.slice(0,10))}. Annulez le retrait pour pouvoir le modifier ou le réactiver.</div><br>`:""}
 ${self?`<div class="callout">C’est votre propre compte : la base refusera toute modification qui laisserait l’équipe sans administrateur actif.</div><br>`:""}
 ${ID_MODE?`<p>Identifiant : ${p.username?`<code>${esc(p.username)}</code> <span class="muted">(définitif)</span>`:`<span class="muted">aucun (compte antérieur aux identifiants)</span>`} · Email de récupération : ${esc(p.email)}</p>`:""}
 <div class="form-grid">
  <div><label>Nom</label><input id="mName" value="${esc(p.full_name)}" ${dis}></div>
  <div><label>Intitulé du poste (affiché)</label><input id="mJob" value="${esc(p.job_title||"")}" placeholder="${esc(ROLES[p.role]||"")}" ${dis}></div>
  <div><label>Rôle (droits)</label><select id="mRole" ${dis}>${roles.map(r=>`<option value="${r}" ${r===p.role?"selected":""}>${esc(ROLES[r]||r)}</option>`).join("")}</select></div>
  <div><label>Pays</label><select id="mCountry" ${dis}><option value="">Global</option>${COUNTRIES.map(c=>`<option ${c===p.country?"selected":""}>${c}</option>`).join("")}</select></div>
  <div><label>Plateforme principale</label><select id="mPlatform" ${dis}><option value="">—</option>${enumPlatforms.map(f=>`<option value="${f.code}" ${f.code===p.platform?"selected":""}>${esc(f.name)}</option>`).join("")}</select></div>
  <div><label>Accès</label><select id="mActive" ${dis}><option value="1" ${p.active?"selected":""}>Actif</option><option value="0" ${!p.active?"selected":""}>Inactif</option></select></div>
  ${arch?"":`<div class="full-span"><button id="mSave" class="btn primary">Enregistrer</button></div>`}
 </div>
 <div class="section-head"><h3>Plateformes affectées</h3></div>
 <p class="muted">Un responsable plateforme ne peut saisir les statistiques que des plateformes qui lui sont affectées.</p>
 <div class="task-list">${data.platforms.map(f=>{const a=asg.find(x=>x.platform_id===f.id);
  const state=!a?"Non affectée":a.revoked_at?`Révoquée le ${frDate(a.revoked_at.slice(0,10))}`:"Affectée";
  const btn=arch?"":!a?`<button class="btn soft" data-assign="${f.id}">Affecter</button>`:a.revoked_at?`<button class="btn soft" data-reassign="${a.id}">Réactiver</button>`:`<button class="btn danger" data-revoke="${a.id}">Révoquer</button>`;
  return `<div class="task"><div><strong>${esc(f.name)}${f.code===p.platform?" ★":""}</strong><span>${state}${f.status!=="active"?" · plateforme inactive":""}</span></div>${btn}</div>`}).join("")}</div>
 ${arch?"":`<div class="section-head"><h3>Mot de passe</h3></div>
 ${p.must_change_password?`<div class="callout warn">Ce membre devra choisir un nouveau mot de passe à sa prochaine connexion. Seul un vrai changement de mot de passe lève cette obligation.</div>`:`<button id="mForcePwd" class="btn soft">Exiger un nouveau mot de passe</button> <span class="muted">Son accès est suspendu jusqu’à ce qu’il en choisisse un.</span>`}
 ${ID_MODE&&!self?`<div class="form-grid" style="margin-top:10px"><div><label>Nouveau mot de passe provisoire</label><input id="mProvPwd" type="text" autocomplete="off" minlength="8" placeholder="8 caractères minimum"></div>
  <div><label>&nbsp;</label><button id="mGenPwd" class="btn soft" type="button">Générer</button> <button id="mSetPwd" class="btn primary" type="button">Définir</button></div></div>
  <p class="muted">Ses sessions ouvertes sont fermées et il devra choisir son propre mot de passe à la connexion suivante.</p>`:""}`}
 <div class="section-head"><h3>Retrait de l’équipe</h3></div>
 ${arch?`<button id="mUnarchive" class="btn soft">Annuler le retrait</button> <span class="muted">Le membre restera inactif jusqu’à sa réactivation.</span>`:`<button id="mArchive" class="btn danger">Retirer ce membre</button> <span class="muted">Désactive le compte ; rien n’est supprimé.</span>`}`);
 $("#mSave")?.addEventListener("click",()=>{
  const name=$("#mName").value.trim();if(!name){toast("Le nom est obligatoire.");return}
  saveTeam(()=>db.from("profiles").update({full_name:name,job_title:$("#mJob").value.trim()||null,role:$("#mRole").value,
   country:$("#mCountry").value||null,platform:$("#mPlatform").value||null,active:$("#mActive").value==="1"}).eq("id",p.id).select("id").single(),"Membre mis à jour.",p.id,($("#mActive").value==="1")!==!!p.active)});
 $$("[data-assign]").forEach(b=>b.onclick=()=>saveTeam(()=>db.from("profile_platforms").insert({profile_id:p.id,platform_id:b.dataset.assign}),"Plateforme affectée.",p.id));
 $$("[data-revoke]").forEach(b=>b.onclick=()=>saveTeam(()=>db.from("profile_platforms").update({revoked_at:new Date().toISOString()}).eq("id",b.dataset.revoke).select("id").single(),"Affectation révoquée.",p.id));
 $$("[data-reassign]").forEach(b=>b.onclick=()=>saveTeam(()=>db.from("profile_platforms").update({revoked_at:null}).eq("id",b.dataset.reassign).select("id").single(),"Affectation réactivée.",p.id));
 $("#mArchive")?.addEventListener("click",()=>{if(confirm(`Retirer ${p.full_name} de l’équipe ? Son compte sera désactivé ; son historique est conservé.`))saveTeam(()=>db.from("profiles").update({archived_at:new Date().toISOString()}).eq("id",p.id).select("id").single(),ID_MODE?"Membre retiré : sessions fermées et connexion bloquée.":"Membre retiré.",p.id,true)});
 $("#mForcePwd")?.addEventListener("click",()=>{if(confirm(`Exiger que ${p.full_name} choisisse un nouveau mot de passe ? Son accès aux données est suspendu jusque-là.`))saveTeam(()=>db.from("profiles").update({must_change_password:true}).eq("id",p.id).select("id").single(),"Nouveau mot de passe exigé.",p.id)});
 $("#mUnarchive")?.addEventListener("click",()=>saveTeam(()=>db.from("profiles").update({archived_at:null}).eq("id",p.id).select("id").single(),"Retrait annulé.",p.id,true));
 $("#mGenPwd")?.addEventListener("click",()=>{$("#mProvPwd").value=genPassword()});
 $("#mSetPwd")?.addEventListener("click",()=>{const pw=$("#mProvPwd").value;if(pw.length<8){toast("8 caractères minimum.");return}
  if(confirm(`Définir ce mot de passe provisoire pour ${p.full_name} ? Ses sessions ouvertes seront fermées.`))
   saveTeam(async()=>{const r=await authFn({action:"set_password",target:p.id,password:pw});return {error:r.ok?null:{message:r.message}}},"Mot de passe provisoire défini : transmettez-le de vive voix.",p.id)});
}
// Mot de passe provisoire aléatoire (sans caractères ambigus), généré dans le navigateur et jamais enregistré par l'application.
function genPassword(n=12){const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-";const v=crypto.getRandomValues(new Uint32Array(n));return [...v].map(x=>a[x%a.length]).join("")}
const usernameBase=name=>String(name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().split(/\s+/)[0].replace(/[^a-z0-9._-]/g,"");
// Création d'un compte par l'administrateur (mode identifiant).
function newMemberForm(){
 const enumPlatforms=data.platforms.filter(f=>PLATFORM_CODES.includes(f.code));
 modal("Nouveau membre",`<div class="callout">Le rôle, le poste et les plateformes sont indépendants de l’identifiant et pourront changer ensuite. Pour remplacer une personne partie, créez un nouveau compte et reprenez ses affectations : l’historique de l’ancienne reste à son nom.</div><br>
 <div class="form-grid">
  <div class="full-span"><label>Reprendre le rôle et les plateformes de (facultatif)</label><select id="nCopy"><option value="">—</option>${data.profiles.map(x=>`<option value="${x.id}">${esc(x.full_name)}${x.archived_at?" (retiré)":""}</option>`).join("")}</select></div>
  <div><label>Nom complet</label><input id="nName" autocomplete="off"></div>
  <div><label>Identifiant de connexion</label><input id="nUser" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ex. clemence"><button class="link" id="nSuggest" type="button">Proposer un identifiant libre</button></div>
  <div><label>Email personnel (récupération)</label><input id="nEmail" type="email" autocomplete="off"></div>
  <div><label>Intitulé du poste (affiché)</label><input id="nJob"></div>
  <div><label>Rôle (droits)</label><select id="nRole">${ASSIGNABLE_ROLES.map(r=>`<option value="${r}" ${r==="platform_manager"?"selected":""}>${esc(ROLES[r]||r)}</option>`).join("")}</select></div>
  <div><label>Pays</label><select id="nCountry"><option value="">Global</option>${COUNTRIES.map(c=>`<option>${c}</option>`).join("")}</select></div>
  <div><label>Plateforme principale</label><select id="nPlatform"><option value="">—</option>${enumPlatforms.map(f=>`<option value="${f.code}">${esc(f.name)}</option>`).join("")}</select></div>
  <div class="full-span"><label>Autres plateformes affectées</label>${data.platforms.filter(f=>f.status==="active").map(f=>`<label class="check"><input type="checkbox" class="nPf" value="${f.id}"> ${esc(f.name)}</label>`).join(" ")}</div>
  <div><label>Mot de passe provisoire</label><input id="nPwd" type="text" autocomplete="off" minlength="8" placeholder="8 caractères minimum"><button class="link" id="nGen" type="button">Générer</button></div>
  <div class="full-span"><button id="nCreate" class="btn primary">Créer le compte</button></div>
 </div><div id="nError" class="error hidden"></div>`);
 $("#nCopy").onchange=()=>{const x=data.profiles.find(y=>y.id===$("#nCopy").value);if(!x)return;
  $("#nRole").value=ASSIGNABLE_ROLES.includes(x.role)?x.role:"platform_manager";$("#nJob").value=x.job_title||"";$("#nCountry").value=x.country||"";$("#nPlatform").value=x.platform||"";
  const ids=(data.assignments||[]).filter(a=>a.profile_id===x.id&&(!a.revoked_at||x.archived_at)).map(a=>a.platform_id);$$(".nPf").forEach(c=>c.checked=ids.includes(c.value))};
 const suggest=async()=>{const base=$("#nUser").value.trim()||usernameBase($("#nName").value);if(!base)return;const r=await db.rpc("wakabi_username_suggestion",{p_base:usernameBase(base)});if(!r.error)$("#nUser").value=r.data};
 $("#nSuggest").onclick=suggest;$("#nName").onblur=()=>{if(!$("#nUser").value)suggest()};
 $("#nGen").onclick=()=>{$("#nPwd").value=genPassword()};
 $("#nCreate").onclick=()=>busy($("#nCreate"),"Création…",async()=>{
  authMessage("#nError","");
  const body={action:"create_user",full_name:$("#nName").value.trim(),username:$("#nUser").value.trim().toLowerCase(),email:$("#nEmail").value.trim(),
   job_title:$("#nJob").value.trim()||null,role:$("#nRole").value,country:$("#nCountry").value||null,platform:$("#nPlatform").value||null,
   platform_ids:$$(".nPf").filter(c=>c.checked).map(c=>c.value),password:$("#nPwd").value};
  if(!body.full_name||!body.username||!body.email||body.password.length<8){authMessage("#nError","Nom, identifiant, email et mot de passe provisoire (8 caractères minimum) sont obligatoires.");return}
  const r=await authFn(body);
  if(!r.ok){authMessage("#nError",r.message||"Création impossible.");return}
  await refresh();admin();memberForm(r.id);toast(`Compte « ${r.username} » créé : transmettez le mot de passe provisoire de vive voix.`);
 });
}
