-- Wakabi Performance Center — Migration 04 : fiche contenu (cahier des charges §8, §11)
-- Objectif principal (liste administrable), caption, script, archivage sécurisé, traçabilité des modifications.
-- À exécuter dans Supabase > SQL Editor, en une seule fois, APRÈS les migrations 01, 02 et 03.
-- Ne modifie et ne supprime aucune valeur existante : les nouvelles colonnes restent vides
-- pour les contenus existants, et aucune mise à jour de contenu n'est lancée.
begin;

-- 0. Garde-fou : migrations 01, 02 et 03 en place, sinon rien n'est modifié.
do $check$
begin
  if (select count(*) from pg_trigger where tgname in
      ('wakabi_contents_created_by','wakabi_metrics_updated_by','wakabi_app_kpis_updated_by')) <> 3
     or to_regclass('public.activity_log') is null
     or to_regclass('public.rubriques') is null
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_contents_check_lists') then
    raise exception 'Migrations 01/02/03 absentes : migration 04 annulée, rien n''a été modifié.';
  end if;
end;
$check$;

-- 1. Liste administrable des objectifs (même modèle que les listes de la migration 03).
create table if not exists public.content_objectives (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  status     text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create unique index if not exists content_objectives_name_key on public.content_objectives (lower(name));

-- Traçabilité (fonction de la migration 01) et journal (fonction de la migration 02),
-- créés avant les valeurs initiales pour que leur création soit journalisée.
drop trigger if exists wakabi_content_objectives_updated_by on public.content_objectives;
create trigger wakabi_content_objectives_updated_by before insert or update on public.content_objectives
  for each row execute function public.wakabi_set_updated_by();
drop trigger if exists wakabi_log_content_objectives on public.content_objectives;
create trigger wakabi_log_content_objectives after insert or update or delete on public.content_objectives
  for each row execute function public.wakabi_log_activity();

insert into public.content_objectives (name, sort_order)
select v.name, v.ord from (values
  ('Notoriété',1),('Engagement',2),('Téléchargements Wakabi',3),('Trafic',4),
  ('Découverte d''un lieu',5),('Conversion',6),('Communauté',7),('Autre',8)
) as v(name, ord)
where not exists (select 1 from public.content_objectives o where lower(o.name) = lower(v.name));

alter table public.content_objectives enable row level security;
drop policy if exists "active users read content objectives" on public.content_objectives;
create policy "active users read content objectives" on public.content_objectives for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "admins create content objectives" on public.content_objectives;
create policy "admins create content objectives" on public.content_objectives for insert to authenticated
  with check (public.my_role() = 'admin'::public.wakabi_role);
drop policy if exists "admins update content objectives" on public.content_objectives;
create policy "admins update content objectives" on public.content_objectives for update to authenticated
  using (public.my_role() = 'admin'::public.wakabi_role) with check (public.my_role() = 'admin'::public.wakabi_role);
revoke delete, truncate on public.content_objectives from anon, authenticated;

-- 2. Nouvelles colonnes de la fiche contenu (toutes facultatives, vides pour les contenus existants).
alter table public.contents add column if not exists objective_id uuid references public.content_objectives(id);
alter table public.contents add column if not exists caption      text;
alter table public.contents add column if not exists script       text;
alter table public.contents add column if not exists archived_at  timestamptz;
alter table public.contents add column if not exists archived_by  uuid references public.profiles(id);
alter table public.contents add column if not exists updated_at   timestamptz;  -- vide = pas modifié depuis la migration 04
alter table public.contents add column if not exists updated_by   uuid references public.profiles(id);
create index if not exists contents_objective_id_idx on public.contents (objective_id);
create index if not exists contents_archived_at_idx  on public.contents (archived_at);

-- 3. La vérification des listes (migration 03) contrôle aussi l'objectif : il doit exister et être actif
--    au moment où on le choisit. Le reste de la fonction est inchangé.
create or replace function public.wakabi_contents_check_lists()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_name   text;
  v_status text;
begin
  -- l'application actuelle envoie le texte : si seul le texte change, on recalcule l'identifiant
  if tg_op = 'UPDATE' and new.rubrique is distinct from old.rubrique
     and new.rubrique_id is not distinct from old.rubrique_id then
    new.rubrique_id := null;
  end if;

  if new.rubrique_id is null then
    select r.id into new.rubrique_id from public.rubriques r where r.name = new.rubrique;
  end if;

  select r.name, r.status into v_name, v_status from public.rubriques r where r.id = new.rubrique_id;
  if v_name is null then
    raise exception 'Rubrique inconnue : %', coalesce(new.rubrique, '(vide)');
  end if;
  new.rubrique := v_name;

  if (tg_op = 'INSERT' or new.rubrique_id is distinct from old.rubrique_id) and v_status <> 'active' then
    raise exception 'La rubrique % n''est pas active', v_name;
  end if;

  if new.content_type_id is not null and (tg_op = 'INSERT' or new.content_type_id is distinct from old.content_type_id)
     and not exists (select 1 from public.content_types t where t.id = new.content_type_id and t.status = 'active') then
    raise exception 'Ce type de contenu n''est pas actif';
  end if;

  if new.campaign_id is not null and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and not exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.status = 'active') then
    raise exception 'Cette campagne n''est pas active';
  end if;

  if new.objective_id is not null and (tg_op = 'INSERT' or new.objective_id is distinct from old.objective_id)
     and not exists (select 1 from public.content_objectives o where o.id = new.objective_id and o.status = 'active') then
    raise exception 'Cet objectif n''est pas actif';
  end if;

  return new;
