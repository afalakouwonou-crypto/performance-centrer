# -*- coding: utf-8 -*-
"""Sonde PUBLIQUE en lecture seule (rôle anon, clé publishable de site/config.js) : GET uniquement, aucune écriture.
Vérifie que le visiteur non connecté ne lit aucune donnée et que l'inscription libre est fermée (décision D9).
Usage : python outils/sonde_anon.py
"""
import json, pathlib, re, urllib.error, urllib.request
cfg = (pathlib.Path(__file__).resolve().parent.parent / "site" / "config.js").read_text(encoding="utf-8")
URL = re.search(r'SUPABASE_URL:\s*"([^"]+)"', cfg).group(1); KEY = re.search(r'SUPABASE_PUBLISHABLE_KEY:\s*"([^"]+)"', cfg).group(1)
TABLES = ["profiles", "profile_platforms", "contents", "publications", "metrics", "metric_readings", "app_kpis", "rubriques", "platforms",
          "content_types", "campaigns", "content_objectives", "activity_log", "content_tasks", "notifications", "content_files", "objectives", "saved_views"]
def get(path):
    req = urllib.request.Request(URL + path, headers={"apikey": KEY, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"null")
        except Exception: return e.code, None
fuite = False
for t in TABLES:
    st, body = get(f"/rest/v1/{t}?select=*&limit=1")
    lignes = len(body) if isinstance(body, list) else 0
    fuite |= lignes > 0
    print(f"{t:22s} {st}  {'LIGNES VISIBLES : ' + str(lignes) if lignes else (body or {}).get('code', '') if isinstance(body, dict) else ''}")
st, s = get("/auth/v1/settings")
print("\ninscription libre :", "OUVERTE (à fermer, D9)" if s and not s.get("disable_signup") else "fermée")
print("données lisibles sans connexion :", "OUI — À CORRIGER" if fuite else "aucune")
