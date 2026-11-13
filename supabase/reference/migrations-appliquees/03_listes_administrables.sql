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
