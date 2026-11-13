// Wakabi Performance Center — Écran : analytics
"use strict";
// ---------- Performance ----------
function analytics(){
 setHead("Performance","Ce qui fonctionne, avec la même formule partout");
 const res=filtered(),prev=previousOf(res),s=statsOf(res.pubs),p=prev?statsOf(prev.pubs):null,lbl=res.range?`vs ${res.range.days} j précédents`:"";
 const both=res.pubs.map(x=>({a:refReading(x,"j1"),b:refReading(x,"j7")})).filter(x=>x.a&&x.b),gA=sum(both.map(x=>x.a.views)),gB=sum(both.map(x=>x.b.views)),gEv=both.length?evolution(gA,gB):null;
 const bp=shownPlatforms().map(f=>{const st=statsOf(res.pubs.filter(x=>platformIdOf(x)===f.id));return {label:f.name,value:st.n?st.views:null,n:st.n,note:st.n?`taux ${st.rate==null?"N/D":pct(st.rate)}`:""}});
 const br=shownRubriques().map(r=>{const ps=res.contents.filter(c=>onRubrique(c,r)).flatMap(c=>res.byContent.get(c.id)||[]),st=statsOf(ps);return {label:r.name,value:st.n?st.views:null,n:st.n,note:st.n?`taux ${st.rate==null?"N/D":pct(st.rate)}`:""}});
 const ranked=rankContents(res).sort((a,b)=>b.s.views-a.s.views);
 $("#page").innerHTML=`${pageBar(refSwitch())}${filterBar(res)}
 <p class="context">${icon("info",15)}${esc(periodText(res))}</p>
 ${trendTiles(s,p,{label:lbl})}
 <div class="grid kpis small">
  ${tile("Likes",s.n?compact(s.likes):ND)}${tile("Commentaires",s.n?compact(s.comments):ND)}${tile("Partages",s.n?compact(s.shares):ND)}
  ${tile("Republications",nd(s.reposts),{note:s.reposts==null?"non fournies ou non saisies":`sur ${plural(s.repostsN,"publication")} · hors taux`})}
  ${tile("Enregistrements",nd(s.saves),{note:s.saves==null?"non fournis ou non saisis":`sur ${plural(s.savesN,"publication")} · hors taux`})}
  ${tile("Croissance J+1 → J+7",gEv?`${gEv.abs>=0?"+":"−"}${compact(Math.abs(gEv.abs))}`:ND,{note:gEv?`${gEv.rel!=null?`${gEv.rel>=0?"+":"−"}${Math.abs(gEv.rel*100).toFixed(0)} % · `:""}sur ${plural(both.length,"publication")} ayant les deux relevés`:"aucune publication avec J+1 et J+7"})}
 </div>
 <div class="grid two">
  ${card(`Vues par plateforme`,bars(bp)+`<details class="table-alt"><summary>Voir le tableau</summary>${platformTable(res,prev)}</details>`,{sub:`Relevé ${REF_LABEL[refType]} · volume de vues`})}
  ${card(`Vues par rubrique`,bars(br),{sub:`Relevé ${REF_LABEL[refType]} · volume de vues`})}
 </div>
 ${card("Classement des contenus",ranked.length?`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Classement des contenus par vues</caption><thead><tr><th scope="col" class="num">#</th><th scope="col">Contenu</th><th scope="col">Rubrique</th><th scope="col" class="num">Mesurées</th><th scope="col" class="num">Vues</th><th scope="col" class="num">Interactions</th><th scope="col" class="num">Taux</th></tr></thead><tbody>${ranked.map((x,i)=>`<tr><td class="num" data-label="Rang">${i+1}</td><td data-label="Contenu" class="title-cell"><button type="button" class="cell-link" data-act="content" data-cid="${x.c.id}">${esc(x.c.title)}</button></td><td data-label="Rubrique">${esc(x.c.rubrique||"—")}</td><td class="num" data-label="Mesurées">${fmt(x.s.n)} / ${fmt((res.byContent.get(x.c.id)||[]).length)}</td><td class="num" data-label="Vues">${fmt(x.s.views)}</td><td class="num" data-label="Interactions">${fmt(x.s.interactions)}</td><td class="num" data-label="Taux">${pctv(x.s.rate)}</td></tr>`).join("")}</tbody></table></div>`:emptyState("Aucune publication mesurée pour ces filtres.","analytics"),{sub:"Par volume de vues · un contenu = la somme de ses publications retenues",cls:"flush-body"})}
 ${compareCard(res)}
 <div class="grid two">${insightsCard(res)}${promotionCard(res)}</div>
 <p class="foot-note">${lateJ7Note()?esc(lateJ7Note())+". ":""}Le taux d’un ensemble est pondéré (somme des interactions ÷ somme des vues), jamais une moyenne de pourcentages. Republications et enregistrements sont affichés à part et n’entrent pas dans le taux.</p>`;
}
