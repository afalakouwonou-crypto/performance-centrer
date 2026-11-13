-- Annulation de la migration 05 : retire ce que la migration 05 a ajouté.
-- La table metrics et toutes ses lignes sont conservées telles quelles (la migration 05 ne les a jamais modifiées).
-- Attention :
--  - la table metric_readings est supprimée : les relevés saisis directement après la migration 05
--    (J+1, relevés « autre », corrections) sont PERDUS. Faites un export CSV de metric_readings avant si besoin ;
--  - les lignes déjà écrites dans activity_log sont conservées (historique) ;
--  - les fonctions partagées des migrations 01 à 04 ne sont pas touchées.
begin;
drop trigger if exists wakabi_metrics_to_readings on public.metrics;
drop function if exists public.wakabi_metrics_to_readings();

drop view if exists public.publication_performance;
drop view if exists public.metric_readings_effective;

drop table if exists public.metric_readings;   -- supprime aussi ses déclencheurs, index et règles
drop function if exists public.wakabi_metric_readings_before_insert();
drop function if exists public.wakabi_metric_readings_append_only();

alter table public.platforms drop column if exists supports_reposts;
alter table public.platforms drop column if exists supports_saves;
commit;

-- Vérification (à lancer après) : doit renvoyer null | 0
-- select to_regclass('public.metric_readings'), (select count(*) from pg_trigger where tgname = 'wakabi_metrics_to_readings');
