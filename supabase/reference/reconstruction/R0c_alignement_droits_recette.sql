-- Alignement des droits sur la PRODUCTION (source : R0_conformite_production_2026-11-03.json, md5 6a6f239cf6efffc0ecb4e604cc5728c4).
-- Réservé à la base de RECETTE ou à la copie LOCALE. Ne jamais exécuter en production : la production est la référence.
begin;
do $g$ begin
  if exists (select 1 from public.contents where title not like '[RECETTE]%') then
    raise exception 'Base contenant de vrais contenus : alignement refusé (production). Rien n''a été modifié.';
  end if;
end $g$;
-- 1. Tout retirer à PUBLIC, anon et authenticated (tables, vues, colonnes, fonctions du schéma public).
do $r$ declare t record; begin
  for t in select c.relname, a.attname from pg_class c join pg_attribute a on a.attrelid = c.oid
           where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped loop
    execute format('revoke all (%I) on public.%I from public, anon, authenticated', t.attname, t.relname);
  end loop;
end $r$;
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
-- 2. Redonner exactement les droits constatés en production.
grant MAINTAIN, REFERENCES, SELECT, TRIGGER on public.activity_log to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER on public.activity_log to authenticated;
grant INSERT, SELECT, UPDATE on public.app_kpis to authenticated;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.campaigns to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.campaigns to authenticated;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.content_objectives to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.content_objectives to authenticated;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.content_types to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.content_types to authenticated;
grant INSERT, SELECT, UPDATE on public.contents to authenticated;
grant INSERT, SELECT on public.metric_readings to authenticated;
grant SELECT on public.metric_readings_effective to authenticated;
grant INSERT, SELECT, UPDATE on public.metrics to authenticated;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.platforms to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.platforms to authenticated;
grant INSERT, SELECT on public.profile_platforms to authenticated;
grant SELECT on public.profiles to authenticated;
grant SELECT on public.publication_performance to authenticated;
grant SELECT on public.publication_schedule to authenticated;
grant INSERT, SELECT, UPDATE on public.publications to authenticated;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.rubriques to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, UPDATE on public.rubriques to authenticated;
grant UPDATE (revoked_at) on public.profile_platforms to authenticated;
grant UPDATE (active) on public.profiles to authenticated;
grant UPDATE (archived_at) on public.profiles to authenticated;
grant UPDATE (country) on public.profiles to authenticated;
grant UPDATE (full_name) on public.profiles to authenticated;
grant UPDATE (job_title) on public.profiles to authenticated;
grant UPDATE (must_change_password) on public.profiles to authenticated;
grant UPDATE (platform) on public.profiles to authenticated;
grant UPDATE (role) on public.profiles to authenticated;
grant execute on function public.my_platform() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.wakabi_can_manage_platform(uuid) to authenticated;
grant execute on function public.wakabi_contents_archive() to public;
grant execute on function public.wakabi_contents_archive() to anon;
grant execute on function public.wakabi_contents_archive() to authenticated;
grant execute on function public.wakabi_contents_check_lists() to public;
grant execute on function public.wakabi_contents_check_lists() to anon;
grant execute on function public.wakabi_contents_check_lists() to authenticated;
grant execute on function public.wakabi_country_tz(wakabi_country) to authenticated;
grant execute on function public.wakabi_local_date(wakabi_country, timestamp with time zone) to authenticated;
grant execute on function public.wakabi_log_activity() to public;
grant execute on function public.wakabi_log_activity() to anon;
grant execute on function public.wakabi_log_activity() to authenticated;
grant execute on function public.wakabi_metric_readings_append_only() to public;
grant execute on function public.wakabi_metric_readings_append_only() to anon;
grant execute on function public.wakabi_metric_readings_append_only() to authenticated;
grant execute on function public.wakabi_metric_readings_before_insert() to public;
grant execute on function public.wakabi_metric_readings_before_insert() to anon;
grant execute on function public.wakabi_metric_readings_before_insert() to authenticated;
grant execute on function public.wakabi_metrics_to_readings() to public;
grant execute on function public.wakabi_metrics_to_readings() to anon;
grant execute on function public.wakabi_metrics_to_readings() to authenticated;
grant execute on function public.wakabi_publications_check_platform() to public;
grant execute on function public.wakabi_publications_check_platform() to anon;
grant execute on function public.wakabi_publications_check_platform() to authenticated;
grant execute on function public.wakabi_rubriques_propagate_name() to public;
grant execute on function public.wakabi_rubriques_propagate_name() to anon;
grant execute on function public.wakabi_rubriques_propagate_name() to authenticated;
grant execute on function public.wakabi_set_created_by() to public;
grant execute on function public.wakabi_set_created_by() to anon;
grant execute on function public.wakabi_set_created_by() to authenticated;
grant execute on function public.wakabi_set_updated_by() to public;
grant execute on function public.wakabi_set_updated_by() to anon;
grant execute on function public.wakabi_set_updated_by() to authenticated;
commit;
