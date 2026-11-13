-- Annulation de la migration 09 (organisation). Rien n'est supprimé :
--   - les 5 tables de la 09 sont RENOMMÉES (suffixe _annulee_AAAAMMJJHHMMSS) et retirées au navigateur ;
--   - les colonnes production_status, production_status_at, production_status_by de contents sont RENOMMÉES de même ;
--   - le compartiment « wakabi-fichiers » et ses fichiers restent dans le stockage (seules ses 2 règles d'accès sont retirées).
-- Supprimés : les déclencheurs, fonctions et règles d'accès créés par la 09. Une réinstallation de la 09 reste possible.
begin;
set local lock_timeout = '5s';
do $check$ begin
  if to_regclass('public.content_tasks') is null then
    raise exception 'Migration 09 absente : rien n''a été modifié.';
  end if;
end $check$;
drop trigger if exists wakabi_contents_status_set on public.contents;
drop trigger if exists wakabi_contents_status_log on public.contents;
drop trigger if exists wakabi_publications_mark_published on public.publications;
drop policy if exists "wakabi09 lire fichiers" on storage.objects;
drop policy if exists "wakabi09 deposer fichiers" on storage.objects;
do $r$
declare
  v_suffix text := '_annulee_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  t text; p record;
begin
  foreach t in array array['content_status_history', 'content_tasks', 'content_feedback', 'content_files', 'notifications'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    -- Index (dont clés primaires et uniques) renommés aussi : sinon une réinstallation de la 09 heurterait leurs noms.
    for p in select i.relname from pg_index x join pg_class i on i.oid = x.indexrelid
             where x.indrelid = format('public.%I', t)::regclass loop
      execute format('alter index public.%I rename to %I', p.relname, left(p.relname, 40) || v_suffix);
    end loop;
    execute format('alter table public.%I rename to %I', t, t || v_suffix);
  end loop;
  execute format('alter table public.contents rename column production_status to %I', 'production_status' || v_suffix);
  execute format('alter table public.contents rename column production_status_at to %I', 'production_status_at' || v_suffix);
  execute format('alter table public.contents rename column production_status_by to %I', 'production_status_by' || v_suffix);
  execute format('alter table public.contents rename constraint wakabi_contents_production_status to %I', 'wakabi_contents_production_status' || v_suffix);
end
$r$;
-- Les déclencheurs suivent les tables renommées : on les retire (les tables annulées ne doivent plus rien faire).
do $t$
declare r record;
begin
  for r in select tgname, tgrelid::regclass as rel from pg_trigger
           where not tgisinternal and tgrelid::regclass::text like '%_annulee_%'
             and tgname in ('wakabi_tasks_guard', 'wakabi_tasks_notify', 'wakabi_feedback_set', 'wakabi_feedback_apply', 'wakabi_files_guard',
                            'wakabi_log_content_tasks', 'wakabi_log_content_feedback', 'wakabi_log_content_files') loop
    execute format('drop trigger %I on %s', r.tgname, r.rel);
  end loop;
end
$t$;
drop function if exists public.wakabi_content_submit(uuid, text);
drop function if exists public.wakabi_publications_mark_published();
drop function if exists public.wakabi_files_guard();
drop function if exists public.wakabi_can_upload_path(text);
drop function if exists public.wakabi_can_work_on(uuid);
drop function if exists public.wakabi_feedback_apply();
drop function if exists public.wakabi_feedback_set();
drop function if exists public.wakabi_tasks_notify();
drop function if exists public.wakabi_tasks_guard();
drop function if exists public.wakabi_contents_status_log();
drop function if exists public.wakabi_contents_status_set();
drop function if exists public.wakabi_notify(uuid, text, uuid, uuid, text);
commit;
select 'Migration 09 annulée : tables et colonnes renommées, aucune donnée supprimée' as resultat;
