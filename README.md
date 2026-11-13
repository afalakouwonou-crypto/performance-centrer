# Wakabi Performance Center

Outil interne de pilotage éditorial de Wakabi (Togo, Bénin) : planifier, affecter, produire, valider, publier, mesurer, analyser, décider.
**Une seule base de données : le projet Supabase « wakabi-performance »** (`dchrvyzdfrvrbdfgvstn`). Il n'y a plus de base de recette.

## En clair

- Ce dossier contient **tout le projet**, rangé : le site (`site/`), la base (`supabase/`), les tests (`tests/`), la documentation (`docs/`).
- **Le site fonctionne dès maintenant sur la base actuelle**, avec la connexion par email. Les nouveautés qui demandent des tables (tâches, validation, fichiers, objectifs, imports…) apparaissent **automatiquement** quand les migrations correspondantes sont appliquées ; avant cela, l'écran l'indique simplement.
- **Rien n'a été appliqué sur la base ni mis en ligne.** Chaque étape de mise en production est décrite dans `docs/MISE_EN_PRODUCTION.md`, une à la fois, avec l'accord d'Andréas.
- Tout est testé sur une **copie locale fidèle de la production** (données fictives) : 83 tests sur la base, 144 tests d'interface, 20 tests de calcul.

## Ce que fait l'application

| Écran | Pour qui | Contenu |
|---|---|---|
| Aujourd'hui | tous, selon le rôle | ce qu'il faut faire maintenant : relevés à saisir, contenus prévus ou en retard, à valider, tâches, tendance 30 jours, objectifs |
| Mes tâches | tous (migration 09) | tâches confiées, avancement, brief, tournage ; vue équipe pour la rédaction |
| Contenus | tous | liste filtrable (13 critères), état de production, fiche complète |
| Fiche contenu | tous | informations, performance, publications, J+1 / J+7 / suivi, état de production, tâches, validation, fichiers, échanges, historique |
| Calendrier | tous | mois / semaine / jour : contenus prévus, publications, échéances des relevés, tâches et tournages |
| Saisie | responsables de plateforme, rédaction | relevés J+1 et J+7, écarts, échéances à 7 jours |
| Performance | tous | indicateurs pondérés, évolutions, comparer le comparable, organique / sponsorisé, pistes d'action |
| Rapports | tous | hebdomadaire, mensuel, campagne, période libre ; impression PDF ; export CSV protégé |
| Objectifs | tous (rédaction : création) | cibles et avancement, part de période écoulée |
| Application | tous (rédaction : saisie) | téléchargements, inscriptions, utilisateurs actifs, désinstallations |
| Direction | tous | synthèse, points d'attention |
| Équipe, Listes | administrateur | comptes, rôles, plateformes ; rubriques, plateformes, types, campagnes, objectifs |
| Imports | rédaction, administrateur (migration 10) | import CSV avec aperçu et détection des doublons |
| Connexions | rédaction, administrateur, direction (migration 10) | état des liaisons avec les plateformes (API officielles à obtenir) |
| Guide | tous | routine, formules, règles, repères internes |

## Structure

```
site/                      Site à mettre en ligne (Vercel : « Root Directory » = site, aucune construction)
  index.html  config.js  sw.js  vercel.json  manifest.webmanifest  robots.txt
  css/styles.css           système de design (contrastes vérifiés, téléphone d'abord)
  js/                      scripts classiques chargés dans l'ordre d'index.html (aucun framework, aucune étape de construction)
    calc.js                calculs purs (formule du 30/10/2026), filtres, CSV — testés seuls
    core.js auth.js navigation.js rules.js ui.js rules-shared.js route-state.js main.js
    organisation.js        Phase 2 : tâches, validation, fichiers, notifications
    analyse-plus.js        Phases 3 et 5 : objectifs, organique / sponsorisé, pistes, vues enregistrées
    imports.js             Phase 4 : import CSV, connexions
    views/ forms/          un fichier par écran et par formulaire
  vendor/supabase.js       supabase-js 2.118.0 (local, aucun CDN)
supabase/
  migrations/              À APPLIQUER, dans l'ordre : 08P, 09, 10, (11) — chacune avec son annulation
  functions/wakabi-auth/   fonction serveur de connexion par identifiant (à déployer avec la 08P)
  controles/               requêtes en LECTURE SEULE (état réel, empreintes des données)
  tests/                   tests des migrations ; tout_tester.sh fait le cycle complet
  banc-local/              copie locale de la production (PostgreSQL 18) + données fictives
  reference/               migrations déjà appliquées (01 → 07) et scripts d'origine : NE PAS RELANCER
tests/                     tests du site (calc.test.mjs, test_interface.py) et captures d'écran
outils/                    maj_service_worker.py (version du cache), sonde_anon.py (lecture seule publique)
docs/                      MISE_EN_PRODUCTION.md, DROITS.md, DECISIONS.md
```

## Vérifier soi-même

```bash
node --test tests/calc.test.mjs                 # 20 tests de calcul
python tests/test_interface.py                  # 144 tests d'interface (Playwright, faux client Supabase)
bash supabase/tests/tout_tester.sh              # base : copie locale, migrations, tests, annulations
python outils/maj_service_worker.py --verifier  # le cache hors ligne liste bien tous les fichiers
```

## Règles du projet (rappel)

- Les droits sont appliqués **par la base** (RLS, droits par colonne, déclencheurs) ; l'écran ne fait que masquer.
- **Rien n'est supprimé** : désactivation, archivage, retrait ; une annulation de migration renomme, elle n'efface pas.
- Aucune clé secrète dans le site : seule la clé « publishable » est dans `site/config.js`.
- Chaque migration : garde-fous, une seule exécution possible, annulation testée, empreintes des données identiques.
- À chaque livraison de l'interface : `python outils/maj_service_worker.py` (nouvelle version du cache).

## État au 13/11/2026

| Élément | Développé | Testé (local) | Appliqué en base | En ligne |
|---|---|---|---|---|
| Migrations 01 → 07 | ✔ | ✔ | ✔ (production) | — |
| Site (Phases 1 à 5, écrans) | ✔ | ✔ 144 + 20 | — | ✘ |
| 08P identifiants, lundi, départs | ✔ | ✔ 28 tests + annulation | ✘ (accord requis) | — |
| 09 organisation (tâches, validation, fichiers, notifications) | ✔ | ✔ 37 tests + annulation | ✘ (accord requis) | — |
| 10 objectifs, diffusion, imports, connexions, vues | ✔ | ✔ 18 tests + annulation | ✘ (accord requis) | — |
| 11 durcissement anon (facultatif) | ✔ | ✔ + annulation | ✘ (décision D8) | — |
| Synchronisation API des plateformes, publication directe | ✘ | — | — | — (comptes développeur à obtenir) |
