// Service worker Wakabi Performance Center (fichier généré par outils/maj_service_worker.py).
// Stratégie « réseau d'abord » : toujours la dernière version en ligne, le cache ne sert que hors ligne.
// Les appels à Supabase (autre domaine) ne passent jamais par le cache : les données restent à jour et privées.
const CACHE='wakabi-performance-v12';
const ASSETS=['./','./index.html','./css/styles.css','./config.js','./vendor/supabase.js','./manifest.webmanifest','./img/icon.svg','./img/icon-192.png','./img/icon-512.png','./img/icon-maskable-512.png','./js/calc.js','./js/icons.js','./js/core.js','./js/auth.js','./js/navigation.js','./js/rules.js','./js/ui.js','./js/rules-shared.js','./js/views/today.js','./js/views/contents.js','./js/views/entry.js','./js/views/analytics.js','./js/views/app-kpis.js','./js/views/direction.js','./js/views/compare.js','./js/views/calendar.js','./js/views/reports.js','./js/route-state.js','./js/views/team.js','./js/views/lists.js','./js/views/guide.js','./js/forms/content.js','./js/forms/metric.js','./js/views/content-detail.js','./js/forms/kpi.js','./js/organisation.js','./js/analyse-plus.js','./js/imports.js','./js/main.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  e.respondWith(
    fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res})
      .catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))
  );
});
