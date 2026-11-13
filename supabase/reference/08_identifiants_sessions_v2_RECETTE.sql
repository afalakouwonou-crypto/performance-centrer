-- Wakabi Performance Center — Migration 08 (version 2) : identifiant personnel, reconnexion du lundi, départs
-- RECETTE UNIQUEMENT. À exécuter seulement dans le projet de recette tbpyymdbflsntouascbz, après relecture.
-- JAMAIS en production sans accord séparé d'Andréas.
-- Version 2 (revue du 04/11) : mot de passe provisoire en 3 étapes fail-closed, limites de tentatives atomiques
-- (réservation avant tout appel distant), lecture de son propre profil et de ses affectations soumise à la session,
-- état antérieur enregistré pour une annulation exacte.
-- Aucune ligne existante n'est supprimée. Les profils existants ne sont pas modifiés (colonnes ajoutées vides).
-- Seules modifications d'objets existants : my_role(), my_platform() et 2 règles de lecture (profiles,
-- profile_platforms), toutes rétablies à l'identique par 08_identifiants_sessions_annulation.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 0. Garde-fous : 06, 06b et 07 en place ; base de recette ; 08 absente ; définitions de départ attendues.
do $check$
begin
  if to_regclass('public.profile_platforms') is null
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_profiles_sync_platform')
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_password_changed')
     or to_regclass('public.publication_schedule') is null then
    raise exception 'Migrations 06 / 06b / 07 absentes : migration 08 annulée, rien n''a été modifié.';
  end if;
  if exists (select 1 from public.contents where title not like '[RECETTE]%')
     and current_setting('wakabi.copie_locale', true) is distinct from 'oui' then
    raise exception 'Base contenant de vrais contenus : migration 08 réservée à la RECETTE. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.wakabi_srv_login_begin(text,text)') is not null
     or to_regclass('public.wakabi_login_attempts') is not null then
    raise exception 'Migration 08 déjà présente : rien n''a été modifié.';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.my_role()'::regprocedure)) <> 'eda685c7f21533f58a04c64de0c7f54e'
     or md5((select prosrc from pg_proc where oid = 'public.my_platform()'::regprocedure)) <> '8c8d1c4285535f51f46f4720aac310ea' then
    raise exception 'my_role() ou my_platform() diffèrent de la version 06 attendue : rien n''a été modifié.';
  end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'active users can read own profile')
       is distinct from '((id = auth.uid()) OR (my_role() = ANY (ARRAY[''editor''::wakabi_role, ''direction''::wakabi_role, ''admin''::wakabi_role])))'
     or (select qual from pg_policies where schemaname = 'public' and tablename = 'profile_platforms' and policyname = 'wakabi06 read assignments')
       is distinct from '((profile_id = auth.uid()) OR (my_role() = ANY (ARRAY[''admin''::wakabi_role, ''editor''::wakabi_role, ''direction''::wakabi_role])))' then
    raise exception 'Règles de lecture profiles / profile_platforms différentes de la version attendue : rien n''a été modifié.';
  end if;
end;
$check$;

-- 0b. État antérieur, pour que l'annulation rétablisse exactement ce qui existait (aucun accès navigateur).
--     Après une annulation, la table est conservée : l'état d'origine (avant la toute première installation) est gardé.
create table if not exists public.wakabi_m08_state (key text primary key, value text, noted_at timestamptz not null default now());
alter table public.wakabi_m08_state enable row level security;
revoke all on public.wakabi_m08_state from public, anon, authenticated, service_role;
insert into public.wakabi_m08_state(key, value) values
  ('auth_admin_had_schema_usage', has_schema_privilege('supabase_auth_admin', 'public', 'usage')::text)
on conflict (key) do nothing;
insert into public.wakabi_m08_state(key, value) values ('installed_at', now()::text)
on conflict (key) do update set value = excluded.value, noted_at = now();
delete from public.wakabi_m08_state where key = 'annulled_at';

