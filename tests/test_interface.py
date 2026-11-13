# -*- coding: utf-8 -*-
"""Tests d'interface Wakabi Performance Center (navigateur sans écran + faux client Supabase).

Usage : python tests/test_interface.py [dossier_du_site] [parties R,N,P,Q]
- Partie R : reprise fidèle de wakabi-recette/tests_interface/run7.js (non-régression, mode identifiant et email).
- Partie N : lot 1.4c (correctifs de l'audit du 2026-11-12).
- Partie P : lots 1.5 à 1.8 (calculs, cloche, filtres, accueil par rôle), mise en page téléphone, accessibilité, CSP.
Aucun réseau : supabase.js et config.js sont remplacés à la volée ; sw.js est désactivé.
Le serveur local envoie les en-têtes de vercel.json (dont la CSP) : chaque page est testée sous la même politique qu'en ligne.
"""
import base64, datetime as dt, functools, http.server, json, pathlib, re, socket, sys, threading, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
SITE = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "site"
STUB = (HERE / "stub_wakabi.js").read_text(encoding="utf-8")
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/"
fails = 0
results = []


def ok(name, cond, extra=""):
    global fails
    line = ("OK     " if cond else "ÉCHEC  ") + name + (f"  → {extra}" if extra and not cond else "")
    print(line, flush=True)
    results.append(line)
    if not cond:
        fails += 1


def now_s():
    return int(time.time())


def monday_s():
    n = dt.datetime.now(dt.timezone.utc)
    d = dt.datetime(n.year, n.month, n.day, tzinfo=dt.timezone.utc)
    d -= dt.timedelta(days=(d.weekday()))
    return int(d.timestamp())


def tok(ts):
    payload = json.dumps({"sub": "u", "amr": [{"method": "password", "timestamp": ts}]}).encode()
    return "h." + base64.b64encode(payload).decode().rstrip("=") + ".s"


def config(mode="identifiant", env=None, url="https://test.supabase.co"):
    extra = (f',AUTH_MODE:"{mode}"' if mode else "") + (f',ENV:"{env}"' if env else "")
    return f'window.WAKABI_CONFIG={{SUPABASE_URL:"{url}",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_test"{extra}}};'


def mk(role, **extra):
    S = {"tables": {
        "profiles": [
            {"id": "u", "email": "moi+prive@gmail.com", "username": "moi", "full_name": "Moi Admin", "role": role, "active": True, "must_change_password": False, "platform": None},
            {"id": "v", "email": "clemence+prive@gmail.com", "username": "clemence", "full_name": "Clémence", "role": "platform_manager", "active": True, "must_change_password": False, "platform": "TikTok"},
            {"id": "w", "email": "partie@gmail.com", "username": "ancienne", "full_name": "Ancienne TikTok", "role": "platform_manager", "active": False, "archived_at": "2026-10-20T10:00:00Z", "must_change_password": False, "platform": "TikTok"}],
        "profile_platforms": [{"id": "a1", "profile_id": "v", "platform_id": "pf-tt", "revoked_at": None}, {"id": "a2", "profile_id": "w", "platform_id": "pf-tt", "revoked_at": None}, {"id": "a3", "profile_id": "w", "platform_id": "pf-ig", "revoked_at": None}],
        "platforms": [{"id": "pf-tt", "code": "TikTok", "name": "TikTok", "status": "active"}, {"id": "pf-ig", "code": "Instagram", "name": "Instagram", "status": "active"}],
        "rubriques": [{"id": "r0", "name": "SPOT", "status": "active"}], "content_types": [], "campaigns": [], "content_objectives": [], "contents": [], "publications": [], "metrics": [], "metric_readings": [], "app_kpis": []},
        "log": [], "session": None}
    S.update(extra)
    return S


class P:
    """Une page de test avec ses erreurs JavaScript et ses fenêtres de dialogue."""
    def __init__(self, browser, S, cfg, tz=None, fixed=None, viewport=None, hash=""):
        opts = {"bypass_csp": bool(S.get("fnSrc"))}  # seul le scénario de connexion simulée a besoin d'évaluer du code
        if tz: opts["timezone_id"] = tz
        if viewport: opts["viewport"] = viewport
        self.ctx = browser.new_context(**opts)
        self.p = self.ctx.new_page()
        self.p.set_default_timeout(4000)
        self.errs, self.dialogs = [], []
        self.p.on("pageerror", lambda e: self.errs.append(str(e)))

        def on_dialog(d):
            self.dialogs.append(d.message)
            d.accept()
        self.p.on("dialog", on_dialog)
        self.p.route("**/vendor/supabase.js", lambda r: r.fulfill(content_type="application/javascript", body=STUB))
        self.p.route("**/config.js", lambda r: r.fulfill(content_type="application/javascript", body=cfg))
        self.p.route("**/sw.js", lambda r: r.fulfill(status=404, body=""))
        self.p.add_init_script(script="window.__S=%s;if(window.__S.fnSrc)window.__S.fn=new Function('body','S',window.__S.fnSrc);"
                               "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));" % json.dumps(S))
        if fixed:
            self.p.clock.set_fixed_time(fixed)
        self.p.goto(BASE + hash)
        self.p.wait_for_timeout(450)

    def vis(self, sel):
        return self.p.evaluate("q=>{const e=document.querySelector(q);return !!e&&!e.closest('.hidden')}", sel)

    def text(self, sel):
        return self.p.evaluate("q=>(document.querySelector(q)||{}).innerText||''", sel)

    def log(self):
        return self.p.evaluate("()=>window.__S.log")

    def close(self):
        self.ctx.close()


LOGIN_FN = ('if(body.action==="login"){if(body.username.toLowerCase()==="moi"&&body.password==="bon-mdp")return {ok:true,session:{access_token:"%s",refresh_token:"r"}};'
            'return {ok:false,message:"Identifiant ou mot de passe incorrect, ou trop de tentatives. Réessayez dans quelques minutes."}}'
            'if(body.action==="recover")return {ok:true,message:"Si cet identifiant correspond à un compte actif, un email..."};'
            'if(body.action==="create_user"){S.tables.profiles.push({id:"n1",email:body.email,username:body.username,full_name:body.full_name,role:body.role,active:true,must_change_password:true,platform:body.platform});return {ok:true,id:"n1",username:body.username}}'
            'return {ok:true,state:"blocked"}')


