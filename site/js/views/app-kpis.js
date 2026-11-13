// Wakabi Performance Center — Écran : app-kpis
"use strict";
// ---------- Application ----------
function appKpis(){
 setHead("Application Wakabi","Acquisition et usage, suivis à part de l’éditorial");
 const months=[...new Set(data.appKpis.map(x=>x.month))].sort().reverse(),m0=months[0],m1=months[1],sumM=(m,k)=>sum(data.appKpis.filter(x=>x.month===m).map(x=>x[k]));
 const T=(k,l,upGood=true)=>tile(l,m0?fmt(sumM(m0,k)):ND,{note:m0?monthLabel(m0):"aucun mois saisi",delta:m0&&m1?deltaHtml(sumM(m1,k),sumM(m0,k),{label:`vs ${monthLabel(m1)}`,upGood}):""});
 const rows=data.appKpis.slice().sort((a,b)=>a.month<b.month?1:a.month>b.month?-1:a.country<b.country?-1:1);
 $("#page").innerHTML=`${pageBar(`<span class="scope">${icon("info",16)}Togo + Bénin · jamais déduit des vues des réseaux sociaux</span>`,canEdit()?`<button id="addKpi" type="button" class="btn ghost">${icon("plus",16)}Ajouter un mois</button>`:"")}
 <div class="grid kpis">${T("downloads","Téléchargements")}${T("signups","Inscriptions")}${T("active_users","Utilisateurs actifs")}${T("uninstalls","Désinstallations",false)}</div>
 ${card("Historique",rows.length?`<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">Historique des KPI de l’application</caption><thead><tr><th scope="col">Mois</th><th scope="col">Pays</th><th scope="col" class="num">Téléchargements</th><th scope="col" class="num">Inscriptions</th><th scope="col" class="num">Utilisateurs actifs</th><th scope="col" class="num">Désinstallations</th></tr></thead><tbody>${rows.map(x=>`<tr><td data-label="Mois">${esc(monthLabel(x.month))}</td><td data-label="Pays">${esc(x.country)}</td><td class="num" data-label="Téléchargements">${fmt(x.downloads)}</td><td class="num" data-label="Inscriptions">${fmt(x.signups)}</td><td class="num" data-label="Utilisateurs actifs">${fmt(x.active_users)}</td><td class="num" data-label="Désinstallations">${fmt(x.uninstalls)}</td></tr>`).join("")}</tbody></table></div>`:emptyState("Aucun mois saisi pour l’instant.","app",canEdit()?`<button type="button" class="btn primary" data-act="kpi">Saisir un premier mois</button>`:""),{cls:"flush-body"})}`;
 $("#addKpi")?.addEventListener("click",kpiForm);$('[data-act="kpi"]')?.addEventListener("click",kpiForm);
}
