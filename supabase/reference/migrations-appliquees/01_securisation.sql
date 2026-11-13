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
