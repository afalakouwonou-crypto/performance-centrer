-- Annulation de la migration 02 : retire tout ce que la migration 02 a créé.
-- Attention : supprime aussi le contenu du journal d'activité (et seulement lui).
-- Aucune autre table ni donnée n'est touchée.
begin;
drop trigger if exists wakabi_log_contents     on public.contents;
drop trigger if exists wakabi_log_publications on public.publications;
drop trigger if exists wakabi_log_metrics      on public.metrics;
drop trigger if exists wakabi_log_app_kpis     on public.app_kpis;
drop trigger if exists wakabi_log_profiles     on public.profiles;
drop function if exists public.wakabi_log_activity();
drop table if exists public.activity_log;
commit;