-- 1. Colonnes (vides pour les profils existants ; conservées par l'annulation).
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists sessions_valid_after timestamptz;
alter table public.profiles add column if not exists provisional_pending_at timestamptz;
alter table public.profiles add column if not exists provisional_op uuid;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'wakabi_profiles_username_format') then
    alter table public.profiles add constraint wakabi_profiles_username_format
      check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$');
  end if;
end $c$;
create unique index if not exists profiles_username_key on public.profiles (username) where username is not null;
-- Aucun droit navigateur sur ces 4 colonnes : les droits par colonne de 06b ne sont pas modifiés.

-- 2. Identifiant immuable une fois attribué (sauf intervention technique explicite dans le SQL Editor).
create function public.wakabi_profiles_username_guard()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.username is not null and new.username is distinct from old.username
     and current_setting('wakabi.changer_identifiant', true) is distinct from 'oui' then
    raise exception 'Un identifiant attribué ne peut pas être modifié : créez un nouveau compte';
  end if;
  return new;
end;
$function$;
create trigger wakabi_profiles_username_guard before update of username on public.profiles
  for each row execute function public.wakabi_profiles_username_guard();

-- 3. Désactivation ou retrait : toutes les sessions ouvertes avant cet instant sont refusées par la base.
create function public.wakabi_profiles_sessions()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if (old.active and not new.active) or (old.archived_at is null and new.archived_at is not null) then
    new.sessions_valid_after := now();
  end if;
  return new;
end;
$function$;
create trigger wakabi_profiles_sessions before update on public.profiles
  for each row execute function public.wakabi_profiles_sessions();

-- 3b. Mot de passe provisoire en cours : le déclencheur existant wakabi_password_changed (06, inchangé) lève
--     l'obligation à chaque changement de mot de passe dans Auth. Tant qu'une opération de l'administrateur est
--     en cours (moins de 15 minutes), cette levée est refusée : l'obligation reste posée quoi qu'il arrive.
--     Au-delà de 15 minutes, l'opération est considérée comme abandonnée (une fonction Edge ne dure jamais aussi
--     longtemps) : le changement suivant, fait par le membre lui-même, lève normalement l'obligation.
create function public.wakabi_profiles_provisional()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.provisional_pending_at is not null and old.must_change_password and not new.must_change_password then
    if old.provisional_pending_at > now() - interval '15 minutes' then
      new.must_change_password := true;
    else
      new.provisional_pending_at := null;
      new.provisional_op := null;
    end if;
  end if;
  return new;
end;
$function$;
create trigger wakabi_profiles_provisional before update on public.profiles
  for each row execute function public.wakabi_profiles_provisional();

-- 4. Règle du lundi et fraîcheur de la session.
create function public.wakabi_week_start(p_ts timestamptz default now())
returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('week', p_ts at time zone 'Africa/Lome') at time zone 'Africa/Lome'
$$;
-- Date de la dernière authentification de la session (claim « amr » du jeton ; absente = refusée).
create function public.wakabi_auth_time(p_claims jsonb default null)
returns timestamptz language sql stable set search_path = '' as $$
  select to_timestamp(max((e ->> 'timestamp')::double precision))
  from jsonb_array_elements(coalesce(coalesce(p_claims, auth.jwt()) -> 'amr', '[]'::jsonb)) e
  where jsonb_typeof(e) = 'object' and (e ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
$$;
create function public.wakabi_session_fresh(p_valid_after timestamptz, p_claims jsonb default null)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.wakabi_auth_time(p_claims) >= public.wakabi_week_start(now())
                  and public.wakabi_auth_time(p_claims) >= coalesce(p_valid_after, '-infinity'::timestamptz), false)
$$;

-- 5. my_role() / my_platform() : mêmes conditions que la migration 06, plus la fraîcheur de la session.
create or replace function public.my_role() returns public.wakabi_role language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password
    and public.wakabi_session_fresh(sessions_valid_after) $$;
create or replace function public.my_platform() returns public.wakabi_platform language sql stable security definer set search_path='' as $$
  select platform from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password
    and public.wakabi_session_fresh(sessions_valid_after) $$;
