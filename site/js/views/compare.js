// Wakabi Performance Center — Écran : compare
"use strict";
// ---------- Comparer le comparable (Performance) et alertes documentées ----------
const MIN_SAMPLE=3;            // en dessous de 3 publications mesurées, un groupe est signalé « échantillon faible »
const RATE_DROP_ALERT=0.01;    // alerte si le taux pondéré d'une plateforme baisse d'au moins 1 point (30 j vs 30 j précédents)
const DIMS={pf_type:"Plateforme × type",platform:"Plateforme",type:"Type de contenu",rubrique:"Rubrique",campaign:"Campagne",objective:"Objectif",country:"Pays"};
let cmpDim="pf_type";
function dimKey(p,c,dim){
 const ty=nameOf("content_types",c.content_type_id);
 switch(dim){case "platform":return platformName(p);case "type":return ty||"Type non précisé";case "rubrique":return c.rubrique||"—";
  case "campaign":return nameOf("campaigns",c.campaign_id)||"Sans campagne";case "objective":return nameOf("content_objectives",c.objective_id)||"Objectif non précisé";
  case "country":return c.country||"—";default:return `${platformName(p)} · ${ty||"type non précisé"}`}
}
function groupTable(res,dim){
 const cById=new Map(res.contents.map(c=>[c.id,c])),g=new Map();
 for(const p of res.pubs){const c=cById.get(p.content_id);if(!c)continue;const k=dimKey(p,c,dim);if(!g.has(k))g.set(k,[]);g.get(k).push(p)}
 const rows=[...g.entries()].map(([k,ps])=>({k,ps,s:statsOf(ps)})).sort((a,b)=>(b.s.rate??-1)-(a.s.rate??-1)||b.s.views-a.s.views);
 if(!rows.length)return emptyState("Aucune publication pour ces critères.","analytics");
 return `<div class="table-wrap"><table class="data cards-sm"><caption class="sr-only">${esc(DIMS[dim])}</caption><thead><tr><th scope="col">${esc(DIMS[dim])}</th><th scope="col" class="num">Publications</th><th scope="col" class="num">Mesurées</th><th scope="col" class="num">Vues</th><th scope="col" class="num">Vues par publication</th><th scope="col" class="num">Taux</th></tr></thead><tbody>${rows.map(x=>`<tr><th scope="row" data-label="${esc(DIMS[dim])}">${esc(x.k)}${x.s.n&&x.s.n<MIN_SAMPLE?` <span class="badge warn">${icon("alert",13)}Échantillon faible</span>`:""}</th><td class="num" data-label="Publications">${fmt(x.ps.length)}</td><td class="num" data-label="Mesurées">${fmt(x.s.n)}</td><td class="num" data-label="Vues">${x.s.n?fmt(x.s.views):ND}</td><td class="num" data-label="Vues par publication">${x.s.n?fmt(Math.round(x.s.views/x.s.n)):ND}</td><td class="num" data-label="Taux">${x.s.n?pctv(x.s.rate):ND}</td></tr>`).join("")}</tbody></table></div>`;
}
function compareCard(res){
 return card("Comparer le comparable",`<div class="cmp-bar"><label class="fld"><span>Regrouper par</span><select id="cmpDim" data-cmp="1">${Object.entries(DIMS).map(([k,l])=>`<option value="${k}"${k===cmpDim?" selected":""}>${l}</option>`).join("")}</select></label>${refType==="latest"?`<p class="callout warn">${icon("alert",16)}<span>Le dernier relevé n’a pas la même durée d’exposition pour toutes les publications : préférez J+7 pour comparer.</span></p>`:""}</div>${groupTable(res,cmpDim)}`,
  {sub:`Taux pondéré par groupe · « échantillon faible » sous ${MIN_SAMPLE} publications mesurées · relevé ${REF_LABEL[refType]}`,cls:"flush-body"});
}
function rateDropAlerts(tr){
 const out=[];for(const f of shownPlatforms()){const a=statsOf(tr.cur.pubs.filter(p=>platformIdOf(p)===f.id)),b=statsOf(tr.prev.pubs.filter(p=>platformIdOf(p)===f.id));
  if(a.n>=MIN_SAMPLE&&b.n>=MIN_SAMPLE&&a.rate!=null&&b.rate!=null&&b.rate-a.rate>=RATE_DROP_ALERT)out.push(["warn","down",`Taux d’interaction ${esc(f.name)} en baisse de ${((b.rate-a.rate)*100).toFixed(1).replace(".",",")} pt (${a.n} publications mesurées, contre ${b.n}).`])}
 return out;
}
