// Client Supabase chargé localement (vendor/supabase.js), sans dépendre d'un CDN externe.
const { createClient } = window.supabase;

const cfg=window.WAKABI_CONFIG||{};
// Mode « identifiant » (migration 08 + fonction Edge wakabi-auth, recette) : connexion par identifiant personnel,
// comptes créés par l'administrateur, reconnexion chaque lundi. Sans ce réglage, l'ancienne connexion par email reste active.
const ID_MODE=cfg.AUTH_MODE==="identifiant";
const configured=cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("PASTE_") &&
  cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");

let supabase=null, me=null, active="home", data={contents:[],publications:[],metrics:[],appKpis:[],profiles:[],platforms:[],rubriques:[],content_types:[],campaigns:[],content_objectives:[]};
// Arrivée par un lien d'invitation ou de réinitialisation : le mot de passe doit être choisi avant d'entrer.
const linkType=new URLSearchParams(location.hash.slice(1)).get("type");
let recovery=linkType==="recovery"||linkType==="invite", entering=false, justChanged=false;
// Listes administrables lues dans la base (migrations 03 et 04). Seules les valeurs actives sont proposées
// dans les formulaires ; une valeur désactivée ou archivée reste affichée sur les contenus qui l'utilisent déjà.
const LISTS={rubriques:"Rubriques",platforms:"Plateformes",content_types:"Types de contenu",campaigns:"Campagnes",content_objectives:"Objectifs"};
const LIST_STATUS={active:"Active",inactive:"Inactive",archived:"Archivée"};
// Valeurs du type wakabi_platform : une publication ne peut viser qu'une plateforme dont le code en fait partie.
const PLATFORM_CODES=["TikTok","Instagram","Facebook","Snapchat","YouTube"];
const activeOf=k=>(data[k]||[]).filter(x=>x.status==="active");
const pubPlatforms=()=>activeOf("platforms").filter(f=>PLATFORM_CODES.includes(f.code));
const onPlatform=(pub,f)=>pub.platform_id?pub.platform_id===f.id:pub.platform===f.code;
const onRubrique=(c,r)=>c.rubrique_id?c.rubrique_id===r.id:c.rubrique===r.name;
// Statistiques : plateformes et rubriques non archivées, plus celles déjà utilisées.
const shownPlatforms=()=>data.platforms.filter(f=>f.status!=="archived"||data.publications.some(p=>onPlatform(p,f)));
const shownRubriques=()=>data.rubriques.filter(r=>r.status!=="archived"||data.contents.some(c=>onRubrique(c,r)));
const namesFr=a=>a.length<2?a.join(""):a.slice(0,-1).join(", ")+" et "+a[a.length-1];
const ROLES={platform_manager:"Responsable plateforme",editor:"Rédaction en chef / Coordination",direction:"Direction",admin:"Administrateur",
 operations:"Chargé des opérations",graphic_designer:"Graphiste",videographer:"Vidéaste",content_creator:"Créateur de contenu"};
