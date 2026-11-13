-- R0b_06_06b_07.sql — Base de RECETTE Wakabi (généré le 2026-11-03 par generer_R0.sh).
-- À exécuter UNIQUEMENT dans le projet Supabase de recette. JAMAIS dans la production (dchrvyzdfrvrbdfgvstn).
-- Aucune donnée réelle, aucune clé, aucun mot de passe. Composants (md5) :
--   e693eb2e8d8b778058359d07703fac1c  migrations/06_applique_reference.sql
--   897bbee9955d7f803458a15a39648b40  migrations/06b_correctif_equipe.sql
--   2b8a8188928c37ab19f71c7425b9e2be  migrations/07_dates_effectives.sql

-- Garde-fou : projet de recette uniquement (la production a des contenus ; la recette n'en a aucun à ce stade).
do $g$ begin
  if (select count(*) from public.contents) > 0 or (select count(*) from public.profiles) <> 1 then
    raise exception 'Ce script est réservé au projet de RECETTE neuf : base inattendue, rien n''a été modifié.';
  end if;
end $g$;

-- ===================== migrations/06_applique_reference.sql =====================
-- RÉFÉRENCE UNIQUEMENT — NE PAS EXÉCUTER : migration 06 réellement appliquée et validée en production (2026-11-03),
-- transmise dans le fil le 2026-11-03 (SQL recopié tel quel, entités HTML décodées).
-- État confirmé après COMMIT : 7 profils actifs (1 admin, 1 editor, 1 direction, 4 platform_manager),
-- 9 contenus, 31 publications, 19 metrics, 19 metric_readings.
-- Remplace le fichier 06_equipe_roles.sql (proposition non appliquée, conservée pour mémoire).
begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
do $$ begin
 if to_regclass('public.metric_readings') is null or to_regclass('public.content_objectives') is null or to_regclass('public.profile_platforms') is not null then raise exception 'Prérequis absents ou migration 06 déjà présente'; end if;
 if not exists(select 1 from public.profiles where role='admin' and active) then raise exception 'Aucun administrateur actif'; end if;
end $$;
lock table public.profiles in share row exclusive mode;
create temporary table wakabi06_before on commit drop as select (select count(*) from public.profiles) profiles,(select count(*) from public.contents) contents,(select count(*) from public.publications) publications,(select count(*) from public.metrics) metrics,(select count(*) from public.metric_readings) readings;
alter table public.profiles add column job_title text,add column archived_at timestamptz,add column archived_by uuid references public.profiles(id),add column must_change_password boolean not null default false,add column password_changed_at timestamptz;
alter table public.profiles alter column must_change_password set default true;
alter table public.profiles add constraint wakabi_profile_archive_inactive check(archived_at is null or active=false);
create table public.profile_platforms(id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.profiles(id) on delete restrict,platform_id uuid not null references public.platforms(id) on delete restrict,created_at timestamptz not null default now(),created_by uuid references public.profiles(id),revoked_at timestamptz,unique(profile_id,platform_id));
insert into public.profile_platforms(profile_id,platform_id) select p.id,f.id from public.profiles p join public.platforms f on f.code=p.platform::text;
alter table public.profile_platforms enable row level security;
create or replace function public.my_role() returns public.wakabi_role language sql stable security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password $$;
create or replace function public.my_platform() returns public.wakabi_platform language sql stable security definer set search_path='' as $$ select platform from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password $$;
create function public.wakabi_can_manage_platform(target uuid) returns boolean language sql stable security definer set search_path='' as $$ select coalesce(public.my_role() in ('editor','admin') or (public.my_role()='platform_manager' and exists(select 1 from public.profile_platforms a where a.profile_id=auth.uid() and a.platform_id=target and a.revoked_at is null)),false) $$;
revoke all on function public.wakabi_can_manage_platform(uuid) from public,anon; grant execute on function public.wakabi_can_manage_platform(uuid) to authenticated;
create function public.wakabi_profiles_serialize() returns trigger language plpgsql security definer set search_path='' as $$ begin lock table public.profiles in share row exclusive mode; return null; end $$;
create trigger wakabi_profiles_serialize before update or delete on public.profiles for each statement execute function public.wakabi_profiles_serialize();
create function public.wakabi_profiles_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'Suppression physique interdite : désactiver puis archiver le membre'; end if;
 if new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Identité et date de création immuables'; end if;
 if btrim(new.full_name)='' then raise exception 'Nom obligatoire'; end if;
 if new.archived_at is not null then new.active:=false;
  if old.archived_at is null then new.archived_at:=now(); new.archived_by:=auth.uid(); else new.archived_at:=old.archived_at; new.archived_by:=old.archived_by; end if;
 else new.archived_by:=null; end if;
 if old.role='admin' and old.active and old.archived_at is null and not old.must_change_password and (new.role<>'admin' or not new.active or new.archived_at is not null or new.must_change_password) and not exists(select 1 from public.profiles p where p.id<>old.id and p.role='admin' and p.active and p.archived_at is null and not p.must_change_password) then raise exception 'Le dernier administrateur actif doit être conservé'; end if;
 return new; end $$;
create trigger wakabi_profiles_guard before update or delete on public.profiles for each row execute function public.wakabi_profiles_guard();
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.profiles(id,email,full_name,role,active,must_change_password) values(new.id,new.email,coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),'platform_manager',false,true); return new; end $$;
create function public.wakabi_password_changed() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.profiles set must_change_password=false,password_changed_at=now() where id=new.id; return new; end $$;
create trigger wakabi_password_changed after update of encrypted_password on auth.users for each row when(old.encrypted_password is distinct from new.encrypted_password and coalesce(new.encrypted_password,'')<>'') execute function public.wakabi_password_changed();
grant update(full_name,role,country,platform,active,job_title,archived_at) on public.profiles to authenticated;
create policy "wakabi06 admins update profiles" on public.profiles for update to authenticated using(public.my_role()='admin') with check(public.my_role()='admin');
revoke all on public.profile_platforms from public,anon,authenticated;
grant select,insert on public.profile_platforms to authenticated; grant update(revoked_at) on public.profile_platforms to authenticated; revoke delete,truncate on public.profile_platforms from authenticated,anon;
create policy "wakabi06 read assignments" on public.profile_platforms for select to authenticated using(profile_id=auth.uid() or public.my_role() in ('admin','editor','direction'));
create policy "wakabi06 admins assign" on public.profile_platforms for insert to authenticated with check(public.my_role()='admin');
create policy "wakabi06 admins revoke" on public.profile_platforms for update to authenticated using(public.my_role()='admin') with check(public.my_role()='admin');
create function public.wakabi_assignment_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then if current_user='authenticated' then new.created_by:=auth.uid(); end if; new.created_at:=now();
 elsif (new.id,new.profile_id,new.platform_id,new.created_at,new.created_by) is distinct from (old.id,old.profile_id,old.platform_id,old.created_at,old.created_by) then raise exception 'Révoquer ou réactiver une affectation sans changer son identité'; end if;
 if new.revoked_at is null and not exists(select 1 from public.platforms f where f.id=new.platform_id and f.status='active') then raise exception 'Plateforme inactive'; end if;
 if tg_op='UPDATE' and new.revoked_at is not null and old.revoked_at is null then new.revoked_at:=now(); end if; return new; end $$;
