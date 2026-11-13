// Wakabi Performance Center — Base commune : configuration, état partagé, listes, utilitaires d'affichage, fenêtre et messages.
"use strict";
// Fonctions de calcul et icônes (scripts calc.js et icons.js chargés avant ce fichier).
const {REF_LABEL,PERIODS,MEASURES,EMPTY_FILTERS,aggregate,evolution,effectiveReadings,groupByPublication,referenceReading,applyFilters,previousPeriodFilters,activeFilterCount,filtersToQuery,filtersFromQuery,interactionsOf,rateOf,weekStart,monthBounds,shiftMonth,toCsv,daysBetween,inRange}=window.WakabiCalc;
const {icon}=window.WakabiIcons;
// Client Supabase chargé localement (vendor/supabase.js), sans dépendre d'un CDN externe.
const { createClient } = window.supabase;

const cfg=window.WAKABI_CONFIG||{};
// Mode « identifiant » (migration 08 + fonction Edge wakabi-auth) : connexion par identifiant personnel,
// comptes créés par l'administrateur, reconnexion chaque lundi. Sans ce réglage, l'ancienne connexion par email reste active.
const ID_MODE=cfg.AUTH_MODE==="identifiant";
const configured=cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("PASTE_") &&
  cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");

let db=null, me=null, active="home", data={contents:[],publications:[],metrics:[],appKpis:[],profiles:[],platforms:[],rubriques:[],content_types:[],campaigns:[],content_objectives:[]};
// Filtres partagés par Contenus, Performance et Direction ; relevé de référence mémorisé sur l'appareil (J+7 par défaut).
let filters={...EMPTY_FILTERS},filtersOpen=false,refType="j7";
try{const r=localStorage.getItem("wakabi.ref");if(REF_LABEL[r])refType=r}catch(e){}
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
// Durée d'affichage proportionnelle à la longueur du message (2,1 s à 9 s) ; un nouveau message remplace le précédent.
let toastTimer=null;
function toast(t){$("#toast").textContent=t;$("#toast").classList.remove("hidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("#toast").classList.add("hidden"),Math.min(9000,Math.max(2100,String(t).length*50)))}
// Fenêtre de dialogue : le focus va dans la fenêtre (sans ouvrir le clavier du téléphone) et revient ensuite à l'élément d'origine.
let modalOpener=null;
function modal(title,html){if($("#modal").classList.contains("hidden"))modalOpener=document.activeElement;$("#modalTitle").textContent=title;$("#modalBody").innerHTML=html;$("#modal").classList.remove("hidden");document.body.classList.add("modal-open");$("#modal .modal-card").scrollTop=0;$("#modal .modal-card").focus({preventScroll:true})}
function closeModal(){if($("#modal").classList.contains("hidden"))return;$("#modal").classList.add("hidden");document.body.classList.remove("modal-open");if(modalOpener&&document.contains(modalOpener))modalOpener.focus({preventScroll:true});modalOpener=null}
$$("[data-close-modal]").forEach(x=>x.onclick=closeModal);
