-- Annulation de la migration 10. Rien n'est supprimé : les 4 tables sont RENOMMÉES (suffixe _annulee_AAAAMMJJHHMMSS),
-- la colonne publications.promotion aussi. Supprimés : déclencheurs, fonction et règles d'accès de la 10.
begin;
set local lock_timeout = '5s';
do $check$ begin
  if to_regclass('public.objectives') is null then raise exception 'Migration 10 absente : rien n''a été modifié.'; end if;
end $check$;
do $r$
declare
  v_suffix text := '_annulee_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  t text; p record;
begin
  foreach t in array array['objectives', 'import_batches', 'platform_connections', 'saved_views'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    for p in select tgname from pg_trigger where tgrelid = format('public.%I', t)::regclass and not tgisinternal loop
      execute format('drop trigger %I on public.%I', p.tgname, t);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    for p in select i.relname from pg_index x join pg_class i on i.oid = x.indexrelid where x.indrelid = format('public.%I', t)::regclass loop
      execute format('alter index public.%I rename to %I', p.relname, left(p.relname, 40) || v_suffix);
    end loop;
    execute format('alter table public.%I rename to %I', t, t || v_suffix);
  end loop;
  execute format('alter table public.publications rename column promotion to %I', 'promotion' || v_suffix);
end
$r$;
drop function if exists public.wakabi_set_author_10();
commit;
select 'Migration 10 annulée : tables et colonne renommées, aucune donnée supprimée' as resultat;
