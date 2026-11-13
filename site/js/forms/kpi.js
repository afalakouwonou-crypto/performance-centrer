// Wakabi Performance Center — Formulaire : kpi
"use strict";
function kpiForm(){
 modal("Ajouter des KPI application",`<div class="form-grid"><div><label>Mois</label><input id="km" type="month" value="${today().slice(0,7)}"></div><div><label>Pays</label><select id="kc">${COUNTRIES.map(x=>`<option>${x}</option>`).join("")}</select></div>${[["kd","Téléchargements"],["ks","Inscriptions"],["ka","Utilisateurs actifs"],["ku","Désinstallations"]].map(([id,l])=>`<div><label>${l}</label><input id="${id}" type="number" min="0" step="1" inputmode="numeric"></div>`).join("")}<div class="full-span muted">Les quatre chiffres sont obligatoires : mettez 0 seulement si la valeur est vraiment nulle (la base n’accepte pas de case vide).</div><div class="full-span"><button id="saveKpi" class="btn primary">Enregistrer</button></div></div>`);
 // Une case vide n'est jamais transformée en 0 en silence ; double clic bloqué ; un mois déjà saisi n'est remplacé qu'après confirmation.
 $("#saveKpi").onclick=()=>busy($("#saveKpi"),"Enregistrement…",async()=>{
  if(!$("#km").value){toast("Choisissez le mois.");return}
  const vals={};for(const [k,id] of [["downloads","#kd"],["signups","#ks"],["active_users","#ka"],["uninstalls","#ku"]]){
   const raw=$(id).value.trim(),n=Number(raw);if(raw===""||!Number.isInteger(n)||n<0){toast("Remplissez les quatre chiffres (nombres entiers, 0 ou plus).");return}vals[k]=n}
  const month=$("#km").value+"-01",country=$("#kc").value;
  if(data.appKpis.some(x=>x.month===month&&x.country===country)&&!confirm(`Ce mois existe déjà pour ${country}. Remplacer les chiffres enregistrés par ceux-ci ?`))return;
  const {error}=await db.from("app_kpis").upsert({month,country,...vals,updated_by:me.id},{onConflict:"month,country"});
  if(error){toast(error.message);return}closeModal();await refresh();toast("KPI enregistrés.");appKpis()});
}