create trigger wakabi_assignment_guard before insert or update on public.profile_platforms for each row execute function public.wakabi_assignment_guard();
create trigger wakabi_log_profile_platforms after insert or update on public.profile_platforms for each row execute function public.wakabi_log_activity();
drop policy "authorized users insert metrics" on public.metrics; drop policy "authorized users update metrics" on public.metrics; drop policy "authorized users insert metric readings" on public.metric_readings;
create policy "authorized users insert metrics" on public.metrics for insert to authenticated with check(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id)));
create policy "authorized users update metrics" on public.metrics for update to authenticated using(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id))) with check(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id)));
create policy "authorized users insert metric readings" on public.metric_readings for insert to authenticated with check(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id)));
revoke all on function public.wakabi_profiles_serialize(),public.wakabi_profiles_guard(),public.wakabi_password_changed(),public.wakabi_assignment_guard() from public,anon,authenticated;
do $$ declare b record; begin select * into b from wakabi06_before;
 if b.profiles<>(select count(*) from public.profiles) or b.contents<>(select count(*) from public.contents) or b.publications<>(select count(*) from public.publications) or b.metrics<>(select count(*) from public.metrics) or b.readings<>(select count(*) from public.metric_readings) then raise exception 'Contrôle de conservation échoué'; end if;
 if exists(select 1 from public.profiles where must_change_password) then raise exception 'Un profil existant a été forcé à changer son mot de passe'; end if;
 if exists(select 1 from public.profiles p where p.platform is not null and not exists(select 1 from public.profile_platforms a join public.platforms f on f.id=a.platform_id where a.profile_id=p.id and f.code=p.platform::text and a.revoked_at is null)) then raise exception 'Reprise des affectations incomplète'; end if;
