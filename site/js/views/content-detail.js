// Wakabi Performance Center — Écran : content-detail
"use strict";
const nameOf=(k,id)=>(data[k]||[]).find(x=>x.id===id)?.name;
// Fiche contenu : informations, performance (relevé de référence), publications avec J+1 / J+7 / suivi, historique complet.
function contentDetail(cid){
 const c=data.contents.find(x=>x.id===cid);if(!c)return;const ps=pubsFor(cid),s=statsOf(ps);
 const info=[["Rubrique",c.rubrique],["Type",nameOf("content_types",c.content_type_id)],["Campagne",nameOf("campaigns",c.campaign_id)],["Objectif principal",nameOf("content_objectives",c.objective_id)],
  ["Pays",c.country],["Publication prévue",frDate(c.publish_date)],["Créé le",c.created_at?frDate(c.created_at.slice(0,10)):null],["Modifié le",c.updated_at?frDate(c.updated_at.slice(0,10)):null]];
 const canM=p=>canMetric(p)&&!c.archived_at&&data.readingsOk;
 const cell=(p,type)=>{const st=rstate(p,c,type),r=effReading(p.id,type);
  const val=r&&isDone(st)?`<span><strong>${compact(r.views)}</strong> vues</span>`:"";
  const sub=st==="done_late"?`<span class="meta">${offsetLabel(p,c,type)}</span>`:st==="upcoming"?`<span class="meta">le ${frDate(dueOf(p,c,type))}</span>`:"";
  const act=canM(p)&&["due","late","done","done_late"].includes(st)?`<button type="button" class="link sm" data-act="metric" data-pid="${p.id}" data-type="${type}">${isDone(st)?"Corriger":"Saisir"}</button>`:"";
  return `<div class="cellstack">${stateBadge(st)}${val}${sub}${act}</div>`};
 const growth=p=>{const a=effReading(p.id,"j1"),b=effReading(p.id,"j7");if(!a||!b)return ND;const ev=evolution(a.views,b.views);
  return `<span class="${ev.abs>=0?"pos":"neg"}">${ev.abs>=0?"+":"−"}${compact(Math.abs(ev.abs))}</span>${ev.rel!=null?`<span class="meta">${ev.rel>=0?"+":"−"}${Math.abs(ev.rel*100).toFixed(0)} %</span>`:""}`};
 const ORIG={direct:"Saisie",metrics_legacy:"Reprise de l’ancienne table",metrics_sync:"Ancienne interface"};
 const hist=data.readings.filter(r=>ps.some(p=>p.id===r.publication_id)).sort((a,b)=>a.entered_at<b.entered_at?1:-1);
 const replaced=r=>hist.some(x=>x.corrects_reading_id===r.id);
 modal(c.title,`${degradedHtml()}${c.archived_at?`<div class="callout warn">${icon("archive",18)}<div>Contenu archivé le ${frDate(c.archived_at.slice(0,10))}. Il n’apparaît plus dans les relevés à faire ; ses statistiques sont conservées.</div></div>`:""}
 ${c.concept?`<p class="lead">${esc(c.concept)}</p>`:""}
 <dl class="info-grid">${info.map(([l,v])=>`<div><dt>${l}</dt><dd>${esc(v||"—")}</dd></div>`).join("")}</dl>
 ${c.caption?`<h3 class="sub-title">Légende</h3><div class="callout prewrap">${esc(c.caption)}</div>`:""}
 ${c.script?`<details class="help-box"><summary>Script</summary><div class="prewrap">${esc(c.script)}</div></details>`:""}
 <div class="section-head"><h3>Performance</h3>${refSwitch(c.id)}</div>
 <div class="grid kpis small">${tile(`Vues (${REF_LABEL[refType]})`,s.n?compact(s.views):ND,{note:`${s.n} publication(s) mesurée(s) sur ${ps.length}`})}${tile("Interactions",s.n?compact(s.interactions):ND)}${tile("Taux d’interaction",pctv(s.rate),{note:"pondéré"})}${tile("Partages",s.n?compact(s.shares):ND)}</div>
 <p class="meta">Somme sur les publications mesurées : c’est un volume de vues, pas un nombre de personnes.</p>
 <h3 class="sub-title">Publications</h3>
 ${ps.length?`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Publications de ce contenu</caption><thead><tr><th scope="col">Plateforme</th><th scope="col">Publication</th><th scope="col">J+1</th><th scope="col">J+7</th><th scope="col" class="num">J+1 → J+7</th><th scope="col" class="num">Taux ${REF_LABEL[refType]}</th><th scope="col" class="num">Republ.</th><th scope="col" class="num">Enreg.</th><th scope="col"><span class="sr-only">Suivi</span></th></tr></thead><tbody>${ps.map(p=>{const f=data.platforms.find(x=>x.id===p.platform_id)||{},r=refReading(p);
  const ndv=(ok,val)=>!r?"—":ok===false?`<span class="nd" title="Non fourni par la plateforme">N/D</span>`:val==null?ND:compact(val);
  return `<tr><th scope="row" data-label="Plateforme">${esc(platformName(p))}${safeUrl(p.url)?`<a class="ext" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${icon("external",13)}Voir la publication</a>`:`<span class="meta">${esc(p.url||"—")}</span>`}</th>
  <td data-label="Publication">${p.published_on?frDate(p.published_on):`<span class="meta">Estimée : ${frDate(c.publish_date)}</span>`}${data.has10&&p.promotion&&p.promotion!=="inconnu"?`<span class="meta">${PROMO[p.promotion]}</span>`:""}</td><td data-label="J+1">${cell(p,"j1")}</td><td data-label="J+7">${cell(p,"j7")}</td><td class="num" data-label="J+1 → J+7">${growth(p)}</td><td class="num" data-label="Taux">${r?pctv(rateOf(+r.views,interactionsOf(r))):"—"}</td><td class="num" data-label="Republications">${ndv(f.supports_reposts,r?.reposts)}</td><td class="num" data-label="Enregistrements">${ndv(f.supports_saves,r?.saves)}</td>
  <td class="act">${canM(p)&&isDone(rstate(p,c,"j7"))?`<button type="button" class="btn sm ghost" data-act="metric" data-pid="${p.id}" data-type="other">${icon("plus",14)}Relevé de suivi</button>`:""}</td></tr>`}).join("")}</tbody></table></div>`:emptyState("Aucune publication enregistrée.","contents",canEdit()&&!c.archived_at?`<button type="button" class="btn ghost" id="cEdit2">Ajouter les liens</button>`:"")}
 ${hist.length?`<details class="help-box"${hist.length<=6?" open":""}><summary>Historique des relevés (${hist.length})</summary><div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Historique des relevés</caption><thead><tr><th scope="col">Saisi le</th><th scope="col">Plateforme</th><th scope="col">Type</th><th scope="col">Date du relevé</th><th scope="col" class="num">Vues</th><th scope="col" class="num">Interactions</th><th scope="col">Origine</th><th scope="col">Correction</th></tr></thead><tbody>${hist.map(r=>{const pub=ps.find(p=>p.id===r.publication_id),rep=replaced(r);
  return `<tr${rep?' class="is-replaced"':""}><td data-label="Saisi le">${r.entered_at?frDate(r.entered_at.slice(0,10)):"—"}</td><td data-label="Plateforme">${esc(pub?platformName(pub):"")}</td><td data-label="Type">${TYPE_LABEL[r.reading_type]||"Autre"}</td><td data-label="Date du relevé">${frDate(r.measured_on)}</td><td class="num" data-label="Vues">${fmt(r.views)}</td><td class="num" data-label="Interactions">${fmt(interactionsOf(r))}</td><td data-label="Origine">${ORIG[r.origin]||esc(r.origin)}</td><td data-label="Correction">${r.correction_reason?esc(r.correction_reason):""}${rep?` <span class="badge neutral">Remplacé</span>`:""}${!rep&&r.reading_type==="other"&&pub&&canM(pub)?` <button type="button" class="link sm" data-act="metric" data-pid="${pub.id}" data-type="other" data-correct="${r.id}">Corriger</button>`:""}</td></tr>`}).join("")}</tbody></table></div></details>`:""}
 <section id="wfBox" class="wf" aria-live="polite"></section>
 ${canEdit()?`<div class="modal-actions">${c.archived_at?`<button id="cUnarch" type="button" class="btn ghost">${icon("refresh",16)}Désarchiver</button>`:`<button id="cArch" type="button" class="btn danger-ghost">${icon("archive",16)}Archiver</button><button id="cEdit" type="button" class="btn primary">Modifier</button>`}</div>`:""}`);
 loadWorkflow(c.id);
 $("#cEdit")?.addEventListener("click",()=>contentForm(c.id));$("#cEdit2")?.addEventListener("click",()=>contentForm(c.id));
 const arch=v=>busy($(v?"#cArch":"#cUnarch"),"…",async()=>{const {error}=await db.from("contents").update({archived_at:v?new Date().toISOString():null}).eq("id",c.id).select("id").single();
  if(error){toast(error.message);return}await refresh();toast(v?"Contenu archivé.":"Contenu désarchivé.");render(active);contentDetail(c.id)});
 $("#cArch")?.addEventListener("click",()=>{if(confirm("Archiver ce contenu ? Il ne sera plus proposé dans les relevés à faire. Rien n’est supprimé."))arch(true)});
 $("#cUnarch")?.addEventListener("click",()=>arch(false));
}
