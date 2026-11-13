# Comparaison de conformité : production / copie locale / recette rejouée (3 novembre 2026)

- **Source production** : `R0_conformite_production_2026-11-03.json`, exécuté par ChatGPT en lecture seule sur le catalogue, PostgreSQL 17.11. La transcription est vérifiée : les md5 recalculés à partir du détail sont égaux aux signatures.
- **Copie locale** : PostgreSQL **16** (et non 15). Le droit `MAINTAIN` n'existe qu'à partir de PostgreSQL 17 : il ne peut pas être reproduit en local, et il est exclu des comparaisons de droits.

## Après alignement des droits (copie locale `w7` et recette rejouée `r0`, résultat identique)

| Catégorie | Résultat |
|---|---|
| colonnes (213), contraintes (81), enums (3), vues (3, security_invoker) | IDENTIQUE (signature) |
| regles_rls (35), rls_active (13) | IDENTIQUE (signature) |
| droits_colonnes (9), droits_fonctions (35) | IDENTIQUE (signature) |
| droits_tables (88) | IDENTIQUE hors MAINTAIN (PostgreSQL 16) |
| declencheurs (38 / 38) | **DIVERGENT** : mêmes nombres, empreintes différentes. Détail à obtenir |
| fonctions (25 / 25) | **DIVERGENT** : mêmes noms et même nombre, empreintes différentes. Détail à obtenir |
| index (40 en production / 37 en local) | **DIVERGENT** : 3 index en plus en production. Détail à obtenir |

La conformité complète n'est **pas** établie. Les droits et les règles RLS concordent, mais les déclencheurs, les fonctions et les index restent à expliquer : `wakabi-recette/R0_conformite_detail_structure.sql` (lecture seule) donnera le détail.

## Droits EXECUTE : fonctions appelables (RPC) et fonctions de déclencheur

- **Fonctions appelables (5)** : `my_role`, `my_platform`, `wakabi_can_manage_platform`, `wakabi_country_tz`, `wakabi_local_date`. EXECUTE est accordé à **authenticated seulement**, ni à PUBLIC ni à anon.
- **Fonctions de déclencheur avec EXECUTE pour PUBLIC, anon et authenticated (10)** :
  - `wakabi_contents_archive`, `wakabi_contents_check_lists`, `wakabi_log_activity` ;
  - `wakabi_metric_readings_append_only`, `wakabi_metric_readings_before_insert`, `wakabi_metrics_to_readings` ;
  - `wakabi_publications_check_platform`, `wakabi_rubriques_propagate_name`, `wakabi_set_created_by`, `wakabi_set_updated_by`.

  Une fonction qui renvoie `trigger` ne peut pas être appelée directement, ni en SQL ni par l'API : le droit EXECUTE n'a donc pas d'effet pratique. Pour un déclencheur, PostgreSQL vérifie ce droit à la création, pas au déclenchement.
- **Fonctions de déclencheur sans aucun droit (10)** :
  - `handle_new_user`, `wakabi_password_changed` ;
  - `wakabi_assignment_guard`, `wakabi_profiles_guard`, `wakabi_profiles_password_flag`, `wakabi_profiles_serialize`, `wakabi_profiles_sync_platform` ;
  - `wakabi_publications_effective_date`, `wakabi_contents_country_dates`, `wakabi_metric_readings_publication_date`.

## Constats sur la production (information seulement, rien n'est modifié)

- **anon** a SELECT, INSERT, UPDATE, REFERENCES, TRIGGER et MAINTAIN sur `campaigns`, `content_objectives`, `content_types`, `platforms` et `rubriques`, et SELECT, REFERENCES, TRIGGER et MAINTAIN sur `activity_log`. La RLS est active sur ces tables et aucune règle ne vise anon : anon ne lit ni n'écrit aucune ligne. Il n'y a donc pas de faille constatée, mais un durcissement défensif reste possible plus tard, comme le REVOKE de la 06b. Il serait à proposer séparément.
- **authenticated** a aussi REFERENCES, TRIGGER et MAINTAIN sur ces mêmes tables. La RLS reste le contrôle effectif.

## Écarts de la recette rejouée sans alignement

Avant alignement, `R0a` et `R0b` donnaient en plus :
- à anon, tous les droits sur `contents`, `publications`, `metrics` et `app_kpis`, et SELECT sur `profiles` ;
- à PUBLIC et anon, EXECUTE sur `my_role`, `my_platform` et `handle_new_user`.

`R0c_alignement_droits_recette.sql` corrige ces écarts. Il est généré par `outils/generer_alignement_droits.py` à partir du JSON de production.

## Complément : détail de structure (`R0_detail_structure_production_2026-11-03.json`)

La transcription est vérifiée : les md5 des déclencheurs et des fonctions sont égaux aux signatures de la 1re requête.

