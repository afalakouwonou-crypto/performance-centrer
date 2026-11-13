# -*- coding: utf-8 -*-
"""Régénère site/sw.js : liste des fichiers mis en cache (lue dans index.html) et version du cache.

Usage : python outils/maj_service_worker.py            -> incrémente la version (à faire à chaque livraison)
        python outils/maj_service_worker.py --verifier -> vérifie seulement que sw.js est à jour (sortie 1 sinon)
"""
import pathlib, re, sys

SITE = pathlib.Path(__file__).resolve().parent.parent / "site"
FIXES = ["./", "./index.html", "./css/styles.css", "./config.js", "./vendor/supabase.js", "./manifest.webmanifest",
         "./img/icon.svg", "./img/icon-192.png", "./img/icon-512.png", "./img/icon-maskable-512.png"]
MODELE = """// Service worker Wakabi Performance Center (fichier généré par outils/maj_service_worker.py).
// Stratégie « réseau d'abord » : toujours la dernière version en ligne, le cache ne sert que hors ligne.
// Les appels à Supabase (autre domaine) ne passent jamais par le cache : les données restent à jour et privées.
const CACHE='wakabi-performance-v__VERSION__';
const ASSETS=__ASSETS__;
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
"""


def attendu(version):
    idx = (SITE / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r'<script defer src="(js/[^"]+)"', idx)
    manquants = [s for s in scripts if not (SITE / s).exists()]
    if manquants:
        sys.exit(f"Scripts introuvables : {manquants}")
    assets = FIXES + ["./" + s for s in scripts]
    return MODELE.replace("__VERSION__", str(version)).replace("__ASSETS__", "[" + ",".join(f"'{a}'" for a in assets) + "]")


sw = SITE / "sw.js"
actuel = sw.read_text(encoding="utf-8") if sw.exists() else ""
m = re.search(r"wakabi-performance-v(\d+)", actuel)
version = int(m.group(1)) if m else 8
if "--verifier" in sys.argv:
    ok = actuel == attendu(version)
    print("sw.js à jour" if ok else "sw.js PAS à jour : lancer python outils/maj_service_worker.py")
    sys.exit(0 if ok else 1)
sw.write_text(attendu(version + 1), encoding="utf-8", newline="\n")
print(f"sw.js régénéré : cache v{version + 1}")
