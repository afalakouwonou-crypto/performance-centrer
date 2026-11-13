// Wakabi Performance Center — Formulaire : metric
"use strict";
// Bornes de la date d'un relevé (§ 11) : jamais avant l'échéance, jamais après « aujourd'hui » dans le fuseau du pays
// du contenu ; un J+1 se mesure au plus tard le lendemain de l'échéance. Une correction peut garder la date d'origine.
// La base refuse déjà les dates futures (tolérance d'un jour) ; elle ne contrôle pas l'échéance : c'est fait ici.
function readingBounds(p,c,type,prev){
 const due=dueOf(p,c,type),t=todayIn(c.country);let min=due,max=type==="j1"&&addDays(due,1)<t?addDays(due,1):t;
 if(prev){if(prev.measured_on<min)min=prev.measured_on;if(prev.measured_on>max)max=prev.measured_on}
 return {min,max};
}
function metricForm(pid,type="j7",correctId=null){
 const p=data.publications.find(x=>x.id===pid);if(!p)return;const c=data.contents.find(x=>x.id===p.content_id);
 if(!data.readingsOk){toast("Relevés indisponibles : rechargez la page.");return}
 if(!canMetric(p)){toast("Vous ne pouvez pas renseigner cette plateforme.");return}
 if(type==="j1"&&rstate(p,c,"j1")==="missed"){toast("Ce J+1 est manqué : il ne peut plus être saisi comme J+1.");return}
 // Suivi après J+7 : plusieurs relevés possibles ; une correction vise un relevé de suivi précis (le dernier de sa chaîne).
 const f=data.platforms.find(x=>x.id===p.platform_id)||{},prev=type==="other"?(correctId?data.readings.find(r=>r.id===correctId&&r.publication_id===pid)||null:null):effReading(pid,type),corr=!!prev,v=prev||{};
 if(type==="other"&&correctId&&(!prev||data.readings.some(x=>x.corrects_reading_id===prev.id))){toast("Ce relevé a déjà été corrigé : corrigez la dernière version.");return}
 const bd=readingBounds(p,c,type,prev);if(bd.min>bd.max){toast(`Ce relevé ${TYPE_LABEL[type]} n’est pas encore dû : échéance le ${frDate(dueOf(p,c,type))}.`);return}
 const opt=(id,label,ok,val)=>`<div><label>${label}</label><input id="${id}" type="number" min="0" step="1" ${ok?"":"disabled"} value="${ok&&val!=null?val:""}" placeholder="${ok?"vide = non disponible":"N/D : non fourni par la plateforme"}"></div>`;
 modal(`${p.platform} · ${TYPE_LABEL[type]} — ${c.title}`,`<div class="callout">${corr?`<strong>Correction</strong> du relevé ${TYPE_LABEL[type]} du ${frDate(prev.measured_on)}. L’ancien relevé est conservé dans l’historique.`:(type==="other"?`Relevé de <strong>suivi</strong> après le J+7 (à partir du ${frDate(dueOf(p,c,type))}), ${basisLabel(p,c)}.`:`Relevé <strong>${TYPE_LABEL[type]}</strong>, échéance ${frDate(dueOf(p,c,type))}, ${basisLabel(p,c)}.`)}</div>
 <div class="form-grid"><div><label>Date du relevé</label><input id="mdate" type="date" min="${bd.min}" max="${bd.max}" value="${corr?prev.measured_on:bd.max}"></div><div class="field-hint">Entre le ${frDate(bd.min)} et le ${frDate(bd.max)}</div>
 <div><label>Vues</label><input id="mv" type="number" min="0" step="1" value="${v.views??""}"></div><div><label>Likes</label><input id="ml" type="number" min="0" step="1" value="${v.likes??""}"></div>
 <div><label>Commentaires</label><input id="mc" type="number" min="0" step="1" value="${v.comments??""}"></div><div><label>Partages</label><input id="ms" type="number" min="0" step="1" value="${v.shares??""}"></div>
 ${opt("mr","Republications (facultatif)",f.supports_reposts!==false,v.reposts)}${opt("msa","Enregistrements (facultatif)",f.supports_saves!==false,v.saves)}
 ${corr?`<div class="full-span"><label>Motif de la correction (obligatoire)</label><input id="mreason" placeholder="Ex. : chiffre mal recopié"></div>`:""}
 <div class="full-span"><button id="saveMetric" class="btn primary">${corr?"Enregistrer la correction":"Enregistrer"}</button></div></div>`);
 $("#saveMetric").onclick=()=>busy($("#saveMetric"),"Enregistrement…",async()=>{
  const num=(id,req)=>{const el=$(id),raw=el.value.trim();if(el.disabled||raw==="")return req?NaN:null;const n=Number(raw);return Number.isInteger(n)&&n>=0?n:NaN};
  const row={publication_id:pid,reading_type:type,views:num("#mv",1),likes:num("#ml",1),comments:num("#mc",1),shares:num("#ms",1),reposts:num("#mr"),saves:num("#msa"),measured_on:$("#mdate").value};
  if(["views","likes","comments","shares"].some(k=>Number.isNaN(row[k]))){toast("Vues, likes, commentaires et partages sont obligatoires (nombres entiers, 0 ou plus).");return}
  if(Number.isNaN(row.reposts)||Number.isNaN(row.saves)){toast("Republications et enregistrements : nombre entier ou vide.");return}
  if(!row.measured_on||row.measured_on<bd.min||row.measured_on>bd.max){toast(`La date du relevé doit être comprise entre le ${frDate(bd.min)} et le ${frDate(bd.max)} : ${type==="j1"?"un J+1 se mesure le jour J+1 ou le lendemain":"un J+7 se mesure à partir de J+7, jamais dans le futur"}.`);return}
  if(corr){const reason=$("#mreason").value.trim();if(!reason){toast("Indiquez le motif de la correction.");return}row.corrects_reading_id=prev.id;row.correction_reason=reason}
  const {error}=await db.from("metric_readings").insert(row).select("id").single();
  // 23505 = la base a refusé un doublon (un seul relevé d'origine, une seule correction par relevé) : une autre
  // personne vient d'enregistrer ce relevé. On recharge pour montrer la dernière version.
  if(error?.code==="23505"){closeModal();await refresh();render(active);toast("Ce relevé vient d’être saisi ou corrigé par quelqu’un d’autre. La page a été rechargée : vérifiez la dernière version avant de corriger.");return}
  if(error){toast(error.message);return}
  closeModal();await refresh();toast(corr?"Correction enregistrée.":"Relevé enregistré.");render(active);
 });
}