end $$;
commit;


-- ===================== migrations/06b_correctif_equipe.sql =====================
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


-- ===================== migrations/07_dates_effectives.sql =====================
-- Wakabi Performance Center — Migration 07 : date de publication effective par plateforme
-- STATUT : PRÉPARÉE ET TESTÉE EN LOCAL UNIQUEMENT. NE PAS EXÉCUTER sans :
--   1) le diagnostic réel diagnostics/D07_avant_07_lecture_seule.sql (lecture seule) et l'examen de ses résultats ;
--   2) l'accord explicite d'Andréas.
-- Décisions retenues pour la préparation (options recommandées, 3 novembre 2026) :
--   D1 external_id facultatif ; D2 saisie par la rédaction et l'administrateur (règles existantes) ;
--   D3 pas de statut de diffusion supplémentaire ; D4 « aujourd'hui » = fuseau du pays du contenu.
-- Uniquement additive. Aucune ligne existante n'est modifiée : les publications existantes gardent
-- published_on / published_at / external_id VIDES. Quand la date prévue du contenu sert de repli, la vue
-- l'indique explicitement (basis_source = 'planned_estimate') ; ce n'est jamais présenté comme une date effective.
-- L'ancienne interface continue de fonctionner sans changement (elle n'envoie pas ces colonnes).
-- Annulation : 07_dates_effectives_annulation.sql (garde les colonnes et leurs valeurs).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 0. Garde-fous : migrations 05, 06 et 06b en place ; colonnes encore absentes ou déjà créées par ce script.
do $check$
begin
  if to_regclass('public.metric_readings') is null
     or to_regclass('public.profile_platforms') is null
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_profiles_sync_platform') then
    raise exception 'Migrations 05 / 06 / 06b absentes : migration 07 annulée, rien n''a été modifié.';
  end if;
  -- Relance sûre : une colonne déjà présente doit avoir exactement le type prévu, sinon arrêt.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'publications'
               and column_name in ('published_on','published_at','external_id')
               and not ((column_name = 'published_on' and data_type = 'date')
                     or (column_name = 'published_at' and data_type = 'timestamp with time zone')
                     or (column_name = 'external_id'  and data_type = 'text'))) then
    raise exception 'Une colonne published_on / published_at / external_id existe déjà avec un autre type : migration 07 annulée.';
  end if;
  if to_regclass('public.publications_external_id_key') is not null
     and pg_get_indexdef(to_regclass('public.publications_external_id_key')) <>
         'CREATE UNIQUE INDEX publications_external_id_key ON public.publications USING btree (platform_id, external_id) WHERE (external_id IS NOT NULL)' then
    raise exception 'Un index publications_external_id_key différent existe déjà : migration 07 annulée.';
  end if;
end;
$check$;