-- Session valable pour lire SON propre profil (y compris pendant le changement obligatoire de mot de passe).
create function public.wakabi_self_fresh()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active and archived_at is null
                  and public.wakabi_session_fresh(sessions_valid_after))
$$;

-- 5b. Les deux seules règles qui donnaient un accès sur la seule base de auth.uid() :
--     propre profil : session fraîche, compte actif et non retiré (le changement de mot de passe reste possible) ;
--     propres affectations : mêmes conditions que toutes les données métier (my_role() non vide).
alter policy "active users can read own profile" on public.profiles
  using (((id = auth.uid()) and public.wakabi_self_fresh()) or (public.my_role() = any (array['editor'::public.wakabi_role, 'direction'::public.wakabi_role, 'admin'::public.wakabi_role])));
alter policy "wakabi06 read assignments" on public.profile_platforms
  using (((profile_id = auth.uid()) and (public.my_role() is not null)) or (public.my_role() = any (array['admin'::public.wakabi_role, 'editor'::public.wakabi_role, 'direction'::public.wakabi_role])));

-- 6. État de la session de l'utilisateur connecté (pour afficher le bon message dans l'application).
create function public.wakabi_session_status()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.id is null then 'no_profile'
    when p.archived_at is not null then 'archived'
    when not p.active then 'inactive'
    when public.wakabi_auth_time() is null or public.wakabi_auth_time() < public.wakabi_week_start(now()) then 'week'
    when p.sessions_valid_after is not null and public.wakabi_auth_time() < p.sessions_valid_after then 'revoked'
    when p.must_change_password then 'must_change'
    else 'ok' end
  from (select 1) x left join public.profiles p on p.id = auth.uid()
$$;
create function public.wakabi_am_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
$$;
-- Proposition d'identifiant libre : base, puis base2, base3… (les identifiants des membres retirés restent pris).
create function public.wakabi_username_suggestion(p_base text)
returns text language plpgsql stable security definer set search_path = '' as $function$
declare
  v_base text := regexp_replace(lower(btrim(coalesce(p_base, ''))), '[^a-z0-9._-]', '', 'g');
  v_try  text;
  i      int := 1;
begin
  if public.my_role() is distinct from 'admin' then   -- fonction security definer : current_user n'est pas fiable ici
    raise exception 'Réservé à l''administrateur';
  end if;
  v_base := regexp_replace(regexp_replace(v_base, '^[._-]+', ''), '[._-]+$', '');
  if length(v_base) < 2 then v_base := 'membre'; end if;
  v_base := left(v_base, 28);
  v_try := v_base;
  while exists (select 1 from public.profiles where username = v_try) loop
    i := i + 1; v_try := v_base || i;
  end loop;
  return v_try;
end;
$function$;

-- 7. Tentatives (aucun accès navigateur). success vide = tentative en cours, comptée comme un échec tant que
--    la fonction Edge n'a pas confirmé la réussite : une fonction interrompue ne libère jamais de tentative.
create table public.wakabi_login_attempts (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('login','recovery')),
  username     text not null,
  ip           text,
  success      boolean,
  attempted_at timestamptz not null default now(),
  finished_at  timestamptz
);
create index wakabi_login_attempts_user_idx on public.wakabi_login_attempts (username, attempted_at);
create index wakabi_login_attempts_ip_idx   on public.wakabi_login_attempts (ip, attempted_at);
create index wakabi_login_attempts_time_idx on public.wakabi_login_attempts (attempted_at);
alter table public.wakabi_login_attempts enable row level security;
revoke all on public.wakabi_login_attempts from public, anon, authenticated, service_role;

