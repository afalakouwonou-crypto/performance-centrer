-- Annulation de la migration 03 : retire ce que la migration 03 a ajouté.
-- Les colonnes d'origine (contents.rubrique, publications.platform) et toutes leurs valeurs sont conservées.
-- Attention :
--  - les liens vers un type de contenu ou une campagne saisis après la migration 03 sont perdus ;
--  - la valeur 'YouTube' reste dans wakabi_platform (PostgreSQL ne permet pas de retirer une valeur d'enum) ;
--  - le contrôle des 5 rubriques d'origine est remis en place pour les nouvelles saisies (NOT VALID) :
--    un contenu déjà enregistré avec une nouvelle rubrique (ex. WAKATRIP) reste en base ;
--  - les fonctions partagées des migrations 01 et 02 (wakabi_set_updated_by, wakabi_log_activity) sont conservées,
--    ainsi que les lignes déjà écrites dans activity_log (historique).
begin;
drop trigger if exists wakabi_contents_check_lists        on public.contents;
drop trigger if exists wakabi_publications_check_platform on public.publications;
drop function if exists public.wakabi_contents_check_lists();
drop function if exists public.wakabi_publications_check_platform();

alter table public.contents     drop column if exists rubrique_id;
alter table public.contents     drop column if exists content_type_id;
alter table public.contents     drop column if exists campaign_id;
alter table public.publications drop column if exists platform_id;

drop table if exists public.rubriques;      -- supprime aussi ses déclencheurs et règles
drop table if exists public.platforms;
drop table if exists public.content_types;
drop table if exists public.campaigns;
drop function if exists public.wakabi_rubriques_propagate_name();

alter table public.contents drop constraint if exists contents_rubrique_check;
alter table public.contents add constraint contents_rubrique_check
  check (rubrique = any (array['SPOT','BON PLAN','ACTU','IMMERSION','GUIDE'])) not valid;
commit;