end;
$function$;

-- 4. Archivage sécurisé par la base.
--    - Depuis l'application (requêtes Supabase exécutées sous les rôles anon / authenticated) :
--      archiver ou désarchiver exige un utilisateur authentifié ET le rôle admin ou editor
--      (Rédactrice en chef / Coordination), sinon l'opération est refusée.
--    - archived_at et archived_by sont toujours remplis par la base (heure réelle, utilisateur connecté) :
--      la valeur envoyée par le navigateur ne sert qu'à demander « archiver » (non vide) ou « désarchiver » (vide).
--    - En dehors d'un archivage / désarchivage, ces deux colonnes ne peuvent pas être modifiées.
--    - Un contenu ne peut pas être créé directement archivé.
--    - Opérations techniques de l'administrateur de la base (SQL Editor, migrations : rôle postgres) :
--      autorisées ; archived_at est quand même fixé par la base et archived_by reste vide (aucun utilisateur
--      de l'application), ce qui les rend identifiables dans activity_log.
create or replace function public.wakabi_contents_archive()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  if (new.archived_at is null) is distinct from (old.archived_at is null) then
    if current_user in ('anon', 'authenticated')
       and (auth.uid() is null or coalesce(public.my_role()::text, '') not in ('editor', 'admin')) then
      raise exception 'Seuls l''Administrateur et la Rédaction en chef / Coordination peuvent archiver ou désarchiver un contenu';
    end if;
    if new.archived_at is not null then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_by := null;
    end if;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$function$;

drop trigger if exists wakabi_contents_archive on public.contents;
create trigger wakabi_contents_archive before insert or update on public.contents
  for each row execute function public.wakabi_contents_archive();

-- 5. updated_at / updated_by des contenus remplis par la base (fonction de la migration 01).
drop trigger if exists wakabi_contents_updated_by on public.contents;
create trigger wakabi_contents_updated_by before insert or update on public.contents
  for each row execute function public.wakabi_set_updated_by();

commit;

-- Vérification (à lancer après) :
-- 1) doit renvoyer 8
-- select count(*) from public.content_objectives;
-- 2) doit renvoyer 0 (aucun contenu existant n'a reçu de valeur dans les nouvelles colonnes)
-- select count(*) from public.contents where objective_id is not null or caption is not null or script is not null
--   or archived_at is not null or archived_by is not null or updated_at is not null or updated_by is not null;
-- 3) doit renvoyer 2 lignes
-- select tgname from pg_trigger where tgname in ('wakabi_contents_archive','wakabi_contents_updated_by');