def partie_R(b):
    """Reprise de run7.js (non-régression)."""
    p = P(b, mk("admin", fnSrc=LOGIN_FN % tok(now_s())), config())
    ok("R1a champ Identifiant affiché, champ email masqué", p.vis('#username') and not p.vis('#email'))
    p.p.fill('#username', 'moi'); p.p.fill('#password', 'faux'); p.p.click('#loginForm button[type=submit]'); p.p.wait_for_timeout(300)
    ok("R1b mauvais mot de passe : message générique", bool(re.search("incorrect, ou trop de tentatives", p.text('#authError'))), p.text('#authError'))
    p.p.fill('#username', 'MOI'); p.p.fill('#password', 'bon-mdp'); p.p.click('#loginForm button[type=submit]'); p.p.wait_for_timeout(600)
    ok("R1c bonne connexion : application affichée", p.vis('#mainView'))
    ok("R1d le mot de passe n'est pas resté dans le champ", p.p.input_value('#password') == "")
    ok("R1e statut de session vérifié auprès de la base", any(x.startswith("rpc:wakabi_session_status") for x in p.log()))
    p.p.click('.nav-btn[data-id=admin]'); p.p.wait_for_timeout(200)
    ok("R2a colonne Identifiant", bool(re.search("identifiant", p.text('#page thead'), re.I)) and "clemence" in p.text('#page tbody'))
    p.p.click('#newMember'); p.p.wait_for_timeout(100)
    p.p.fill('#nName', 'Clémence Durand'); p.p.click('#nSuggest'); p.p.wait_for_timeout(150)
    ok("R2b identifiant proposé sans accent ni doublon", p.p.input_value('#nUser') == "clemence2", p.p.input_value('#nUser'))
    p.p.select_option('#nCopy', 'w'); p.p.wait_for_timeout(50)
    pfs = p.p.evaluate("()=>[...document.querySelectorAll('.nPf')].filter(c=>c.checked).map(c=>c.value).join(',')")
    ok("R2c reprise des affectations de l'ancienne", p.p.input_value('#nPlatform') == "TikTok" and pfs == "pf-tt,pf-ig", pfs)
    p.p.click('#nCreate'); p.p.wait_for_timeout(150)
    ok("R2d champs obligatoires contrôlés", "obligatoires" in p.text('#nError'))
    p.p.fill('#nEmail', 'clemence.d@gmail.com'); p.p.click('#nGen')
    ok("R2e mot de passe provisoire généré (12 caractères)", len(p.p.input_value('#nPwd')) == 12)
    p.p.click('#nCreate'); p.p.wait_for_timeout(500)
    created = next((x for x in p.log() if '"create_user"' in x), "")
    ok("R2f appel create_user complet", '"username":"clemence2"' in created and '"platform_ids":["pf-tt","pf-ig"]' in created and '"email":"clemence.d@gmail.com"' in created)
    ok("R2g fiche du nouveau membre ouverte, identifiant définitif", "clemence2" in p.text('#modalBody') and "définitif" in p.text('#modalBody'))
    p.p.evaluate("()=>document.querySelector('[data-close-modal]').click()"); p.p.click('[data-member="v"]'); p.p.wait_for_timeout(100)
    p.p.click('#mGenPwd'); p.p.click('#mSetPwd'); p.p.wait_for_timeout(400)
    ok("R3a mot de passe provisoire : appel set_password", any('"set_password"' in x and '"target":"v"' in x for x in p.log()))
    p.p.evaluate("()=>document.querySelector('[data-close-modal]').click()"); p.p.click('[data-member="v"]'); p.p.wait_for_timeout(100); p.p.click('#mArchive'); p.p.wait_for_timeout(400)
    L = p.log()
    iu = next((i for i, x in enumerate(L) if x.startswith('update:profiles') and 'archived_at' in x), -1)
    isy = next((i for i, x in enumerate(L) if '"sync_access"' in x and '"target":"v"' in x), -1)
    ok("R3b départ : profil retiré puis compte bloqué dans Auth", iu >= 0 and isy > iu)
    ok("R3c message de confirmation", "sessions fermées" in p.text('#toast'), p.text('#toast'))
    ok("R3d aucune erreur JavaScript", not p.errs, ";".join(p.errs))
    p.p.evaluate("t=>{window.__S.session.access_token=t}", tok(monday_s() - 60))
    p.p.evaluate("()=>document.dispatchEvent(new Event('visibilitychange'))"); p.p.wait_for_timeout(300)
    ok("R4a session d'avant lundi : déconnexion et message", p.vis('#authView') and "Nouvelle semaine" in p.text('#authInfo'), p.text('#authInfo'))
    p.close()
    p = P(b, mk("admin", session={"user": {"id": "u"}, "access_token": tok(monday_s() - 3600)}), config())
    ok("R5a session de la semaine précédente refusée à l'ouverture", p.vis('#authView') and "Nouvelle semaine" in p.text('#authInfo') and "signOut" in p.log())
    p.close()
    p = P(b, mk("admin", session={"user": {"id": "u"}, "access_token": tok(monday_s())}), config())
    ok("R5b session ouverte lundi 00:00 pile acceptée", p.vis('#mainView')); p.close()
    p = P(b, mk("admin", status="revoked", session={"user": {"id": "u"}, "access_token": tok(now_s())}), config())
    ok("R6a session fermée par l'admin : message", p.vis('#authView') and "fermée par l’administrateur" in p.text('#authInfo')); p.close()
    p = P(b, mk("admin", status="archived", session={"user": {"id": "u"}, "access_token": tok(now_s())}), config())
    ok("R6b compte retiré : message", "retiré de l’équipe" in p.text('#authInfo')); p.close()
    S7 = mk("platform_manager", status="must_change", session={"user": {"id": "u"}, "access_token": tok(now_s())})
    S7["tables"]["profiles"][0]["must_change_password"] = True
    p = P(b, S7, config()); ok("R7a mot de passe provisoire : écran de changement imposé", p.vis('#passwordView')); p.close()
    p = P(b, mk("admin", fnSrc=LOGIN_FN % tok(now_s())), config())
    p.p.click('#forgotBtn'); p.p.wait_for_timeout(100)
    ok("R8a récupération : identifiant demandé", "identifiant" in p.text('#authError'))
    p.p.fill('#username', 'Clemence'); p.p.click('#forgotBtn'); p.p.wait_for_timeout(300)
    ok("R8b récupération : réponse générique, adresse du site transmise", "Si cet identifiant" in p.text('#authInfo') and any('"recover"' in x and f'"redirectTo":"{BASE}"' in x for x in p.log()))
    p.close()
    p = P(b, mk("admin"), config(mode=None))
    ok("R9a mode email : champ email affiché, pas d'identifiant", p.vis('#email') and not p.vis('#username'))
    ok("R9b mode email : aucun appel à la fonction serveur", not any(x.startswith("fn:") for x in p.log()))
    p.close()


def jours(n=0, base=None):
    d = (base or dt.datetime.now(dt.timezone.utc)).date()
    return (d + dt.timedelta(days=n)).isoformat()


def scenario_releves(role, country, published_on, title="L'été à Lomé"):
    S = mk(role, session={"user": {"id": "u"}, "access_token": tok(now_s())})
    T = S["tables"]
    T["platforms"][0].update({"supports_reposts": True, "supports_saves": True})
    T["contents"] = [{"id": "c1", "title": title, "concept": "", "country": country, "rubrique": "SPOT", "rubrique_id": "r0", "publish_date": published_on, "archived_at": None}]
    T["publications"] = [{"id": "pub1", "content_id": "c1", "platform": "TikTok", "platform_id": "pf-tt", "url": "https://exemple.test/1", "published_on": published_on}]
    T["publication_schedule"] = []
    return S


def saisir(p, date_val, vals=("100", "5", "2", "1")):
    p.p.fill('#mdate', date_val)
    for sel, v in zip(('#mv', '#ml', '#mc', '#ms'), vals):
        p.p.fill(sel, v)
    p.p.click('#saveMetric'); p.p.wait_for_timeout(350)


