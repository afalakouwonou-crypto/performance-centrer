// Wakabi Performance Center — Démarrage de l'application et du service worker.
"use strict";
window.metricForm=metricForm;window.contentDetail=contentDetail;
init();
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))}