-- Limites, vérifiées et réservées dans la MÊME transaction, sous un verrou exclusif (pg_advisory_xact_lock) :
-- des requêtes parallèles passent l'une après l'autre, aucune ne peut dépasser le seuil.
--   connexion   : 5 échecs ou tentatives en cours par identifiant, 30 par adresse IP, 200 au total, sur 15 minutes ;
--   récupération : 3 par identifiant, 10 par adresse IP, 50 au total, sur 1 heure.
-- Comptées que l'identifiant existe ou non (aucune énumération possible).
create function public.wakabi_srv_login_begin(p_username text, p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_user  text := left(lower(btrim(coalesce(p_username, ''))), 64);
  v_ip    text := left(coalesce(nullif(btrim(p_ip), ''), 'inconnue'), 64);
  v_email text;
  v_id    bigint;
begin
  perform pg_advisory_xact_lock(80808, 1);
  delete from public.wakabi_login_attempts where attempted_at < now() - interval '2 days';
  if (select count(*) from public.wakabi_login_attempts where kind = 'login' and success is not true
        and username = v_user and attempted_at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.wakabi_login_attempts where kind = 'login' and success is not true
        and ip = v_ip and attempted_at > now() - interval '15 minutes') >= 30
     or (select count(*) from public.wakabi_login_attempts where kind = 'login' and success is not true
        and attempted_at > now() - interval '15 minutes') >= 200 then
    insert into public.wakabi_login_attempts(kind, username, ip, success, finished_at) values ('login', v_user, v_ip, false, now());
    return jsonb_build_object('allowed', false);
  end if;
  insert into public.wakabi_login_attempts(kind, username, ip, success) values ('login', v_user, v_ip, null)
    returning id into v_id;
  select p.email into v_email from public.profiles p
   where p.username = v_user and p.active and p.archived_at is null;
  return jsonb_build_object('allowed', true, 'attempt', v_id, 'email', v_email);
end;
$function$;
-- Clôt UNE tentative réservée (une seule fois). Sans appel, elle reste comptée comme un échec.
create function public.wakabi_srv_login_end(p_attempt bigint, p_success boolean)
returns boolean language sql security definer set search_path = '' as $$
  update public.wakabi_login_attempts set success = coalesce(p_success, false), finished_at = now()
   where id = p_attempt and kind = 'login' and success is null
  returning true
$$;
create function public.wakabi_srv_recovery_email(p_username text, p_ip text)
returns text language plpgsql security definer set search_path = '' as $function$
declare
  v_user  text := left(lower(btrim(coalesce(p_username, ''))), 64);
  v_ip    text := left(coalesce(nullif(btrim(p_ip), ''), 'inconnue'), 64);
  v_email text;
begin
  perform pg_advisory_xact_lock(80808, 2);
  if (select count(*) from public.wakabi_login_attempts
        where kind = 'recovery' and username = v_user and attempted_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.wakabi_login_attempts
        where kind = 'recovery' and ip = v_ip and attempted_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.wakabi_login_attempts
        where kind = 'recovery' and attempted_at > now() - interval '1 hour') >= 50 then
    insert into public.wakabi_login_attempts(kind, username, ip, success, finished_at) values ('recovery', v_user, v_ip, false, now());
    return null;
  end if;
  select p.email into v_email from public.profiles p
   where p.username = v_user and p.active and p.archived_at is null;
  insert into public.wakabi_login_attempts(kind, username, ip, success, finished_at)
  values ('recovery', v_user, v_ip, v_email is not null, now());
  return v_email;
end;
$function$;

-- 8. Création de compte et mot de passe provisoire par l'administrateur (appelées par la fonction Edge,
--    après vérification du jeton de l'administrateur). L'auteur réel est inscrit dans le journal.
create function public.wakabi_srv_act_as(p_caller uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not exists (select 1 from public.profiles where id = p_caller and role = 'admin' and active
                   and archived_at is null and not must_change_password) then
    raise exception 'Réservé à un administrateur actif';
  end if;
  perform set_config('request.jwt.claim.sub', p_caller::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_caller, 'role', 'service_role')::text, true);
end;
$function$;
create function public.wakabi_srv_setup_profile(p_caller uuid, p_target uuid, p_username text, p_full_name text,
  p_role public.wakabi_role, p_job_title text, p_country public.wakabi_country, p_platform public.wakabi_platform,
  p_platform_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_user text := lower(btrim(coalesce(p_username, '')));
begin
  perform public.wakabi_srv_act_as(p_caller);
  if v_user !~ '^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$' then
    raise exception 'Identifiant invalide : 2 à 32 caractères, lettres minuscules, chiffres, point, tiret ou souligné';
  end if;
  if exists (select 1 from public.profiles where username = v_user) then
    raise exception 'Identifiant déjà utilisé : %', v_user;
  end if;
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'Nom obligatoire'; end if;
  update public.profiles set username = v_user, full_name = btrim(p_full_name), role = p_role,
         job_title = nullif(btrim(coalesce(p_job_title, '')), ''), country = p_country, platform = p_platform,
         active = true, must_change_password = true
   where id = p_target and username is null and archived_at is null;
  if not found then raise exception 'Profil introuvable ou déjà configuré'; end if;
  insert into public.profile_platforms(profile_id, platform_id, created_by)
  select p_target, x, p_caller from unnest(coalesce(p_platform_ids, '{}')) x
  on conflict (profile_id, platform_id) do update set revoked_at = null
    where public.profile_platforms.revoked_at is not null;
end;
$function$;

-- Mot de passe provisoire, étape 1 (AVANT de toucher Auth) : obligation posée, sessions révoquées, opération
-- enregistrée. Refusé pour soi-même, pour un membre retiré ou si une opération est déjà en cours.
create function public.wakabi_srv_password_reset_begin(p_caller uuid, p_target uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  p    public.profiles%rowtype;
  v_op uuid := gen_random_uuid();
begin
  perform public.wakabi_srv_act_as(p_caller);
  if p_caller = p_target then
    raise exception 'Un administrateur ne peut pas se donner un mot de passe provisoire : utilisez « Mot de passe oublié » ou le changement de mot de passe';
  end if;
  select * into p from public.profiles where id = p_target for update;
  if p.id is null then raise exception 'Membre introuvable'; end if;
  if p.archived_at is not null then raise exception 'Membre retiré : aucun mot de passe provisoire'; end if;
  if p.provisional_pending_at > now() - interval '15 minutes' then
    raise exception 'Une réinitialisation est déjà en cours pour ce membre : réessayez dans quelques minutes';
  end if;
  update public.profiles set must_change_password = true, sessions_valid_after = now(),
         provisional_pending_at = now(), provisional_op = v_op
   where id = p_target;
  return v_op;
end;
$function$;
-- Étape 3 (APRÈS le changement dans Auth) : vérifie qu'un changement a bien eu lieu après l'étape 1, puis clôt
-- l'opération. L'obligation reste posée et les sessions ouvertes entre-temps sont révoquées à nouveau.
create function public.wakabi_srv_password_reset_end(p_caller uuid, p_target uuid, p_op uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  p public.profiles%rowtype;
begin
  perform public.wakabi_srv_act_as(p_caller);
  select * into p from public.profiles where id = p_target for update;
  if p.id is null or p.provisional_op is distinct from p_op then
    raise exception 'Opération inconnue, déjà close ou expirée';
  end if;
  if p.password_changed_at is null or p.password_changed_at < p.provisional_pending_at then
    raise exception 'Aucun changement de mot de passe constaté dans Auth depuis le début de l''opération';
  end if;
  update public.profiles set must_change_password = true, sessions_valid_after = now(),
         provisional_pending_at = null, provisional_op = null
   where id = p_target;
end;
$function$;
-- Si Auth a refusé le changement : l'opération est close, l'obligation et la révocation restent en place.
create function public.wakabi_srv_password_reset_abort(p_caller uuid, p_target uuid, p_op uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform public.wakabi_srv_act_as(p_caller);
  update public.profiles set provisional_pending_at = null, provisional_op = null
   where id = p_target and provisional_op = p_op;
end;
$function$;
-- 'blocked' si le compte doit être bloqué dans Auth (inactif ou retiré), sinon 'allowed'.
create function public.wakabi_srv_access_state(p_caller uuid, p_target uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare v text;
begin
  perform public.wakabi_srv_act_as(p_caller);
  select case when archived_at is not null or not active then 'blocked' else 'allowed' end into v
    from public.profiles where id = p_target;
  if v is null then raise exception 'Membre introuvable'; end if;
  return v;
end;
$function$;

-- 9. Hook « Customize Access Token » : refuse d'émettre ou de renouveler un jeton hors des règles ci-dessus.
create or replace function public.wakabi_access_token_hook(event jsonb)   -- « or replace » : remplace la version neutre laissée par une annulation
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = (event ->> 'user_id')::uuid;
  if p.id is null or p.archived_at is not null or not p.active
     or not public.wakabi_session_fresh(p.sessions_valid_after, event -> 'claims') then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Session expirée ou compte inactif : reconnectez-vous avec votre identifiant.'));
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end;
$function$;

-- 10. Droits : rien pour PUBLIC ni anon ; le navigateur connecté n'a que 4 fonctions d'information.
revoke all on function public.wakabi_profiles_username_guard(), public.wakabi_profiles_sessions(),
  public.wakabi_profiles_provisional(),
  public.wakabi_week_start(timestamptz), public.wakabi_auth_time(jsonb), public.wakabi_session_fresh(timestamptz, jsonb),
  public.wakabi_self_fresh(), public.wakabi_session_status(), public.wakabi_am_admin(), public.wakabi_username_suggestion(text),
  public.wakabi_srv_login_begin(text, text), public.wakabi_srv_login_end(bigint, boolean),
  public.wakabi_srv_recovery_email(text, text), public.wakabi_srv_act_as(uuid),
  public.wakabi_srv_setup_profile(uuid, uuid, text, text, public.wakabi_role, text, public.wakabi_country, public.wakabi_platform, uuid[]),
  public.wakabi_srv_password_reset_begin(uuid, uuid), public.wakabi_srv_password_reset_end(uuid, uuid, uuid),
  public.wakabi_srv_password_reset_abort(uuid, uuid, uuid), public.wakabi_srv_access_state(uuid, uuid),
  public.wakabi_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.wakabi_self_fresh(), public.wakabi_session_status(), public.wakabi_am_admin(),
  public.wakabi_username_suggestion(text)
  to authenticated;
grant execute on function public.wakabi_srv_login_begin(text, text), public.wakabi_srv_login_end(bigint, boolean),
  public.wakabi_srv_recovery_email(text, text),
  public.wakabi_srv_setup_profile(uuid, uuid, text, text, public.wakabi_role, text, public.wakabi_country, public.wakabi_platform, uuid[]),
  public.wakabi_srv_password_reset_begin(uuid, uuid), public.wakabi_srv_password_reset_end(uuid, uuid, uuid),
  public.wakabi_srv_password_reset_abort(uuid, uuid, uuid), public.wakabi_srv_access_state(uuid, uuid)
  to service_role;
grant execute on function public.wakabi_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

commit;

-- Vérifications (à lancer après) :
-- 1) 4 lignes : provisional_op, provisional_pending_at, sessions_valid_after, username
-- select column_name from information_schema.columns where table_schema='public' and table_name='profiles'
--  and column_name in ('username','sessions_valid_after','provisional_pending_at','provisional_op') order by 1;
-- 2) 0 : aucun profil existant modifié
-- select count(*) from public.profiles where username is not null or sessions_valid_after is not null or provisional_pending_at is not null;
-- 3) droits : authenticated sur 4 fonctions, service_role sur 8 wakabi_srv_*, supabase_auth_admin sur le hook ; ni anon ni PUBLIC
-- select routine_name, grantee from information_schema.role_routine_grants where routine_schema='public'
--  and (routine_name like 'wakabi_srv%' or routine_name in ('wakabi_access_token_hook','wakabi_session_status','wakabi_am_admin',
--  'wakabi_username_suggestion','wakabi_self_fresh','wakabi_week_start','wakabi_auth_time','wakabi_session_fresh'))
--  and grantee <> 'postgres' order by 1, 2;
-- 4) lundi 00:00 de la semaine en cours à Lomé
-- select public.wakabi_week_start();
