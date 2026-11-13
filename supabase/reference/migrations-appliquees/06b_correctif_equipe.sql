-- Wakabi Performance Center — Migration 06b : correctif minimal de la migration 06 appliquée
-- (référence : 06_applique_reference.sql). À exécuter dans Supabase > SQL Editor, en une seule fois.
-- Entièrement réversible (voir 06b_correctif_equipe_annulation.sql) ; n'ajoute AUCUNE valeur d'enum.
-- Ne modifie et ne supprime aucune donnée : aucune ligne de profiles ni de profile_platforms n'est changée par ce script.
--
-- Corrige :
--  1. Droits sur profiles (DURCISSEMENT DÉFENSIF, pas une faille observée) : le diagnostic D06 du 3 novembre 2026
--     confirme qu'en production authenticated n'a que SELECT au niveau table, anon aucun droit, et que seules
--     les 7 colonnes de la migration 06 sont modifiables. Le REVOKE ne change donc rien en production ;
--     il garantit seulement que ce sera toujours vrai. Seul ajout réel : la colonne must_change_password
--     devient modifiable par l'administrateur (voir point 4).
--  2. Affectations (profile_platforms) : une date de révocation déjà posée pouvait être réécrite
--     (ex. antidatée). Elle devient immuable tant que l'affectation n'est pas réactivée.
--  3. profiles.platform (plateforme principale utilisée par l'application actuelle) reste cohérente avec
--     les affectations : la changer réactive / crée l'affectation correspondante et révoque logiquement
--     l'ancienne ; l'affectation de la plateforme principale ne peut pas être révoquée directement.
--  4. Mot de passe : l'administrateur peut RÉIMPOSER un changement de mot de passe (must_change_password = true)
--     depuis l'application ; le navigateur ne peut JAMAIS lever cette obligation. Seuls Supabase Auth
--     (déclencheur wakabi_password_changed, après un vrai changement) et le SQL Editor peuvent la lever.
--     La protection du dernier administrateur (migration 06) s'applique aussi à ce drapeau.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 0. Garde-fous : migration 06 (version appliquée) en place, aucun écart actuel plateforme principale / affectations.
do $check$
begin
  if to_regclass('public.profile_platforms') is null
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_profiles_guard')
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_assignment_guard')
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_password_changed')
     or to_regprocedure('public.wakabi_can_manage_platform(uuid)') is null then
    raise exception 'Migration 06 absente : migration 06b annulée, rien n''a été modifié.';
  end if;
  if exists (select 1 from public.profiles p where p.platform is not null and not exists (
               select 1 from public.profile_platforms a join public.platforms f on f.id = a.platform_id
               where a.profile_id = p.id and f.code = p.platform::text and a.revoked_at is null)) then
    raise exception 'Une plateforme principale n''a pas d''affectation active : migration 06b annulée.';
  end if;
end;
$check$;

-- 1. profiles : seules les colonnes prévues restent modifiables depuis l'application
--    (la règle RLS « wakabi06 admins update profiles » réserve toujours ces modifications à l'administrateur).
--    Aucune création ni suppression depuis l'application. La lecture (SELECT) est inchangée.
revoke insert, update, delete, truncate, references, trigger on public.profiles from anon, authenticated;
grant update (full_name, role, country, platform, active, job_title, archived_at, must_change_password) on public.profiles to authenticated;

-- 4. Depuis l'application (rôles anon / authenticated), must_change_password peut passer à true, jamais à false.
--    Fonction NON security definer : current_user est bien le rôle de la requête.
create or replace function public.wakabi_profiles_password_flag()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') and old.must_change_password and not new.must_change_password then
    raise exception 'L''obligation de changer de mot de passe ne peut être levée que par un vrai changement de mot de passe';
  end if;
  return new;
end;
$function$;
revoke all on function public.wakabi_profiles_password_flag() from public, anon, authenticated;
drop trigger if exists wakabi_profiles_password_flag on public.profiles;
create trigger wakabi_profiles_password_flag before update of must_change_password on public.profiles
  for each row execute function public.wakabi_profiles_password_flag();

-- 2. et 3. Affectations : même fonction que la migration 06, avec deux contrôles en plus
--    (date de révocation immuable ; plateforme principale non révocable directement).
create or replace function public.wakabi_assignment_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then new.created_by := auth.uid(); end if;
    new.created_at := now();
  elsif (new.id, new.profile_id, new.platform_id, new.created_at, new.created_by)
        is distinct from (old.id, old.profile_id, old.platform_id, old.created_at, old.created_by) then
    raise exception 'Révoquer ou réactiver une affectation sans changer son identité';
  end if;
  if new.revoked_at is null and not exists (select 1 from public.platforms f where f.id = new.platform_id and f.status = 'active') then
    raise exception 'Plateforme inactive';
  end if;
  if tg_op = 'UPDATE' and new.revoked_at is not null then
    if old.revoked_at is null then
      if exists (select 1 from public.profiles p join public.platforms f on f.code = p.platform::text
                 where p.id = new.profile_id and f.id = new.platform_id) then
        raise exception 'C''est la plateforme principale de ce membre : changez d''abord sa plateforme principale';
      end if;
      new.revoked_at := now();
    else
      new.revoked_at := old.revoked_at;   -- une révocation déjà enregistrée ne peut pas être redatée
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.wakabi_assignment_guard() from public, anon, authenticated;

-- 3. Changer la plateforme principale met à jour les affectations (journalisé via wakabi_log_profile_platforms).
create or replace function public.wakabi_profiles_sync_platform()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.platform is not distinct from old.platform then
    return null;
  end if;
  if old.platform is not null then
    update public.profile_platforms a set revoked_at = now()
      from public.platforms f
     where a.profile_id = new.id and f.id = a.platform_id and f.code = old.platform::text and a.revoked_at is null;
  end if;
  if new.platform is not null then
    insert into public.profile_platforms (profile_id, platform_id, created_by)
    select new.id, f.id, auth.uid() from public.platforms f where f.code = new.platform::text
    on conflict (profile_id, platform_id) do update set revoked_at = null
      where public.profile_platforms.revoked_at is not null;
  end if;
  return null;
end;
$function$;
revoke all on function public.wakabi_profiles_sync_platform() from public, anon, authenticated;

drop trigger if exists wakabi_profiles_sync_platform on public.profiles;
create trigger wakabi_profiles_sync_platform after update of platform on public.profiles
  for each row execute function public.wakabi_profiles_sync_platform();

commit;

-- Vérifications (à lancer après, dans une nouvelle requête) :
-- 1) doit renvoyer une seule ligne : authenticated | SELECT (aucune ligne pour anon, qui n'a aucun droit)
-- select grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon','authenticated') group by 1;
-- 2) doit renvoyer exactement : active, archived_at, country, full_name, job_title, must_change_password, platform, role
-- select string_agg(column_name, ', ' order by column_name) from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE';
-- 3) doit renvoyer 2 lignes
-- select tgname from pg_trigger where tgname in ('wakabi_profiles_sync_platform', 'wakabi_profiles_password_flag');
-- 4) doit renvoyer 0 (aucun écart plateforme principale / affectation active) et 4 affectations actives
-- select (select count(*) from public.profiles p where p.platform is not null and not exists (
--           select 1 from public.profile_platforms a join public.platforms f on f.id = a.platform_id
--           where a.profile_id = p.id and f.code = p.platform::text and a.revoked_at is null)) as ecarts,
--        (select count(*) from public.profile_platforms where revoked_at is null) as affectations_actives;
-- 5) doit renvoyer 7 | 4 (aucun profil ni affectation modifié)
-- select (select count(*) from public.profiles where active and archived_at is null and not must_change_password),
--        (select count(*) from public.profile_platforms);
