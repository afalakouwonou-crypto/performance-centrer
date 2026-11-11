// Service worker Wakabi Performance.
// Stratégie : réseau d'abord (toujours la dernière version), cache en secours si hors ligne.
// Les appels à Supabase (autre domaine) ne sont jamais mis en cache : les données restent toujours à jour et privées.
const CACHE='wakabi-performance-v5';
const ASSETS=['./','./index.html','./styles.css','./app.js','./config.js','./vendor/supabase.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
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
