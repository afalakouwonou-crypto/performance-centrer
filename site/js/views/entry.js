// Wakabi Performance Center — Écran : entry
"use strict";
// ---------- Saisie ----------
function entry(){
 setHead("Saisie","Relevés J+1 et J+7, regroupés par contenu");
 const t=tasks(),mine=[],gp=gaps(),up=upcomingTasks(7);
 for(const c of data.contents.filter(x=>!x.archived_at))for(const p of pubsFor(c.id))if(canMetric(p))for(const type of ["j1","j7"])mine.push({c,p,type,state:rstate(p,c,type)});
 const done=mine.filter(x=>isDone(x.state)).length,late=t.filter(x=>x.state==="late").length;
 const groups=[...new Set(t.map(x=>x.c.id))].map(id=>({c:data.contents.find(c=>c.id===id),items:t.filter(x=>x.c.id===id)}));
 $("#page").innerHTML=`${pageBar(`<span class="scope">${icon("lists",16)}Vos plateformes : <strong>${esc(myScope())}</strong></span>`)}
 <div class="grid kpis">${tile("À saisir",fmt(t.length),{note:late?`dont ${late} en retard`:"relevés J+1 et J+7",tone:late?"bad":t.length?"warn":"good"})}${tile("À venir",fmt(up.length),{note:"7 prochains jours"})}${tile("Saisis",fmt(done),{note:"relevés d’origine enregistrés"})}${tile("Écarts J+1",fmt(gp.length),{note:"30 derniers jours",tone:gp.length?"warn":""})}</div>
 <div class="section-head"><h2>À renseigner maintenant</h2></div>
 ${groups.length?groups.map(g=>{const all=mine.filter(x=>x.c.id===g.c.id&&!["missed","not_tracked","unknown"].includes(x.state)),ok=all.filter(x=>isDone(x.state)).length;
  return card(`<button type="button" class="cell-link" data-act="content" data-cid="${g.c.id}">${esc(g.c.title)}</button>`,taskList(g.items,{showTitle:false}),{action:`<span class="progress" aria-label="${ok} relevés saisis sur ${all.length}"><span class="progress-bar"><span style="width:${all.length?ok/all.length*100:0}%"></span></span>${ok} / ${all.length}</span>`,sub:`${esc(g.c.country)} · ${esc(g.c.rubrique||"")}`})}).join("")
 :`<section class="card">${emptyState("Aucun relevé à saisir pour le moment.","check")}</section>`}
 <div class="grid two">
  ${card("Prochaines échéances",up.length?taskList(up,{action:false}):emptyState("Aucune échéance dans les 7 prochains jours.","calendar"),{sub:"7 prochains jours"})}
  ${card("Écarts J+1",gp.length?`<ul class="rows">${gp.map(x=>`<li class="row"><div class="row-main"><button type="button" class="cell-link" data-act="content" data-cid="${x.c.id}">${esc(x.c.title)}</button><span class="meta">${esc(platformName(x.p))} · J+1 attendu le ${frDate(x.due)}${x.p.published_on?"":" (estimé)"}</span></div>${x.st==="missed"?stateBadge("missed"):stateBadge("done_late",x.p.published_on?"Saisi en retard":"Après l’échéance estimée")}</li>`).join("")}</ul>`:emptyState("Aucun écart J+1.","check"),{sub:"J+1 non saisis à temps, 30 derniers jours"})}
 </div>
 <details class="help-box"><summary>${icon("info",16)}Règles de saisie</summary><ul>
  <li>Un relevé <strong>J+1</strong> se saisit le jour J+1 ou le lendemain. Au-delà, il est « manqué » : visible dans les écarts et sur la fiche, il ne peut plus être saisi comme J+1. Aucune donnée n’est reconstituée.</li>
  <li>Un relevé <strong>J+7</strong> reste demandé tant qu’il manque. Après le J+7, des relevés de suivi peuvent être ajoutés depuis la fiche du contenu.</li>
  <li>Vues, likes, commentaires et partages sont obligatoires. Une case vide pour les republications ou les enregistrements signifie « non disponible » (N/D), ce qui est différent de 0.</li>
  <li>« Aujourd’hui » suit le fuseau du pays du contenu : Lomé (UTC+0) ou Porto-Novo (UTC+1).</li></ul></details>`;
}
