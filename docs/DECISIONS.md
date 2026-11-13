# Décisions — prises et ouvertes

## Prises (13/11/2026)

| Décision | Choix | Effet |
|---|---|---|
| Base de données | **Une seule base : wakabi-performance** (production) | Plus de recette séparée. Les migrations sont testées sur une copie locale fidèle (données fictives) avant tout accord. |
| Projet | Nouveau dossier unique `wakabi-performance-center/` | Site, base, tests et documentation rangés ensemble ; le code éprouvé est repris et découpé par écran. |
| Nouveaux rôles (ancienne 06c) | **Abandonnés** : droits par tâches confiées | Rien d'irréversible ; graphiste / vidéaste = « Responsable plateforme » sans plateforme + intitulé. |
| États de production | Idée → À produire → En production → À valider → Validé → Programmé → Publié | « Publié » automatique dès qu'une date effective est saisie. |
| Fichiers | Stockage Supabase **privé** (25 Mo par fichier) | Visible par l'équipe connectée seulement ; jamais effacé, seulement retiré. |
| Notifications | Dans l'application (cloche), pas d'email | L'email demandera le SMTP (D3). |
| Formule des interactions | Celle du 30/10/2026 | Republications et enregistrements à part, hors taux. |

## Ouvertes — à présenter une à la fois, avec ma recommandation

| # | Décision | En clair | Recommandation |
|---|---|---|---|
| D9 | Fermer l'inscription libre | N'importe qui peut créer un compte (sans voir de données) | **Oui, en premier** (1 clic, réversible) |
| D1 | Dépôt GitHub privé | L'ancien dépôt `performance-centrer` est public | **Oui** : nouveau dépôt privé pour ce dossier |
| D2 | Mise en ligne du nouveau site sur la base actuelle | Connexion par email, aucune modification de la base | **Oui** après D9 et D1 |
| D5 | Migration 08P (identifiants, lundi, départs) | Chacun reçoit un identifiant ; reconnexion chaque lundi | **Oui** une fois le site en ligne et vérifié |
| D11 | Migration 09 (organisation) | Tâches, validation, fichiers, notifications | **Oui** après la 08P |
| D12 | Migration 10 (objectifs, imports…) | Objectifs, organique / sponsorisé, import CSV, connexions | **Oui** après la 09 |
| D8 | Durcissement 11 | Retirer un droit de lecture inutile au visiteur non connecté | **Oui**, risque nul |
| D3 | SMTP | Pour « mot de passe oublié » et de futurs emails | **Oui** avant d'en dépendre ; clé saisie par Andréas dans Supabase |
| D6 | Ancien site Netlify | Remplacé par le nouveau | Redirection puis désactivation |
| D13 | Ancienne recette (Supabase `tbpyymdbflsntouascbz`, dépôt `performance-centrer`, site Vercel) | Inutiles avec la base unique | Mettre en pause puis supprimer |
| D14 | API des plateformes (synchronisation, publication directe) | Demande des comptes développeur et une validation par chaque plateforme | Lancer les démarches plateforme par plateforme ; d'ici là, saisie et import CSV |
