# Mise en production — une étape à la fois

**Qui fait quoi** : Andréas donne chaque accord et fait les réglages dans les tableaux de bord ; ChatGPT exécute les scripts SQL validés dans l'éditeur SQL de Supabase et recopie les résultats ; Claude prépare et vérifie.
**Règle** : une étape n'est lancée qu'après la réussite de la précédente. En cas de doute : on s'arrête, rien n'est perdu.

## En clair

1. On ferme l'inscription libre (sécurité, 1 clic).
2. On met le **nouveau site en ligne sur la base actuelle**, avec la connexion par email habituelle. Aucune modification de la base.
3. Ensuite seulement, migration par migration : **08P** (identifiants), **09** (organisation de l'équipe), **10** (objectifs, imports…). Chaque migration s'annule si besoin, sans perte de données.

---

## Étape 1 — Fermer l'inscription libre (décision D9)

- **Pourquoi** : aujourd'hui, n'importe qui peut créer un compte avec la clé publique. Il ne voit aucune donnée, mais le compte ne pourrait jamais être supprimé.
- **Action (Andréas)** : Supabase → projet wakabi-performance → *Authentication* → *Sign In / Providers* → *User Signups* → désactiver **Allow new users to sign up** → *Save*.
- **Contrôle (Claude)** : `python outils/sonde_anon.py` → `disable_signup: true`.
- **Retour arrière** : réactiver l'interrupteur.

## Étape 2 — Mettre le nouveau site en ligne (base actuelle, connexion par email)

- **Action (Andréas)** :
  1. Créer un dépôt GitHub **privé** (ex. `wakabi-performance-center`) avec le contenu de ce dossier (Claude peut préparer l'envoi sur accord).
  2. Vercel → *Add New* → *Project* → importer ce dépôt → **Root Directory : `site`** → *Framework Preset* : **Other** → aucune commande de construction → *Deploy*.
  3. Supabase → *Authentication* → *URL Configuration* : *Site URL* = l'adresse Vercel ; *Redirect URLs* : ajouter `https://<adresse>/**`.
- **Contrôle (Claude)** : en-têtes de sécurité (CSP, HSTS, noindex), page de connexion, aucun fichier de travail en ligne.
- **Contrôle (Andréas)** : se connecter avec son email et son mot de passe habituels ; ouvrir Aujourd'hui, Contenus, Saisie, Performance.
- **Retour arrière** : Vercel → *Instant Rollback* ou suppression du projet ; l'ancien site Netlify reste disponible.

## Étape 3 — Contrôle de l'état réel (lecture seule, ChatGPT)

- Exécuter `supabase/controles/controle_lecture_seule.sql` puis `supabase/controles/empreintes_donnees.sql` ; recopier les deux résultats dans le fil.
- **But** : confirmer que la base est bien dans l'état attendu (01 → 07, pas de 08) et noter les empreintes « avant ».

## Étape 4 — Migration 08P : identifiants, reconnexion du lundi, départs (accord A requis)

- **Ce que ça change** : chaque membre reçoit un **identifiant** (prénom sans accent : `clemence`, `margot`…) ; tout le monde se reconnecte chaque lundi 00:00 (Lomé) ; un départ ferme immédiatement les sessions. La liste des identifiants s'affiche à la fin du script.
- **Action (ChatGPT)** : exécuter `supabase/migrations/08P_identifiants_sessions.sql` ; recopier la liste affichée.
- **Puis (Andréas, tableau de bord)** :
  1. *Edge Functions* → déployer `supabase/functions/wakabi-auth` ; désactiver **Verify JWT** pour cette fonction ; dans *Secrets*, ajouter `WAKABI_ALLOWED_ORIGIN` = l'adresse du site.
  2. *Authentication* → *Hooks* → **Customize Access Token** → fonction `public.wakabi_access_token_hook` → activer.
  3. Dans `site/config.js`, décommenter `AUTH_MODE: "identifiant"` (Claude le fait sur demande) puis remettre en ligne.
  4. Communiquer à chacun son identifiant (de vive voix ou canal sûr) ; le mot de passe ne change pas.
- **Contrôles** : `empreintes_donnees.sql` identique à l'étape 3 ; connexion de chacun avec son identifiant ; le lundi suivant, reconnexion demandée.
- **Retour arrière** : désactiver le hook, remettre la ligne `AUTH_MODE` en commentaire, puis `08P_identifiants_sessions_annulation.sql` (et l'étape 2 facultative). Les identifiants restent enregistrés, sans effet.

## Étape 5 — Migration 09 : organisation de l'équipe (accord A requis)

- **Ce que ça change** : états de production (Idée → Publié), tâches confiées (« Mes tâches »), validation et demandes de correction, fichiers en stockage privé, notifications dans la cloche, calendrier des tâches. Les contenus existants démarrent « Publié » (s'ils ont un lien) ou « À produire ».
- **Action (ChatGPT)** : `supabase/migrations/09_organisation.sql`.
- **Contrôles** : empreintes identiques ; l'écran « Mes tâches » apparaît ; créer une tâche de test sur un contenu, la confier à soi-même, la terminer.
- **Membres de production** (graphiste, vidéaste…) : compte « Responsable plateforme » **sans plateforme** + intitulé de poste ; leurs droits viennent des tâches confiées (voir `docs/DROITS.md`).
- **Retour arrière** : `09_organisation_annulation.sql` (tables renommées, rien d'effacé, fichiers conservés).

## Étape 6 — Migration 10 : objectifs, diffusion, imports, connexions, vues enregistrées (accord A requis)

- **Action (ChatGPT)** : `supabase/migrations/10_analyse_imports.sql`.
- **Contrôles** : empreintes identiques ; écrans Objectifs, Imports, Connexions visibles selon les rôles.
- **Retour arrière** : `10_analyse_imports_annulation.sql`.

## Étape 7 (facultative) — Durcissement 11 (décision D8)

- `supabase/migrations/11_durcissement_anon.sql` : retire au visiteur non connecté un droit de lecture déjà rendu inutile par les règles RLS. Annulation : `11_durcissement_anon_annulation.sql`.

## Étape 8 — Après la mise en production

- **SMTP** (décision D3) : sans serveur d'envoi, « Mot de passe oublié » risque de ne rien envoyer. Clé saisie par Andréas dans Supabase uniquement.
- **Ancien site Netlify** : le remplacer par une redirection vers la nouvelle adresse, puis le désactiver.
- **Ancien projet de recette** (`tbpyymdbflsntouascbz`) et ancien dépôt `performance-centrer` : à mettre en pause ou supprimer (décision d'Andréas) ; ils ne servent plus.
- **API des plateformes** : démarches à lancer plateforme par plateforme (comptes développeur) ; voir l'écran Connexions.
