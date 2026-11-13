// Wakabi Performance Center — Formulaire : content
"use strict";
// Options d'une liste : valeurs actives, plus la valeur déjà enregistrée sur la fiche même si elle n'est plus active.
const opts=(k,blank,cur)=>(blank?`<option value="">${blank}</option>`:"")+(data[k]||[]).filter(x=>x.status==="active"||x.id===cur)
 .map(x=>`<option value="${x.id}" ${x.id===cur?"selected":""}>${esc(x.name)}${x.status!=="active"?` (${(LIST_STATUS[x.status]||x.status).toLowerCase()})`:""}</option>`).join("");
const safeUrl=u=>/^https?:\/\//i.test(u||"");
function openNewContent(){contentForm(null)}
function contentForm(cid){
 const c=cid?data.contents.find(x=>x.id===cid):null;if(cid&&!c)return;
 const pubs=c?pubsFor(c.id):[];
 // Plateformes proposées : actives, plus celles où le contenu est déjà publié.
 const pf=[...pubPlatforms(),...data.platforms.filter(f=>pubs.some(p=>onPlatform(p,f))&&!pubPlatforms().includes(f))];
 const curRub=c?.rubrique_id||data.rubriques.find(r=>r.name===c?.rubrique)?.id;
 if(!c&&!activeOf("rubriques").length){toast(data.listErrors?.length?"Listes indisponibles : rechargez la page.":"Aucune rubrique active : l’administrateur doit en activer une.");return}
 modal(c?"Modifier le contenu":"Nouveau contenu",`<div class="form-grid"><div class="full-span"><label>Titre</label><input id="ctitle" value="${esc(c?.title||"")}" placeholder="On va où là ? — Restaurant X"></div>
 <div><label>Concept</label><input id="cconcept" value="${esc(c?.concept||"")}"></div><div><label>Rubrique</label><select id="crub">${opts("rubriques","",curRub)}</select></div>
 <div><label>Type de contenu</label><select id="ctype">${opts("content_types","— Non précisé",c?.content_type_id)}</select></div><div><label>Campagne</label><select id="ccamp">${opts("campaigns","— Aucune",c?.campaign_id)}</select></div>
 <div><label>Objectif principal</label><select id="cobj">${opts("content_objectives","— Non précisé",c?.objective_id)}</select></div><div><label>Pays</label><select id="ccountry">${COUNTRIES.map(x=>`<option ${x===c?.country?"selected":""}>${x}</option>`).join("")}</select></div>
 <div><label>Date de publication prévue</label><input id="cdate" type="date" value="${c?.publish_date||today()}"></div><div></div>
 <div class="full-span"><label>Légende (caption)</label><textarea id="ccaption" rows="3">${esc(c?.caption||"")}</textarea></div>
 <div class="full-span"><label>Script</label><textarea id="cscript" rows="5">${esc(c?.script||"")}</textarea></div>
 <div class="full-span"><label>Liens par plateforme</label>${c?`<span class="muted">Un lien déjà enregistré peut être corrigé mais pas vidé : la publication et ses statistiques sont conservées.</span>`:""}</div>
 ${pf.map(f=>{const pub=pubs.find(p=>onPlatform(p,f));return `<div><label>${esc(f.name)}${f.status!=="active"?" (inactive)":""}</label><input id="p_${f.id}" value="${esc(pub?.url||"")}" placeholder="https://...">${data.has07?`<input id="d_${f.id}" type="date" max="${todayIn(c?.country||"Togo")}" value="${pub?.published_on||""}" title="Date effective de publication (vide = pas encore connue)" class="mt-6">`:""}${data.has10?`<select id="pr_${f.id}" class="mt-6" aria-label="Diffusion sur ${esc(f.name)}">${Object.entries(PROMO).map(([k,l])=>`<option value="${k}"${k===(pub?.promotion||"inconnu")?" selected":""}>${k==="inconnu"?"Diffusion non précisée":l}</option>`).join("")}</select>`:""}</div>`}).join("")}
 ${data.has07?`<div class="full-span muted">Sous chaque lien : la date effective de publication sur la plateforme. Laissez-la vide si elle n’est pas connue : l’échéance sera alors estimée à partir de la date prévue.</div>`:""}
 <div class="full-span"><button id="saveContent" class="btn primary">${c?"Enregistrer":"Créer"}</button></div></div>`);
 // « Aujourd'hui » pour la date effective = jour du pays choisi (Lomé UTC+0, Porto-Novo UTC+1), recalculé si le pays change.
 $("#ccountry").onchange=()=>{const m=todayIn($("#ccountry").value);$$('#modalBody input[id^="d_"]').forEach(i=>i.max=m)};
 $("#saveContent").onclick=()=>busy($("#saveContent"),c?"Enregistrement…":"Création…",async()=>{
  const title=$("#ctitle").value.trim();if(!title){toast("Ajoute un titre.");return}
  if(!$("#cdate").value){toast("Indique la date de publication prévue.");return}
  const rub=data.rubriques.find(r=>r.id===$("#crub").value);if(!rub){toast("Choisis une rubrique.");return}
  const links=pf.map(f=>({f,pub:pubs.find(p=>onPlatform(p,f)),url:$("#p_"+CSS.escape(f.id)).value.trim(),date:data.has07?($("#d_"+CSS.escape(f.id)).value||null):undefined,promo:data.has10?$("#pr_"+CSS.escape(f.id)).value:undefined}));
  if(links.some(x=>x.date&&!x.url)){toast("Une date de publication demande un lien.");return}
  if(links.some(x=>x.date&&x.date>todayIn($("#ccountry").value))){toast("Une date de publication ne peut pas être dans le futur (jour du pays du contenu).");return}
  if(links.some(x=>x.pub&&!x.url)){toast("Un lien déjà enregistré ne peut pas être vidé.");return}
  if(links.some(x=>x.url&&x.url!==x.pub?.url&&!safeUrl(x.url))){toast("Chaque lien doit commencer par https://");return}
  const row={title,concept:$("#cconcept").value.trim(),rubrique:rub.name,rubrique_id:rub.id,content_type_id:$("#ctype").value||null,campaign_id:$("#ccamp").value||null,
   objective_id:$("#cobj").value||null,country:$("#ccountry").value,publish_date:$("#cdate").value,caption:$("#ccaption").value.trim()||null,script:$("#cscript").value.trim()||null};
  const {data:saved,error}=c?await db.from("contents").update(row).eq("id",c.id).select().single()
   :await db.from("contents").insert({...row,created_by:me.id}).select().single();
  if(error){toast(error.message);return}
  const errs=[];
  const dateChanged=x=>x.date!==undefined&&x.date!==(x.pub.published_on||null);
  const promoChanged=x=>x.promo!==undefined&&x.promo!==(x.pub.promotion||"inconnu");
  const added=links.filter(x=>!x.pub&&x.url),changed=links.filter(x=>x.pub&&(x.url!==x.pub.url||dateChanged(x)||promoChanged(x)));
  if(added.length){const {error:e}=await db.from("publications").insert(added.map(x=>({content_id:saved.id,platform:x.f.code,url:x.url,...(x.date?{published_on:x.date}:{}),...(x.promo&&x.promo!=="inconnu"?{promotion:x.promo}:{})})));if(e)errs.push(e.message)}
  for(const x of changed){const upd={};if(x.url!==x.pub.url)upd.url=x.url;if(dateChanged(x))upd.published_on=x.date;if(promoChanged(x))upd.promotion=x.promo;
   const {error:e}=await db.from("publications").update(upd).eq("id",x.pub.id).select("id").single();if(e)errs.push(x.f.name+" : "+e.message)}
  closeModal();await refresh();
  if(errs.length)toast((c?"Contenu enregistré":"Contenu créé")+", mais des liens ou des dates n’ont pas été enregistrés : "+errs.join(" ; "));else toast(c?"Contenu mis à jour.":"Contenu créé.");
  render(active==="contents"?"contents":active);contentDetail(saved.id);
 });
}