-- 1. Trois colonnes facultatives (vides pour toutes les publications existantes).
alter table public.publications add column if not exists published_on date;         -- date effective, jour local du pays du contenu
alter table public.publications add column if not exists published_at timestamptz;  -- heure exacte, seulement si connue
alter table public.publications add column if not exists external_id  text;         -- identifiant sur la plateforme, si connu
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'publications_external_id_not_blank') then
    alter table public.publications add constraint publications_external_id_not_blank
      check (external_id is null or btrim(external_id) <> '');
  end if;
end $c$;
-- Un même identifiant externe ne peut pas désigner deux publications de la même plateforme.
create unique index if not exists publications_external_id_key
  on public.publications (platform_id, external_id) where external_id is not null;

-- 2. Fuseau horaire du pays (D4) et date locale correspondante.
create or replace function public.wakabi_country_tz(p_country public.wakabi_country)
returns text language sql immutable set search_path = '' as $$
  select case p_country::text when 'Togo' then 'Africa/Lome' when 'Bénin' then 'Africa/Porto-Novo' else 'UTC' end
$$;
create or replace function public.wakabi_local_date(p_country public.wakabi_country, p_ts timestamptz default now())
returns date language sql stable set search_path = '' as $$
  select (p_ts at time zone public.wakabi_country_tz(p_country))::date
$$;
-- Exécution réservée à authenticated (PostgreSQL l'accorde à PUBLIC par défaut ; anon n'y a pas accès).
revoke all on function public.wakabi_country_tz(public.wakabi_country), public.wakabi_local_date(public.wakabi_country, timestamptz) from public, anon;
grant execute on function public.wakabi_country_tz(public.wakabi_country), public.wakabi_local_date(public.wakabi_country, timestamptz) to authenticated;

