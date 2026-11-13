// Wakabi Performance Center — Écran : today
"use strict";
// ---------- Aujourd'hui (accueil selon le rôle) ----------
function home(){
 setHead(`Bonjour${firstName()?" "+firstName():""}`,`${longDate(todayIn(me.country||"Togo"))} · ce qui compte aujourd’hui`);
 if(isProductionMember()&&data.has09)return homeMember();
 if(me.role==="platform_manager")return homeManager();
 if(me.role==="direction")return homeDirection();
 return homeEditor();
}
function homeEditor(){
 const t=tasks(),late=t.filter(x=>x.state==="late"),pt=plannedToday(),noLink=pt.filter(c=>!pubsFor(c.id).length),lp=lateToPublish(),gp=gaps(),tr=trend30(),tf=topFlop(tr.cur);
 const byPf=shownPlatforms().map(f=>({f,list:t.filter(x=>platformIdOf(x.p)===f.id)})).filter(x=>x.list.length);
 const team=me.role==="admin"?(()=>{const inact=data.profiles.filter(p=>!p.archived_at&&!p.active).length,pwd=data.profiles.filter(p=>!p.archived_at&&p.must_change_password).length;
  return inact||pwd?card("Équipe",`<ul class="rows">${inact?`<li class="row"><div class="row-main"><strong>${plural(inact,"compte inactif","comptes inactifs")}</strong><span class="meta">à activer ou à retirer</span></div></li>`:""}${pwd?`<li class="row"><div class="row-main"><strong>${plural(pwd,"mot de passe à choisir","mots de passe à choisir")}</strong><span class="meta">accès suspendu jusqu’au changement</span></div></li>`:""}</ul>`,{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="admin">Ouvrir Équipe</button>`}):""})():"";
 $("#page").innerHTML=`<div class="grid kpis">
  ${tile("Relevés à saisir",fmt(t.length),{note:late.length?`dont ${late.length} en retard`:"J+1 et J+7, toute l’équipe",tone:late.length?"bad":t.length?"warn":"good"})}
  ${tile("Prévus aujourd’hui",fmt(pt.length),{note:pt.length?`dont ${noLink.length} sans lien de publication`:"aucun contenu prévu",tone:noLink.length?"warn":""})}
  ${tile("Publication en retard",fmt(lp.length),{note:"date prévue passée, aucun lien (30 j)",tone:lp.length?"bad":"good"})}
  ${tile("Écarts J+1",fmt(gp.length),{note:"manqués ou saisis en retard (30 j)",tone:gp.length?"warn":"good"})}
 </div>
 <div class="grid two">
  ${card("Relevés à saisir",byPf.length?byPf.map(x=>{const o=ownersOf(x.f.id);return `<div class="group"><div class="group-head"><strong>${esc(x.f.name)}</strong><span class="meta">${o.length?esc(namesFr(o)):"aucun responsable affecté"} · ${plural(x.list.length,"relevé")}</span></div>${taskList(x.list.slice(0,4),{showPlatform:false})}${x.list.length>4?`<p class="meta more">+ ${x.list.length-4} autre(s) dans la page Saisie</p>`:""}</div>`}).join(""):emptyState("Aucun relevé en attente : tout est à jour.","check"),{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="entry">Tout voir</button>`})}
  <div class="stack">
   ${card("À publier aujourd’hui",pt.length?`<ul class="rows">${pt.map(c=>`<li class="row"><div class="row-main"><button type="button" class="cell-link" data-act="content" data-cid="${c.id}">${esc(c.title)}</button><span class="meta">${esc(c.country)} · ${esc(c.rubrique||"")}</span></div>${pubsFor(c.id).length?`<span class="badge good">${icon("check",13)}${plural(pubsFor(c.id).length,"lien")}</span>`:`<span class="badge warn">${icon("clock",13)}Sans lien</span>`}</li>`).join("")}</ul>`:emptyState("Aucun contenu prévu aujourd’hui.","calendar"))}
   ${lp.length?card("Publication en retard",`<ul class="rows">${lp.slice(0,5).map(c=>`<li class="row"><div class="row-main"><button type="button" class="cell-link" data-act="content" data-cid="${c.id}">${esc(c.title)}</button><span class="meta">prévu le ${frDate(c.publish_date)} · ${esc(c.country)}</span></div><span class="badge bad">${icon("alert",13)}Aucun lien</span></li>`).join("")}</ul>`,{sub:"Date prévue passée et aucune publication enregistrée"}):""}
   ${data.has09?homeOrganisation():""}
   ${team}
  </div>
 </div>
 <div class="section-head"><div><h2>Tendance des 30 derniers jours</h2><p class="card-sub">Comparée aux 30 jours précédents · publications datées par leur date effective, sinon prévue</p></div>${refSwitch()}</div>
 ${trendTiles(tr.s,tr.p)}
 <div class="grid two">
  ${card("Par plateforme",platformTable(tr.cur,tr.prev))}
  ${card("Ce qui marche",tf.top.length?`<ul class="rows">${tf.top.map(x=>contentLine(x)).join("")}</ul>`:emptyState(`Pas encore assez de données (au moins ${MIN_VIEWS_RANK} vues par contenu).`,"analytics"),{sub:`Meilleurs taux d’interaction, à partir de ${MIN_VIEWS_RANK} vues · repère interne`})}
 </div>
 ${objectivesSummary()}
 ${tf.flop.length?card("À surveiller",`<ul class="rows">${tf.flop.map(x=>contentLine(x)).join("")}</ul>`,{sub:"Taux d’interaction les plus faibles sur la même base"}):""}`;
}
function homeManager(){
 const t=tasks(),due=t.filter(x=>x.state==="due"),late=t.filter(x=>x.state==="late"),gp=gaps(),up=upcomingTasks(7),tr=trend30();
 const mine=data.platforms.filter(f=>me.platformIds?me.platformIds.includes(f.id):f.code===me.platform);
 const groups=[...new Set(t.map(x=>x.c.id))].map(id=>({c:data.contents.find(c=>c.id===id),items:t.filter(x=>x.c.id===id)}));
 $("#page").innerHTML=`<div class="grid kpis">
  ${tile("À saisir aujourd’hui",fmt(due.length),{note:"relevés J+1 et J+7",tone:due.length?"warn":"good"})}
  ${tile("En retard",fmt(late.length),{note:"à saisir au plus vite",tone:late.length?"bad":"good"})}
  ${tile("Écarts J+1",fmt(gp.length),{note:"30 derniers jours",tone:gp.length?"warn":""})}
  ${tile("Mes plateformes",fmt(mine.length),{note:esc(mine.map(f=>f.name).join(", ")||"aucune affectation")})}
 </div>
 <div class="grid two">
  ${card("Mes relevés",groups.length?groups.map(g=>`<div class="group"><div class="group-head"><button type="button" class="cell-link" data-act="content" data-cid="${g.c.id}">${esc(g.c.title)}</button><span class="meta">${esc(g.c.country)}</span></div>${taskList(g.items,{showTitle:false})}</div>`).join(""):emptyState("Rien à saisir pour l’instant. Vos prochaines échéances sont à droite.","check"),{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="entry">Page Saisie</button>`})}
  ${card("Prochaines échéances",up.length?taskList(up.slice(0,8),{action:false}):emptyState("Aucune échéance dans les 7 prochains jours.","calendar"),{sub:"7 prochains jours"})}
 </div>
 <div class="section-head"><div><h2>Mes plateformes · 30 derniers jours</h2><p class="card-sub">Comparées aux 30 jours précédents</p></div>${refSwitch()}</div>
 ${card("",platformTable({...tr.cur,pubs:tr.cur.pubs.filter(p=>mine.some(f=>f.id===platformIdOf(p)))},{...tr.prev,pubs:tr.prev.pubs.filter(p=>mine.some(f=>f.id===platformIdOf(p)))}),{cls:"flush-head"})}`;
}
function homeDirection(){
 const tr=trend30(),tf=topFlop(tr.cur),late=tasks(true).filter(x=>x.state==="late"),gp=gaps(),lp=lateToPublish();
 const months=[...new Set(data.appKpis.map(x=>x.month))].sort().reverse(),sumM=(m,k)=>sum(data.appKpis.filter(x=>x.month===m).map(x=>x[k]));
 const m0=months[0],m1=months[1];
 const alerts=[];
 if(late.length)alerts.push(["bad","alert",`${plural(late.length,"relevé en retard","relevés en retard")} dans l’équipe.`]);
 if(gp.length)alerts.push(["warn","clock",`${plural(gp.length,"écart J+1","écarts J+1")} sur 30 jours (manqués ou saisis en retard).`]);
 if(lp.length)alerts.push(["warn","calendar",`${plural(lp.length,"contenu prévu non publié","contenus prévus non publiés")} (30 jours).`]);
 alerts.push(...rateDropAlerts(tr));
 if(m0&&sumM(m0,"downloads")>0&&sumM(m0,"uninstalls")>sumM(m0,"downloads")*UNINSTALL_ALERT)alerts.push(["warn","app",`Désinstallations supérieures à ${UNINSTALL_ALERT*100} % des téléchargements en ${monthLabel(m0)} (repère interne).`]);
 $("#page").innerHTML=`<div class="section-head first"><div><h2>Les 30 derniers jours</h2><p class="card-sub">Comparés aux 30 jours précédents</p></div>${refSwitch()}</div>
 ${trendTiles(tr.s,tr.p)}
 <div class="grid two">
  ${card("Points d’attention",alerts.length?`<ul class="rows">${alerts.map(([t,i,txt])=>`<li class="row"><span class="badge ${t}">${icon(i,13)}${t==="bad"?"Urgent":"À suivre"}</span><div class="row-main"><span>${txt}</span></div></li>`).join("")}</ul>`:emptyState("Rien à signaler.","check"))}
  ${card("Ce qui marche",tf.top.length?`<ul class="rows">${tf.top.map(x=>contentLine(x)).join("")}</ul>`:emptyState(`Pas encore assez de données (au moins ${MIN_VIEWS_RANK} vues par contenu).`,"analytics"),{sub:`Meilleurs taux, à partir de ${MIN_VIEWS_RANK} vues · repère interne`})}
 </div>
 ${objectivesSummary()}
 ${card("Application Wakabi",m0?`<div class="grid kpis">${[["downloads","Téléchargements",true],["active_users","Utilisateurs actifs",true],["signups","Inscriptions",true],["uninstalls","Désinstallations",false]].map(([k,l,g])=>tile(l,fmt(sumM(m0,k)),{note:monthLabel(m0),delta:m1?deltaHtml(sumM(m1,k),sumM(m0,k),{label:`vs ${monthLabel(m1)}`,upGood:g}):""})).join("")}</div>`:emptyState("Aucun chiffre d’application saisi.","app"),{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="app">Détail</button>`,sub:"Togo + Bénin · jamais déduit des vues des réseaux"})}`;
}

// Membre de production (rôle « Responsable plateforme » sans plateforme, avec un intitulé : graphiste, vidéaste…).
function homeMember(){
 const mine=myTasks(),late=mine.filter(lateTask),open=mine.filter(t=>t.status!=="fait"),t0=todayIn(me.country||"Togo"),week=open.filter(t=>t.due_on&&t.due_on<=addDays(t0,7)&&!lateTask(t));
 const un=unreadNotifs();
 $("#page").innerHTML=`<div class="grid kpis">${tile("En retard",fmt(late.length),{tone:late.length?"bad":"good",note:"échéance dépassée"})}${tile("Cette semaine",fmt(week.length),{note:"échéances des 7 prochains jours"})}${tile("Tâches ouvertes",fmt(open.length))}${tile("Notifications",fmt(un.length),{note:"non lues",tone:un.length?"warn":""})}</div>
 <div class="grid two">${card("À traiter maintenant",open.length?`<ul class="rows">${[...late,...open.filter(t=>!lateTask(t))].slice(0,8).map(t=>taskCard(t)).join("")}</ul>`:emptyState("Aucune tâche ouverte : rien ne vous attend.","check"),{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="tasks">Mes tâches</button>`})}
 ${card("Dernières nouvelles",(data.notifications||[]).length?`<ul class="rows">${data.notifications.slice(0,6).map(n=>`<li class="row"><div class="row-main"><strong>${esc(n.message)}</strong><span class="meta">${NOTIF_LABEL[n.kind]||""} · ${relTime(n.created_at)}</span></div>${n.content_id?`<button type="button" class="btn sm ghost" data-act="notif" data-nid="${n.id}" data-cid="${n.content_id}">Ouvrir</button>`:""}</li>`).join("")}</ul>`:emptyState("Rien de nouveau.","bell"))}</div>`;
}
// Rédaction : contenus à valider et tâches en retard, par personne.
function homeOrganisation(){
 const toValidate=data.contents.filter(c=>!c.archived_at&&c.production_status==="a_valider"),late=(data.tasks||[]).filter(lateTask);
 const byWho=[...new Set(late.map(t=>t.assignee))].map(id=>({id,n:late.filter(t=>t.assignee===id).length}));
 return card("Production",`${toValidate.length?`<div class="group"><div class="group-head"><strong>À valider</strong><span class="meta">${plural(toValidate.length,"contenu")}</span></div><ul class="rows">${toValidate.slice(0,5).map(c=>`<li class="row"><div class="row-main"><button type="button" class="cell-link" data-act="content" data-cid="${c.id}">${esc(c.title)}</button><span class="meta">proposé ${relTime(c.production_status_at)}</span></div>${prodBadge("a_valider")}</li>`).join("")}</ul></div>`:""}
 ${late.length?`<div class="group"><div class="group-head"><strong>Tâches en retard</strong><span class="meta">${plural(late.length,"tâche")}</span></div><ul class="rows">${byWho.map(x=>`<li class="row"><div class="row-main"><strong>${esc(personName(x.id))}</strong></div><span class="badge bad">${icon("alert",13)}${plural(x.n,"tâche")}</span></li>`).join("")}</ul></div>`:""}
 ${!toValidate.length&&!late.length?emptyState("Rien à valider, aucune tâche en retard.","check"):""}`,{action:`<button type="button" class="btn sm ghost" data-act="go" data-view="tasks">Tâches de l’équipe</button>`});
}