def partie_N(b):
    """Lot 1.4c."""
    # N1 — base unique : aucun bandeau ni titre de recette
    p = P(b, mk("admin"), config())
    ok("N1a base unique : aucun bandeau, titre normal", p.p.locator('#envBanner').count() == 0 and p.p.title() == "Wakabi Performance Center", p.p.title()); p.close()
    # N2 / N3 — erreur réseau ≠ profil introuvable, sans fenêtre bloquante (C11)
    S = mk("admin", session={"user": {"id": "u"}, "access_token": tok(now_s())}, netFail=["profiles"])
    p = P(b, S, config(mode=None))
    ok("N2a coupure réseau : message clair et bouton Réessayer", p.vis('#authView') and "ne répond pas" in p.text('#authError') and p.vis('#retryBtn'), p.text('#authError'))
    ok("N2b coupure réseau : la session n'est pas fermée", "signOut" not in p.log())
    p.p.evaluate("()=>{window.__S.netFail=[]}")
    if p.vis('#retryBtn'):
        p.p.click('#retryBtn'); p.p.wait_for_timeout(400)
    ok("N2c Réessayer : l'application s'ouvre", p.vis('#mainView'))
    ok("N2d aucune fenêtre de dialogue", not p.dialogs, ";".join(p.dialogs)); p.close()
    p = P(b, mk("admin", session={"user": {"id": "zz"}, "access_token": tok(now_s())}), config(mode=None))
    ok("N3a profil introuvable : message à l'écran, session fermée", "Profil Wakabi introuvable" in p.text('#authError') and "signOut" in p.log(), p.text('#authError'))
    ok("N3b profil introuvable : aucune fenêtre alert()", not p.dialogs, ";".join(p.dialogs)); p.close()
    # N4 — titres de fenêtre sans double échappement (C06)
    p = P(b, scenario_releves("editor", "Togo", jours(-1)), config(mode=None))
    p.p.evaluate("()=>window.metricForm('pub1','j1')"); p.p.wait_for_timeout(150)
    ok("N4a titre du relevé : apostrophe affichée telle quelle", "L'été à Lomé" in p.text('#modalTitle') and "&#" not in p.text('#modalTitle'), p.text('#modalTitle')); p.close()
    S = mk("admin", session={"user": {"id": "u"}, "access_token": tok(now_s())}); S["tables"]["rubriques"][0]["name"] = "Bons plans d'été"
    p = P(b, S, config(mode=None)); p.p.click('.nav-btn[data-id=lists]'); p.p.wait_for_timeout(150); p.p.click('[data-item="r0"]'); p.p.wait_for_timeout(100)
    ok("N4b titre d'une valeur de liste : apostrophe affichée telle quelle", "d'été" in p.text('#modalTitle') and "&#" not in p.text('#modalTitle'), p.text('#modalTitle')); p.close()
    # N5 — date du relevé : fuseau du pays et bornes par rapport à l'échéance (C07, C08)
    now = dt.datetime.now(dt.timezone.utc)
    soir = dt.datetime(now.year, now.month, now.day, 23, 30, tzinfo=dt.timezone.utc)
    D = soir.date().isoformat(); D1 = (soir.date() + dt.timedelta(days=1)).isoformat()
    p = P(b, scenario_releves("editor", "Bénin", D), config(mode=None), tz="Africa/Lome", fixed=soir)
    p.p.evaluate("()=>window.metricForm('pub1','j1')"); p.p.wait_for_timeout(150)
    mn, mx, val = (p.p.get_attribute('#mdate', a) for a in ("min", "max", "value"))
    ok("N5a Bénin à 23:30 UTC (navigateur à Lomé) : J+1 daté du jour béninois", val == D1 and mx == D1 and mn == D1, f"min={mn} max={mx} valeur={val} attendu {D1}")
    saisir(p, D)
    ok("N5b date antérieure à l'échéance refusée", not any(x.startswith("insert:metric_readings") for x in p.log()) and "doit être" in p.text('#toast'), p.text('#toast'))
    saisir(p, D1)
    ok("N5c date dans les bornes acceptée", any(x.startswith("insert:metric_readings") and f'"measured_on":"{D1}"' in x for x in p.log()))
    ok("N5d aucune erreur JavaScript", not p.errs, ";".join(p.errs)); p.close()
    p = P(b, scenario_releves("editor", "Togo", (soir.date() - dt.timedelta(days=7)).isoformat()), config(mode=None), tz="Africa/Lome", fixed=soir)
    p.p.evaluate("()=>window.metricForm('pub1','j7')"); p.p.wait_for_timeout(150)
    saisir(p, (soir.date() - dt.timedelta(days=4)).isoformat())
    ok("N5e J+7 daté de J+3 refusé", not any(x.startswith("insert:metric_readings") for x in p.log()), p.text('#toast')); p.close()
    # N6 — doublon simultané : message compréhensible (C09)
    S = scenario_releves("editor", "Togo", jours(-1))
    S["insertError"] = {"metric_readings": {"code": "23505", "message": 'duplicate key value violates unique constraint "metric_readings_one_original_key"'}}
    p = P(b, S, config(mode=None)); p.p.evaluate("()=>window.metricForm('pub1','j1')"); p.p.wait_for_timeout(150)
    saisir(p, jours(0))
    ok("N6a doublon : message en français, sans texte technique", bool(re.search("quelqu.un d.autre", p.text('#toast'))) and "duplicate" not in p.text('#toast'), p.text('#toast')); p.close()
    # N7 — KPI application (C05)
    mois = jours(0)[:7]
    S = mk("editor", session={"user": {"id": "u"}, "access_token": tok(now_s())})
    S["tables"]["app_kpis"] = [{"id": "k1", "month": mois + "-01", "country": "Togo", "downloads": 10, "signups": 5, "active_users": 3, "uninstalls": 1}]
    p = P(b, S, config(mode=None)); p.p.click('.nav-btn[data-id=app]'); p.p.wait_for_timeout(150); p.p.click('#addKpi'); p.p.wait_for_timeout(100)
    p.p.select_option('#kc', 'Bénin'); p.p.fill('#ks', '4'); p.p.fill('#ka', '3'); p.p.fill('#ku', '0'); p.p.click('#saveKpi'); p.p.wait_for_timeout(200)
    ok("N7a champ vide : refusé (jamais enregistré à 0 en silence)", not any(x.startswith("upsert:") for x in p.log()) and "Remplissez" in p.text('#toast'), p.text('#toast'))
    p.p.fill('#kd', '12'); p.p.evaluate("()=>{window.__S.delayMs=400}")
    p.p.click('#saveKpi'); p.p.click('#saveKpi', force=True, no_wait_after=True); p.p.wait_for_timeout(700)
    ups = [x for x in p.log() if x.startswith("upsert:app_kpis")]
    ok("N7b double clic : un seul enregistrement", len(ups) == 1, str(len(ups)))
    ok("N7c valeurs enregistrées telles que saisies", bool(ups) and '"downloads":12' in ups[0] and '"uninstalls":0' in ups[0] and '"country":"Bénin"' in ups[0], ups[0] if ups else "")
    ok("N7d mois nouveau : aucune demande de confirmation", not p.dialogs, ";".join(p.dialogs))
    p.p.evaluate("()=>{window.__S.delayMs=0}"); p.p.click('#addKpi'); p.p.wait_for_timeout(100)
    for sel, v in (('#kd', '20'), ('#ks', '9'), ('#ka', '7'), ('#ku', '2')):
        p.p.fill(sel, v)
    p.p.click('#saveKpi'); p.p.wait_for_timeout(300)
    ok("N7e mois déjà saisi : confirmation demandée avant de remplacer", any("existe déjà" in d for d in p.dialogs) and len([x for x in p.log() if x.startswith("upsert:app_kpis")]) == 2, ";".join(p.dialogs))
    ok("N7f aucune erreur JavaScript", not p.errs, ";".join(p.errs)); p.close()
    # N8 — date effective : « aujourd'hui » suit le pays choisi (C12)
    S = scenario_releves("editor", "Togo", D)
    p = P(b, S, config(mode=None), tz="Africa/Lome", fixed=soir); p.p.click('#newContentBtn'); p.p.wait_for_timeout(150)
    m1 = p.p.get_attribute('#d_pf-tt', 'max'); p.p.select_option('#ccountry', 'Bénin'); p.p.wait_for_timeout(50); m2 = p.p.get_attribute('#d_pf-tt', 'max')
    ok("N8a date effective maximale = jour du pays choisi", m1 == D and m2 == D1, f"Togo={m1} Bénin={m2} attendu {D}/{D1}"); p.close()
    # N9 — fichiers statiques (C21, C22, C23, .vercelignore)
    html = (SITE / "index.html").read_text(encoding="utf-8")
    ok("N9a champs de connexion : autocomplete", bool(re.search(r'id="email"[^>]*autocomplete="username"', html)) and bool(re.search(r'id="password"[^>]*autocomplete="current-password"', html)))
    ok("N9b écran de configuration à jour", "supabase_schema.sql" not in html)
    ok("N9c index.html sans bandeau ni titre de recette en dur", "[RECETTE]" not in html and "SITE DE TEST" not in html)
    sw = (SITE / "sw.js").read_text(encoding="utf-8"); m = re.search(r"wakabi-performance-v(\d+)", sw)
    ok("N9d cache PWA incrémenté (≥ v7) ; icône maskable, calc.js et icons.js en cache", bool(m) and int(m.group(1)) >= 7 and all(x in sw for x in ("icon-maskable-512.png", "calc.js", "icons.js")))
    ok("N9e le dossier du site ne contient aucun document de travail (.md, .sql, .py)", not [f for f in SITE.rglob("*") if f.suffix in (".md", ".sql", ".py")])