const roleLabel=p=>p.job_title||ROLES[p.role]||p.role;
// Rôles techniques réellement présents dans la base (type wakabi_role). Les rôles d'équipe
// (operations, graphic_designer, videographer, content_creator) seront ajoutés ici après la migration 06c.
const ASSIGNABLE_ROLES=["admin","editor","direction","platform_manager"];
const COUNTRIES=["Togo","Bénin"];

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const fmt=n=>new Intl.NumberFormat("fr-FR").format(Number(n||0));
const compact=n=>{n=+n||0;if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace(".",",")+" M";if(n>=1e3)return (n/1e3).toFixed(n>=1e4?0:1).replace(".",",")+" k";return fmt(n)};
const pct=n=>(Number(n||0)*100).toFixed(1).replace(".",",")+" %";
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const addDays=(s,n)=>{const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const frDate=s=>s?new Date(s+"T00:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—";
const sum=a=>a.reduce((x,y)=>x+(+y||0),0);

function show(id){["#loading","#setupView","#authView","#passwordView","#mainView"].forEach(x=>$(x).classList.add("hidden"));$(id).classList.remove("hidden")}
function toast(t){$("#toast").textContent=t;$("#toast").classList.remove("hidden");setTimeout(()=>$("#toast").classList.add("hidden"),2100)}
function modal(title,html){$("#modalTitle").textContent=title;$("#modalBody").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
$$("[data-close-modal]").forEach(x=>x.onclick=closeModal);

async function init(){
 if(!configured){show("#setupView");return}
 supabase=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
 if(ID_MODE){$("#loginEmailBlock").classList.add("hidden");$("#email").required=false;$("#loginUserBlock").classList.remove("hidden");$("#username").required=true}
 const {data:{session}}=await supabase.auth.getSession();
 if(session) await enter(session.user.id); else show("#authView");
 // Pas d'appel Supabase directement dans ce rappel (recommandation supabase-js) : on le diffère.
 supabase.auth.onAuthStateChange((e,s)=>{
  if(e==="PASSWORD_RECOVERY")recovery=true;
  if(!s){if(me&&ID_MODE&&!userLogout&&$("#authError").classList.contains("hidden"))authMessage("#authInfo","Votre session est terminée : reconnectez-vous avec votre identifiant.");
   me=null;recovery=false;userLogout=false;show("#authView");return}
  if(!me && !entering)setTimeout(()=>enter(s.user.id),0);
 });
}
function authMessage(id,t){$(id).textContent=t;$(id).classList.toggle("hidden",!t)}
let userLogout=false;
function logout(){userLogout=true;return supabase.auth.signOut()}
// Appel de la fonction serveur wakabi-auth (clé service_role uniquement côté Supabase).
async function authFn(body){
 try{const {data,error}=await supabase.functions.invoke("wakabi-auth",{body});
  if(error)return {ok:false,message:"Service de connexion indisponible. Réessayez dans un instant."};
  return data||{ok:false,message:"Réponse vide du service de connexion."}}
 catch(e){return {ok:false,message:"Service de connexion indisponible. Réessayez dans un instant."}}
}
// Règle du lundi : une connexion faite avant le lundi 00:00 (heure de Lomé) n'est plus valable.
// Lomé est en UTC+0 toute l'année (pas d'heure d'été) : lundi 00:00 Lomé = lundi 00:00 UTC.
// La base applique la même règle (my_role) : ce contrôle ne sert qu'à afficher le bon message.
function weekStartLome(now=new Date()){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d}
function authTimeOf(session){
 try{const p=JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
  const ts=(p.amr||[]).map(a=>+a.timestamp).filter(Boolean);return ts.length?new Date(Math.max(...ts)*1000):null}catch(e){return null}
}
function sessionStale(session){const t=authTimeOf(session);return !t||t<weekStartLome()}
const SESSION_MSG={week:"Nouvelle semaine : reconnectez-vous avec votre identifiant et votre mot de passe habituel.",
 revoked:"Votre session a été fermée par l’administrateur. Reconnectez-vous.",archived:"Ce compte a été retiré de l’équipe. Contactez l’administrateur.",
 inactive:"Ce compte n’est pas activé ou a été désactivé. Contactez l’administrateur.",no_profile:"Profil Wakabi introuvable. Contactez l’administrateur."};
async function endSession(reason){authMessage("#authError","");authMessage("#authInfo",SESSION_MSG[reason]||SESSION_MSG.week);me=null;await supabase.auth.signOut();show("#authView")}
async function checkWeek(){
 if(!ID_MODE||!me)return;const {data:{session}}=await supabase.auth.getSession();
 if(session&&sessionStale(session))await endSession("week");
}
setInterval(checkWeek,60000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkWeek()});
$("#loginForm").onsubmit=async e=>{
 e.preventDefault();authMessage("#authError","");authMessage("#authInfo","");
 if(ID_MODE){
  const btn=$("#loginForm button[type=submit]");
  await busy(btn,"Connexion…",async()=>{
   const r=await authFn({action:"login",username:$("#username").value.trim(),password:$("#password").value});
   if(!r.ok||!r.session){authMessage("#authError",r.message||"Connexion impossible.");return}
   $("#password").value="";
   const {error}=await supabase.auth.setSession(r.session);
   if(error)authMessage("#authError","Connexion impossible : "+error.message);
  });return
 }
 const {error}=await supabase.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
 if(error){$("#authError").textContent="Connexion impossible : "+error.message;$("#authError").classList.remove("hidden")}
};
$("#logoutBtn").onclick=()=>logout();
$("#passwordLogout").onclick=()=>logout();
$("#forgotBtn").onclick=async()=>{
 authMessage("#authError","");authMessage("#authInfo","");
 if(ID_MODE){
  const username=$("#username").value.trim();if(!username){authMessage("#authError","Indiquez d’abord votre identifiant.");return}
  const r=await authFn({action:"recover",username,redirectTo:location.origin+location.pathname});
  authMessage(r.ok?"#authInfo":"#authError",r.message||"Demande envoyée.");return
 }
 const email=$("#email").value.trim();if(!email){authMessage("#authError","Indiquez d’abord votre email professionnel.");return}
 const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
 if(error){authMessage("#authError","Envoi impossible : "+error.message);return}
 authMessage("#authInfo","Si un compte existe pour cette adresse, un email permettant de choisir un nouveau mot de passe vient d’être envoyé.");
};
// Le changement passe par Supabase Auth ; la base lève ensuite elle-même l'obligation (déclencheur wakabi_password_changed).
$("#showPassword").onchange=e=>["#newPassword","#newPassword2"].forEach(id=>$(id).type=e.target.checked?"text":"password");
// Bouton désactivé pendant l'envoi : évite les doubles soumissions.
async function busy(btn,label,fn){
 if(btn.disabled)return;const old=btn.textContent;btn.disabled=true;btn.textContent=label;
 try{return await fn()}finally{btn.disabled=false;btn.textContent=old}
}
$("#passwordForm").onsubmit=e=>{e.preventDefault();busy($("#passwordSubmit"),"Enregistrement…",changePassword)};
async function changePassword(){
 authMessage("#passwordError","");
 const p1=$("#newPassword").value,p2=$("#newPassword2").value,nonce=$("#passwordNonce").value.trim();
 if(p1.length<8){authMessage("#passwordError","Le mot de passe doit contenir au moins 8 caractères.");return}
 if(p1!==p2){authMessage("#passwordError","Les deux mots de passe ne sont pas identiques.");return}
 const {data:u,error}=await supabase.auth.updateUser(nonce?{password:p1,nonce}:{password:p1});
 if(error){
  if(error.code==="reauthentication_needed"||/reauthenticat/i.test(error.message)){
   const r=await supabase.auth.reauthenticate();
   if(r.error){authMessage("#passwordError","Envoi du code impossible : "+r.error.message);return}
   $("#nonceBlock").classList.remove("hidden");authMessage("#passwordError","Par sécurité, un code de vérification vient de vous être envoyé par email. Saisissez-le puis validez à nouveau.");return
  }
  if(error.code==="same_password"){authMessage("#passwordError","Choisissez un mot de passe différent de l’actuel.");return}
  if(error.code==="weak_password"){authMessage("#passwordError","Mot de passe trop faible : "+error.message);return}
  authMessage("#passwordError","Changement impossible : "+error.message);return
 }
 $("#passwordForm").reset();$("#nonceBlock").classList.add("hidden");["#newPassword","#newPassword2"].forEach(id=>$(id).type="password");
 recovery=false;justChanged=true;history.replaceState(null,"",location.pathname+location.search);
 await enter(u.user.id);
}
$("#newContentBtn").onclick=()=>openNewContent();

async function enter(uid){
 if(entering)return;entering=true;
 try{
 if(ID_MODE){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session||sessionStale(session)){await endSession("week");return}
  const st=await supabase.rpc("wakabi_session_status");
  if(!st.error&&["week","revoked","archived","inactive","no_profile"].includes(st.data)){await endSession(st.data);return}
 }
 const {data,error}=await supabase.from("profiles").select("*").eq("id",uid).single();
 if(error||!data){await supabase.auth.signOut();alert("Profil Wakabi introuvable. Demande à l’administrateur.");return}
 if(data.archived_at){await supabase.auth.signOut();authMessage("#authError","Ce compte a été retiré de l’équipe. Contactez l’administrateur.");show("#authView");return}
 if(data.must_change_password||recovery){
  if(justChanged&&data.must_change_password)authMessage("#passwordError","Le mot de passe a été changé mais l’accès n’est pas encore débloqué. Réessayez dans un instant ou contactez l’administrateur.");
  justChanged=false;show("#passwordView");return
 }
 justChanged=false;
 if(data.active===false){await supabase.auth.signOut();authMessage("#authError","Ce compte n’est pas encore activé ou a été désactivé. Contactez l’administrateur.");show("#authView");return}
 // Plateformes affectées (profile_platforms, affectations non révoquées). En cas d'erreur, repli sur profiles.platform.
 const as=await supabase.from("profile_platforms").select("platform_id").eq("profile_id",uid).is("revoked_at",null);
 data.platformIds=as.error?null:as.data.map(a=>a.platform_id);
 me=data;$("#profileName").textContent=me.full_name||me.email;$("#profileRole").textContent=roleLabel(me);$("#avatar").textContent=(me.full_name||"W")[0].toUpperCase();
 $("#newContentBtn").classList.toggle("hidden",!["editor","admin"].includes(me.role));
 show("#mainView");buildNav();await refresh();render("home");
 }finally{entering=false}
}
async function refresh(){
 const [c,p,m,a,f]=await Promise.all([
   supabase.from("contents").select("*").order("publish_date",{ascending:false}),
   supabase.from("publications").select("*"),
   supabase.from("metrics").select("*"),
   supabase.from("app_kpis").select("*").order("month",{ascending:false}),
   supabase.from("platforms").select("*").order("sort_order")
 ]);
 data.contents=c.data||[];data.publications=p.data||[];data.metrics=m.data||[];data.appKpis=a.data||[];data.platforms=f.data||[];
 data.loadErrors=[["contenus",c],["publications",p],["KPI application",a],["plateformes",f]].filter(x=>x[1].error).map(x=>x[0]+" : "+x[1].error.message);
 data.metricsError=m.error?m.error.message:null;
 const others=["rubriques","content_types","campaigns","content_objectives"];
 const ls=await Promise.all(others.map(k=>supabase.from(k).select("*").order("sort_order")));
 data.listErrors=[];if(f.error)data.listErrors.push("platforms");
 others.forEach((k,i)=>{data[k]=ls[i].data||[];if(ls[i].error)data.listErrors.push(k)});
 const rd=await supabase.from("metric_readings").select("*").order("entered_at");
 data.readingsOk=!rd.error;data.readings=rd.data||[];data.readingsError=rd.error?rd.error.message:null;
 // Migration 07 (date effective par publication) : présente si la vue des échéances est lisible.
 const sc=await supabase.from("publication_schedule").select("publication_id").limit(1);data.has07=!sc.error;
 if(me?.role==="admin"){
  const [r,pp]=await Promise.all([supabase.from("profiles").select("*").order("full_name"),supabase.from("profile_platforms").select("*")]);
  data.profiles=r.data||[];data.assignments=pp.data||[];
 }
}
function buildNav(){
 const items=[["home","⌂ Accueil"],["contents","🎬 Contenus"],["entry","✍ Saisie"],["analytics","▥ Performance"],["app","📱 Application"],["direction","◫ Direction"]];
 if(me.role==="admin")items.push(["admin","⚙ Équipe"],["lists","☰ Listes"]);
 items.push(["help","? Guide"]);
 items.push(["logout","⏻ Déconnexion"]);
 $("#nav").innerHTML=items.map(([id,l])=>`<button class="nav-btn ${active===id?"active":""}${id==="logout"?" nav-logout":""}" data-id="${id}">${l}</button>`).join("");
 $$(".nav-btn").forEach(b=>b.onclick=()=>b.dataset.id==="logout"?logout():render(b.dataset.id));
}
function setHead(t,s){$("#pageTitle").textContent=t;$("#pageSubtitle").textContent=s}
function degradedHtml(){
 const out=[];
 if(!data.readingsOk)out.push(`<strong>Mode dégradé : les relevés (metric_readings) n’ont pas pu être lus</strong> (${esc(data.readingsError)}). ${data.metricsError?`L’ancienne table metrics est aussi illisible (${esc(data.metricsError)}) : aucun chiffre n’est affiché.`:"Les chiffres affichés viennent de l’ancienne table metrics : J+7 seulement, sans J+1 ni corrections. L’historique est donc incomplet."} La saisie est désactivée. Rechargez la page ; si le problème continue, prévenez l’administrateur.`);
 if(data.loadErrors?.length)out.push(`<strong>Données incomplètes</strong> : ${data.loadErrors.map(esc).join(" ; ")}.`);
 return out.map(t=>`<div class="callout warn">${t}</div><br>`).join("");
}
function render(id){active=id;buildNav();({home,contents,entry,analytics,app:appKpis,direction,admin,lists,help}[id]||home)();const d=degradedHtml();if(d)$("#page").insertAdjacentHTML("afterbegin",d)}
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
const TYPE_LABEL={j1:"J+1",j7:"J+7"};
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
function totals(c){
 const ps=pubsFor(c.id),ms=ps.map(p=>metricFor(p.id)).filter(Boolean);
 const views=sum(ms.map(m=>m.views)),likes=sum(ms.map(m=>m.likes)),comments=sum(ms.map(m=>m.comments)),shares=sum(ms.map(m=>m.shares)),interactions=likes+comments+shares;
 return {views,likes,comments,shares,interactions,rate:views?interactions/views:0}
}
function statKpi(l,v,n=""){return `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="note">${n}</div></div>`}
function status(p,c){
 const j7=rstate(p,c,"j7"),j1=rstate(p,c,"j1");
 if(j7==="done")return ["Terminé","green"];
 if(j7!=="upcoming")return ["J+7 à renseigner","red"];
 if(j1==="due"||j1==="late")return ["J+1 à renseigner","red"];
 return ["En attente J+7","yellow"];
}
// Même règle que la base (wakabi_can_manage_platform) : la base reste seule juge, ceci ne sert qu'à l'affichage.
function canMetric(pub){return me.role==="admin"||me.role==="editor"||(me.role==="platform_manager"&&(me.platformIds?me.platformIds.includes(pub.platform_id):me.platform===pub.platform))}
function myScope(){
 if(me.role==="admin"||me.role==="editor")return "Toutes";
 if(me.role!=="platform_manager")return "Lecture seule";
 if(!me.platformIds)return me.platform||"Aucune";
 return data.platforms.filter(f=>me.platformIds.includes(f.id)).map(f=>f.name).join(", ")||"Aucune";
}
// Relevés à saisir maintenant, pour les publications que l'utilisateur peut renseigner (contenus non archivés).
function tasks(){
 const out=[];for(const c of data.contents.filter(x=>!x.archived_at))for(const p of pubsFor(c.id))if(canMetric(p))for(const type of ["j1","j7"]){
  const state=rstate(p,c,type);if(state==="due"||state==="late")out.push({c,p,type,state,due:dueOf(p,c,type)})}
 return out.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:0);
}
function global(){
 const ts=data.contents.map(totals);const views=sum(ts.map(x=>x.views)),interactions=sum(ts.map(x=>x.interactions));
 return {contents:data.contents.length,views,interactions,rate:views?interactions/views:0,shares:sum(ts.map(x=>x.shares))}
}
function home(){
 setHead("Accueil","Ce que vous devez savoir aujourd’hui");const g=global(),t=tasks();
 const byP=shownPlatforms().map(f=>({p:f.name,views:sum(data.publications.filter(x=>onPlatform(x,f)).map(x=>metricFor(x.id)?.views||0))})).sort((a,b)=>b.views-a.views);
 $("#page").innerHTML=`<div class="grid kpis">${statKpi("À renseigner",t.length,"relevés J+1 et J+7")}${statKpi("Contenus",g.contents,"dans la base")}${statKpi("Vues cumulées",compact(g.views),"toutes plateformes")}${statKpi("Taux d’interaction",pct(g.rate),"likes + commentaires + partages / vues")}</div>
 <div class="grid two" style="margin-top:15px"><section class="card"><h3>À faire cette semaine</h3>${t.length?`<div class="task-list">${t.slice(0,10).map(x=>`<div class="task"><div><strong>${esc(x.c.title)}</strong><span>${esc(x.p.platform)} · ${TYPE_LABEL[x.type]} : ${frDate(x.due)}${x.state==="late"?" · en retard":""}</span></div><button class="btn soft" onclick="window.metricForm('${x.p.id}','${x.type}')">Renseigner</button></div>`).join("")}</div>`:`<div class="callout good">✓ Rien à renseigner pour votre rôle.</div>`}</section>
 <section class="card"><h3>Plateforme la plus visible</h3><div class="stat"><span>Sur les données J+7 enregistrées</span><strong>${esc(byP[0]?.p||"—")}</strong><div>${compact(byP[0]?.views||0)} vues</div></div><br><div class="callout">Un contenu Wakabi existe une seule fois ; ses publications ${esc(namesFr(pubPlatforms().map(f=>f.name)))} lui sont rattachées.</div></section></div>
 <div class="section-head"><h3>Performance par plateforme</h3></div><section class="card">${bars(byP.map(x=>({label:x.p,value:x.views})))}</section>`;
}
function bars(items){const mx=Math.max(1,...items.map(x=>x.value));return items.map(x=>`<div class="bar-row"><div>${esc(x.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,x.value/mx*100)}%"></div></div><div class="num">${compact(x.value)}</div></div>`).join("")}
let showArchivedContents=false;
const canEdit=()=>["editor","admin"].includes(me.role);
function contents(){
 setHead("Contenus","1 contenu = plusieurs plateformes");
 const nArch=data.contents.filter(c=>c.archived_at).length,rows=data.contents.filter(c=>showArchivedContents||!c.archived_at);
 $("#page").innerHTML=`<div class="toolbar"><div class="callout">Bibliothèque éditoriale Wakabi</div>${nArch?`<button class="btn soft" id="toggleArchC">${showArchivedContents?"Masquer":"Afficher"} les contenus archivés (${nArch})</button>`:""}${canEdit()?`<button class="btn primary" id="addC">+ Nouveau contenu</button>`:""}</div><section class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Contenu</th><th>Pays</th><th>Rubrique</th><th>Plateformes</th><th>Vues J+7</th><th>Interaction</th><th></th></tr></thead><tbody>${rows.map(c=>{const t=totals(c);return `<tr><td>${frDate(c.publish_date)}</td><td><strong>${esc(c.title)}</strong>${c.archived_at?` <span class="badge gray">Archivé</span>`:""}<br><span class="muted">${esc(c.concept||"")}</span></td><td>${c.country}</td><td><span class="badge blue">${esc(c.rubrique)}</span></td><td>${pubsFor(c.id).map(p=>`<span class="badge ${status(p,c)[1]}">${p.platform}</span> `).join("")}</td><td><strong>${compact(t.views)}</strong></td><td>${pct(t.rate)}</td><td><button class="link" onclick="window.contentDetail('${c.id}')">Voir</button></td></tr>`}).join("")||`<tr><td colspan="8" class="muted">Aucun contenu.</td></tr>`}</tbody></table></div></section>`;
 $("#addC")?.addEventListener("click",()=>openNewContent());
 $("#toggleArchC")?.addEventListener("click",()=>{showArchivedContents=!showArchivedContents;contents()});
}
function entry(){
 setHead("Saisie","Relevés J+1 et J+7 regroupés par contenu, pour vos plateformes");
 const t=tasks(),mine=[];
 for(const c of data.contents.filter(x=>!x.archived_at))for(const p of pubsFor(c.id))if(canMetric(p))for(const type of ["j1","j7"])mine.push({c,p,type,state:rstate(p,c,type)});
 const upcoming=mine.filter(x=>x.state==="upcoming").length,done=mine.filter(x=>isDone(x.state)).length,gp=gaps();
 const groups=[...new Set(t.map(x=>x.c.id))].map(id=>({c:data.contents.find(c=>c.id===id),items:t.filter(x=>x.c.id===id)}));
 $("#page").innerHTML=`<p class="muted">Périmètre : ${esc(myScope())}</p>
 <div class="grid kpis">${statKpi("À renseigner",t.length,"relevés J+1 et J+7")}${statKpi("À venir",upcoming,"échéances futures")}${statKpi("Saisis",done,"relevés enregistrés")}${statKpi("Écarts J+1",gp.length,"30 derniers jours")}</div>
 <div class="section-head"><h3>À renseigner maintenant</h3></div>
 ${groups.length?groups.map(g=>{const all=mine.filter(x=>x.c.id===g.c.id&&!["missed","not_tracked","unknown"].includes(x.state)),ok=all.filter(x=>isDone(x.state)).length;
  return `<section class="card" style="margin-bottom:12px"><div class="section-head" style="margin-top:0"><h3>${esc(g.c.title)}</h3><span class="muted">${ok} / ${all.length} relevés saisis</span></div>
  <div class="task-list">${g.items.map(x=>`<div class="task"><div><strong>${esc(x.p.platform)} · ${TYPE_LABEL[x.type]}</strong><span>Échéance ${frDate(x.due)}${x.state==="late"?` · <span class="badge red">en retard</span>`:""}${x.p.published_on?"":" · échéance estimée sur la date prévue"}</span></div><button class="btn primary" onclick="window.metricForm('${x.p.id}','${x.type}')">Saisir</button></div>`).join("")}</div></section>`}).join("")
 :`<section class="card"><div class="callout good">✓ Aucun relevé à saisir pour le moment.</div></section>`}
 <div class="section-head"><h3>Écarts : J+1 non saisis à temps (30 derniers jours)</h3></div><section class="card">${gp.length?`<div class="task-list">${gp.map(x=>`<div class="task"><div><strong>${esc(x.c.title)} · ${esc(x.p.platform)}</strong><span>J+1 attendu le ${frDate(x.due)}${x.p.published_on?"":" (échéance estimée depuis la date prévue)"} · ${x.st==="missed"?`<span class="badge red">Manqué</span>`:`<span class="badge yellow">${x.p.published_on?"Saisi en retard":"Saisi après l’échéance estimée"}</span>`}</span></div><button class="link" onclick="window.contentDetail('${x.c.id}')">Voir la fiche</button></div>`).join("")}</div>`:`<div class="callout good">✓ Aucun écart J+1.</div>`}</section>
 <p class="muted">Un relevé J+1 se saisit le jour J+1 ou le lendemain. Au-delà, il est classé « manqué » : il reste visible dans les écarts et sur la fiche, mais il ne peut plus être saisi comme J+1, car la valeur ne correspondrait plus à J+1. Aucune donnée n’est reconstituée. Un relevé J+7 reste demandé tant qu’il manque. Un champ laissé vide pour les republications ou les enregistrements signifie « non disponible », ce qui est différent de 0.</p>`;
}
function analytics(){
 setHead("Performance","Comparer ce qui fonctionne réellement");
 const g=global(),bp=shownPlatforms().map(f=>({label:f.name,value:sum(data.publications.filter(x=>onPlatform(x,f)).map(x=>metricFor(x.id)?.views||0))}));
 const br=shownRubriques().map(r=>({label:r.name,value:sum(data.contents.filter(c=>onRubrique(c,r)).map(c=>totals(c).views))}));
 const ranked=data.contents.map(c=>({c,...totals(c)})).sort((a,b)=>b.views-a.views);
 $("#page").innerHTML=`<div class="grid kpis">${statKpi("Contenus",g.contents)}${statKpi("Vues J+7",compact(g.views),lateJ7Note())}${statKpi("Partages",compact(g.shares))}${statKpi("Interaction",pct(g.rate),"indicateur interne Wakabi")}</div>
 <div class="grid two" style="margin-top:15px"><section class="card"><h3>Vues par plateforme</h3>${bars(bp)}</section><section class="card"><h3>Vues par rubrique</h3>${bars(br)}</section></div>
 <div class="section-head"><h3>Classement des contenus</h3></div><section class="card"><div class="table-wrap"><table><thead><tr><th>#</th><th>Contenu</th><th>Rubrique</th><th>Vues</th><th>Partages</th><th>Interaction</th></tr></thead><tbody>${ranked.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.c.title)}</td><td>${esc(x.c.rubrique)}</td><td>${compact(x.views)}</td><td>${compact(x.shares)}</td><td>${pct(x.rate)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function appKpis(){
 setHead("Application Wakabi","Acquisition et usage — séparés de l’éditorial");
 const latest=data.appKpis[0]?.month||"",rs=data.appKpis.filter(x=>x.month===latest),d=sum(rs.map(x=>x.downloads)),s=sum(rs.map(x=>x.signups)),a=sum(rs.map(x=>x.active_users)),u=sum(rs.map(x=>x.uninstalls));
 $("#page").innerHTML=`<div class="grid kpis">${statKpi("Téléchargements",compact(d),latest)}${statKpi("Inscriptions",compact(s),latest)}${statKpi("Utilisateurs actifs",compact(a),latest)}${statKpi("Désinstallations",compact(u),latest)}</div>
 <div class="section-head"><h3>Historique</h3>${["editor","admin"].includes(me.role)?`<button id="addKpi" class="btn primary">+ Ajouter un mois</button>`:""}</div><section class="card"><div class="table-wrap"><table><thead><tr><th>Mois</th><th>Pays</th><th>Téléchargements</th><th>Inscriptions</th><th>Actifs</th><th>Désinstallations</th></tr></thead><tbody>${data.appKpis.map(x=>`<tr><td>${x.month}</td><td>${x.country}</td><td>${fmt(x.downloads)}</td><td>${fmt(x.signups)}</td><td>${fmt(x.active_users)}</td><td>${fmt(x.uninstalls)}</td></tr>`).join("")}</tbody></table></div></section>`;
 $("#addKpi")?.addEventListener("click",kpiForm)
}
function direction(){
 setHead("Direction","Les informations essentielles en quelques secondes");const g=global(),ranked=data.contents.map(c=>({c,...totals(c)})).sort((a,b)=>b.views-a.views).slice(0,3);
 const latest=data.appKpis[0]?.month||"",rs=data.appKpis.filter(x=>x.month===latest),d=sum(rs.map(x=>x.downloads)),a=sum(rs.map(x=>x.active_users)),u=sum(rs.map(x=>x.uninstalls));
 $("#page").innerHTML=`<div class="grid kpis">${statKpi("Contenus",g.contents)}${statKpi("Vues J+7",compact(g.views),lateJ7Note())}${statKpi("Téléchargements",compact(d),latest)}${statKpi("Utilisateurs actifs",compact(a),latest)}</div><div class="grid two" style="margin-top:15px"><section class="card"><h3>Lecture rapide</h3><div class="callout ${u>d*.25?"warn":"good"}"><strong>Désinstallations :</strong> ${fmt(u)} pour ${fmt(d)} téléchargements renseignés sur ${latest||"la période"}.</div><br><div class="callout">L’éditorial et l’application sont suivis séparément afin de voir si la visibilité se transforme réellement en acquisition et en usage.</div></section><section class="card"><h3>Top 3 contenus</h3>${ranked.map((x,i)=>`<div class="task"><div><strong>${i+1}. ${esc(x.c.title)}</strong><span>${compact(x.views)} vues · ${pct(x.rate)} interaction</span></div></div>`).join("")}</section></div>`;
}
let showArchived=false;
function memberStatus(p){
 if(p.archived_at)return `<span class="badge red">Retiré</span>`;
 return `<span class="badge ${p.active?"green":"gray"}">${p.active?"Actif":"Inactif"}</span>${p.must_change_password?` <span class="badge yellow">Mot de passe à choisir</span>`:""}`;
}
function admin(){
 if(me.role!=="admin"){home();return}setHead("Administration · Équipe","Membres, rôles et plateformes");
 const rows=data.profiles.filter(p=>showArchived||!p.archived_at);
 const nArch=data.profiles.filter(p=>p.archived_at).length;
 const intro=ID_MODE?`<div class="callout">Chaque membre a un <strong>identifiant personnel</strong> (jamais réattribué) et une adresse email privée pour la récupération. Vous créez le compte avec un mot de passe provisoire, à lui transmettre de vive voix ou par un canal sûr : il devra le changer à sa première connexion. Tout le monde se reconnecte chaque lundi.</div><button class="btn primary" id="newMember">+ Nouveau membre</button>`
  :`<div class="callout">Ajouter un membre : Supabase › Authentication › Users › <strong>Invite user</strong>. Il apparaît ici comme inactif : activez-le et choisissez son rôle. À sa première connexion, il choisit son mot de passe.</div>`;
 $("#page").innerHTML=`<div class="toolbar">${intro}${nArch?`<button class="btn soft" id="toggleArch">${showArchived?"Masquer":"Afficher"} les membres retirés (${nArch})</button>`:""}</div>
 <section class="card"><div class="table-wrap"><table><thead><tr><th>Nom</th>${ID_MODE?"<th>Identifiant</th>":""}<th>Email</th><th>Rôle</th><th>Pays</th><th>Plateformes</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map(p=>{
  const pf=(data.assignments||[]).filter(a=>a.profile_id===p.id&&!a.revoked_at).map(a=>data.platforms.find(f=>f.id===a.platform_id)).filter(Boolean);
  return `<tr><td><strong>${esc(p.full_name)}</strong>${p.id===me.id?` <span class="muted">(vous)</span>`:""}</td>${ID_MODE?`<td>${p.username?`<code>${esc(p.username)}</code>`:`<span class="muted">—</span>`}</td>`:""}<td>${esc(p.email)}</td><td>${esc(ROLES[p.role]||p.role)}${p.job_title?`<br><span class="muted">${esc(p.job_title)}</span>`:""}</td><td>${esc(p.country||"Global")}</td><td>${pf.length?pf.map(f=>`<span class="badge blue">${esc(f.name)}${f.code===p.platform?" ★":""}</span> `).join(""):"—"}</td><td>${memberStatus(p)}</td><td><button class="link" data-member="${p.id}">Modifier</button></td></tr>`}).join("")}</tbody></table></div>
 <p class="muted">★ plateforme principale. Un membre retiré garde tout son historique mais ne peut plus se connecter. La base refuse toute opération qui laisserait l’équipe sans administrateur actif.</p></section>`;
 $("#toggleArch")?.addEventListener("click",()=>{showArchived=!showArchived;admin()});
 $("#newMember")?.addEventListener("click",()=>newMemberForm());
 $$("[data-member]").forEach(b=>b.onclick=()=>memberForm(b.dataset.member));
}
// Toute écriture est contrôlée par la base (règles RLS et déclencheurs) ; son message d'erreur est affiché tel quel.
// Les boutons de la fenêtre sont désactivés pendant l'envoi (pas de double clic).
async function saveTeam(fn,okMsg,id,syncAccess=false){
 const btns=$$("#modalBody button");if(btns.some(b=>b.disabled))return false;btns.forEach(b=>b.disabled=true);
 try{
  const {error}=await fn();
  if(error){toast(error.message);return false}
  // Mode identifiant : bloque ou débloque aussi le compte dans Supabase Auth (la base refuse déjà l'accès).
  if(syncAccess&&ID_MODE){const r=await authFn({action:"sync_access",target:id});if(!r.ok)okMsg+=" Attention : "+(r.message||"blocage Auth non appliqué.")}
  await refresh();toast(okMsg);admin();if(id)memberForm(id);return true;
 }finally{btns.forEach(b=>b.disabled=false)}
}
function memberForm(id){
 const p=data.profiles.find(x=>x.id===id);if(!p)return;
 const self=p.id===me.id,arch=!!p.archived_at,dis=arch?"disabled":"";
 const roles=[...new Set([...ASSIGNABLE_ROLES,p.role])];
 const enumPlatforms=data.platforms.filter(f=>["TikTok","Instagram","Facebook","Snapchat","YouTube"].includes(f.code));
 const asg=(data.assignments||[]).filter(a=>a.profile_id===p.id);
 modal(p.full_name,`${arch?`<div class="callout warn">Membre retiré le ${frDate(p.archived_at.slice(0,10))}. Annulez le retrait pour pouvoir le modifier ou le réactiver.</div><br>`:""}
 ${self?`<div class="callout">C’est votre propre compte : la base refusera toute modification qui laisserait l’équipe sans administrateur actif.</div><br>`:""}
 ${ID_MODE?`<p>Identifiant : ${p.username?`<code>${esc(p.username)}</code> <span class="muted">(définitif)</span>`:`<span class="muted">aucun (compte antérieur aux identifiants)</span>`} · Email de récupération : ${esc(p.email)}</p>`:""}
 <div class="form-grid">
  <div><label>Nom</label><input id="mName" value="${esc(p.full_name)}" ${dis}></div>
  <div><label>Intitulé du poste (affiché)</label><input id="mJob" value="${esc(p.job_title||"")}" placeholder="${esc(ROLES[p.role]||"")}" ${dis}></div>
  <div><label>Rôle (droits)</label><select id="mRole" ${dis}>${roles.map(r=>`<option value="${r}" ${r===p.role?"selected":""}>${esc(ROLES[r]||r)}</option>`).join("")}</select></div>
  <div><label>Pays</label><select id="mCountry" ${dis}><option value="">Global</option>${COUNTRIES.map(c=>`<option ${c===p.country?"selected":""}>${c}</option>`).join("")}</select></div>
  <div><label>Plateforme principale</label><select id="mPlatform" ${dis}><option value="">—</option>${enumPlatforms.map(f=>`<option value="${f.code}" ${f.code===p.platform?"selected":""}>${esc(f.name)}</option>`).join("")}</select></div>
  <div><label>Accès</label><select id="mActive" ${dis}><option value="1" ${p.active?"selected":""}>Actif</option><option value="0" ${!p.active?"selected":""}>Inactif</option></select></div>
  ${arch?"":`<div class="full-span"><button id="mSave" class="btn primary">Enregistrer</button></div>`}
 </div>
 <div class="section-head"><h3>Plateformes affectées</h3></div>
 <p class="muted">Un responsable plateforme ne peut saisir les statistiques que des plateformes qui lui sont affectées.</p>
 <div class="task-list">${data.platforms.map(f=>{const a=asg.find(x=>x.platform_id===f.id);
  const state=!a?"Non affectée":a.revoked_at?`Révoquée le ${frDate(a.revoked_at.slice(0,10))}`:"Affectée";
  const btn=arch?"":!a?`<button class="btn soft" data-assign="${f.id}">Affecter</button>`:a.revoked_at?`<button class="btn soft" data-reassign="${a.id}">Réactiver</button>`:`<button class="btn danger" data-revoke="${a.id}">Révoquer</button>`;
  return `<div class="task"><div><strong>${esc(f.name)}${f.code===p.platform?" ★":""}</strong><span>${state}${f.status!=="active"?" · plateforme inactive":""}</span></div>${btn}</div>`}).join("")}</div>
 ${arch?"":`<div class="section-head"><h3>Mot de passe</h3></div>
 ${p.must_change_password?`<div class="callout warn">Ce membre devra choisir un nouveau mot de passe à sa prochaine connexion. Seul un vrai changement de mot de passe lève cette obligation.</div>`:`<button id="mForcePwd" class="btn soft">Exiger un nouveau mot de passe</button> <span class="muted">Son accès est suspendu jusqu’à ce qu’il en choisisse un.</span>`}
 ${ID_MODE&&!self?`<div class="form-grid" style="margin-top:10px"><div><label>Nouveau mot de passe provisoire</label><input id="mProvPwd" type="text" autocomplete="off" minlength="8" placeholder="8 caractères minimum"></div>
  <div><label>&nbsp;</label><button id="mGenPwd" class="btn soft" type="button">Générer</button> <button id="mSetPwd" class="btn primary" type="button">Définir</button></div></div>
  <p class="muted">Ses sessions ouvertes sont fermées et il devra choisir son propre mot de passe à la connexion suivante.</p>`:""}`}
 <div class="section-head"><h3>Retrait de l’équipe</h3></div>
 ${arch?`<button id="mUnarchive" class="btn soft">Annuler le retrait</button> <span class="muted">Le membre restera inactif jusqu’à sa réactivation.</span>`:`<button id="mArchive" class="btn danger">Retirer ce membre</button> <span class="muted">Désactive le compte ; rien n’est supprimé.</span>`}`);
 $("#mSave")?.addEventListener("click",()=>{
  const name=$("#mName").value.trim();if(!name){toast("Le nom est obligatoire.");return}
  saveTeam(()=>supabase.from("profiles").update({full_name:name,job_title:$("#mJob").value.trim()||null,role:$("#mRole").value,
   country:$("#mCountry").value||null,platform:$("#mPlatform").value||null,active:$("#mActive").value==="1"}).eq("id",p.id).select("id").single(),"Membre mis à jour.",p.id,($("#mActive").value==="1")!==!!p.active)});
 $$("[data-assign]").forEach(b=>b.onclick=()=>saveTeam(()=>supabase.from("profile_platforms").insert({profile_id:p.id,platform_id:b.dataset.assign}),"Plateforme affectée.",p.id));
 $$("[data-revoke]").forEach(b=>b.onclick=()=>saveTeam(()=>supabase.from("profile_platforms").update({revoked_at:new Date().toISOString()}).eq("id",b.dataset.revoke).select("id").single(),"Affectation révoquée.",p.id));
 $$("[data-reassign]").forEach(b=>b.onclick=()=>saveTeam(()=>supabase.from("profile_platforms").update({revoked_at:null}).eq("id",b.dataset.reassign).select("id").single(),"Affectation réactivée.",p.id));
 $("#mArchive")?.addEventListener("click",()=>{if(confirm(`Retirer ${p.full_name} de l’équipe ? Son compte sera désactivé ; son historique est conservé.`))saveTeam(()=>supabase.from("profiles").update({archived_at:new Date().toISOString()}).eq("id",p.id).select("id").single(),ID_MODE?"Membre retiré : sessions fermées et connexion bloquée.":"Membre retiré.",p.id,true)});
 $("#mForcePwd")?.addEventListener("click",()=>{if(confirm(`Exiger que ${p.full_name} choisisse un nouveau mot de passe ? Son accès aux données est suspendu jusque-là.`))saveTeam(()=>supabase.from("profiles").update({must_change_password:true}).eq("id",p.id).select("id").single(),"Nouveau mot de passe exigé.",p.id)});
 $("#mUnarchive")?.addEventListener("click",()=>saveTeam(()=>supabase.from("profiles").update({archived_at:null}).eq("id",p.id).select("id").single(),"Retrait annulé.",p.id,true));
 $("#mGenPwd")?.addEventListener("click",()=>{$("#mProvPwd").value=genPassword()});
 $("#mSetPwd")?.addEventListener("click",()=>{const pw=$("#mProvPwd").value;if(pw.length<8){toast("8 caractères minimum.");return}
  if(confirm(`Définir ce mot de passe provisoire pour ${p.full_name} ? Ses sessions ouvertes seront fermées.`))
   saveTeam(async()=>{const r=await authFn({action:"set_password",target:p.id,password:pw});return {error:r.ok?null:{message:r.message}}},"Mot de passe provisoire défini : transmettez-le de vive voix.",p.id)});
}
// Mot de passe provisoire aléatoire (sans caractères ambigus), généré dans le navigateur et jamais enregistré par l'application.
function genPassword(n=12){const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-";const v=crypto.getRandomValues(new Uint32Array(n));return [...v].map(x=>a[x%a.length]).join("")}
const usernameBase=name=>String(name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().split(/\s+/)[0].replace(/[^a-z0-9._-]/g,"");
// Création d'un compte par l'administrateur (mode identifiant).
function newMemberForm(){
 const enumPlatforms=data.platforms.filter(f=>PLATFORM_CODES.includes(f.code));
 modal("Nouveau membre",`<div class="callout">Le rôle, le poste et les plateformes sont indépendants de l’identifiant et pourront changer ensuite. Pour remplacer une personne partie, créez un nouveau compte et reprenez ses affectations : l’historique de l’ancienne reste à son nom.</div><br>
 <div class="form-grid">
  <div class="full-span"><label>Reprendre le rôle et les plateformes de (facultatif)</label><select id="nCopy"><option value="">—</option>${data.profiles.map(x=>`<option value="${x.id}">${esc(x.full_name)}${x.archived_at?" (retiré)":""}</option>`).join("")}</select></div>
  <div><label>Nom complet</label><input id="nName" autocomplete="off"></div>
  <div><label>Identifiant de connexion</label><input id="nUser" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ex. clemence"><button class="link" id="nSuggest" type="button">Proposer un identifiant libre</button></div>
  <div><label>Email personnel (récupération)</label><input id="nEmail" type="email" autocomplete="off"></div>
  <div><label>Intitulé du poste (affiché)</label><input id="nJob"></div>
  <div><label>Rôle (droits)</label><select id="nRole">${ASSIGNABLE_ROLES.map(r=>`<option value="${r}" ${r==="platform_manager"?"selected":""}>${esc(ROLES[r]||r)}</option>`).join("")}</select></div>
  <div><label>Pays</label><select id="nCountry"><option value="">Global</option>${COUNTRIES.map(c=>`<option>${c}</option>`).join("")}</select></div>
  <div><label>Plateforme principale</label><select id="nPlatform"><option value="">—</option>${enumPlatforms.map(f=>`<option value="${f.code}">${esc(f.name)}</option>`).join("")}</select></div>
  <div class="full-span"><label>Autres plateformes affectées</label>${data.platforms.filter(f=>f.status==="active").map(f=>`<label class="check"><input type="checkbox" class="nPf" value="${f.id}"> ${esc(f.name)}</label>`).join(" ")}</div>
  <div><label>Mot de passe provisoire</label><input id="nPwd" type="text" autocomplete="off" minlength="8" placeholder="8 caractères minimum"><button class="link" id="nGen" type="button">Générer</button></div>
  <div class="full-span"><button id="nCreate" class="btn primary">Créer le compte</button></div>
 </div><div id="nError" class="error hidden"></div>`);
 $("#nCopy").onchange=()=>{const x=data.profiles.find(y=>y.id===$("#nCopy").value);if(!x)return;
  $("#nRole").value=ASSIGNABLE_ROLES.includes(x.role)?x.role:"platform_manager";$("#nJob").value=x.job_title||"";$("#nCountry").value=x.country||"";$("#nPlatform").value=x.platform||"";
  const ids=(data.assignments||[]).filter(a=>a.profile_id===x.id&&(!a.revoked_at||x.archived_at)).map(a=>a.platform_id);$$(".nPf").forEach(c=>c.checked=ids.includes(c.value))};
 const suggest=async()=>{const base=$("#nUser").value.trim()||usernameBase($("#nName").value);if(!base)return;const r=await supabase.rpc("wakabi_username_suggestion",{p_base:usernameBase(base)});if(!r.error)$("#nUser").value=r.data};
 $("#nSuggest").onclick=suggest;$("#nName").onblur=()=>{if(!$("#nUser").value)suggest()};
 $("#nGen").onclick=()=>{$("#nPwd").value=genPassword()};
 $("#nCreate").onclick=()=>busy($("#nCreate"),"Création…",async()=>{
  authMessage("#nError","");
  const body={action:"create_user",full_name:$("#nName").value.trim(),username:$("#nUser").value.trim().toLowerCase(),email:$("#nEmail").value.trim(),
   job_title:$("#nJob").value.trim()||null,role:$("#nRole").value,country:$("#nCountry").value||null,platform:$("#nPlatform").value||null,
   platform_ids:$$(".nPf").filter(c=>c.checked).map(c=>c.value),password:$("#nPwd").value};
  if(!body.full_name||!body.username||!body.email||body.password.length<8){authMessage("#nError","Nom, identifiant, email et mot de passe provisoire (8 caractères minimum) sont obligatoires.");return}
  const r=await authFn(body);
  if(!r.ok){authMessage("#nError",r.message||"Création impossible.");return}
  await refresh();admin();memberForm(r.id);toast(`Compte « ${r.username} » créé : transmettez le mot de passe provisoire de vive voix.`);
 });
}
let listTab="rubriques";
function listUses(k,id){
 if(k==="platforms")return data.publications.filter(p=>p.platform_id===id).length;
 const col={rubriques:"rubrique_id",content_types:"content_type_id",campaigns:"campaign_id",content_objectives:"objective_id"}[k];
 return data.contents.filter(c=>c[col]===id).length;
}
function lists(){
 if(me.role!=="admin"){home();return}setHead("Administration · Listes","Rubriques, plateformes, types, campagnes et objectifs");
 const k=listTab,rows=data[k]||[],isP=k==="platforms",isC=k==="campaigns";
 $("#page").innerHTML=`<div class="toolbar">${Object.entries(LISTS).map(([id,l])=>`<button class="btn ${id===k?"primary":"soft"}" data-list="${id}">${l}</button>`).join(" ")}</div>
 ${data.listErrors?.includes(k)?`<div class="callout warn">Cette liste n’a pas pu être chargée. Rechargez la page.</div><br>`:""}
 <div class="toolbar"><div class="callout">${isP?"Une nouvelle plateforme demande une évolution technique de la base : demandez-la à l’équipe technique. Ici, vous pouvez renommer, réordonner, désactiver ou archiver une plateforme et indiquer les statistiques qu’elle fournit.":"Une valeur inactive ou archivée n’est plus proposée dans les formulaires mais reste affichée sur les contenus qui l’utilisent. Rien n’est supprimé."}</div>${isP?"":`<button class="btn primary" id="addItem">+ Ajouter</button>`}</div>
 <section class="card"><div class="table-wrap"><table><thead><tr><th>Ordre</th><th>Nom</th>${isP?"<th>Code</th><th>Republications</th><th>Enregistrements</th>":""}${isC?"<th>Nature</th><th>Période</th>":""}<th>Statut</th><th>Utilisations</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.sort_order}</td><td><strong>${esc(x.name)}</strong>${isC&&x.description?`<br><span class="muted">${esc(x.description)}</span>`:""}</td>${isP?`<td>${esc(x.code||"—")}</td><td>${x.supports_reposts===false?"Non fournies":"Oui"}</td><td>${x.supports_saves===false?"Non fournis":"Oui"}</td>`:""}${isC?`<td>${x.kind==="recurring"?"Rendez-vous récurrent":"Campagne datée"}</td><td>${x.start_date||x.end_date?`${frDate(x.start_date)} → ${frDate(x.end_date)}`:"—"}</td>`:""}<td><span class="badge ${x.status==="active"?"green":x.status==="inactive"?"gray":"red"}">${LIST_STATUS[x.status]||x.status}</span></td><td>${listUses(k,x.id)}</td><td><button class="link" data-item="${x.id}">Modifier</button></td></tr>`).join("")||`<tr><td colspan="9" class="muted">Aucune valeur.</td></tr>`}</tbody></table></div></section>`;
 $$("[data-list]").forEach(b=>b.onclick=()=>{listTab=b.dataset.list;lists()});
 $("#addItem")?.addEventListener("click",()=>itemForm(k,null));
 $$("[data-item]").forEach(b=>b.onclick=()=>itemForm(k,b.dataset.item));
}
function itemForm(k,id){
 const x=id?data[k].find(r=>r.id===id):{name:"",sort_order:Math.max(0,...data[k].map(r=>r.sort_order||0))+1,status:"active",kind:"campaign",supports_reposts:true,supports_saves:true};
 if(!x)return;const isP=k==="platforms",isC=k==="campaigns",n=id?listUses(k,id):0;
 modal(`${LISTS[k]} · ${id?esc(x.name):"Nouvelle valeur"}`,`<div class="form-grid">
  <div class="full-span"><label>Nom</label><input id="iName" value="${esc(x.name)}"></div>
  <div><label>Ordre d’affichage</label><input id="iOrder" type="number" value="${x.sort_order??0}"></div>
  <div><label>Statut</label><select id="iStatus">${Object.entries(LIST_STATUS).map(([v,l])=>`<option value="${v}" ${v===x.status?"selected":""}>${l}</option>`).join("")}</select></div>
  ${isP?`<div><label class="check"><input type="checkbox" id="iReposts" ${x.supports_reposts!==false?"checked":""}> Fournit les republications</label></div><div><label class="check"><input type="checkbox" id="iSaves" ${x.supports_saves!==false?"checked":""}> Fournit les enregistrements</label></div>`:""}
  ${isC?`<div><label>Nature</label><select id="iKind"><option value="campaign" ${x.kind!=="recurring"?"selected":""}>Campagne datée</option><option value="recurring" ${x.kind==="recurring"?"selected":""}>Rendez-vous récurrent</option></select></div><div></div><div><label>Début</label><input id="iStart" type="date" value="${x.start_date||""}"></div><div><label>Fin</label><input id="iEnd" type="date" value="${x.end_date||""}"></div><div class="full-span"><label>Description</label><input id="iDesc" value="${esc(x.description||"")}"></div>`:""}
  ${n?`<div class="full-span muted">Utilisée par ${n} ${isP?"publication(s)":"contenu(s)"}.${k==="rubriques"?" Un changement de nom est reporté sur ces contenus.":""}</div>`:""}
  <div class="full-span"><button id="iSave" class="btn primary">${id?"Enregistrer":"Ajouter"}</button></div></div>`);
 $("#iSave").onclick=()=>busy($("#iSave"),"Enregistrement…",async()=>{
  const name=$("#iName").value.trim();if(!name){toast("Le nom est obligatoire.");return}
  const row={name,sort_order:parseInt($("#iOrder").value,10)||0,status:$("#iStatus").value};
  if(isP){row.supports_reposts=$("#iReposts").checked;row.supports_saves=$("#iSaves").checked}
  if(isC){row.kind=$("#iKind").value;row.start_date=$("#iStart").value||null;row.end_date=$("#iEnd").value||null;row.description=$("#iDesc").value.trim()||null;
   if(row.start_date&&row.end_date&&row.end_date<row.start_date){toast("La fin doit être après le début.");return}}
  const {error}=id?await supabase.from(k).update(row).eq("id",id).select("id").single():await supabase.from(k).insert(row).select("id").single();
  if(error){toast(/duplicate|unique/i.test(error.message)?"Ce nom existe déjà dans la liste.":error.message);return}
  closeModal();await refresh();toast(id?"Valeur mise à jour.":"Valeur ajoutée.");lists();
 });
}
function help(){
 setHead("Guide","La routine Wakabi en quelques étapes");
 $("#page").innerHTML=`<div class="grid two"><section class="card"><h3>Routine</h3><ol class="steps"><li>La rédactrice crée <strong>une seule fiche contenu</strong>.</li><li>Elle associe les liens ${esc(namesFr(pubPlatforms().map(f=>f.name)))}.</li><li>À J+1 puis à J+7, le responsable de chaque réseau renseigne vues, likes, commentaires et partages (republications et enregistrements si la plateforme les fournit).</li><li>Les dashboards se mettent à jour automatiquement.</li><li>La rédaction analyse ce qui doit être gardé, réinventé ou abandonné.</li></ol></section><section class="card"><h3>Indicateur interne</h3><div class="callout"><strong>Taux d’interaction = (likes + commentaires + partages) / vues × 100.</strong></div><p class="muted">Republications et enregistrements peuvent être conservés en données complémentaires sans fausser la comparaison entre plateformes.</p></section></div>`;
}
// Options d'une liste : valeurs actives, plus la valeur déjà enregistrée sur la fiche même si elle n'est plus active.
const opts=(k,blank,cur)=>(blank?`<option value="">${blank}</option>`:"")+(data[k]||[]).filter(x=>x.status==="active"||x.id===cur)
 .map(x=>`<option value="${x.id}" ${x.id===cur?"selected":""}>${esc(x.name)}${x.status!=="active"?` (${(LIST_STATUS[x.status]||x.status).toLowerCase()})`:""}</option>`).join("");
