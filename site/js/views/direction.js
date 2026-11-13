// Wakabi Performance Center — Écran : direction
"use strict";
// ---------- Direction ----------
function direction(){
 setHead("Direction","L’essentiel pour décider");
 const res=filtered(),prev=previousOf(res),s=statsOf(res.pubs),p=prev?statsOf(prev.pubs):null,lbl=res.range?`vs ${res.range.days} j précédents`:"";
 const top=rankContents(res).sort((a,b)=>b.s.views-a.s.views).slice(0,3),tf=topFlop(res);
 const months=[...new Set(data.appKpis.map(x=>x.month))].sort().reverse(),m0=months[0],sumM=(m,k)=>sum(data.appKpis.filter(x=>x.month===m).map(x=>x[k]));
 const d=m0?sumM(m0,"downloads"):0,u=m0?sumM(m0,"uninstalls"):0,late=tasks(true).filter(x=>x.state==="late").length;
 $("#page").innerHTML=`${pageBar(refSwitch())}${filterBar(res)}<p class="context">${icon("info",15)}${esc(periodText(res))}</p>
 ${trendTiles(s,p,{label:lbl})}
 <div class="grid two">
  ${card("Les plus vus",top.length?`<ol class="rows ranked">${top.map(x=>contentLine(x)).join("")}</ol>`:emptyState("Aucune publication mesurée pour ces filtres.","analytics"),{sub:`Relevé ${REF_LABEL[refType]}`})}
  ${card("Lecture rapide",`<ul class="rows">
   <li class="row"><span class="badge ${late?"bad":"good"}">${icon(late?"alert":"check",13)}${late?"À traiter":"À jour"}</span><div class="row-main"><span>${late?`${plural(late,"relevé en retard","relevés en retard")} dans l’équipe`:"Aucun relevé en retard"}</span></div></li>
   <li class="row"><span class="badge ${m0&&d>0&&u>d*UNINSTALL_ALERT?"warn":"neutral"}">${icon("app",13)}${monthLabel(m0)}</span><div class="row-main"><span>${m0?`${fmt(u)} désinstallations pour ${fmt(d)} téléchargements${d>0&&u>d*UNINSTALL_ALERT?` : au-dessus du repère de ${UNINSTALL_ALERT*100} %`:""}`:"Aucun chiffre d’application saisi"}</span></div></li>
   ${tf.flop.length?`<li class="row"><span class="badge warn">${icon("down",13)}À surveiller</span><div class="row-main"><span>${esc(namesFr(tf.flop.map(x=>x.c.title)))}</span></div></li>`:""}
  </ul><p class="meta">L’éditorial et l’application sont suivis séparément, pour voir si la visibilité se transforme en acquisition et en usage.</p>`)}
 </div>`;
}
