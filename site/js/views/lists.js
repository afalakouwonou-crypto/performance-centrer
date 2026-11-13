// Wakabi Performance Center — Écran : lists
"use strict";
let listTab="rubriques";
function listUses(k,id){
 if(k==="platforms")return data.publications.filter(p=>p.platform_id===id).length;
 const col={rubriques:"rubrique_id",content_types:"content_type_id",campaigns:"campaign_id",content_objectives:"objective_id"}[k];
 return data.contents.filter(c=>c[col]===id).length;
}
function lists(){
 if(me.role!=="admin"){home();return}setHead("Administration · Listes","Rubriques, plateformes, types, campagnes et objectifs");
 const k=listTab,rows=data[k]||[],isP=k==="platforms",isC=k==="campaigns";
 $("#page").innerHTML=`<div class="toolbar">${Object.entries(LISTS).map(([id,l])=>`<button class="btn ${id===k?"primary":"soft"}" data-list="${id}">${l}</button>`).join(" ")}</div>
 ${data.listErrors?.includes(k)?`<div class="callout warn">Cette liste n’a pas pu être chargée. Rechargez la page.</div><br>`:""}
 <div class="toolbar"><div class="callout">${isP?"Une nouvelle plateforme demande une évolution technique de la base : demandez-la à l’équipe technique. Ici, vous pouvez renommer, réordonner, désactiver ou archiver une plateforme et indiquer les statistiques qu’elle fournit.":"Une valeur inactive ou archivée n’est plus proposée dans les formulaires mais reste affichée sur les contenus qui l’utilisent. Rien n’est supprimé."}</div>${isP?"":`<button class="btn primary" id="addItem">+ Ajouter</button>`}</div>
 <section class="card"><div class="table-wrap"><table><thead><tr><th>Ordre</th><th>Nom</th>${isP?"<th>Code</th><th>Republications</th><th>Enregistrements</th>":""}${isC?"<th>Nature</th><th>Période</th>":""}<th>Statut</th><th>Utilisations</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.sort_order}</td><td><strong>${esc(x.name)}</strong>${isC&&x.description?`<br><span class="muted">${esc(x.description)}</span>`:""}</td>${isP?`<td>${esc(x.code||"—")}</td><td>${x.supports_reposts===false?"Non fournies":"Oui"}</td><td>${x.supports_saves===false?"Non fournis":"Oui"}</td>`:""}${isC?`<td>${x.kind==="recurring"?"Rendez-vous récurrent":"Campagne datée"}</td><td>${x.start_date||x.end_date?`${frDate(x.start_date)} → ${frDate(x.end_date)}`:"—"}</td>`:""}<td><span class="badge ${x.status==="active"?"green":x.status==="inactive"?"gray":"red"}">${LIST_STATUS[x.status]||x.status}</span></td><td>${listUses(k,x.id)}</td><td><button class="link" data-item="${x.id}">Modifier</button></td></tr>`).join("")||`<tr><td colspan="9" class="muted">Aucune valeur.</td></tr>`}</tbody></table></div></section>`;
 $$("[data-list]").forEach(b=>b.onclick=()=>{listTab=b.dataset.list;lists()});
 $("#addItem")?.addEventListener("click",()=>itemForm(k,null));
 $$("[data-item]").forEach(b=>b.onclick=()=>itemForm(k,b.dataset.item));
}
function itemForm(k,id){
 const x=id?data[k].find(r=>r.id===id):{name:"",sort_order:Math.max(0,...data[k].map(r=>r.sort_order||0))+1,status:"active",kind:"campaign",supports_reposts:true,supports_saves:true};
 if(!x)return;const isP=k==="platforms",isC=k==="campaigns",n=id?listUses(k,id):0;
 // Le titre de fenêtre est affiché comme du texte (modal) : il ne doit pas être échappé une seconde fois.
 modal(`${LISTS[k]} · ${id?x.name:"Nouvelle valeur"}`,`<div class="form-grid">
  <div class="full-span"><label>Nom</label><input id="iName" value="${esc(x.name)}"></div>
  <div><label>Ordre d’affichage</label><input id="iOrder" type="number" value="${x.sort_order??0}"></div>
  <div><label>Statut</label><select id="iStatus">${Object.entries(LIST_STATUS).map(([v,l])=>`<option value="${v}" ${v===x.status?"selected":""}>${l}</option>`).join("")}</select></div>
  ${isP?`<div><label class="check"><input type="checkbox" id="iReposts" ${x.supports_reposts!==false?"checked":""}> Fournit les republications</label></div><div><label class="check"><input type="checkbox" id="iSaves" ${x.supports_saves!==false?"checked":""}> Fournit les enregistrements</label></div>`:""}
  ${isC?`<div><label>Nature</label><select id="iKind"><option value="campaign" ${x.kind!=="recurring"?"selected":""}>Campagne datée</option><option value="recurring" ${x.kind==="recurring"?"selected":""}>Rendez-vous récurrent</option></select></div><div></div><div><label>Début</label><input id="iStart" type="date" value="${x.start_date||""}"></div><div><label>Fin</label><input id="iEnd" type="date" value="${x.end_date||""}"></div><div class="full-span"><label>Description</label><input id="iDesc" value="${esc(x.description||"")}"></div>`:""}
  ${n?`<div class="full-span muted">Utilisée par ${n} ${isP?"publication(s)":"contenu(s)"}.${k==="rubriques"?" Un changement de nom est reporté sur ces contenus.":""}</div>`:""}
  <div class="full-span"><button id="iSave" class="btn primary">${id?"Enregistrer":"Ajouter"}</button></div></div>`);
 $("#iSave").onclick=()=>busy($("#iSave"),"Enregistrement…",async()=>{
  const name=$("#iName").value.trim();if(!name){toast("Le nom est obligatoire.");return}
  const row={name,sort_order:parseInt($("#iOrder").value,10)||0,status:$("#iStatus").value};
  if(isP){row.supports_reposts=$("#iReposts").checked;row.supports_saves=$("#iSaves").checked}
  if(isC){row.kind=$("#iKind").value;row.start_date=$("#iStart").value||null;row.end_date=$("#iEnd").value||null;row.description=$("#iDesc").value.trim()||null;
   if(row.start_date&&row.end_date&&row.end_date<row.start_date){toast("La fin doit être après le début.");return}}
  const {error}=id?await db.from(k).update(row).eq("id",id).select("id").single():await db.from(k).insert(row).select("id").single();
  if(error){toast(/duplicate|unique/i.test(error.message)?"Ce nom existe déjà dans la liste.":error.message);return}
  closeModal();await refresh();toast(id?"Valeur mise à jour.":"Valeur ajoutée.");lists();
 });
}