const safeUrl=u=>/^https?:\/\//i.test(u||"");
function openNewContent(){contentForm(null)}
function contentForm(cid){
 const c=cid?data.contents.find(x=>x.id===cid):null;if(cid&&!c)return;
 const pubs=c?pubsFor(c.id):[];
 // Plateformes proposées : actives, plus celles où le contenu est déjà publié.
 const pf=[...pubPlatforms(),...data.platforms.filter(f=>pubs.some(p=>onPlatform(p,f))&&!pubPlatforms().includes(f))];
 const curRub=c?.rubrique_id||data.rubriques.find(r=>r.name===c?.rubrique)?.id;
 if(!c&&!activeOf("rubriques").length){toast(data.listErrors?.length?"Listes indisponibles : rechargez la page.":"Aucune rubrique active : l’administrateur doit en activer une.");return}
 modal(c?"Modifier le contenu":"Nouveau contenu",`<div class="form-grid"><div class="full-span"><label>Titre</label><input id="ctitle" value="${esc(c?.title||"")}" placeholder="On va où là ? — Restaurant X"></div>
 <div><label>Concept</label><input id="cconcept" value="${esc(c?.concept||"")}"></div><div><label>Rubrique</label><select id="crub">${opts("rubriques","",curRub)}</select></div>
 <div><label>Type de contenu</label><select id="ctype">${opts("content_types","— Non précisé",c?.content_type_id)}</select></div><div><label>Campagne</label><select id="ccamp">${opts("campaigns","— Aucune",c?.campaign_id)}</select></div>
 <div><label>Objectif principal</label><select id="cobj">${opts("content_objectives","— Non précisé",c?.objective_id)}</select></div><div><label>Pays</label><select id="ccountry">${COUNTRIES.map(x=>`<option ${x===c?.country?"selected":""}>${x}</option>`).join("")}</select></div>
 <div><label>Date de publication prévue</label><input id="cdate" type="date" value="${c?.publish_date||today()}"></div><div></div>
 <div class="full-span"><label>Légende (caption)</label><textarea id="ccaption" rows="3">${esc(c?.caption||"")}</textarea></div>
 <div class="full-span"><label>Script</label><textarea id="cscript" rows="5">${esc(c?.script||"")}</textarea></div>
 <div class="full-span"><label>Liens par plateforme</label>${c?`<span class="muted">Un lien déjà enregistré peut être corrigé mais pas vidé : la publication et ses statistiques sont conservées.</span>`:""}</div>
 ${pf.map(f=>{const pub=pubs.find(p=>onPlatform(p,f));return `<div><label>${esc(f.name)}${f.status!=="active"?" (inactive)":""}</label><input id="p_${f.id}" value="${esc(pub?.url||"")}" placeholder="https://...">${data.has07?`<input id="d_${f.id}" type="date" max="${todayIn($("#ccountry")?.value||c?.country||"Togo")}" value="${pub?.published_on||""}" title="Date effective de publication (vide = pas encore connue)" style="margin-top:6px">`:""}</div>`}).join("")}
 ${data.has07?`<div class="full-span muted">Sous chaque lien : la date effective de publication sur la plateforme. Laissez-la vide si elle n’est pas connue : l’échéance sera alors estimée à partir de la date prévue.</div>`:""}
 <div class="full-span"><button id="saveContent" class="btn primary">${c?"Enregistrer":"Créer"}</button></div></div>`);
 $("#saveContent").onclick=()=>busy($("#saveContent"),c?"Enregistrement…":"Création…",async()=>{
  const title=$("#ctitle").value.trim();if(!title){toast("Ajoute un titre.");return}
  if(!$("#cdate").value){toast("Indique la date de publication prévue.");return}
  const rub=data.rubriques.find(r=>r.id===$("#crub").value);if(!rub){toast("Choisis une rubrique.");return}
  const links=pf.map(f=>({f,pub:pubs.find(p=>onPlatform(p,f)),url:$("#p_"+CSS.escape(f.id)).value.trim(),date:data.has07?($("#d_"+CSS.escape(f.id)).value||null):undefined}));
  if(links.some(x=>x.date&&!x.url)){toast("Une date de publication demande un lien.");return}
  if(links.some(x=>x.pub&&!x.url)){toast("Un lien déjà enregistré ne peut pas être vidé.");return}
  if(links.some(x=>x.url&&x.url!==x.pub?.url&&!safeUrl(x.url))){toast("Chaque lien doit commencer par https://");return}
  const row={title,concept:$("#cconcept").value.trim(),rubrique:rub.name,rubrique_id:rub.id,content_type_id:$("#ctype").value||null,campaign_id:$("#ccamp").value||null,
   objective_id:$("#cobj").value||null,country:$("#ccountry").value,publish_date:$("#cdate").value,caption:$("#ccaption").value.trim()||null,script:$("#cscript").value.trim()||null};
  const {data:saved,error}=c?await supabase.from("contents").update(row).eq("id",c.id).select().single()
   :await supabase.from("contents").insert({...row,created_by:me.id}).select().single();
  if(error){toast(error.message);return}
  const errs=[];
  const dateChanged=x=>x.date!==undefined&&x.date!==(x.pub.published_on||null);
  const added=links.filter(x=>!x.pub&&x.url),changed=links.filter(x=>x.pub&&(x.url!==x.pub.url||dateChanged(x)));
  if(added.length){const {error:e}=await supabase.from("publications").insert(added.map(x=>({content_id:saved.id,platform:x.f.code,url:x.url,...(x.date?{published_on:x.date}:{})})));if(e)errs.push(e.message)}
  for(const x of changed){const upd={};if(x.url!==x.pub.url)upd.url=x.url;if(dateChanged(x))upd.published_on=x.date;
   const {error:e}=await supabase.from("publications").update(upd).eq("id",x.pub.id).select("id").single();if(e)errs.push(x.f.name+" : "+e.message)}
  closeModal();await refresh();
  if(errs.length)toast((c?"Contenu enregistré":"Contenu créé")+", mais des liens ou des dates n’ont pas été enregistrés : "+errs.join(" ; "));else toast(c?"Contenu mis à jour.":"Contenu créé.");
  render(active==="contents"?"contents":active);contentDetail(saved.id);
 });
}
function metricForm(pid,type="j7"){
 const p=data.publications.find(x=>x.id===pid);if(!p)return;const c=data.contents.find(x=>x.id===p.content_id);
 if(!data.readingsOk){toast("Relevés indisponibles : rechargez la page.");return}
 if(!canMetric(p)){toast("Vous ne pouvez pas renseigner cette plateforme.");return}
 if(type==="j1"&&rstate(p,c,"j1")==="missed"){toast("Ce J+1 est manqué : il ne peut plus être saisi comme J+1.");return}
 const f=data.platforms.find(x=>x.id===p.platform_id)||{},prev=effReading(pid,type),corr=!!prev,v=prev||{};
 const opt=(id,label,ok,val)=>`<div><label>${label}</label><input id="${id}" type="number" min="0" step="1" ${ok?"":"disabled"} value="${ok&&val!=null?val:""}" placeholder="${ok?"vide = non disponible":"N/D : non fourni par la plateforme"}"></div>`;
 modal(`${esc(p.platform)} · ${TYPE_LABEL[type]} — ${esc(c.title)}`,`<div class="callout">${corr?`<strong>Correction</strong> du relevé ${TYPE_LABEL[type]} du ${frDate(prev.measured_on)}. L’ancien relevé est conservé dans l’historique.`:`Relevé <strong>${TYPE_LABEL[type]}</strong>, échéance ${frDate(dueOf(p,c,type))}, ${basisLabel(p,c)}.`}</div>
 <div class="form-grid"><div><label>Date du relevé</label><input id="mdate" type="date" max="${today()}" value="${corr?prev.measured_on:today()}"></div><div></div>
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
  if(!row.measured_on||row.measured_on>today()){toast("La date du relevé ne peut pas être dans le futur.");return}
  if(corr){const reason=$("#mreason").value.trim();if(!reason){toast("Indiquez le motif de la correction.");return}row.corrects_reading_id=prev.id;row.correction_reason=reason}
  const {error}=await supabase.from("metric_readings").insert(row).select("id").single();
  if(error){toast(error.message);return}
  closeModal();await refresh();toast(corr?"Correction enregistrée.":"Relevé enregistré.");render(active);
 });
}
const nameOf=(k,id)=>(data[k]||[]).find(x=>x.id===id)?.name;
function contentDetail(cid){
 const c=data.contents.find(x=>x.id===cid);if(!c)return;const t=totals(c),ps=pubsFor(cid),n=ps.filter(p=>metricFor(p.id)).length;
 const info=[["Rubrique",c.rubrique],["Type",nameOf("content_types",c.content_type_id)],["Campagne",nameOf("campaigns",c.campaign_id)],["Objectif principal",nameOf("content_objectives",c.objective_id)],
  ["Pays",c.country],["Publication prévue",frDate(c.publish_date)],["Créé le",c.created_at?frDate(c.created_at.slice(0,10)):null],["Modifié le",c.updated_at?frDate(c.updated_at.slice(0,10)):null]];
 modal(c.title,`${degradedHtml()}${c.archived_at?`<div class="callout warn">Contenu archivé le ${frDate(c.archived_at.slice(0,10))}. Il n’apparaît plus dans les relevés à faire ; ses statistiques sont conservées.</div><br>`:""}
 ${c.concept?`<p class="muted">${esc(c.concept)}</p>`:""}
 <div class="stat-grid">${info.map(([l,v])=>`<div class="stat"><span>${l}</span><strong>${esc(v||"—")}</strong></div>`).join("")}</div>
 ${c.caption?`<div class="section-head"><h3>Légende</h3></div><div class="callout prewrap">${esc(c.caption)}</div>`:""}
 ${c.script?`<div class="section-head"><h3>Script</h3></div><div class="callout prewrap">${esc(c.script)}</div>`:""}
 <div class="section-head"><h3>Performance J+7 (relevés en vigueur)</h3></div>
 <div class="stat-grid"><div class="stat"><span>Vues</span><strong>${compact(t.views)}</strong></div><div class="stat"><span>Likes</span><strong>${compact(t.likes)}</strong></div><div class="stat"><span>Partages</span><strong>${compact(t.shares)}</strong></div><div class="stat"><span>Interaction</span><strong>${t.views?pct(t.rate):"—"}</strong></div></div>
 <p class="muted">Somme sur ${n} publication(s) mesurée(s) sur ${ps.length} : c’est un volume de vues, pas un nombre de personnes.</p>
 <div class="section-head"><h3>Publications</h3></div>
 <div class="table-wrap"><table><thead><tr><th>Plateforme</th><th>Lien</th><th>Publication</th><th>J+1</th><th>J+7</th><th>Vues J+7</th><th>Likes</th><th>Commentaires</th><th>Partages</th><th>Republications</th><th>Enregistrements</th></tr></thead><tbody>${ps.map(p=>{const m=metricFor(p.id),f=data.platforms.find(x=>x.id===p.platform_id)||{};
  const cell=type=>{const st=rstate(p,c,type),r=effReading(p.id,type),can=canMetric(p)&&!c.archived_at&&data.readingsOk;
   const lab={done:`<span class="badge green">${compact(r?.views)} vues</span>`,done_late:`<span class="badge yellow">${compact(r?.views)} vues · ${offsetLabel(p,c,type)}</span>`,not_tracked:`<span class="badge gray">Non suivi</span>`,unknown:`<span class="badge gray">Indisponible</span>`,due:`<span class="badge red">À saisir</span>`,late:`<span class="badge red">En retard</span>`,upcoming:`<span class="badge yellow">${frDate(dueOf(p,c,type))}</span>`,missed:`<span class="badge red">Manqué</span>`}[st];
   const act=can&&["due","late","done","done_late"].includes(st)?` <button class="link" onclick="window.metricForm('${p.id}','${type}')">${isDone(st)?"Corriger":"Saisir"}</button>`:"";return lab+act};
  const nd=(ok,val)=>!m?"—":ok===false||val==null?`<span class="muted">N/D</span>`:compact(val);
  return `<tr><td>${esc(p.platform)}</td><td>${safeUrl(p.url)?`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Voir la publication</a>`:`<span class="muted">${esc(p.url||"—")}</span>`}</td><td>${p.published_on?frDate(p.published_on):`<span class="muted">Estimée : ${frDate(c.publish_date)}</span>`}</td><td>${cell("j1")}</td><td>${cell("j7")}</td><td>${m?compact(m.views):"—"}</td><td>${m?compact(m.likes):"—"}</td><td>${m?compact(m.comments):"—"}</td><td>${m?compact(m.shares):"—"}</td><td>${nd(f.supports_reposts,m?.reposts)}</td><td>${nd(f.supports_saves,m?.saves)}</td></tr>`}).join("")||`<tr><td colspan="11" class="muted">Aucune publication enregistrée.</td></tr>`}</tbody></table></div>
 ${(()=>{const hist=data.readings.filter(r=>ps.some(p=>p.id===r.publication_id)).sort((a,b)=>a.entered_at<b.entered_at?1:-1);if(!hist.length)return "";
  const ORIG={direct:"Saisie",metrics_legacy:"Reprise de l’ancienne table",metrics_sync:"Ancienne interface"};
  return `<div class="section-head"><h3>Historique des relevés</h3></div><div class="table-wrap"><table><thead><tr><th>Saisi le</th><th>Plateforme</th><th>Type</th><th>Date du relevé</th><th>Vues</th><th>Interactions</th><th>Origine</th><th>Correction</th></tr></thead><tbody>${hist.map(r=>{const pub=ps.find(p=>p.id===r.publication_id),replaced=hist.some(x=>x.corrects_reading_id===r.id);
   return `<tr${replaced?' class="muted"':""}><td>${r.entered_at?frDate(r.entered_at.slice(0,10)):"—"}</td><td>${esc(pub?.platform)}</td><td>${TYPE_LABEL[r.reading_type]||"Autre"}</td><td>${frDate(r.measured_on)}</td><td>${compact(r.views)}</td><td>${compact((+r.likes||0)+(+r.comments||0)+(+r.shares||0))}</td><td>${ORIG[r.origin]||esc(r.origin)}</td><td>${r.correction_reason?esc(r.correction_reason):""}${replaced?" (remplacé)":""}</td></tr>`}).join("")}</tbody></table></div>`})()}
 ${canEdit()?`<br><div class="toolbar">${c.archived_at?"":`<button id="cEdit" class="btn primary">Modifier</button>`}${c.archived_at?`<button id="cUnarch" class="btn soft">Désarchiver</button>`:`<button id="cArch" class="btn danger">Archiver</button>`}</div>`:""}`);
 $("#cEdit")?.addEventListener("click",()=>contentForm(c.id));
 const arch=v=>busy($(v?"#cArch":"#cUnarch"),"…",async()=>{const {error}=await supabase.from("contents").update({archived_at:v?new Date().toISOString():null}).eq("id",c.id).select("id").single();
  if(error){toast(error.message);return}await refresh();toast(v?"Contenu archivé.":"Contenu désarchivé.");render(active);contentDetail(c.id)});
 $("#cArch")?.addEventListener("click",()=>{if(confirm("Archiver ce contenu ? Il ne sera plus proposé dans les relevés à faire. Rien n’est supprimé."))arch(true)});
 $("#cUnarch")?.addEventListener("click",()=>arch(false));
}
function kpiForm(){
 modal("Ajouter des KPI application",`<div class="form-grid"><div><label>Mois</label><input id="km" type="month" value="${today().slice(0,7)}"></div><div><label>Pays</label><select id="kc"><option>Togo</option><option>Bénin</option></select></div><div><label>Téléchargements</label><input id="kd" type="number"></div><div><label>Inscriptions</label><input id="ks" type="number"></div><div><label>Utilisateurs actifs</label><input id="ka" type="number"></div><div><label>Désinstallations</label><input id="ku" type="number"></div><div class="full-span"><button id="saveKpi" class="btn primary">Enregistrer</button></div></div>`);
 $("#saveKpi").onclick=async()=>{const n=id=>Math.max(0,+$(id).value||0);const payload={month:$("#km").value+"-01",country:$("#kc").value,downloads:n("#kd"),signups:n("#ks"),active_users:n("#ka"),uninstalls:n("#ku"),updated_by:me.id};const {error}=await supabase.from("app_kpis").upsert(payload,{onConflict:"month,country"});if(error){toast(error.message);return}closeModal();await refresh();toast("KPI enregistrés.");appKpis()}
}
window.metricForm=metricForm;window.contentDetail=contentDetail;
init();
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))}