| Écart | Cause établie | Preuve | Correction (copie locale et recette uniquement) |
|---|---|---|---|
| **Index** : 40 en production, 37 en local | 3 index de production absents de l'export du 28/10 et des migrations : `idx_contents_publish_date`, `idx_metrics_publication`, `idx_publications_content` | Liste détaillée | `R0d_complements_structure_recette.sql` (création « if not exists »). Rien n'est retiré en production |
| **Déclencheur** `wakabi_password_changed` (1 sur 38) | Clause WHEN identique, seul le type diffère : `auth.users.encrypted_password` est `varchar` dans Supabase, alors que ma simulation locale l'avait en `text` | Définitions comparées ; casts `::text` / `character varying` | Simulation locale corrigée en `varchar(255)`. Rien à changer en recette, qui est un vrai Supabase |
| **Fonctions** : 10 sur 25 (`wakabi_log_activity`, `wakabi_set_created_by`, `wakabi_set_updated_by`, `wakabi_rubriques_propagate_name`, `wakabi_contents_check_lists`, `wakabi_contents_archive`, `wakabi_publications_check_platform`, `wakabi_metric_readings_append_only`, `wakabi_metric_readings_before_insert`, `wakabi_metrics_to_readings`) | Les migrations 01 à 05 ont été exécutées avec des fins de ligne Windows (CRLF) | **md5 de la source locale, après le seul remplacement LF→CRLF, égal octet pour octet au src_md5 de production** pour les 10. Longueurs : production = local + (nombre de lignes − 1) | R0a émet 01 à 05 en CRLF ; copie locale idem |
| **Fonctions** : 12 sur 25 | Aucun écart | src_md5 identique | — |
| **Fonctions** : 3 sur 25 (`wakabi_assignment_guard` : 1022 car./12 lignes contre 1202/26 en local ; `wakabi_profiles_password_flag` : 266/3 contre 276/8 ; `wakabi_profiles_sync_platform` : 657/10 contre 716/19) | **Non établie.** Elles ne correspondent ni à la 06b v2, ni à la 06b v1, même après CRLF. Leur forme plus compacte suggère une version reformatée à l'application. Une différence de logique n'est pas exclue | — | Détail ciblé demandé : `R0_detail_3_fonctions.sql` (lecture seule). Empreintes normalisées locales (CRLF→LF, sans commentaires, espaces réduits) : `wakabi_assignment_guard` aa028db2def7c69c0d49b154ae9d7bdc, `wakabi_profiles_password_flag` 475826a5d71269c2da66c52ae16e4a99, `wakabi_profiles_sync_platform` fc6bccb1d0b95c64082e815dde474ada |

**Après corrections**, la copie locale (`outils/build7_prod.sh`) et la recette rejouée (R0a + R0_admin + R0b + R0c + R0d) sont **identiques entre elles** sur toutes les catégories. Par rapport à la production, toutes les catégories sont identiques sauf deux :
- `droits_tables`, identique hors MAINTAIN ;
- `fonctions`, qui diffère encore pour ces 3 fonctions.

Les tests 07 (invariants, concurrence) passent toujours sur la copie alignée.

## Complément 2 : les 3 fonctions de la 06b (`R0_3_fonctions_sources_production_2026-11-03.json`)

- **Sources reçues** : leur indentation a été réduite à un espace pendant la transmission. Elle a été retrouvée en ajoutant 0 à 2 espaces en début de ligne, jusqu'à ce que le md5 soit **exactement** le `src_md5` de production pour les 3 fonctions. Les sources conservées sont donc celles de la production, octet pour octet.
- **Logique comparée jeton par jeton** à `migrations/06b_correctif_equipe.sql`. Les chaînes de caractères sont gardées intactes ; seuls l'espacement, les commentaires et le « ; » après le `end` final sont ignorés.

| Fonction | Jetons (local / prod) | Résultat |
|---|---|---|
| `wakabi_assignment_guard` | 222 / 222 | Logique identique |
| `wakabi_profiles_password_flag` | 30 / 30 | Logique identique |
| `wakabi_profiles_sync_platform` | 158 / 158 | Logique identique |

- **Reconstruction** : `R0e_fonctions_06b_sources_production.sql` recrée ces 3 fonctions avec les sources exactes de production, pour la recette et la copie locale uniquement. Il contrôle les md5 en fin de script.
- **Tests de comportement**, rejoués sur la copie avec les sources locales et sur la copie avec les sources de production : tests 06 et 06b (t9 à t13, t16), puis 07 (comportement, sécurité, invariants, concurrence à deux connexions). Sur 775 lignes de sortie, il n'y a que 2 écarts, tous deux sans rapport avec la logique :
  - un identifiant de plateforme tiré au hasard ;
  - l'ordre d'affichage des deux connexions dans le test de concurrence.

## Résultat final

- **Copie locale neuve** (`outils/build7_prod.sh`), comparée à la production : **toutes les catégories sont identiques**, y compris les 25 fonctions, les 38 déclencheurs et les 40 index.
- **Seule exception** : `droits_tables`, identique hors MAINTAIN, un droit qui n'existe pas en PostgreSQL 16.
- **Recette rejouée** (R0a, R0_admin, R0b, R0c, R0d, R0e) : identique à la production dans les mêmes conditions.

Remarque : la copie locale doit être reconstruite après les tests t12, qui essaient la 06c en local et ajoutent des valeurs d'enum.
