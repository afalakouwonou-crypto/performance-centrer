-- R0a_schema_01_05.sql — Base de RECETTE Wakabi (généré le 2026-11-03 par generer_R0.sh).
-- À exécuter UNIQUEMENT dans le projet Supabase de recette. JAMAIS dans la production (dchrvyzdfrvrbdfgvstn).
-- Aucune donnée réelle, aucune clé, aucun mot de passe. Composants (md5) :
--   e32fd3ab598b8a492524e2d02d68ed61  schema_actuel_2026-10-28.sql
--   6b90dd46a2a29a86d7fb31ff714ffaa2  migrations/01_securisation.sql
--   c43462d9a29b59a7c4512c54b0939ec6  migrations/02_journal_activite.sql
--   935e56c5f4e882164c892c3b5b706c6a  migrations/03_listes_administrables.sql
--   5bf3792fd477f6f97e867a81c9dfb736  migrations/04_fiche_contenu.sql
--   1ce2a6c875c2145a06ddd0fb98b34fcb  migrations/05_statistiques_historique.sql

-- Garde-fou : projet de recette uniquement (la production a des contenus ; la recette n'en a aucun à ce stade).
do $g$ begin
  if to_regclass('public.contents') is not null or to_regclass('public.profiles') is not null then
    raise exception 'Ce script est réservé au projet de RECETTE neuf : base inattendue, rien n''a été modifié.';
  end if;
end $g$;

-- ===================== schema_actuel_2026-10-28.sql =====================
-- Schéma RÉEL du projet Supabase Wakabi (dchrvyzdfrvrbdfgvstn), état au 2026-10-28.
-- Reconstitué fidèlement à partir de l'export JSON (colonnes, contraintes, RLS, règles, fonctions, déclencheurs, enums)
-- fourni par l'utilisateur. Document de référence et de sauvegarde : NE PAS exécuter sur la base de production.
-- Lignes au moment de l'export (estimations) : contents 9, publications 31, metrics 19, profiles 7, app_kpis 6.

-- Types énumérés
create type public.wakabi_country  as enum ('Togo','Bénin');
create type public.wakabi_platform as enum ('TikTok','Instagram','Facebook','Snapchat');
create type public.wakabi_role     as enum ('platform_manager','editor','direction','admin');

-- Tables
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null,
  role       public.wakabi_role not null default 'platform_manager',
  country    public.wakabi_country,
  platform   public.wakabi_platform,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.contents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  concept      text,
  rubrique     text not null check (rubrique = any (array['SPOT','BON PLAN','ACTU','IMMERSION','GUIDE'])),
  country      public.wakabi_country not null,
  publish_date date not null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table public.publications (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  platform   public.wakabi_platform not null,
  url        text not null,
  created_at timestamptz not null default now(),
  unique (content_id, platform)
);

create table public.metrics (
  id             uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  snapshot       text not null default 'j7' check (snapshot = any (array['j7','final'])),
  views    bigint not null default 0 check (views    >= 0),
  likes    bigint not null default 0 check (likes    >= 0),
  comments bigint not null default 0 check (comments >= 0),
  shares   bigint not null default 0 check (shares   >= 0),
  reposts  bigint not null default 0 check (reposts  >= 0),
  saves    bigint not null default 0 check (saves    >= 0),
  measured_at date not null default current_date,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  unique (publication_id, snapshot)
);

create table public.app_kpis (
  id           uuid primary key default gen_random_uuid(),
  month        date not null,
  country      public.wakabi_country not null,
  downloads    bigint not null default 0 check (downloads    >= 0),
  signups      bigint not null default 0 check (signups      >= 0),
  active_users bigint not null default 0 check (active_users >= 0),
  uninstalls   bigint not null default 0 check (uninstalls   >= 0),
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now(),
  unique (month, country)
);

-- Fonctions
create or replace function public.my_role() returns public.wakabi_role
language sql stable security definer set search_path to 'public'
as $function$ select role from public.profiles where id=auth.uid() and active=true $function$;

create or replace function public.my_platform() returns public.wakabi_platform
language sql stable security definer set search_path to 'public'
as $function$ select platform from public.profiles where id=auth.uid() and active=true $function$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles(id,email,full_name,role,active)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),'platform_manager',true);
  return new;
end;
$function$;

-- Déclencheur : chaque compte Auth créé reçoit automatiquement un profil actif « platform_manager »
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS : activée sur les 5 tables (non forcée)
alter table public.profiles     enable row level security;
alter table public.contents     enable row level security;
alter table public.publications enable row level security;
alter table public.metrics      enable row level security;
alter table public.app_kpis     enable row level security;

-- Règles (aucune règle DELETE ; aucune règle INSERT/UPDATE sur profiles)
create policy "active users can read own profile" on public.profiles for select to authenticated
  using ((id = auth.uid()) or (my_role() = any (array['editor'::wakabi_role,'direction'::wakabi_role,'admin'::wakabi_role])));