-- 3. Contrôles des dates effectives, revalidés intégralement à chaque changement de date OU de contenu.
--    - pas dans le futur (jour local du pays ; 10 minutes de tolérance pour l'heure) ;
--    - published_at renseignée => published_on doit être son jour local (rempli s'il est vide) ;
--    - pas postérieure au premier relevé J+1 / J+7 déjà enregistré pour cette publication ;
--    - une publication datée ou déjà mesurée ne peut pas être rattachée à un autre contenu.
--    Concurrence : la ligne du contenu est lue FOR SHARE (attend un changement de pays en cours) ; chaque requête
--    de la fonction prend un nouvel instantané (READ COMMITTED), donc les relevés validés pendant l'attente du
--    verrou de la publication sont vus. Le déclencheur des relevés verrouille la publication FOR SHARE (section 4).
-- security definer : le contrôle voit tous les relevés et le contenu, quelles que soient les règles RLS
-- de l'utilisateur (il ne fait que lire et refuser ; il n'écrit rien d'autre que published_on déduit de published_at).
create or replace function public.wakabi_publications_effective_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_country public.wakabi_country;
  v_first   date;
begin
  if tg_op = 'UPDATE' and new.content_id is distinct from old.content_id
     and (old.published_on is not null or old.published_at is not null or new.published_on is not null or new.published_at is not null
          or exists (select 1 from public.metric_readings r where r.publication_id = old.id)) then
    raise exception 'Une publication datée ou déjà mesurée ne peut pas être rattachée à un autre contenu';
  end if;
  if new.published_on is null and new.published_at is null then
    return new;
  end if;
  select c.country into v_country from public.contents c where c.id = new.content_id for share;
  if new.published_at is not null then
    if new.published_at > now() + interval '10 minutes' then
      raise exception 'L''heure de publication ne peut pas être dans le futur';
    end if;
    if new.published_on is null then
      new.published_on := public.wakabi_local_date(v_country, new.published_at);
    elsif new.published_on <> public.wakabi_local_date(v_country, new.published_at) then
      raise exception 'La date et l''heure de publication ne correspondent pas (fuseau %)', public.wakabi_country_tz(v_country);
    end if;
  end if;
  if new.published_on > public.wakabi_local_date(v_country) then
    raise exception 'La date de publication ne peut pas être dans le futur';
  end if;
  select min(r.measured_on) into v_first from public.metric_readings r
   where r.publication_id = new.id and r.reading_type in ('j1','j7');
  if v_first is not null and new.published_on > v_first then
    raise exception 'La date de publication ne peut pas être postérieure au premier relevé (%)', to_char(v_first, 'DD/MM/YYYY');
  end if;
  return new;
end;
$function$;

drop trigger if exists wakabi_publications_effective_date on public.publications;
create trigger wakabi_publications_effective_date before insert or update of published_on, published_at, content_id on public.publications
  for each row execute function public.wakabi_publications_effective_date();

-- 3 bis. Changer le pays d'un contenu revalide les dates de ses publications (le jour local dépend du pays).
--        Les publications sont verrouillées FOR SHARE : un changement de date concurrent attend ou est attendu.
create or replace function public.wakabi_contents_country_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bad record;
begin
  if new.country is not distinct from old.country then
    return null;
  end if;
  perform 1 from public.publications p where p.content_id = new.id for share;
  select p.platform, p.published_on into v_bad from public.publications p
   where p.content_id = new.id
     and ((p.published_at is not null and p.published_on <> public.wakabi_local_date(new.country, p.published_at))
          or p.published_on > public.wakabi_local_date(new.country))
   limit 1;
  if found then
    raise exception 'Changement de pays impossible : la date de publication % (%) deviendrait incohérente avec le fuseau %',
      to_char(v_bad.published_on, 'DD/MM/YYYY'), v_bad.platform, public.wakabi_country_tz(new.country);
  end if;
  return null;
end;
$function$;

drop trigger if exists wakabi_contents_country_dates on public.contents;
create trigger wakabi_contents_country_dates after update of country on public.contents
  for each row execute function public.wakabi_contents_country_dates();

-- 4. Un relevé J+1 / J+7 saisi depuis l'application ne peut pas être daté d'avant la publication effective
--    (déclencheur ajouté : la fonction de la migration 05 n'est pas modifiée ; son nom le fait passer APRÈS
--    wakabi_metric_readings_before_insert, qui impose origin = 'direct' pour l'application).
--    Concurrence : la publication est lue FOR SHARE. Si sa date est en cours de modification, l'insertion attend
--    la fin de l'autre transaction et relit la date validée ; inversement, la modification de date attend la fin
--    de l'insertion et voit alors le relevé (voir section 3).
create or replace function public.wakabi_metric_readings_publication_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pub date;
begin
  if new.origin = 'direct' and new.reading_type in ('j1','j7') then
    select p.published_on into v_pub from public.publications p where p.id = new.publication_id for share;
    if v_pub is not null and new.measured_on < v_pub then
      raise exception 'Le relevé ne peut pas être daté d''avant la publication (%)', to_char(v_pub, 'DD/MM/YYYY');
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists wakabi_metric_readings_publication_date on public.metric_readings;
create trigger wakabi_metric_readings_publication_date before insert on public.metric_readings
  for each row execute function public.wakabi_metric_readings_publication_date();

revoke all on function public.wakabi_publications_effective_date(), public.wakabi_metric_readings_publication_date(),
  public.wakabi_contents_country_dates() from public, anon, authenticated;

-- 5. Échéances par publication (security_invoker : applique les droits de l'utilisateur connecté).
--    basis_source : 'effective' (published_on renseignée) ou 'planned_estimate' (repli sur la date prévue du contenu).
--    J+1 : 'done' (pris à temps : au plus tard le lendemain de l'échéance) / 'done_late' / 'upcoming' / 'due' /
--          'late' (lendemain de l'échéance) / 'missed' (non saisi après J+2 : écart à suivre, aucune donnée inventée) /
--          'not_tracked' (échéance antérieure au 30/10/2026, date de création des relevés J+1 par la migration 05).
--    J+7 : 'done' (mesuré au plus tard le lendemain de l'échéance) / 'done_late' (mesuré plus tard : c'est le cas des
--          19 relevés repris de l'ancienne table, mesurés 9 à 20 jours après la date prévue) / 'upcoming' / 'due' /
--          'late' (reste à saisir tant qu'il manque).
--    j1_offset_days / j7_offset_days : jours réels entre la date de départ et la mesure (ex. 14 = mesuré à J+14) ;
--    j7_origin : origine du relevé J+7 (metrics_legacy = repris de l'ancienne table). Rien n'est recalculé ni déplacé.
--    ATTENTION : avec basis_source = 'planned_estimate', les décalages et les états done / done_late sont ESTIMÉS
--    depuis la date prévue, pas depuis une publication prouvée ; l'interface doit l'afficher comme tel.
create or replace view public.publication_schedule
with (security_invoker = true) as
with base as (
  select p.id as publication_id, p.content_id, p.platform, p.platform_id, c.country,
         (c.archived_at is not null) as content_archived,
         p.published_on, p.published_at, p.external_id, c.publish_date as planned_date,
         coalesce(p.published_on, c.publish_date) as basis_date,
         case when p.published_on is not null then 'effective' else 'planned_estimate' end as basis_source,
         public.wakabi_local_date(c.country) as local_today,
         (select r.measured_on from public.metric_readings r
           where r.publication_id = p.id and r.reading_type = 'j1' and r.corrects_reading_id is null) as j1_measured_on,
         (select r.measured_on from public.metric_readings r
           where r.publication_id = p.id and r.reading_type = 'j7' and r.corrects_reading_id is null) as j7_measured_on,
         (select r.origin from public.metric_readings r
           where r.publication_id = p.id and r.reading_type = 'j7' and r.corrects_reading_id is null) as j7_origin
  from public.publications p
  join public.contents c on c.id = p.content_id
)
select b.*, b.basis_date + 1 as j1_due, b.basis_date + 7 as j7_due,
       b.j1_measured_on - b.basis_date as j1_offset_days, b.j7_measured_on - b.basis_date as j7_offset_days,
       case
         when b.j1_measured_on is not null then case when b.j1_measured_on <= b.basis_date + 2 then 'done' else 'done_late' end
         when b.basis_date + 1 < date '2026-10-30' then 'not_tracked'
         when b.local_today < b.basis_date + 1 then 'upcoming'
         when b.local_today = b.basis_date + 1 then 'due'
         when b.local_today = b.basis_date + 2 then 'late'
         else 'missed'
       end as j1_state,
       case
         when b.j7_measured_on is not null then case when b.j7_measured_on <= b.basis_date + 8 then 'done' else 'done_late' end
         when b.local_today < b.basis_date + 7 then 'upcoming'
         when b.local_today = b.basis_date + 7 then 'due'
         else 'late'
       end as j7_state
from base b;

revoke all on public.publication_schedule from public, anon, authenticated;
grant select on public.publication_schedule to authenticated;

commit;

-- Vérifications (à lancer après, dans une nouvelle requête) :
-- 1) doit renvoyer 3 lignes : external_id, published_at, published_on
-- select column_name from information_schema.columns where table_schema='public' and table_name='publications'
--  and column_name in ('published_on','published_at','external_id') order by 1;
-- 2) doit renvoyer 0 0 0 (aucune publication existante modifiée)
-- select count(published_on), count(published_at), count(external_id) from public.publications;
-- 3) doit renvoyer 3 lignes
-- select tgname from pg_trigger where tgname in ('wakabi_publications_effective_date','wakabi_metric_readings_publication_date','wakabi_contents_country_dates');
-- 3 bis) aucun droit pour PUBLIC ni anon sur la vue (attendu : authenticated | SELECT seulement)
-- select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='publication_schedule';
-- 4) doit renvoyer planned_estimate | 31 (D07 : 31 publications, aucune date effective)
-- select basis_source, count(*) from public.publication_schedule group by 1;
-- 6) relevés historiques : attendu metrics_legacy | done_late | 19, décalages entre 9 et 20 jours (D07/E6), jamais déplacés
-- select j7_origin, j7_state, count(*), min(j7_offset_days), max(j7_offset_days) from public.publication_schedule
--  where j7_measured_on is not null group by 1, 2;
-- 5) les effectifs de profiles, contents, publications, metrics et metric_readings doivent être identiques à ceux d'avant.

