// Wakabi Performance Center — Règles des relevés : publications d'un contenu, relevé en vigueur, échéances J+1 / J+7, écarts.
"use strict";
function pubsFor(cid){return data.publications.filter(p=>p.content_id===cid)}
// Relevés (migration 05) : l'interface lit et écrit uniquement metric_readings. Une correction remplace
// le relevé corrigé ; l'historique complet reste visible sur la fiche contenu. Repli en lecture sur metrics
// seulement si metric_readings ne peut pas être lu.
function effReading(pid,type){
 if(!data.readingsOk)return type==="j7"?data.metrics.find(m=>m.publication_id===pid&&m.snapshot==="j7")||null:null;
 const rs=data.readings.filter(r=>r.publication_id===pid&&r.reading_type===type);
 return rs.find(r=>!rs.some(x=>x.corrects_reading_id===r.id))||null;
}
function metricFor(pid){return effReading(pid,"j7")}
// Date de départ des échéances : date effective de la publication (prévue par la migration 07), sinon date prévue du contenu.
const basisDate=(p,c)=>p.published_on||c.publish_date;
const TYPE_LABEL={j1:"J+1",j7:"J+7",other:"Suivi"};
// J+1 : à saisir le jour J+1 ou le lendemain ; au-delà, ce n'est plus un J+1 : « manqué », sans tâche.
// J+7 : à saisir à partir de J+7 ; la tâche reste tant que le relevé manque.
// « Aujourd'hui » dans le fuseau du pays du contenu (décision D4) : Lomé UTC+0, Porto-Novo UTC+1.
const TZ={"Togo":"Africa/Lome","Bénin":"Africa/Porto-Novo"};
function todayIn(country){try{return new Intl.DateTimeFormat("en-CA",{timeZone:TZ[country]||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}catch(e){return today()}}
// Les relevés J+1 existent depuis la migration 05 (30/10/2026) : une échéance J+1 antérieure n'était pas suivie.
const J1_TRACKING_START="2026-10-30";
const origReading=(pid,type)=>data.readings.find(r=>r.publication_id===pid&&r.reading_type===type&&!r.corrects_reading_id)||null;
// Mêmes règles que la vue publication_schedule (migration 07).
// J+1 : done (pris au plus tard le lendemain de l'échéance) | done_late | upcoming | due | late (lendemain)
//       | missed (non saisi après J+2 : écart suivi, rien n'est inventé) | not_tracked | unknown (relevés illisibles).
// J+7 : done | upcoming | due | late (reste demandé tant qu'il manque).
function rstate(p,c,type){
 const due=dueOf(p,c,type),t=todayIn(c.country);
 if(type==="j1"){
  if(!data.readingsOk)return "unknown";
  const o=origReading(p.id,"j1");if(o)return o.measured_on<=addDays(due,1)?"done":"done_late";
  if(due<J1_TRACKING_START)return "not_tracked";
  if(t<due)return "upcoming";if(t===due)return "due";if(t===addDays(due,1))return "late";return "missed";
 }
 const o7=data.readingsOk?origReading(p.id,"j7"):null;
 if(o7)return o7.measured_on<=addDays(due,1)?"done":"done_late";
 if(effReading(p.id,"j7"))return "done";
 if(t<due)return "upcoming";return t===due?"due":"late";
}
function dueOf(p,c,type){return addDays(basisDate(p,c),type==="j1"?1:7)}
const isDone=st=>st==="done"||st==="done_late";
// Décalage réel entre la date de départ et la mesure d'origine (ex. 14 = mesuré à J+14) : jamais recalculé ni déplacé.
function offsetOf(p,c,type){const o=origReading(p.id,type);if(!o)return "?";return Math.round((Date.parse(o.measured_on+"T00:00:00Z")-Date.parse(basisDate(p,c)+"T00:00:00Z"))/864e5)}
// Sans date effective, le décalage part de la date prévue : c'est une estimation, jamais une mesure tardive certaine.
const offsetLabel=(p,c,type)=>p.published_on?`mesuré à J+${offsetOf(p,c,type)}`:`J+${offsetOf(p,c,type)} estimé depuis la date prévue`;
// Nombre de J+7 en vigueur mesurés après J+8 (ex. relevés repris de l'ancienne table) : à signaler à côté des totaux.
function lateJ7(){let eff=0,est=0;for(const c of data.contents)for(const p of pubsFor(c.id))if(rstate(p,c,"j7")==="done_late")p.published_on?eff++:est++;return {eff,est}}
const lateJ7Note=()=>{const {eff,est}=lateJ7(),out=[];if(eff)out.push(`${eff} relevé(s) mesuré(s) après J+8`);
 if(est)out.push(`${est} relevé(s) au-delà de J+8 selon une estimation depuis la date prévue`);return out.length?"dont "+out.join(" et "):""};
// Écarts : J+1 non saisis à temps (manqués ou saisis en retard), pour les publications que l'utilisateur suit.
function gaps(days=30){
 const out=[];for(const c of data.contents.filter(x=>!x.archived_at))for(const p of pubsFor(c.id))if(canMetric(p)||["admin","editor","direction"].includes(me.role)){
  const st=rstate(p,c,"j1");if((st==="missed"||st==="done_late")&&dueOf(p,c,"j1")>=addDays(todayIn(c.country),-days))out.push({c,p,st,due:dueOf(p,c,"j1")})}
 return out.sort((a,b)=>a.due<b.due?1:-1);
}
const basisLabel=(p,c)=>p.published_on?`publiée le ${frDate(p.published_on)}`:`date prévue ${frDate(c.publish_date)} (estimation : date effective non renseignée)`;
