// Wakabi Performance Center — État des écrans Calendrier et Rapports dans l'adresse, et leurs actions.
"use strict";
// ---------- État des écrans Calendrier et Rapports dans l'adresse ----------
const REP_Q=[["ref","rref"],["from","rfrom"],["to","rto"],["campaign","rcamp"],["platform","rpf"],["country","rct"]];
function viewQuery(id){
 const p=new URLSearchParams(FILTERABLE.includes(id)?filtersToQuery(filters):"");
 if(id==="calendar"){if(calState.mode)p.set("cal",calState.mode);if(calState.d)p.set("d",calState.d)}
 if(id==="reports"){p.set("rt",repState.type);for(const [k,q] of REP_Q)if(repState[k])p.set(q,repState[k])}
 return p.toString();
}
function readViewQuery(view,qs){
 const p=new URLSearchParams(qs||"");
 if(view==="calendar"){if(CAL_MODES[p.get("cal")])calState.mode=p.get("cal");if(/^\d{4}-\d{2}-\d{2}$/.test(p.get("d")||""))calState.d=p.get("d")}
 if(view==="reports"){if(REPORT_TYPES[p.get("rt")])repState.type=p.get("rt");for(const [k,q] of REP_Q)repState[k]=p.get(q)||""}
}
document.addEventListener("click",e=>{
 const a=e.target.closest("[data-act]");if(!a||!me)return;const act=a.dataset.act;
 if(act==="cal-step")calStep(+a.dataset.step);
 else if(act==="cal-today"){calState.d=todayIn(me.country||"Togo");render("calendar")}
 else if(act==="cal-mode"){calState.mode=a.dataset.mode;render("calendar")}
 else if(act==="cal-day"){calState.d=a.dataset.d;calState.mode="day";render("calendar",{push:true})}
 else if(act==="export-csv")exportReportCsv();
 else if(act==="print")window.print();
});
document.addEventListener("change",e=>{
 const l=e.target.closest("[data-cal-layer]");if(l){calState.layers[l.dataset.calLayer]=l.checked;render("calendar");document.querySelector(`[data-cal-layer="${l.dataset.calLayer}"]`)?.focus();return}
 const r=e.target.closest("[data-rep]");if(r){repState[r.dataset.rep]=r.value;if(r.dataset.rep==="type")repState.ref="";const id=r.id;render("reports");document.getElementById(id)?.focus();return}
 const c=e.target.closest("[data-cmp]");if(c){cmpDim=c.value;render(active);$("#cmpDim")?.focus()}
});