create policy "authenticated active users read contents" on public.contents for select to authenticated
  using (my_role() is not null);
create policy "editors admins create contents" on public.contents for insert to authenticated
  with check (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]));
create policy "editors admins update contents" on public.contents for update to authenticated
  using (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]))
  with check (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]));

create policy "authenticated active users read publications" on public.publications for select to authenticated
  using (my_role() is not null);
create policy "editors admins create publications" on public.publications for insert to authenticated
  with check (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]));
create policy "editors admins update publications" on public.publications for update to authenticated
  using (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]))
  with check (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]));

create policy "authenticated active users read metrics" on public.metrics for select to authenticated
  using (my_role() is not null);
create policy "authorized users insert metrics" on public.metrics for insert to authenticated
  with check ((my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role])) or (exists (select 1 from publications p
    where p.id = metrics.publication_id and my_role() = 'platform_manager'::wakabi_role and p.platform = my_platform())));
create policy "authorized users update metrics" on public.metrics for update to authenticated
  using ((my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role])) or (exists (select 1 from publications p
    where p.id = metrics.publication_id and my_role() = 'platform_manager'::wakabi_role and p.platform = my_platform())))
  with check ((my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role])) or (exists (select 1 from publications p
    where p.id = metrics.publication_id and my_role() = 'platform_manager'::wakabi_role and p.platform = my_platform())));

create policy "authenticated active users read app kpis" on public.app_kpis for select to authenticated
  using (my_role() is not null);
create policy "editors admins insert app kpis" on public.app_kpis for insert to authenticated
  with check (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]));
create policy "editors admins update app kpis" on public.app_kpis for update to authenticated
  using (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]))
  with check (my_role() = any (array['editor'::wakabi_role,'admin'::wakabi_role]));


-- ===================== migrations/01_securisation.sql =====================
-- Wakabi Performance Center — Migration 01 : sécurisation de la base existante
-- À exécuter dans Supabase > SQL Editor, en une seule fois.
-- Ne supprime aucune table, aucune colonne, aucune donnée. Ne modifie aucun profil existant.
begin;

-- 0. Garde-fou : le script s'arrête sans rien modifier si le déclencheur Auth
--    n'existe pas, n'est pas actif ou ne pointe pas vers public.handle_new_user().
do $check$
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgname = 'on_auth_user_created'
      and t.tgrelid = 'auth.users'::regclass
      and t.tgfoid = 'public.handle_new_user()'::regprocedure
      and t.tgenabled = 'O'
  ) then
    raise exception 'Déclencheur on_auth_user_created absent ou inactif : migration annulée, rien n''a été modifié.';
  end if;
end;
$check$;

-- 1. Les nouveaux comptes Auth reçoivent un profil INACTIF.
--    Un administrateur l'active (et choisit rôle / plateforme) dans la table profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles(id, email, full_name, role, active)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          'platform_manager', false);
  return new;
end;
$function$;

-- 2. Traçabilité imposée par la base : l'auteur est l'utilisateur connecté,
--    jamais une valeur envoyée par le navigateur.
--    (auth.uid() est vide dans le SQL Editor : la valeur fournie est alors conservée.)
create or replace function public.wakabi_set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;  -- l'auteur d'origine ne peut plus être changé
  end if;
  return new;
end;
$function$;

create or replace function public.wakabi_set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists wakabi_contents_created_by on public.contents;
create trigger wakabi_contents_created_by
  before insert or update on public.contents
  for each row execute function public.wakabi_set_created_by();

drop trigger if exists wakabi_metrics_updated_by on public.metrics;
create trigger wakabi_metrics_updated_by
  before insert or update on public.metrics
  for each row execute function public.wakabi_set_updated_by();

drop trigger if exists wakabi_app_kpis_updated_by on public.app_kpis;
create trigger wakabi_app_kpis_updated_by
  before insert or update on public.app_kpis
  for each row execute function public.wakabi_set_updated_by();

commit;

-- Vérification (à lancer après) : la 1re requête doit renvoyer 3 lignes, la 2e "true"
-- select tgname, tgrelid::regclass from pg_trigger where tgname like 'wakabi_%';
-- select prosrc like '%''platform_manager'', false)%' as nouveaux_comptes_inactifs from pg_proc where proname = 'handle_new_user';


-- ===================== migrations/02_journal_activite.sql =====================
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


-- ===================== migrations/03_listes_administrables.sql =====================
-- Wakabi Performance Center — Migration 03 : listes administrables (cahier des charges §9, §10)
-- Rubriques, plateformes, types de contenus, campagnes / rendez-vous récurrents.
-- À exécuter dans Supabase > SQL Editor, en une seule fois, APRÈS les migrations 01 et 02.
-- Ne supprime aucune ligne et ne modifie aucune valeur existante : seules les nouvelles
-- colonnes (vides) sont remplies. Le contrôle figé des 5 rubriques est remplacé par une
-- vérification dynamique basée sur la table rubriques.
begin;

