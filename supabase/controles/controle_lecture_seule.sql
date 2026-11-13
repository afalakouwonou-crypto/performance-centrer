-- Wakabi Performance Center - CONTROLE EN LECTURE SEULE (aucune ecriture, aucun changement de droits).
-- Base unique wakabi-performance. A executer par ChatGPT dans l'editeur SQL Supabase, avant et apres chaque migration.
-- Une seule instruction SELECT : l'editeur affiche tout le resultat (2 colonnes : controle, resultat).
-- Ligne 19 : migrations presentes (08P = table wakabi_login_attempts ; 09 = content_tasks ; 10 = objectives).
-- Le fichier ne contient volontairement aucune ligne vide.
select '00 base' as controle, current_database()::text || ' / ' || version() as resultat
union all
select '01 compteurs', json_build_object(
  'profils', (select count(*) from public.profiles),
  'profils_actifs_non_retires', (select count(*) from public.profiles where active and archived_at is null),
  'affectations_en_cours', (select count(*) from public.profile_platforms where revoked_at is null),
  'affectations_total', (select count(*) from public.profile_platforms),
  'contenus', (select count(*) from public.contents),
  'contenus_archives', (select count(*) from public.contents where archived_at is not null),
  'publications', (select count(*) from public.publications),
  'publications_sans_date_effective', (select count(*) from public.publications where published_on is null),
  'metrics', (select count(*) from public.metrics),
  'metric_readings', (select count(*) from public.metric_readings),
  'app_kpis', (select count(*) from public.app_kpis))::text
union all
select '02 releves par type/origine', coalesce((select string_agg(x.k || '=' || x.n, ', ' order by x.k) from (select r.reading_type::text || '/' || r.origin::text as k, count(*) as n from public.metric_readings r group by 1) x), 'aucun')
union all
select '03 corrections', json_build_object(
  'lignes_de_correction', (select count(*) from public.metric_readings where corrects_reading_id is not null),
  'releves_corriges_plusieurs_fois', (select count(*) from (select corrects_reading_id from public.metric_readings where corrects_reading_id is not null group by 1 having count(*) > 1) y))::text
union all
select '04 valeurs wakabi_role (06c appliquee ?)', (select string_agg(e.enumlabel::text, ', ' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'wakabi_role')
union all
select '05 valeurs wakabi_platform', (select string_agg(e.enumlabel::text, ', ' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'wakabi_platform')
union all
select '06 colonnes profiles (08 appliquee ?)', (select string_agg(c.column_name::text, ', ' order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'profiles')
union all
select '07 colonnes publications (07)', (select string_agg(c.column_name::text, ', ' order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'publications')
union all
select '08 colonnes metric_readings', (select string_agg(c.column_name::text, ', ' order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'metric_readings')
union all
select '09 colonnes app_kpis (vide autorise ? defaut ?)', (select string_agg(c.column_name::text || ' null=' || c.is_nullable::text || ' def=' || coalesce(c.column_default::text, '-'), ' | ' order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'app_kpis')
union all
select '10 contraintes metric_readings', (select string_agg(k.conname::text || ' = ' || pg_get_constraintdef(k.oid), ' | ' order by k.conname) from pg_constraint k where k.conrelid = 'public.metric_readings'::regclass)
union all
select '11 index uniques metric_readings', coalesce((select string_agg(i.indexname::text || ' = ' || i.indexdef, ' | ' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = 'metric_readings' and i.indexdef ilike '%unique%'), 'aucun')
union all
select '12 tables publiques et RLS', (select string_agg(c.relname::text || '=' || case when c.relrowsecurity then 'RLS' else 'SANS-RLS' end, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p'))
union all
select '13 vues (security_invoker ?)', coalesce((select string_agg(c.relname::text || ' [' || coalesce(array_to_string(c.reloptions, ','), 'sans option') || ']', ' | ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'), 'aucune')
union all
select '14 droits de table du role anon (S/I/U/D)', coalesce((select string_agg(c.relname::text || ':' || concat_ws('/', case when has_table_privilege('anon', c.oid, 'SELECT') then 'S' end, case when has_table_privilege('anon', c.oid, 'INSERT') then 'I' end, case when has_table_privilege('anon', c.oid, 'UPDATE') then 'U' end, case when has_table_privilege('anon', c.oid, 'DELETE') then 'D' end), ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))), 'aucun')
union all
select '15 fonctions public.wakabi*', coalesce((select string_agg(p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' || case when p.prosecdef then ' SECURITY DEFINER' else '' end, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike 'wakabi%'), 'aucune')
union all
select '16 fonctions public executables par anon', coalesce((select string_agg(p.proname::text, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')), 'aucune')
union all
select '17 declencheurs sur auth.users', coalesce((select string_agg(t.tgname::text || ' -> ' || t.tgfoid::regproc::text, ', ' order by t.tgname) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal), 'aucun')
union all
select '18 politiques profiles / profile_platforms', coalesce((select string_agg(p.tablename::text || '.' || p.policyname::text || ' [' || p.cmd || ' ' || array_to_string(p.roles::text[], ',') || '] USING ' || coalesce(p.qual, '-'), ' | ' order by p.tablename, p.policyname) from pg_policies p where p.schemaname = 'public' and p.tablename in ('profiles', 'profile_platforms')), 'aucune')
union all
select '19 migrations presentes', concat_ws(', ', case when to_regclass('public.wakabi_login_attempts') is not null then '08P' end,
  case when to_regclass('public.content_tasks') is not null then '09' end, case when to_regclass('public.objectives') is not null then '10' end,
  case when to_regclass('public.wakabi_m11_state') is not null and not has_table_privilege('anon', 'public.rubriques', 'SELECT') then '11' end, '01-07 (references)');
