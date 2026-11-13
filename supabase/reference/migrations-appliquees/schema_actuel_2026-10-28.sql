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