-- 0. Garde-fou : migrations 01 et 02 en place, sinon rien n'est modifié.
do $check$
begin
  if (select count(*) from pg_trigger where tgname in
      ('wakabi_contents_created_by','wakabi_metrics_updated_by','wakabi_app_kpis_updated_by')) <> 3
     or (select count(*) from pg_trigger where tgname like 'wakabi_log_%') < 5
     or to_regclass('public.activity_log') is null then
    raise exception 'Migrations 01/02 absentes : migration 03 annulée, rien n''a été modifié.';
  end if;
end;
$check$;

-- 1. YouTube devient une valeur possible pour les publications (les 4 valeurs existantes ne changent pas).
alter type public.wakabi_platform add value if not exists 'YouTube';

-- 2. Les 4 listes. Statut : active (proposée), inactive (masquée des nouveaux choix), archived.
--    Aucune suppression possible depuis l'application : on désactive ou on archive.
create table if not exists public.rubriques (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  status     text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create unique index if not exists rubriques_name_key on public.rubriques (lower(name));

create table if not exists public.platforms (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,   -- valeur technique stable (= valeur de wakabi_platform) ; le nom affiché peut changer
  name       text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  status     text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create unique index if not exists platforms_name_key on public.platforms (lower(name));

create table if not exists public.content_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  status     text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create unique index if not exists content_types_name_key on public.content_types (lower(name));

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  kind        text not null default 'campaign' check (kind in ('campaign','recurring')),  -- campagne datée | rendez-vous récurrent
  description text,
  start_date  date,
  end_date    date,
  sort_order  integer not null default 0,
  status      text not null default 'active' check (status in ('active','inactive','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  check (start_date is null or end_date is null or end_date >= start_date)
);
create unique index if not exists campaigns_name_key on public.campaigns (lower(name));

-- 2 bis. Traçabilité et journal sur les 4 listes, en réutilisant les fonctions existantes :
--    public.wakabi_set_updated_by() (migration 01) impose updated_by = utilisateur connecté et updated_at = now() ;
--    public.wakabi_log_activity() (migration 02) enregistre chaque création / modification dans activity_log.
--    Placés avant les valeurs initiales pour que leur création soit aussi journalisée.
drop trigger if exists wakabi_rubriques_updated_by on public.rubriques;
create trigger wakabi_rubriques_updated_by before insert or update on public.rubriques
  for each row execute function public.wakabi_set_updated_by();
drop trigger if exists wakabi_platforms_updated_by on public.platforms;
create trigger wakabi_platforms_updated_by before insert or update on public.platforms
  for each row execute function public.wakabi_set_updated_by();
drop trigger if exists wakabi_content_types_updated_by on public.content_types;
create trigger wakabi_content_types_updated_by before insert or update on public.content_types
  for each row execute function public.wakabi_set_updated_by();
drop trigger if exists wakabi_campaigns_updated_by on public.campaigns;
create trigger wakabi_campaigns_updated_by before insert or update on public.campaigns
  for each row execute function public.wakabi_set_updated_by();

drop trigger if exists wakabi_log_rubriques on public.rubriques;
create trigger wakabi_log_rubriques after insert or update or delete on public.rubriques
  for each row execute function public.wakabi_log_activity();
drop trigger if exists wakabi_log_platforms on public.platforms;
create trigger wakabi_log_platforms after insert or update or delete on public.platforms
  for each row execute function public.wakabi_log_activity();
drop trigger if exists wakabi_log_content_types on public.content_types;
create trigger wakabi_log_content_types after insert or update or delete on public.content_types
  for each row execute function public.wakabi_log_activity();
drop trigger if exists wakabi_log_campaigns on public.campaigns;
create trigger wakabi_log_campaigns after insert or update or delete on public.campaigns
  for each row execute function public.wakabi_log_activity();

-- 3. Valeurs initiales (ajoutées seulement si absentes : le script peut être relancé).
insert into public.rubriques (name, sort_order)
select v.name, v.ord from (values
  ('SPOT',1),('BON PLAN',2),('ACTU',3),('IMMERSION',4),('GUIDE',5),
  ('ON VA OÙ LÀ ?',6),('EXPLORE WITH WAKABI',7),('WAKATRIP',8),('SANS FILTRE',9),('ZÉMI TOUR',10),('VERSUS',11)
) as v(name, ord)
where not exists (select 1 from public.rubriques r where lower(r.name) = lower(v.name));

insert into public.platforms (code, name, sort_order)
select v.code, v.code, v.ord from (values
  ('TikTok',1),('Instagram',2),('Facebook',3),('Snapchat',4),('YouTube',5)
) as v(code, ord)
where not exists (select 1 from public.platforms p where p.code = v.code);

insert into public.content_types (name, sort_order)
select v.name, v.ord from (values
  ('Vidéo',1),('Visuel',2),('Carrousel',3),('Story',4),('Motion design',5),('Autre',6)
) as v(name, ord)
where not exists (select 1 from public.content_types t where lower(t.name) = lower(v.name));

insert into public.campaigns (name, kind, description, sort_order)
select 'VSD', 'recurring', 'Rendez-vous éditorial récurrent du week-end', 1
where not exists (select 1 from public.campaigns c where lower(c.name) = 'vsd');

-- 4. Nouvelles colonnes de liaison (vides au départ). Une liste utilisée ne peut pas être supprimée.
alter table public.contents     add column if not exists rubrique_id     uuid references public.rubriques(id);
alter table public.contents     add column if not exists content_type_id uuid references public.content_types(id);
alter table public.contents     add column if not exists campaign_id     uuid references public.campaigns(id);
alter table public.publications add column if not exists platform_id     uuid references public.platforms(id);
create index if not exists contents_rubrique_id_idx     on public.contents (rubrique_id);
create index if not exists contents_content_type_id_idx on public.contents (content_type_id);
create index if not exists contents_campaign_id_idx     on public.contents (campaign_id);
create index if not exists publications_platform_id_idx on public.publications (platform_id);

-- 5. Vérification dynamique des contenus (remplace le contrôle figé des 5 rubriques).
--    - La rubrique doit exister dans la table rubriques.
--    - Elle doit être ACTIVE seulement quand on la choisit (création ou changement) :
--      un ancien contenu garde sa rubrique même si elle est désactivée ensuite.
--    - Le texte "rubrique" (utilisé par l'application actuelle) et rubrique_id restent synchronisés.
--    - Type de contenu et campagne : doivent être actifs quand on les choisit.
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

  return new;
end;
$function$;

-- Publications : la plateforme (valeur wakabi_platform envoyée par l'application) reste la référence ;
-- platform_id est rempli automatiquement. Une plateforme doit être active quand on la choisit.
create or replace function public.wakabi_publications_check_platform()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_status text;
begin
  select p.id, p.status into new.platform_id, v_status
  from public.platforms p where p.code = new.platform::text;
  if new.platform_id is null then
    raise exception 'Plateforme inconnue : %', new.platform;
  end if;
  if (tg_op = 'INSERT' or new.platform is distinct from old.platform) and v_status <> 'active' then
    raise exception 'La plateforme % n''est pas active', new.platform;
  end if;
  return new;
end;
$function$;

-- Renommer une rubrique met à jour le texte des contenus qui l'utilisent.
create or replace function public.wakabi_rubriques_propagate_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.contents set rubrique = new.name where rubrique_id = new.id and rubrique is distinct from new.name;
  return null;
end;
$function$;

-- 6. Remplissage des nouvelles colonnes pour les contenus et publications existants
--    (seules les colonnes vides rubrique_id / platform_id sont écrites).
update public.contents c set rubrique_id = r.id
from public.rubriques r where r.name = c.rubrique and c.rubrique_id is null;

update public.publications pu set platform_id = p.id
from public.platforms p where p.code = pu.platform::text and pu.platform_id is null;

do $verif$
begin
  if exists (select 1 from public.contents where rubrique_id is null)
     or exists (select 1 from public.publications where platform_id is null) then
    raise exception 'Un contenu ou une publication n''a pas pu être relié à sa liste : migration annulée, rien n''a été modifié.';
  end if;
end;
$verif$;

-- 7. Remplacement du contrôle figé par la vérification dynamique.
drop trigger if exists wakabi_contents_check_lists on public.contents;
create trigger wakabi_contents_check_lists before insert or update on public.contents
  for each row execute function public.wakabi_contents_check_lists();

drop trigger if exists wakabi_publications_check_platform on public.publications;
create trigger wakabi_publications_check_platform before insert or update on public.publications
  for each row execute function public.wakabi_publications_check_platform();

drop trigger if exists wakabi_rubriques_propagate_name on public.rubriques;
create trigger wakabi_rubriques_propagate_name after update of name on public.rubriques
  for each row execute function public.wakabi_rubriques_propagate_name();

alter table public.contents drop constraint if exists contents_rubrique_check;

-- 8. Droits : lecture pour tout utilisateur actif ; création / modification par l'admin ; aucune suppression.
alter table public.rubriques     enable row level security;
alter table public.platforms     enable row level security;
alter table public.content_types enable row level security;
alter table public.campaigns     enable row level security;

drop policy if exists "active users read rubriques" on public.rubriques;
create policy "active users read rubriques" on public.rubriques for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "admins create rubriques" on public.rubriques;
create policy "admins create rubriques" on public.rubriques for insert to authenticated
  with check (public.my_role() = 'admin'::public.wakabi_role);
drop policy if exists "admins update rubriques" on public.rubriques;
create policy "admins update rubriques" on public.rubriques for update to authenticated
  using (public.my_role() = 'admin'::public.wakabi_role) with check (public.my_role() = 'admin'::public.wakabi_role);

drop policy if exists "active users read platforms" on public.platforms;
create policy "active users read platforms" on public.platforms for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "admins create platforms" on public.platforms;
create policy "admins create platforms" on public.platforms for insert to authenticated
  with check (public.my_role() = 'admin'::public.wakabi_role);
drop policy if exists "admins update platforms" on public.platforms;
create policy "admins update platforms" on public.platforms for update to authenticated
  using (public.my_role() = 'admin'::public.wakabi_role) with check (public.my_role() = 'admin'::public.wakabi_role);

drop policy if exists "active users read content types" on public.content_types;
create policy "active users read content types" on public.content_types for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "admins create content types" on public.content_types;
create policy "admins create content types" on public.content_types for insert to authenticated
  with check (public.my_role() = 'admin'::public.wakabi_role);
drop policy if exists "admins update content types" on public.content_types;
create policy "admins update content types" on public.content_types for update to authenticated
  using (public.my_role() = 'admin'::public.wakabi_role) with check (public.my_role() = 'admin'::public.wakabi_role);

drop policy if exists "active users read campaigns" on public.campaigns;
create policy "active users read campaigns" on public.campaigns for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "admins create campaigns" on public.campaigns;
create policy "admins create campaigns" on public.campaigns for insert to authenticated
  with check (public.my_role() = 'admin'::public.wakabi_role);
drop policy if exists "admins update campaigns" on public.campaigns;
create policy "admins update campaigns" on public.campaigns for update to authenticated
  using (public.my_role() = 'admin'::public.wakabi_role) with check (public.my_role() = 'admin'::public.wakabi_role);

revoke delete, truncate on public.rubriques, public.platforms, public.content_types, public.campaigns from anon, authenticated;

commit;

-- Vérification (à lancer après) :
-- 1) doit renvoyer : rubriques 11 | platforms 5 | content_types 6 | campaigns 1
-- select 'rubriques', count(*) from public.rubriques union all select 'platforms', count(*) from public.platforms
--   union all select 'content_types', count(*) from public.content_types union all select 'campaigns', count(*) from public.campaigns;
-- 2) doit renvoyer 0 et 0 (tous les contenus et publications existants sont reliés)
-- select (select count(*) from public.contents where rubrique_id is null) as contenus_non_relies,
--        (select count(*) from public.publications where platform_id is null) as publications_non_reliees;


-- ===================== migrations/04_fiche_contenu.sql =====================
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


-- ===================== migrations/05_statistiques_historique.sql =====================
-- Wakabi Performance Center — Migration 05 : statistiques J+1 / J+7 et historique des relevés (cahier des charges, Phase 1)
-- À exécuter dans Supabase > SQL Editor, en une seule fois, APRÈS les migrations 01, 02, 03 et 04.
-- Uniquement additive :
--  - la table metrics et ses 19 lignes ne sont ni modifiées ni supprimées ;
--  - les 19 relevés existants sont COPIÉS dans la nouvelle table metric_readings, avec leur vraie date
--    et leur vrai auteur, sans heure de relevé inventée, et marqués comme repris de metrics ;
--  - l'application actuelle continue d'écrire dans metrics : chaque enregistrement y est recopié
--    automatiquement dans metric_readings (sens unique, rien n'est jamais écrasé).
begin;

-- 0. Garde-fous : migrations 01 à 04 en place et PostgreSQL 15 ou plus (vues security_invoker).
do $check$
begin
  if (select count(*) from pg_trigger where tgname in
      ('wakabi_contents_created_by','wakabi_metrics_updated_by','wakabi_app_kpis_updated_by')) <> 3
     or to_regclass('public.activity_log') is null
     or to_regclass('public.platforms') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.publications'::regclass
                    and attname = 'platform_id' and not attisdropped)
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_contents_archive') then
    raise exception 'Migrations 01/02/03/04 absentes : migration 05 annulée, rien n''a été modifié.';
  end if;
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'PostgreSQL 15 ou plus requis (vues security_invoker) : migration 05 annulée.';
  end if;
end;
$check$;

-- Pendant la migration, les écritures dans metrics attendent quelques instants :
-- aucun enregistrement fait depuis l'application ne peut passer entre la reprise et la recopie automatique.
lock table public.metrics in share row exclusive mode;

-- 1. Ce que chaque plateforme fournit (ajustable par l'administrateur). Par défaut : tout.
alter table public.platforms add column if not exists supports_reposts boolean not null default true;
alter table public.platforms add column if not exists supports_saves   boolean not null default true;

-- 2. Table des relevés : une ligne = un relevé, jamais modifiée ni supprimée depuis l'application.
create table if not exists public.metric_readings (
  id                  uuid primary key default gen_random_uuid(),
  publication_id      uuid not null references public.publications(id) on delete restrict,
  reading_type        text not null check (reading_type in ('j1','j7','other')),   -- J+1, J+7, autre relevé manuel
  source              text not null default 'manual' check (source in ('manual','api')),
  origin              text not null default 'direct'
                      check (origin in ('direct','metrics_legacy','metrics_sync')),
                      -- direct         : saisi directement dans metric_readings
                      -- metrics_legacy : repris de l'ancienne table metrics lors de la migration 05
                      -- metrics_sync   : recopié automatiquement depuis metrics (application actuelle)
  legacy_metric_id    uuid,          -- ligne de metrics d'où vient le relevé (origines metrics_*)
  views               bigint not null check (views    >= 0),
  likes               bigint not null check (likes    >= 0),
  comments            bigint not null check (comments >= 0),
  shares              bigint not null check (shares   >= 0),
  reposts             bigint check (reposts >= 0),  -- vide = non renseigné / non fourni par la plateforme (différent de 0)
  saves               bigint check (saves   >= 0),
  measured_on         date not null,                -- date du relevé
  measured_at         timestamptz,                  -- heure exacte du relevé ; vide si inconnue (jamais inventée)
  corrects_reading_id uuid references public.metric_readings(id) on delete restrict,
  correction_reason   text,
  original_reading_id uuid references public.metric_readings(id) on delete restrict,  -- 1er relevé de la chaîne
  entered_by          uuid references public.profiles(id),
  entered_at          timestamptz not null default now(),
  constraint metric_readings_correction_reason check (
    (corrects_reading_id is null and correction_reason is null)
    or (corrects_reading_id is not null and correction_reason is not null and btrim(correction_reason) <> '')),
  constraint metric_readings_legacy_link check ((origin = 'direct') = (legacy_metric_id is null))
);

-- Un seul relevé d'origine J+1 et un seul J+7 par publication ; les corrections ne sont pas concernées.
create unique index if not exists metric_readings_one_original_key
  on public.metric_readings (publication_id, reading_type)
  where corrects_reading_id is null and reading_type in ('j1','j7');
-- Un relevé ne peut être corrigé qu'une fois : les corrections forment une chaîne, la dernière fait foi.
create unique index if not exists metric_readings_one_correction_key
  on public.metric_readings (corrects_reading_id) where corrects_reading_id is not null;
create index if not exists metric_readings_publication_idx on public.metric_readings (publication_id, reading_type);
create index if not exists metric_readings_legacy_idx      on public.metric_readings (legacy_metric_id);
create index if not exists metric_readings_original_idx    on public.metric_readings (original_reading_id);

-- 3. Contrôles à la création d'un relevé.
--    Depuis l'application (rôles anon / authenticated) : auteur, heure de saisie, origine et source
--    sont imposés par la base ; la date et l'heure du relevé ne peuvent pas être dans le futur ;
--    reposts / enregistrements restent vides pour une plateforme qui ne les fournit pas.
--    Depuis la base (migration, recopie depuis metrics, SQL Editor) : l'auteur et l'heure de saisie
--    fournis sont conservés (reprise de l'historique sans écraser l'auteur d'origine).
create or replace function public.wakabi_metric_readings_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_parent public.metric_readings%rowtype;
  v_reposts boolean;
  v_saves   boolean;
  v_label   text := case new.reading_type when 'j1' then 'J+1' when 'j7' then 'J+7' else 'autre' end;
begin
  if current_user in ('anon', 'authenticated') then
    if auth.uid() is null then
      raise exception 'Utilisateur non connecté';
    end if;
    new.entered_by       := auth.uid();
    new.entered_at       := now();
    new.origin           := 'direct';
    new.legacy_metric_id := null;
    new.source           := 'manual';
  else
    new.entered_by := coalesce(new.entered_by, auth.uid());
    new.entered_at := coalesce(new.entered_at, now());
  end if;

  if new.origin = 'direct' then
    -- tolérance d'un jour / quelques minutes pour les fuseaux horaires (Togo UTC+0, Bénin UTC+1)
    if new.measured_on > current_date + 1 or new.measured_at > now() + interval '10 minutes' then
      raise exception 'La date ou l''heure du relevé ne peut pas être dans le futur';
    end if;
    select pf.supports_reposts, pf.supports_saves into v_reposts, v_saves
    from public.publications p join public.platforms pf on pf.id = p.platform_id
    where p.id = new.publication_id;
    if new.reposts is not null and v_reposts is false then
      raise exception 'Cette plateforme ne fournit pas les republications : laissez le champ vide';
    end if;
    if new.saves is not null and v_saves is false then
      raise exception 'Cette plateforme ne fournit pas les enregistrements : laissez le champ vide';
    end if;
  end if;

  if new.corrects_reading_id is null then
    new.original_reading_id := new.id;
    if new.reading_type in ('j1','j7') and exists (
         select 1 from public.metric_readings r
         where r.publication_id = new.publication_id and r.reading_type = new.reading_type
           and r.corrects_reading_id is null) then
      raise exception 'Un relevé % d''origine existe déjà pour cette publication : enregistrez une correction', v_label;
    end if;
  else
    select * into v_parent from public.metric_readings r where r.id = new.corrects_reading_id;
    if v_parent.id is null then
      raise exception 'Relevé à corriger introuvable';
    end if;
    if v_parent.publication_id <> new.publication_id or v_parent.reading_type <> new.reading_type then
      raise exception 'Une correction doit porter sur la même publication et le même type de relevé';
    end if;
    if exists (select 1 from public.metric_readings r where r.corrects_reading_id = v_parent.id) then
      raise exception 'Ce relevé a déjà été corrigé : corrigez la dernière version';
    end if;
    new.original_reading_id := coalesce(v_parent.original_reading_id, v_parent.id);
  end if;
  return new;
end;
$function$;

-- Append-only : aucune modification ni suppression depuis l'application (en plus du retrait des droits).
create or replace function public.wakabi_metric_readings_append_only()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Un relevé ne peut être ni modifié ni supprimé : enregistrez une correction';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists wakabi_metric_readings_before_insert on public.metric_readings;
create trigger wakabi_metric_readings_before_insert before insert on public.metric_readings
  for each row execute function public.wakabi_metric_readings_before_insert();
drop trigger if exists wakabi_metric_readings_append_only on public.metric_readings;
create trigger wakabi_metric_readings_append_only before update or delete on public.metric_readings
  for each row execute function public.wakabi_metric_readings_append_only();
-- Journal (fonction de la migration 02), créé avant la reprise pour qu'elle soit journalisée.
drop trigger if exists wakabi_log_metric_readings on public.metric_readings;
create trigger wakabi_log_metric_readings after insert or update or delete on public.metric_readings
  for each row execute function public.wakabi_log_activity();

-- 4. Droits : mêmes règles que metrics pour la lecture et la saisie ; ni modification ni suppression.
alter table public.metric_readings enable row level security;
revoke all on public.metric_readings from anon, authenticated;
grant select, insert on public.metric_readings to authenticated;

drop policy if exists "active users read metric readings" on public.metric_readings;
create policy "active users read metric readings" on public.metric_readings for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "authorized users insert metric readings" on public.metric_readings;
create policy "authorized users insert metric readings" on public.metric_readings for insert to authenticated
  with check (
    public.my_role() = any (array['editor'::public.wakabi_role, 'admin'::public.wakabi_role])
    or exists (select 1 from public.publications p
               where p.id = metric_readings.publication_id
                 and public.my_role() = 'platform_manager'::public.wakabi_role
                 and p.platform = public.my_platform()));

-- 5. Reprise des relevés existants de metrics (19 relevés J+7 au 2026-10-30).
--    Date = metrics.measured_at (date seule) ; heure du relevé laissée vide ;
--    auteur et heure de saisie = metrics.updated_by / updated_at ; valeurs copiées telles quelles
--    (les 0 de reposts / enregistrements sont conservés : l'ancienne saisie ne distinguait pas « vide » de 0).
--    Relancer le script ne recopie rien en double.
insert into public.metric_readings
  (publication_id, reading_type, source, origin, legacy_metric_id,
   views, likes, comments, shares, reposts, saves,
   measured_on, measured_at, entered_by, entered_at)
select m.publication_id, case m.snapshot when 'j7' then 'j7' else 'other' end, 'manual', 'metrics_legacy', m.id,
       m.views, m.likes, m.comments, m.shares, m.reposts, m.saves,
       m.measured_at, null, m.updated_by, m.updated_at
from public.metrics m
where not exists (select 1 from public.metric_readings r where r.legacy_metric_id = m.id)
order by m.updated_at, m.id;

-- 6. Recopie automatique depuis metrics (sens unique) : l'application actuelle continue de fonctionner
--    et chaque enregistrement devient un relevé. Une modification d'un relevé existant devient une
--    correction (nouvelle ligne) ; rien n'est recopié si aucune valeur n'a changé. Une suppression dans
--    metrics ne supprime rien dans l'historique.
create or replace function public.wakabi_metrics_to_readings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_type   text := case new.snapshot when 'j7' then 'j7' else 'other' end;
  v_target uuid;
begin
  if tg_op = 'UPDATE'
     and (new.publication_id, new.snapshot, new.views, new.likes, new.comments, new.shares,
          new.reposts, new.saves, new.measured_at)
         is not distinct from
         (old.publication_id, old.snapshot, old.views, old.likes, old.comments, old.shares,
          old.reposts, old.saves, old.measured_at) then
    return null;
  end if;

  -- dernière version (non corrigée) du relevé concerné
  select r.id into v_target
  from public.metric_readings r
  where r.publication_id = new.publication_id and r.reading_type = v_type
    and (v_type <> 'other' or r.legacy_metric_id = new.id)
    and not exists (select 1 from public.metric_readings c where c.corrects_reading_id = r.id)
  order by r.entered_at desc, r.id
  limit 1;

  insert into public.metric_readings
    (publication_id, reading_type, source, origin, legacy_metric_id,
     views, likes, comments, shares, reposts, saves,
     measured_on, measured_at, corrects_reading_id, correction_reason, entered_by, entered_at)
  values
    (new.publication_id, v_type, 'manual', 'metrics_sync', new.id,
     new.views, new.likes, new.comments, new.shares, new.reposts, new.saves,
     new.measured_at, null, v_target,
     case when v_target is not null then 'Mise à jour depuis l''application actuelle (table metrics)' end,
     coalesce(new.updated_by, auth.uid()), now());
  return null;
end;
$function$;

drop trigger if exists wakabi_metrics_to_readings on public.metrics;
create trigger wakabi_metrics_to_readings after insert or update on public.metrics
  for each row execute function public.wakabi_metrics_to_readings();

-- 7. Vues de calcul (rien de calculé n'est stocké). security_invoker = true : chaque utilisateur
--    ne voit que ce que les règles RLS de metric_readings et publications lui permettent de voir.
--    Taux d'interaction = (likes + commentaires + partages) / vues (vide si 0 vue).

-- 7a. Version en vigueur de chaque relevé (dernière correction, ou le relevé d'origine s'il n'a pas été corrigé).
create or replace view public.metric_readings_effective
with (security_invoker = true) as
select r.id, r.original_reading_id, r.publication_id, p.content_id, p.platform, p.platform_id,
       r.reading_type, r.source, r.origin, r.legacy_metric_id,
       r.views, r.likes, r.comments, r.shares, r.reposts, r.saves,
       r.likes + r.comments + r.shares as interactions,
       case when r.views > 0 then round((r.likes + r.comments + r.shares)::numeric / r.views, 4) end as interaction_rate,
       r.measured_on, r.measured_at, r.entered_by, r.entered_at,
       (r.corrects_reading_id is not null) as is_corrected,
       r.correction_reason
from public.metric_readings r
join public.publications p on p.id = r.publication_id
where not exists (select 1 from public.metric_readings c where c.corrects_reading_id = r.id);

-- 7b. Synthèse par publication : J+1, J+7, dernier relevé et évolution.
create or replace view public.publication_performance
with (security_invoker = true) as
with latest as (
  select distinct on (e.publication_id) e.*
  from public.metric_readings_effective e
  order by e.publication_id, e.measured_on desc, e.measured_at desc nulls last, e.entered_at desc
)
select p.id as publication_id, p.content_id, p.platform, p.platform_id,
       j1.views as j1_views, j1.interactions as j1_interactions, j1.interaction_rate as j1_interaction_rate,
       j1.measured_on as j1_measured_on, j1.id as j1_reading_id,
       j7.views as j7_views, j7.likes as j7_likes, j7.comments as j7_comments, j7.shares as j7_shares,
       j7.reposts as j7_reposts, j7.saves as j7_saves,
       j7.interactions as j7_interactions, j7.interaction_rate as j7_interaction_rate,
       j7.measured_on as j7_measured_on, j7.id as j7_reading_id,
       l.reading_type as latest_reading_type, l.views as latest_views, l.interactions as latest_interactions,
       l.interaction_rate as latest_interaction_rate, l.measured_on as latest_measured_on,
       l.measured_at as latest_measured_at, l.id as latest_reading_id,
       j7.views - j1.views as views_change_j1_j7,
       case when j1.views > 0 then round((j7.views - j1.views)::numeric / j1.views, 4) end as views_growth_j1_j7,
       l.views - j7.views as views_change_j7_latest
from public.publications p
left join public.metric_readings_effective j1 on j1.publication_id = p.id and j1.reading_type = 'j1'
left join public.metric_readings_effective j7 on j7.publication_id = p.id and j7.reading_type = 'j7'
left join latest l on l.publication_id = p.id;

revoke all on public.metric_readings_effective, public.publication_performance from anon, authenticated;
grant select on public.metric_readings_effective, public.publication_performance to authenticated;

commit;

-- Vérification (à lancer après) :
-- 1) doit renvoyer : metrics_legacy | j7 | 19
-- select origin, reading_type, count(*) from public.metric_readings group by 1, 2;
-- 2) doit renvoyer 0 (chaque relevé repris est identique à sa ligne metrics, même date, même auteur, aucune heure)
-- select count(*) from public.metrics m join public.metric_readings r on r.legacy_metric_id = m.id and r.origin = 'metrics_legacy'
--  where (m.views, m.likes, m.comments, m.shares, m.reposts, m.saves, m.measured_at, m.updated_by, m.updated_at)
--        is distinct from (r.views, r.likes, r.comments, r.shares, r.reposts, r.saves, r.measured_on, r.entered_by, r.entered_at)
--     or r.measured_at is not null;
-- 3) doit renvoyer 4 lignes
-- select tgname from pg_trigger where tgname in ('wakabi_metric_readings_before_insert','wakabi_metric_readings_append_only',
--   'wakabi_log_metric_readings','wakabi_metrics_to_readings');
-- 4) doit renvoyer 2 lignes avec security_invoker=true
-- select relname, reloptions from pg_class where relname in ('metric_readings_effective','publication_performance');

