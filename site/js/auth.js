// Wakabi Performance Center — Connexion (email ou identifiant), mot de passe obligatoire, règle du lundi, ouverture de session, chargement des données.
"use strict";
async function init(){
 if(!configured){show("#setupView");return}
 db=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
 if(ID_MODE){$("#loginEmailBlock").classList.add("hidden");$("#email").required=false;$("#loginUserBlock").classList.remove("hidden");$("#username").required=true}
 const {data:{session}}=await db.auth.getSession();
 if(session) await enter(session.user.id); else show("#authView");
 // Pas d'appel Supabase directement dans ce rappel (recommandation supabase-js) : on le diffère.
 db.auth.onAuthStateChange((e,s)=>{
  if(e==="PASSWORD_RECOVERY")recovery=true;
  if(!s){if(me&&ID_MODE&&!userLogout&&$("#authError").classList.contains("hidden"))authMessage("#authInfo","Votre session est terminée : reconnectez-vous avec votre identifiant.");
   me=null;recovery=false;userLogout=false;show("#authView");return}
  if(!me && !entering)setTimeout(()=>enter(s.user.id),0);
 });
}
function authMessage(id,t){$(id).textContent=t;$(id).classList.toggle("hidden",!t)}
let userLogout=false;
function logout(){userLogout=true;return db.auth.signOut()}
// Appel de la fonction serveur wakabi-auth (clé service_role uniquement côté Supabase).
async function authFn(body){
 try{const {data,error}=await db.functions.invoke("wakabi-auth",{body});
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
async function endSession(reason){authMessage("#authError","");authMessage("#authInfo",SESSION_MSG[reason]||SESSION_MSG.week);me=null;await db.auth.signOut();show("#authView")}
async function checkWeek(){
 if(!ID_MODE||!me)return;const {data:{session}}=await db.auth.getSession();
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
   const {error}=await db.auth.setSession(r.session);
   if(error)authMessage("#authError","Connexion impossible : "+error.message);
  });return
 }
 const {error}=await db.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
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
 const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
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
 const {data:u,error}=await db.auth.updateUser(nonce?{password:p1,nonce}:{password:p1});
 if(error){
  if(error.code==="reauthentication_needed"||/reauthenticat/i.test(error.message)){
   const r=await db.auth.reauthenticate();
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

$("#retryBtn").onclick=async()=>{$("#retryBtn").classList.add("hidden");authMessage("#authError","");
 const {data:{session}}=await db.auth.getSession();if(session)await enter(session.user.id);else show("#authView")};
async function enter(uid){
 if(entering)return;entering=true;$("#retryBtn").classList.add("hidden");
 try{
 if(ID_MODE){
  const {data:{session}}=await db.auth.getSession();
  if(!session||sessionStale(session)){await endSession("week");return}
  const st=await db.rpc("wakabi_session_status");
  if(!st.error&&["week","revoked","archived","inactive","no_profile"].includes(st.data)){await endSession(st.data);return}
 }
 const {data,error}=await db.from("profiles").select("*").eq("id",uid).single();
 // Aucune ligne (code PGRST116) = profil introuvable : la session est fermée. Toute autre erreur (réseau coupé,
 // serveur indisponible, refus) ne ferme rien : message exact et bouton « Réessayer ».
 if(error&&error.code!=="PGRST116"){authMessage("#authInfo","");authMessage("#authError","Le serveur Wakabi ne répond pas ou refuse la lecture de votre profil ("+error.message+"). Vérifiez votre connexion internet, puis cliquez sur « Réessayer ».");$("#retryBtn").classList.remove("hidden");show("#authView");return}
 if(!data){await db.auth.signOut();authMessage("#authInfo","");authMessage("#authError","Profil Wakabi introuvable. Contactez l’administrateur.");show("#authView");return}
 if(data.archived_at){await db.auth.signOut();authMessage("#authError","Ce compte a été retiré de l’équipe. Contactez l’administrateur.");show("#authView");return}
 if(data.must_change_password||recovery){
  if(justChanged&&data.must_change_password)authMessage("#passwordError","Le mot de passe a été changé mais l’accès n’est pas encore débloqué. Réessayez dans un instant ou contactez l’administrateur.");
  justChanged=false;show("#passwordView");return
 }
 justChanged=false;
 if(data.active===false){await db.auth.signOut();authMessage("#authError","Ce compte n’est pas encore activé ou a été désactivé. Contactez l’administrateur.");show("#authView");return}
 // Plateformes affectées (profile_platforms, affectations non révoquées). En cas d'erreur, repli sur profiles.platform.
 const as=await db.from("profile_platforms").select("platform_id").eq("profile_id",uid).is("revoked_at",null);
 data.platformIds=as.error?null:as.data.map(a=>a.platform_id);
 me=data;$("#profileName").textContent=me.full_name||me.email;$("#profileRole").textContent=roleLabel(me);$("#avatar").textContent=(me.full_name||"W")[0].toUpperCase();
 $("#newContentBtn").classList.toggle("hidden",!["editor","admin"].includes(me.role));
 $("#page").innerHTML=`<div class="skeleton" aria-busy="true" aria-label="Chargement"><span></span><span></span><span></span><span></span></div>`;show("#mainView");
 await refresh();const r=parseRoute();if(r){filters=filtersFromQuery(r.qs);readViewQuery(r.view,r.qs)}render(r&&VIEWS[r.view]?r.view:"home");
 }finally{entering=false}
}
async function refresh(){
 const [c,p,m,a,f]=await Promise.all([
   db.from("contents").select("*").order("publish_date",{ascending:false}),
   db.from("publications").select("*"),
   db.from("metrics").select("*"),
   db.from("app_kpis").select("*").order("month",{ascending:false}),
   db.from("platforms").select("*").order("sort_order")
 ]);
 data.contents=c.data||[];data.publications=p.data||[];data.metrics=m.data||[];data.appKpis=a.data||[];data.platforms=f.data||[];
 data.loadErrors=[["contenus",c],["publications",p],["KPI application",a],["plateformes",f]].filter(x=>x[1].error).map(x=>x[0]+" : "+x[1].error.message);
 data.metricsError=m.error?m.error.message:null;
 const others=["rubriques","content_types","campaigns","content_objectives"];
 const ls=await Promise.all(others.map(k=>db.from(k).select("*").order("sort_order")));
 data.listErrors=[];if(f.error)data.listErrors.push("platforms");
 others.forEach((k,i)=>{data[k]=ls[i].data||[];if(ls[i].error)data.listErrors.push(k)});
 const rd=await db.from("metric_readings").select("*").order("entered_at");
 data.readingsOk=!rd.error;data.readings=rd.data||[];data.readingsError=rd.error?rd.error.message:null;
 data.effByPub=groupByPublication(effectiveReadings(data.readings));
 // Migration 07 (date effective par publication) : présente si la vue des échéances est lisible.
 const sc=await db.from("publication_schedule").select("publication_id").limit(1);data.has07=!sc.error;
 if(["admin","editor","direction"].includes(me?.role)){
  const [r,pp]=await Promise.all([db.from("profiles").select("*").order("full_name"),db.from("profile_platforms").select("*")]);
  data.profiles=r.data||[];data.assignments=pp.data||[];
 }
 await refreshExtras();   // tâches, notifications, objectifs… (migrations 09 et 10, si présentes)
}
