# -*- coding: utf-8 -*-
"""Captures d'écran de contrôle visuel (données fictives du test « rich »). Usage : python captures.py <site> <dossier_sortie>"""
import functools, http.server, pathlib, sys, threading
site, out = sys.argv[1], pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
sys.argv = [sys.argv[0], site]
import test_interface as T  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

srv = http.server.ThreadingHTTPServer(("127.0.0.1", T.PORT), functools.partial(T.Handler, directory=str(T.SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
shots = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp, tag in (({"width": 1366, "height": 900}, "ordi"), ({"width": 390, "height": 844}, "tel")):
        for role in ("editor", "platform_manager", "direction"):
            p = T.P(b, T.rich(role, me_platforms=["pf-tt"] if role == "platform_manager" else None), T.config(mode=None), viewport=vp)
            p.p.screenshot(path=str(out / f"{tag}_accueil_{role}.png"), full_page=True); shots.append(f"{tag}_accueil_{role}")
            if role == "editor":
                for v in ("contents", "analytics", "entry"):
                    p.p.evaluate(f"()=>document.querySelector('.{'nav-btn' if tag == 'ordi' else 'bnav-btn'}[data-id={v}]').click()"); p.p.wait_for_timeout(200)
                    p.p.screenshot(path=str(out / f"{tag}_{v}.png"), full_page=True); shots.append(f"{tag}_{v}")
                p.p.evaluate("()=>window.contentDetail('c1')"); p.p.wait_for_timeout(250)
                p.p.screenshot(path=str(out / f"{tag}_fiche.png")); shots.append(f"{tag}_fiche")
                p.p.keyboard.press("Escape"); p.p.wait_for_timeout(100)
                p.p.click('#bellBtn'); p.p.wait_for_timeout(150)
                p.p.screenshot(path=str(out / f"{tag}_cloche.png")); shots.append(f"{tag}_cloche")
            p.close()
        p = T.P(b, T.mk("admin"), T.config(env="recette"), viewport=vp)
        p.p.screenshot(path=str(out / f"{tag}_connexion_recette.png")); shots.append(f"{tag}_connexion_recette"); p.close()
    b.close()
srv.shutdown()
print("\n".join(shots))