def rich(role, me_platforms=None, **extra):
    """Jeu de données réaliste, daté par rapport à aujourd'hui (UTC = jour de Lomé).
    Attendus (aujourd'hui = D) : à saisir p4 J+1, p8 J+1 (Instagram), p7 J+7 en retard ; J+1 manqués p2, p7 ;
    prévu aujourd'hui c2 sans lien ; publication en retard c3 ; période 30 j : p1 2000 vues, p2 0 vue, p6 300 vues
    (archivé, conservé dans les statistiques) ; période précédente : p5 500 vues."""
    D = dt.datetime.now(dt.timezone.utc).date()
    d = lambda n: (D + dt.timedelta(days=n)).isoformat()
    month = lambda k: (D.replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m") if k else D.strftime("%Y-%m")
    S = mk(role, session={"user": {"id": "u"}, "access_token": tok(now_s())}, **extra)
    T = S["tables"]
    T["profiles"][0]["country"] = "Togo"
    T["platforms"] = [
        {"id": "pf-tt", "code": "TikTok", "name": "TikTok", "status": "active", "supports_reposts": True, "supports_saves": True, "sort_order": 1},
        {"id": "pf-ig", "code": "Instagram", "name": "Instagram", "status": "active", "supports_reposts": False, "supports_saves": True, "sort_order": 2},
        {"id": "pf-fb", "code": "Facebook", "name": "Facebook", "status": "active", "supports_reposts": True, "supports_saves": True, "sort_order": 3}]
    T["rubriques"] = [{"id": "r0", "name": "SPOT", "status": "active"}, {"id": "r1", "name": "BON PLAN", "status": "active"}]
    T["content_types"] = [{"id": "t1", "name": "Vidéo", "status": "active"}]
    T["profile_platforms"] = [{"id": "a1", "profile_id": "v", "platform_id": "pf-tt", "revoked_at": None}] + \
        [{"id": f"a0{i}", "profile_id": "u", "platform_id": x, "revoked_at": None} for i, x in enumerate(me_platforms or [])]
    rub = {"r0": "SPOT", "r1": "BON PLAN"}
    C = lambda i, t, c, pd, r="r0", arch=None: {"id": i, "title": t, "concept": "", "country": c, "rubrique": rub[r], "rubrique_id": r, "content_type_id": "t1", "publish_date": pd, "archived_at": arch}
    T["contents"] = [C("c1", "Restaurant X", "Togo", d(-8)), C("c2", "Plage d'Aného", "Togo", d(0)), C("c3", "Concert", "Bénin", d(-3), "r1"),
                     C("c4", "Marché", "Togo", d(-1)), C("c5", "Ancien", "Togo", d(-40)), C("c6", "Archivé", "Togo", d(-20), "r0", d(-2) + "T10:00:00Z"),
                     C("c7", "Retard J+7", "Togo", d(-9), "r1"), C("c8", "Insta du jour", "Togo", d(-1))]
    Pb = lambda i, c, pf, code, pon: {"id": i, "content_id": c, "platform": code, "platform_id": pf, "url": f"https://exemple.test/{i}", "published_on": pon}
    T["publications"] = [Pb("p1", "c1", "pf-tt", "TikTok", d(-8)), Pb("p2", "c1", "pf-ig", "Instagram", d(-8)), Pb("p4", "c4", "pf-tt", "TikTok", d(-1)),
                         Pb("p5", "c5", "pf-tt", "TikTok", d(-40)), Pb("p6", "c6", "pf-tt", "TikTok", d(-20)), Pb("p7", "c7", "pf-tt", "TikTok", d(-9)),
                         Pb("p8", "c8", "pf-ig", "Instagram", d(-1))]
    Rd = lambda i, p, ty, mon, v, l, c=0, s=0, rep=None: {"id": i, "publication_id": p, "reading_type": ty, "measured_on": mon, "views": v, "likes": l, "comments": c, "shares": s,
                                                       "reposts": rep, "saves": None, "corrects_reading_id": None, "correction_reason": None, "origin": "direct", "entered_at": mon + "T00:00:00Z"}
    T["metric_readings"] = [Rd("m1", "p1", "j1", d(-7), 1000, 40, 5, 5), Rd("m2", "p1", "j7", d(0), 2000, 60, 10, 10, 7), Rd("m3", "p2", "j7", d(-1), 0, 0),
                            Rd("m5", "p5", "j7", d(-33), 500, 25), Rd("m6", "p6", "j7", d(-13), 300, 30)]
    T["publication_schedule"] = []
    T["app_kpis"] = [{"id": "k1", "month": month(0) + "-01", "country": "Togo", "downloads": 100, "signups": 40, "active_users": 60, "uninstalls": 30},
                     {"id": "k2", "month": month(1) + "-01", "country": "Togo", "downloads": 80, "signups": 30, "active_users": 50, "uninstalls": 10}]
    return S


def no_inline_handlers(p):
    return p.p.evaluate("()=>!/\\son[a-z]+=\"/.test(document.documentElement.outerHTML)")


def unnamed_controls(p):
    return p.p.evaluate("""()=>{const vis=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
      const b=[...document.querySelectorAll('button,a[href]')].filter(e=>vis(e)&&!(e.innerText.trim()||e.getAttribute('aria-label')));
      const f=[...document.querySelectorAll('input,select,textarea')].filter(e=>vis(e)&&e.type!=='hidden'&&!e.labels?.length&&!e.getAttribute('aria-label'));
      return [...b,...f].map(e=>e.outerHTML.slice(0,80))}""")


def partie_P(b):
    VIEWS = ["home", "contents", "calendar", "entry", "analytics", "reports", "app", "direction", "admin", "lists", "help"]
    # P1 — Accueil rédaction
    p = P(b, rich("editor"), config(mode=None))
    kp = p.text('#page .kpis')
    ok("P1a Aujourd'hui (rédaction) : 3 relevés à saisir dont 1 en retard", re.search(r"Relevés à saisir\s*3\s*dont 1 en retard", kp) is not None, kp[:160])
    ok("P1b prévus aujourd'hui (1, sans lien), publication en retard (1), écarts J+1 (2)", re.search(r"Prévus aujourd’hui\s*1\s*dont 1 sans lien", kp) and re.search(r"Publication en retard\s*1", kp) and re.search(r"Écarts J\+1\s*2", kp), kp)
    page = p.text('#page')
    ok("P1c tendance 30 j : vues 2,3 k (+360 %), taux pondéré 4,8 %", "2,3 k" in page and "+360 %" in page and "4,8 %" in page, re.sub(r"\s+", " ", page)[:600])
    ok("P1d « Ce qui marche » : contenus d'au moins 100 vues, archivé compris", "Archivé" in p.text('#page') and "Restaurant X" in page)
    ok("P1e titre de la page : Bonjour + date du jour", p.text('#pageTitle').startswith("Bonjour") and re.search(r"\d{4}", p.text('#pageSubtitle')) is not None)
    # P2 — Cloche
    ok("P2a cloche : 3 relevés, pastille rouge (retard)", p.text('#bellCount') == "3" and p.p.evaluate("()=>document.querySelector('#bellCount').classList.contains('is-late')"))
    p.p.click('#bellBtn'); p.p.wait_for_timeout(120)
    ok("P2b panneau : 3 relevés, groupés (en retard d'abord)", p.p.locator('#bellPanel .bell-item').count() == 3 and "En retard" in p.text('#bellPanel'))
    p.p.locator('#bellPanel .bell-item').first.click(); p.p.wait_for_timeout(150)
    ok("P2c clic sur un relevé : formulaire de saisie ouvert, panneau fermé", "J+7" in p.text('#modalTitle') and not p.vis('#bellPanel'), p.text('#modalTitle'))
    p.p.keyboard.press("Escape"); p.p.wait_for_timeout(100)
    ok("P2d Échap ferme la fenêtre", not p.vis('#modal'))
    # P3 — Navigation, adresse, accessibilité, CSP, absence de onclick sur chaque écran (admin pour tout voir)
    p.close(); p = P(b, rich("admin"), config(mode=None))
    errs_views = []
    for v in VIEWS:
        p.p.click(f'.nav-btn[data-id={v}]'); p.p.wait_for_timeout(120)
        if not p.p.evaluate("()=>location.hash").startswith(f"#/{v}"): errs_views.append(f"{v}: adresse")
        if not no_inline_handlers(p): errs_views.append(f"{v}: onclick")
        u = unnamed_controls(p)
        if u: errs_views.append(f"{v}: sans nom {u[:2]}")
        if p.p.get_attribute(f'.nav-btn[data-id={v}]', 'aria-current') != "page": errs_views.append(f"{v}: aria-current")
    ok("P3a 11 écrans : adresse propre, aucun onclick, contrôles nommés, page courante signalée", not errs_views, "; ".join(errs_views))
    p.p.go_back(); p.p.wait_for_timeout(150)
    ok("P3b bouton Retour du navigateur : écran précédent (Listes)", p.p.evaluate("()=>location.hash").startswith("#/lists") and p.text('#pageTitle').startswith("Administration · Listes"), p.p.evaluate("()=>location.hash"))
    ok("P3c aucune violation de la CSP de vercel.json", p.p.evaluate("()=>window.__csp.length") == 0, str(p.p.evaluate("()=>window.__csp")))
    ok("P3d aucune erreur JavaScript", not p.errs, ";".join(p.errs))
    # P4 — Filtres, compteur, lien partageable
    p.p.click('.nav-btn[data-id=contents]'); p.p.wait_for_timeout(120)
    ok("P4a Contenus : 8 contenus · 7 publications sans filtre", "8 contenus · 7 publications" in p.text('.filters-foot'), p.text('.filters-foot'))
    p.p.select_option('#f_platform', 'pf-ig'); p.p.wait_for_timeout(150)
    ok("P4b filtre Instagram : 2 contenus · 2 publications, adresse mise à jour", "2 contenus · 2 publications" in p.text('.filters-foot') and "platform=pf-ig" in p.p.evaluate("()=>location.hash"), p.text('.filters-foot'))
    p.p.fill('#fq', 'insta'); p.p.wait_for_timeout(450)
    ok("P4c recherche combinée (sans accent) : 1 contenu", "1 contenu · 1 publication" in p.text('.filters-foot') and p.p.evaluate("()=>document.activeElement.id") == "fq", p.text('.filters-foot'))
    p.p.click('[data-act=reset-filters]'); p.p.wait_for_timeout(150)
    ok("P4d réinitialiser : retour à 8 contenus", "8 contenus" in p.text('.filters-foot'))
    p.close()
    p = P(b, rich("editor"), config(mode=None), hash="#/contents?platform=pf-ig")
    ok("P4e lien partagé #/contents?platform=pf-ig : même vue", p.text('#pageTitle') == "Contenus" and "2 contenus · 2 publications" in p.text('.filters-foot') and p.p.input_value('#f_platform') == "pf-ig", p.text('.filters-foot'))
    p.close()
    # P5 — Performance : N/D, taux pondéré, relevé de référence, croissance J+1 → J+7
    p = P(b, rich("editor"), config(mode=None), hash="#/analytics")
    t = re.sub(r"\s+", " ", p.text('#page'))
    ok("P5a toute la période (J+7) : 2,8 k vues, taux pondéré 4,8 %, 4 publications mesurées sur 7", "2,8 k" in t and "4,8 %" in t and re.search(r"Publications mesurées 4\s*/ 7", t), t[:500])
    ok("P5b republications : 7 (1 publication) ; enregistrements : N/D", re.search(r"Republications 7", t) and re.search(r"Enregistrements N/D", t), t[:900])
    ok("P5c croissance J+1 → J+7 : +1,0 k (+100 %) sur 1 publication", "+1,0 k" in t and "+100 %" in t)
    ig = p.p.evaluate("()=>[...document.querySelectorAll('.table-alt tbody tr')].map(r=>r.textContent.replace(/\\s+/g,' ')).find(r=>r.includes('Instagram'))||''")
    ok("P5d Instagram (1 publication mesurée, 0 vue) : taux N/D, jamais 0,0 %", "N/D" in ig and "0,0 %" not in ig, ig)
    p.p.click('[data-act=ref][data-ref=j1]'); p.p.wait_for_timeout(150)
    t = re.sub(r"\s+", " ", p.text('#page'))
    ok("P5e relevé J+1 : 1,0 k vues, taux 5,0 %, mémorisé", "Vues (J+1)" in t and "5,0 %" in t and p.p.evaluate("()=>localStorage.getItem('wakabi.ref')") == "j1", t[:400])
    p.close()
    # P6 — Fiche : croissance, relevé de suivi après J+7
    p = P(b, rich("editor"), config(mode=None))
    p.p.evaluate("()=>window.contentDetail('c1')"); p.p.wait_for_timeout(150)
    t = re.sub(r"\s+", " ", p.text('#modalBody'))
    ok("P6a fiche : J+1 → J+7 +1,0 k / +100 %, N/D si la plateforme ne fournit pas", "+1,0 k" in t and "+100 %" in t and "N/D" in t, t[:400])
    p.p.locator('[data-type=other][data-pid=p1]').first.click(); p.p.wait_for_timeout(150)
    ok("P6b relevé de suivi : formulaire « Suivi »", "Suivi" in p.text('#modalTitle'), p.text('#modalTitle'))
    for sel, v in (('#mv', '2500'), ('#ml', '70'), ('#mc', '12'), ('#ms', '11')):
        p.p.fill(sel, v)
    p.p.click('#saveMetric'); p.p.wait_for_timeout(300)
    ok("P6c relevé de suivi enregistré (type other)", any(x.startswith("insert:metric_readings") and '"reading_type":"other"' in x for x in p.log()))
    p.p.evaluate("()=>window.contentDetail('c1')"); p.p.wait_for_timeout(120)
    p.p.click('[data-act=ref][data-ref=latest][data-cid=c1]'); p.p.wait_for_timeout(150)
    ok("P6d relevé de référence « Dernier relevé » : la fiche reste ouverte et suit le suivi (2,5 k)", p.vis('#modal') and "2,5 k" in p.text('#modalBody'), re.sub(r"\s+", " ", p.text('#modalBody'))[:300])
    p.close()
    # P7 — Accueil responsable plateforme (TikTok seulement)
    p = P(b, rich("platform_manager", me_platforms=["pf-tt"]), config(mode=None))
    t = p.text('#page')
    ok("P7a responsable TikTok : ses 2 relevés, pas Instagram", "Marché" in t and "Retard J+7" in t and "Insta du jour" not in t, re.sub(r"\s+", " ", t)[:300])
    ok("P7b cloche : 2", p.text('#bellCount') == "2")
    ok("P7c pas de bouton « Nouveau contenu »", not p.vis('#newContentBtn'))
    p.close()
    # P8 — Accueil direction
    p = P(b, rich("direction"), config(mode=None))
    t = re.sub(r"\s+", " ", p.text('#page'))
    ok("P8a direction : synthèse 30 j, points d'attention, application ; pas de cloche", "Points d’attention" in t and "Téléchargements" in t and not p.vis('#bellBtn'), t[:300])
    ok("P8b désinstallations > 25 % signalées (30 pour 100)", "25 %" in t)
    p.close()
    # P9 — Téléphone (390 × 844) : barre du bas, pas de défilement horizontal, cibles tactiles
    p = P(b, rich("admin"), config(mode=None), viewport={"width": 390, "height": 844})
    over = []
    for v in ["home", "contents", "entry", "analytics"]:  # barre du bas
        p.p.click(f'.bnav-btn[data-id={v}]'); p.p.wait_for_timeout(150)
        w = p.p.evaluate("()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
        if w[0] > w[1] + 1: over.append(f"{v}:{w}")
    p.p.click('[data-act=more]'); p.p.wait_for_timeout(120)
    p.p.click('.menu-item[data-id=app]'); p.p.wait_for_timeout(150)
    w = p.p.evaluate("()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
    if w[0] > w[1] + 1: over.append(f"app:{w}")
    disp = p.p.evaluate("()=>[getComputedStyle(document.querySelector('#bottomNav')).display,getComputedStyle(document.querySelector('.sidebar')).display]")
    ok("P9a téléphone : barre du bas visible, barre latérale masquée", disp[0] != "none" and disp[1] == "none", str(disp))
    ok("P9b aucun défilement horizontal (5 écrans)", not over, "; ".join(over))
    ok("P9c menu « Plus » → Application", p.text('#pageTitle') == "Application Wakabi" and not p.vis('#modal'))
    small = p.p.evaluate("()=>[...document.querySelectorAll('.bnav-btn')].filter(e=>e.getBoundingClientRect().height<44).length")
    ok("P9d barre du bas : cibles d'au moins 44 px", small == 0, str(small))
    ok("P9e aucune erreur JavaScript", not p.errs, ";".join(p.errs))
    p.close()


def partie_Q(b):
    D = dt.datetime.now(dt.timezone.utc).date()
    d = lambda n: (D + dt.timedelta(days=n)).isoformat()
    flat = lambda p, sel="#page": re.sub(r"\s+", " ", p.text(sel))
    # Q1 — Calendrier (mois) : prévu aujourd'hui, échéances, légende, navigation, vue Jour, couches
    p = P(b, rich("editor"), config(mode=None), hash="#/calendar?cal=month")
    today_cell = p.p.evaluate("()=>(document.querySelector('.cal-cell.today')||{}).innerText||''")
    ok("Q1a calendrier (mois) : aujourd'hui = « Plage d'Aného » prévu + J+1 de Marché et d'Insta du jour", "Plage d'Aného" in today_cell and "J+1 TikTok · Marché" in today_cell and "Insta du jour" in today_cell, today_cell.replace("\n", " | "))
    ok("Q1b légende des couleurs présente (icône + texte)", "Date passée, aucun lien" in flat(p))
    title = p.text('.cal-title'); p.p.click('[data-act=cal-step][data-step="1"]'); p.p.wait_for_timeout(120)
    t2 = p.text('.cal-title'); p.p.click('[data-act=cal-today]'); p.p.wait_for_timeout(120)
    ok("Q1c navigation : mois suivant puis retour à aujourd'hui", t2 != title and p.text('.cal-title') == title, f"{title} -> {t2}")
    p.p.click('.cal-cell.today .cal-day'); p.p.wait_for_timeout(150)
    h = p.p.evaluate("()=>location.hash")
    ok("Q1d clic sur un jour : vue Jour avec boutons Saisir", "#/calendar" in h and "cal=day" in h and p.p.locator('#page [data-act=metric]').count() >= 2, h)
    p.p.locator('#page [data-act=metric]').first.click(); p.p.wait_for_timeout(150)
    ok("Q1e Saisir depuis le calendrier : formulaire du relevé", "J+1" in p.text('#modalTitle'), p.text('#modalTitle'))
    p.p.keyboard.press("Escape"); p.p.wait_for_timeout(80)
    p.p.click('[data-act=cal-mode][data-mode=month]'); p.p.wait_for_timeout(100)
    p.p.uncheck('[data-cal-layer=due]'); p.p.wait_for_timeout(120)
    ok("Q1f couche « Relevés » masquée : plus aucune échéance", "J+1 TikTok" not in flat(p, ".cal-grid") and "Plage d'Aného" in flat(p, ".cal-grid"))
    ok("Q1g aucune erreur JavaScript ni violation CSP", not p.errs and p.p.evaluate("()=>window.__csp.length") == 0, ";".join(p.errs))
    p.close()
    # Q2 — Calendrier sur téléphone
    p = P(b, rich("editor"), config(mode=None), viewport={"width": 390, "height": 844}, hash="#/calendar")
    over = []
    for m in ("week", "month", "day"):
        p.p.click(f'[data-act=cal-mode][data-mode={m}]'); p.p.wait_for_timeout(120)
        w = p.p.evaluate("()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
        if w[0] > w[1] + 1: over.append(f"{m}:{w}")
    ok("Q2a téléphone : semaine / mois / jour sans défilement horizontal", not over, "; ".join(over))
    p.p.click('[data-act=cal-mode][data-mode=month]'); p.p.wait_for_timeout(120)
    hh = p.p.evaluate("()=>document.querySelector('.cal-cell.today .cal-day').getBoundingClientRect().height")
    cnt = p.p.evaluate("()=>getComputedStyle(document.querySelector('.cal-cell.today .cal-count')).display")
    ok("Q2b mois sur téléphone : jour = bouton d'au moins 44 px avec compteur", hh >= 44 and cnt != "none", f"{hh} {cnt}")
    p.close()
    # Q3 — Rapport période libre = mêmes chiffres que la tendance 30 jours ; exports
    p = P(b, rich("editor"), config(mode=None), hash=f"#/reports?rt=custom&rfrom={d(-29)}&rto={d(0)}")
    t = flat(p)
    ok("Q3a rapport 30 jours : 2,3 k vues, +360 %, taux 4,8 % (identiques à l'accueil)", "2,3 k" in t and "+360 %" in t and "4,8 %" in t, t[:500])
    i = t.find("Production")
    ok("Q3b production et mesure : J+1 à temps / manqués, J+7 attendus", re.search(r"J\+1 1 à temps · 0 en retard · 2 manqués · 2 à saisir", t) is not None and re.search(r"J\+7 3 saisis sur 4 attendus", t) is not None, t[i:i + 400])
    with p.p.expect_download() as dl:
        p.p.click('[data-act=export-csv]')
    csv = pathlib.Path(dl.value.path()).read_bytes().decode("utf-8")
    ok("Q3c export CSV : BOM, séparateur ;, une ligne par publication + total", csv.startswith("﻿") and "Contenu;Pays;Rubrique" in csv and "Restaurant X;Togo;SPOT" in csv and "Total (taux pondéré)" in csv, csv[:300])
    total = [l for l in csv.splitlines() if l.startswith("Total")]
    ok("Q3d export CSV : total = écran (2300 vues, taux 4,78 en virgule décimale)", bool(total) and ";2300;" in total[0] and ";4,78;" in total[0], total[:1])
    p.close()
    S = rich("editor"); S["tables"]["contents"][3]["title"] = '=HYPERLINK("http://x";"Marché")'
    p = P(b, S, config(mode=None), hash=f"#/reports?rt=custom&rfrom={d(-29)}&rto={d(0)}")
    with p.p.expect_download() as dl:
        p.p.click('[data-act=export-csv]')
    csv = pathlib.Path(dl.value.path()).read_bytes().decode("utf-8")
    ok("Q3e export CSV : formule malveillante neutralisée (préfixe ')", "\"'=HYPERLINK(" in csv and "\n=HYPERLINK" not in csv and ";=HYPERLINK" not in csv, [l for l in csv.splitlines() if "HYPERLINK" in l][:1])
    p.close()
    # Q4 — Rapports : mensuel par défaut, campagne à choisir, état dans l'adresse
    p = P(b, rich("editor"), config(mode=None))
    p.p.click('.nav-btn[data-id=reports]'); p.p.wait_for_timeout(150)
    ok("Q4a rapport mensuel par défaut (mois précédent) avec en-tête imprimable", "rapport mensuel" in p.text('#page').lower() and "rt=month" in p.p.evaluate("()=>location.hash"))
    p.p.select_option('#r_type', 'campaign'); p.p.wait_for_timeout(120)
    ok("Q4b rapport de campagne : invite à choisir, exports désactivés", "Choisissez une campagne" in p.text('#page') and p.p.is_disabled('[data-act=export-csv]'))
    ok("Q4c aucune erreur JavaScript ni violation CSP", not p.errs and p.p.evaluate("()=>window.__csp.length") == 0, ";".join(p.errs))
    p.close()
    # Q5 — Performance : comparer le comparable
    p = P(b, rich("editor"), config(mode=None), hash="#/analytics")
    t = flat(p, ".card:has(#cmpDim)")
    ok("Q5a comparer le comparable : plateforme × type, échantillon faible signalé", "TikTok · Vidéo" in t and "Instagram · Vidéo" in t and "Échantillon faible" in t, t[:300])
    p.p.select_option('#cmpDim', 'rubrique'); p.p.wait_for_timeout(120)
    ok("Q5b regroupement par rubrique, focus conservé", "SPOT" in flat(p, ".card:has(#cmpDim)") and p.p.evaluate("()=>document.activeElement.id") == "cmpDim")
    p.p.click('[data-act=ref][data-ref=latest]'); p.p.wait_for_timeout(120)
    ok("Q5c dernier relevé : avertissement sur la durée d'exposition", "même durée d’exposition" in flat(p, ".card:has(#cmpDim)"))
    p.close()


def rich_plus(role, me_platforms=None, job=None):
    """rich() + tables des migrations 09 et 10 (tâches, notifications, objectifs, connexions…)."""
    S = rich(role, me_platforms=me_platforms)
    T = S["tables"]
    D = dt.datetime.now(dt.timezone.utc).date()
    d = lambda n: (D + dt.timedelta(days=n)).isoformat()
    if job:
        T["profiles"][0]["job_title"] = job
    T["profiles"].append({"id": "g", "email": "g@x", "username": "kodjo", "full_name": "Kodjo Graphiste", "role": "platform_manager", "active": True, "must_change_password": False, "platform": None, "job_title": "Graphiste"})
    for c in T["contents"]:
        c["production_status"] = "publie" if any(p["content_id"] == c["id"] for p in T["publications"]) else "a_produire"
    T["contents"][1]["production_status"] = "en_production"          # c2 « Plage d'Aného »
    T["contents"][2]["production_status"] = "a_valider"              # c3 « Concert »
    T["contents"][2]["production_status_at"] = d(0) + "T08:00:00Z"
    T["content_tasks"] = [
        {"id": "t1", "content_id": "c2", "kind": "graphisme", "title": "Visuel de couverture", "assignee": "u", "due_on": d(-1), "status": "en_cours", "brief": "Format 9:16"},
        {"id": "t2", "content_id": "c2", "kind": "tournage", "title": None, "assignee": "u", "due_on": d(2), "shoot_on": d(0), "location": "Plage d'Aného", "status": "a_faire"},
        {"id": "t3", "content_id": "c3", "kind": "montage", "title": "Montage concert", "assignee": "g", "due_on": d(-3), "status": "a_faire"}]
    T["notifications"] = [
        {"id": "n1", "recipient": "u", "kind": "tache_affectee", "content_id": "c2", "task_id": "t2", "message": "Nouvelle tâche (tournage) : Plage d'Aného", "created_at": d(0) + "T07:00:00Z", "read_at": None},
        {"id": "n2", "recipient": "u", "kind": "commentaire", "content_id": "c1", "task_id": None, "message": "Commentaire : Restaurant X — bravo", "created_at": d(-1) + "T07:00:00Z", "read_at": d(-1) + "T09:00:00Z"}]
    T["content_feedback"] = []; T["content_status_history"] = []; T["content_files"] = []
    T["objectives"] = [{"id": "o1", "period_kind": "mois", "period_start": D.replace(day=1).isoformat(), "period_end": (D.replace(day=28) + dt.timedelta(days=4)).replace(day=1).__sub__(dt.timedelta(days=1)).isoformat(),
                        "campaign_id": None, "country": None, "platform_id": None, "metric": "vues", "target": 10000, "note": None, "archived_at": None}]
    T["saved_views"] = []; T["import_batches"] = []
    T["platform_connections"] = [{"platform_id": f["id"], "status": "non_configuree", "account_label": None, "last_sync_at": None, "last_error": None} for f in T["platforms"]]
    return S


def partie_S(b):
    flat = lambda p, sel="#page": re.sub(r"\s+", " ", p.text(sel))
    D = dt.datetime.now(dt.timezone.utc).date()
    # S1 — Navigation avec les migrations 09 et 10
    p = P(b, rich_plus("editor"), config(mode=None))
    nav = flat(p, "#nav")
    ok("S1a rédaction : Mes tâches, Objectifs, Imports, Connexions dans le menu ; pas d'Équipe", all(x in nav for x in ("Mes tâches", "Objectifs", "Imports", "Connexions")) and "Équipe" not in nav, nav)
    p.p.click('.nav-btn[data-id=contents]'); p.p.wait_for_timeout(150)
    ok("S1c colonne État : « À valider », « En production »", "À valider" in flat(p) and "En production" in flat(p))
    p.p.click('[data-act=toggle-filters]'); p.p.wait_for_timeout(100); p.p.select_option('#f_prod', 'a_valider'); p.p.wait_for_timeout(150)
    ok("S1d filtre État de production = À valider : 1 contenu", "1 contenu ·" in p.text('.filters-foot'), p.text('.filters-foot'))
    p.p.click('[data-act=reset-filters]'); p.p.wait_for_timeout(100)
    # S2 — Accueil rédaction : bloc Production
    p.p.click('.nav-btn[data-id=home]'); p.p.wait_for_timeout(150)
    t = flat(p)
    ok("S2a accueil rédaction : à valider (Concert) et tâches en retard par personne", "À valider" in t and "Concert" in t and "Tâches en retard" in t, t[:600])
    ok("S2b objectifs en cours sur l'accueil", "Objectifs en cours" in t)
    # S3 — Tâches : création par la rédaction
    p.p.click('.nav-btn[data-id=tasks]'); p.p.wait_for_timeout(150)
    ok("S3a Mes tâches : en retard 1, à faire 1, en cours 0", re.search(r"En retard\s*1", p.text('#page .kpis')) is not None, p.text('#page .kpis'))
    p.p.click('[data-act=task-new]'); p.p.wait_for_timeout(120)
    p.p.select_option('#tk_c', 'c4'); p.p.select_option('#tk_k', 'montage'); p.p.select_option('#tk_a', 'v'); p.p.fill('#tk_d', (D + dt.timedelta(days=3)).isoformat()); p.p.fill('#tk_b', 'Couper à 45 s')
    p.p.click('#tk_save'); p.p.wait_for_timeout(300)
    ins = [x for x in p.log() if x.startswith("insert:content_tasks")]
    ok("S3b nouvelle tâche enregistrée (contenu, nature, personne, brief)", bool(ins) and '"content_id":"c4"' in ins[0] and '"assignee":"v"' in ins[0] and '"brief":"Couper à 45 s"' in ins[0], ins[:1])
    # S4 — Fiche : production, validation
    p.p.evaluate("()=>window.contentDetail('c3')"); p.p.wait_for_timeout(300)
    t = flat(p, "#modalBody")
    ok("S4a fiche : état, tâches, fichiers, échanges", all(x in t for x in ("Production", "Tâches", "Fichiers", "Échanges")) and "attend votre validation" in t, t[-500:])
    p.p.click('[data-act=wf-valid]'); p.p.wait_for_timeout(120); p.p.click('#wf_go'); p.p.wait_for_timeout(300)
    ok("S4b « Valider » : retour enregistré (décision valide)", any(x.startswith("insert:content_feedback") and '"decision":"valide"' in x for x in p.log()))
    p.p.evaluate("()=>window.contentDetail('c2')"); p.p.wait_for_timeout(300)
    p.p.select_option('#wf_status', 'programme'); p.p.click('[data-act=wf-status]'); p.p.wait_for_timeout(300)
    ok("S4c la rédaction change l'état de production", any(x.startswith("update:contents") and '"production_status":"programme"' in x for x in p.log()))
    p.p.evaluate("()=>window.contentDetail('c2')"); p.p.wait_for_timeout(300)
    p.p.fill('#wf_comment', 'Merci, parfait'); p.p.click('[data-act=wf-comment]'); p.p.wait_for_timeout(300)
    ok("S4d commentaire envoyé", any(x.startswith("insert:content_feedback") and '"decision":"commentaire"' in x for x in p.log()))
    p.p.evaluate("()=>window.contentDetail('c2')"); p.p.wait_for_timeout(300)
    p.p.set_input_files('#wf_file', files=[{"name": "visuel été.png", "mimeType": "image/png", "buffer": b"\x89PNG fictif"}]); p.p.wait_for_timeout(400)
    L = p.log()
    ok("S4e dépôt d'un fichier : envoi dans le stockage privé puis enregistrement", any(x.startswith("upload:wakabi-fichiers:contents/c2/") and x.endswith("visuel_ete.png") for x in L) and any(x.startswith("insert:content_files") and '"file_name":"visuel été.png"' in x for x in L), [x for x in L if "upload" in x or "content_files" in x][:2])
    ok("S4f aucune erreur JavaScript", not p.errs, ";".join(p.errs))
    p.close()
    # S5 — Membre de production (sans plateforme) : accueil, cloche, tâches, proposition
    p = P(b, rich_plus("platform_manager", job="Graphiste"), config(mode=None), viewport={"width": 390, "height": 844})
    ok("S5a accueil membre : tâches d'abord (« À traiter maintenant »)", "À traiter maintenant" in flat(p) and "Visuel de couverture" in flat(p))
    bn = flat(p, "#bottomNav")
    ok("S5b barre du bas : Mes tâches au lieu de Saisie", "Mes tâches" in bn and "Saisie" not in bn, bn)
    ok("S5c cloche : 1 notification non lue", p.text('#bellCount') == "1", p.text('#bellCount'))
    p.p.click('#bellBtn'); p.p.wait_for_timeout(150)
    p.p.locator('#bellPanel .bell-item.unread').first.click(); p.p.wait_for_timeout(350)
    ok("S5d clic sur la notification : marquée lue, fiche ouverte", any(x.startswith("update:notifications") and "read_at" in x for x in p.log()) and p.vis('#modal'))
    t = flat(p, "#modalBody")
    ok("S5e fiche : « Proposer à la validation » pour le membre qui a une tâche", "Proposer à la validation" in t)
    p.p.click('[data-act=wf-submit]'); p.p.wait_for_timeout(350)
    ok("S5f proposition à la validation (fonction serveur)", any(x.startswith("rpc:wakabi_content_submit") for x in p.log()))
    p.p.keyboard.press("Escape"); p.p.wait_for_timeout(80)
    p.p.click('.bnav-btn[data-id=tasks]'); p.p.wait_for_timeout(150)
    p.p.locator('[data-act=task-status][data-s=fait]').first.click(); p.p.wait_for_timeout(300)
    ok("S5g « Terminé » : tâche passée à fait", any(x.startswith("update:content_tasks") and '"status":"fait"' in x for x in p.log()))
    w = p.p.evaluate("()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
    ok("S5h téléphone : Mes tâches sans défilement horizontal", w[0] <= w[1] + 1, str(w))
    ok("S5i aucune erreur JavaScript ni violation CSP", not p.errs and p.p.evaluate("()=>window.__csp.length") == 0, ";".join(p.errs))
    p.close()
    # S6 — Objectifs, connexions, imports, vues enregistrées, analyse
    p = P(b, rich_plus("admin"), config(mode=None))
    errs = []
    for v in ("tasks", "objectives", "imports", "connections"):
        p.p.click(f'.nav-btn[data-id={v}]'); p.p.wait_for_timeout(200)
        if not no_inline_handlers(p): errs.append(f"{v}: onclick")
        u = unnamed_controls(p)
        if u: errs.append(f"{v}: sans nom {u[:2]}")
    ok("S6a nouveaux écrans : aucun onclick, contrôles nommés", not errs, "; ".join(errs))
    p.p.click('.nav-btn[data-id=objectives]'); p.p.wait_for_timeout(150)
    t = flat(p)
    ok("S6b objectif mensuel : avancement et part de période affichés", "Vues ·" in t and "% de la période écoulée" in t and p.p.locator('.meter[role=img]').count() == 1, t[:400])
    p.p.click('[data-act=obj-new]'); p.p.wait_for_timeout(120)
    p.p.select_option('#ob_m', 'taux'); p.p.fill('#ob_t', '6'); p.p.click('#ob_save'); p.p.wait_for_timeout(300)
    ok("S6c nouvel objectif de taux (6 % -> 0,06)", any(x.startswith("insert:objectives") and '"target":0.06' in x and '"metric":"taux"' in x for x in p.log()))
    p.p.click('.nav-btn[data-id=connections]'); p.p.wait_for_timeout(150)
    ok("S6d connexions : 3 plateformes « Non configurée », Synchroniser désactivé", flat(p).count("Non configurée") == 3 and p.p.locator('button[disabled][title="API non configurée"]').count() == 3)
    p.p.click('.nav-btn[data-id=analytics]'); p.p.wait_for_timeout(200)
    t = flat(p)
    ok("S6e Performance : pistes d'action et organique / sponsorisé", "Pistes d’action" in t and "Organique / sponsorisé" in t, t[-600:])
    p.p.click('[data-act=sv-save]'); p.p.wait_for_timeout(120); p.p.fill('#sv_name', 'Vue test'); p.p.click('#sv_ok'); p.p.wait_for_timeout(300)
    ok("S6f vue de filtres enregistrée", any(x.startswith("insert:saved_views") and '"name":"Vue test"' in x and '"view":"analytics"' in x for x in p.log()))
    ok("S6g aucune erreur JavaScript ni violation CSP", not p.errs and p.p.evaluate("()=>window.__csp.length") == 0, ";".join(p.errs))
    p.close()
    # S7 — Import CSV : correspondance, doublon, création, erreur
    p = P(b, rich_plus("editor"), config(mode=None), hash="#/imports")
    csv = ("Titre;Plateforme;Lien;Date du relevé;Type de relevé;Vues;Likes;Commentaires;Partages;Rubrique\n"
           f";TikTok;https://exemple.test/p4;{D.strftime('%d/%m/%Y')};J+1;1 200;40;3;2;\n"
           f";TikTok;https://www.exemple.test/p1/;{D.strftime('%d/%m/%Y')};J+7;9;9;9;9;\n"
           f"Nouveau lieu;Instagram;https://exemple.test/new;{D.strftime('%d/%m/%Y')};J+7;500;20;1;1;SPOT\n"
           f"Sans chiffres;TikTok;https://exemple.test/bad;{D.strftime('%d/%m/%Y')};J+7;;;;;SPOT\n")
    p.p.set_input_files('#imp_file', files=[{"name": "stats.csv", "mimeType": "text/csv", "buffer": csv.encode("utf-8")}]); p.p.wait_for_timeout(400)
    k = p.text('#page .kpis')
    ok("S7a aperçu : 2 à importer, 1 ignorée (J+7 déjà saisi), 1 en erreur, 1 nouveau contenu", re.search(r"À importer\s*2", k) and re.search(r"Ignorées\s*1", k) and re.search(r"En erreur\s*1", k) and re.search(r"Nouveaux contenus\s*1", k), k)
    p.p.click('[data-act=imp-run]'); p.p.wait_for_timeout(700)
    L = p.log()
    ok("S7b import : 1 contenu, 1 publication, 2 relevés, lot tracé", sum(x.startswith("insert:contents") for x in L) == 1 and sum(x.startswith("insert:publications") for x in L) == 1
       and sum(x.startswith("insert:metric_readings") for x in L) == 2 and any(x.startswith("insert:import_batches") and '"readings_created":2' in x for x in L), [x[:80] for x in L if x.startswith("insert:")])
    ok("S7c aucune erreur JavaScript", not p.errs, ";".join(p.errs))
    p.close()
    # S8 — Calendrier : couche Tâches
    p = P(b, rich_plus("editor"), config(mode=None), hash=f"#/calendar?cal=day&d={D.isoformat()}")
    t = flat(p)
    ok("S8a calendrier (jour) : tournage du jour affiché avec sa tâche", "Tournage" in t and "Plage d'Aného" in t and "Plage d'Aného" in t, t[:300])
    p.p.click('[data-act=cal-mode][data-mode=month]'); p.p.wait_for_timeout(150)
    ok("S8b calendrier (mois) : couche Tâches proposée et légende", p.p.locator('[data-cal-layer=tasks]').count() == 1 and "Tâche (échéance)" in flat(p))
    p.close()


HEADERS = [h for r in json.loads((SITE / "vercel.json").read_text(encoding="utf-8")).get("headers", []) if r["source"] == "/(.*)" for h in r["headers"]]


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for h in HEADERS:
            self.send_header(h["key"], h["value"])
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", PORT), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            parts = sys.argv[2].split(",") if len(sys.argv) > 2 else ["R", "N", "P", "Q", "S"]
            if "R" in parts:
                print("— Partie R : non-régression (run7.js)"); partie_R(b)
            if "N" in parts:
                print("— Partie N : lot 1.4c"); partie_N(b)
            if "P" in parts:
                print("— Partie P : lots 1.5 à 1.8, téléphone, accessibilité, CSP"); partie_P(b)
            if "Q" in parts:
                print("— Partie Q : calendrier, rapports, comparer le comparable"); partie_Q(b)
            if "S" in parts:
                print("— Partie S : organisation, objectifs, imports, connexions (migrations 09 et 10)"); partie_S(b)
            b.close()
    finally:
        srv.shutdown()
    print(f"\n{len(results) - fails} réussis, {fails} échec(s) sur {len(results)} — site testé : {SITE}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
