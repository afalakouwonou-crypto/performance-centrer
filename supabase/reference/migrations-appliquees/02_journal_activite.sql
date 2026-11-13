-- Wakabi Performance Center — Migration 02 : journal d'activité (cahier des charges §34)
-- À exécuter dans Supabase > SQL Editor, en une seule fois, APRÈS la migration 01.
-- Uniquement additive : crée une table, une fonction et 5 déclencheurs.
-- Ne modifie ni ne supprime aucune donnée, aucune table ni aucune colonne existante.
begin;

-- 0. Garde-fou : la migration 01 doit être en place, sinon rien n'est modifié.
do $check$
begin
  if (select count(*) from pg_trigger where tgname in
      ('wakabi_contents_created_by','wakabi_metrics_updated_by','wakabi_app_kpis_updated_by')) <> 3 then
    raise exception 'Migration 01 absente : migration 02 annulée, rien n''a été modifié.';
  end if;
end;
$check$;

-- 1. Table du journal. Pas de clé étrangère vers profiles : une entrée reste
--    lisible même si le compte de son auteur est retiré plus tard.
create table if not exists public.activity_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_id       uuid,          -- utilisateur connecté ; vide si action faite depuis le tableau de bord
  actor_email    text,          -- email de l'auteur au moment de l'action
  action         text not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name     text not null,
  row_id         uuid,
  changed_fields text[],        -- champs modifiés (pour UPDATE)
  old_data       jsonb,         -- état avant (UPDATE, DELETE)
  new_data       jsonb          -- état après (INSERT, UPDATE)
);
create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_row_idx        on public.activity_log (table_name, row_id);

-- 2. Droits : lecture réservée aux administrateurs ; aucune écriture possible depuis l'application.
alter table public.activity_log enable row level security;
drop policy if exists "admins read activity log" on public.activity_log;
create policy "admins read activity log" on public.activity_log
  for select to authenticated
  using (public.my_role() = 'admin'::public.wakabi_role);
revoke insert, update, delete, truncate on public.activity_log from anon, authenticated;

-- 3. Fonction d'enregistrement, appelée après chaque création / modification / suppression.
create or replace function public.wakabi_log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_actor   uuid := auth.uid();
  v_email   text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return null;  -- aucune valeur réellement changée : rien à journaliser
    end if;
  end if;

  if v_actor is not null then
    select p.email into v_email from public.profiles p where p.id = v_actor;
  end if;

  insert into public.activity_log(actor_id, actor_email, action, table_name, row_id, changed_fields, old_data, new_data)
  values (v_actor, v_email, tg_op, tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id')::uuid, v_changed, v_old, v_new);
  return null;
end;
$function$;

-- 4. Déclencheurs sur les 5 tables existantes.
drop trigger if exists wakabi_log_contents on public.contents;
create trigger wakabi_log_contents after insert or update or delete on public.contents
  for each row execute function public.wakabi_log_activity();

drop trigger if exists wakabi_log_publications on public.publications;
create trigger wakabi_log_publications after insert or update or delete on public.publications
  for each row execute function public.wakabi_log_activity();

drop trigger if exists wakabi_log_metrics on public.metrics;
create trigger wakabi_log_metrics after insert or update or delete on public.metrics
  for each row execute function public.wakabi_log_activity();

drop trigger if exists wakabi_log_app_kpis on public.app_kpis;
create trigger wakabi_log_app_kpis after insert or update or delete on public.app_kpis
  for each row execute function public.wakabi_log_activity();

drop trigger if exists wakabi_log_profiles on public.profiles;
create trigger wakabi_log_profiles after insert or update or delete on public.profiles
  for each row execute function public.wakabi_log_activity();

commit;

-- Vérification (à lancer après) : la 1re requête doit renvoyer 5 lignes, la 2e "0" (journal vide au départ)
-- select tgname, tgrelid::regclass from pg_trigger where tgname like 'wakabi_log_%';
-- select count(*) from public.activity_log;
