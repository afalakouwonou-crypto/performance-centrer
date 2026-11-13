-- Annulation de la migration 08, étape 1 sur 2 (RECETTE UNIQUEMENT). Version 2 (revue du 04/11).
-- Sans danger même si le hook d'Auth est encore activé : la fonction du hook n'est pas supprimée, elle est
-- remplacée par une version neutre qui accepte tous les jetons (comportement d'avant la migration).
-- Garde-fous : base de recette uniquement, migration 08 présente, aucune réinitialisation de mot de passe en cours,
-- définitions rétablies vérifiées par empreinte avant validation (sinon tout est annulé).
--
-- EFFETS EXACTS
-- Rétabli à l'identique : my_role(), my_platform() (md5 de production eda685c7…, 8c8d1c42…) et les 2 règles de
--   lecture « active users can read own profile » (profiles) et « wakabi06 read assignments » (profile_platforms).
-- Supprimé : les 4 déclencheurs et 18 fonctions créés par 08 (hors hook) ; la règle du lundi, la révocation par
--   sessions_valid_after et le mot de passe provisoire en 3 étapes cessent ; la fonction Edge ne fonctionne plus.
-- Conservé (rien n'est perdu) :
--   - colonnes de profiles username, sessions_valid_after, provisional_pending_at, provisional_op, avec leurs
--     valeurs, leur contrainte de format et leur index unique ; elles n'ont aucun effet sans la migration ;
--   - l'historique des tentatives : la table wakabi_login_attempts est RENOMMÉE en
--     wakabi_login_attempts_annulee_AAAAMMJJHHMMSS (aucun droit navigateur), pas supprimée ;
--   - la table wakabi_m08_state (état d'origine, nécessaire à l'étape 2 et à une réinstallation) ;
--   - la fonction du hook, en version neutre, et le droit USAGE du rôle supabase_auth_admin sur le schéma public
--     (nécessaire tant que le hook peut être appelé). L'étape 2 les retire, une fois le hook désactivé.
-- Non modifié par ce script : les comptes bloqués dans Auth (ban) par la fonction Edge restent bloqués ;
--   les mots de passe d'Auth ; must_change_password ; les droits des tables, colonnes et des autres fonctions.
begin;
set local lock_timeout = '5s';
do $check$
declare
  v_pending int;
begin
  if exists (select 1 from public.contents where title not like '[RECETTE]%')
     and current_setting('wakabi.copie_locale', true) is distinct from 'oui' then
    raise exception 'Base contenant de vrais contenus : annulation réservée à la RECETTE. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.wakabi_srv_login_begin(text,text)') is null or to_regclass('public.wakabi_login_attempts') is null
     or to_regclass('public.wakabi_m08_state') is null then
    raise exception 'Migration 08 absente ou déjà annulée : rien n''a été modifié.';
  end if;
  select count(*) into v_pending from public.profiles where provisional_pending_at > now() - interval '15 minutes';
  if v_pending > 0 then
    raise exception 'Réinitialisation de mot de passe en cours pour % membre(s) : réessayez dans 15 minutes. Rien n''a été modifié.', v_pending;
  end if;
end $check$;

-- 1. Hook neutre (accepte tout jeton, comme avant la migration) : aucune coupure de connexion possible.
create or replace function public.wakabi_access_token_hook(event jsonb)
returns jsonb language sql stable set search_path = '' as $$ select jsonb_build_object('claims', event -> 'claims') $$;
revoke all on function public.wakabi_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.wakabi_access_token_hook(jsonb) to supabase_auth_admin;

-- 2. Définitions d'origine.
create or replace function public.my_role() returns public.wakabi_role language sql stable security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password $$;
create or replace function public.my_platform() returns public.wakabi_platform language sql stable security definer set search_path='' as $$ select platform from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password $$;
alter policy "active users can read own profile" on public.profiles
  using ((id = auth.uid()) or (public.my_role() = any (array['editor'::public.wakabi_role, 'direction'::public.wakabi_role, 'admin'::public.wakabi_role])));
alter policy "wakabi06 read assignments" on public.profile_platforms
  using ((profile_id = auth.uid()) or (public.my_role() = any (array['admin'::public.wakabi_role, 'editor'::public.wakabi_role, 'direction'::public.wakabi_role])));

-- 3. Objets de la migration (hors hook).
drop trigger wakabi_profiles_username_guard on public.profiles;
drop trigger wakabi_profiles_sessions on public.profiles;
drop trigger wakabi_profiles_provisional on public.profiles;
drop function public.wakabi_srv_access_state(uuid, uuid);
drop function public.wakabi_srv_password_reset_abort(uuid, uuid, uuid);
drop function public.wakabi_srv_password_reset_end(uuid, uuid, uuid);
drop function public.wakabi_srv_password_reset_begin(uuid, uuid);
drop function public.wakabi_srv_setup_profile(uuid, uuid, text, text, public.wakabi_role, text, public.wakabi_country, public.wakabi_platform, uuid[]);
drop function public.wakabi_srv_act_as(uuid);
drop function public.wakabi_srv_recovery_email(text, text);
drop function public.wakabi_srv_login_end(bigint, boolean);
drop function public.wakabi_srv_login_begin(text, text);
drop function public.wakabi_username_suggestion(text);
drop function public.wakabi_am_admin();
drop function public.wakabi_session_status();
drop function public.wakabi_self_fresh();
drop function public.wakabi_session_fresh(timestamptz, jsonb);
drop function public.wakabi_auth_time(jsonb);
drop function public.wakabi_week_start(timestamptz);
drop function public.wakabi_profiles_provisional();
drop function public.wakabi_profiles_sessions();
drop function public.wakabi_profiles_username_guard();

-- 4. Historique des tentatives conservé sous un autre nom.
--    Ses index et sa séquence sont renommés avec le même suffixe (une réinstallation reste possible).
do $r$
declare
  v_suffix text := '_annulee_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v record;
begin
  for v in select i.indexrelid::regclass::text as name, c.relname from pg_index i join pg_class c on c.oid = i.indexrelid
             where i.indrelid = 'public.wakabi_login_attempts'::regclass loop
    execute format('alter index public.%I rename to %I', v.relname, left(v.relname, 63 - length(v_suffix)) || v_suffix);
  end loop;
  for v in select s.relname from pg_depend d join pg_class s on s.oid = d.objid
             where d.refobjid = 'public.wakabi_login_attempts'::regclass and s.relkind = 'S' loop
    execute format('alter sequence public.%I rename to %I', v.relname, left(v.relname, 63 - length(v_suffix)) || v_suffix);
  end loop;
  execute format('alter table public.wakabi_login_attempts rename to %I', 'wakabi_login_attempts' || v_suffix);
end $r$;
insert into public.wakabi_m08_state(key, value) values ('annulled_at', now()::text)
on conflict (key) do update set value = excluded.value, noted_at = now();

-- 5. Contrôle avant validation : sinon tout est annulé.
do $verif$ begin
  if md5((select prosrc from pg_proc where oid = 'public.my_role()'::regprocedure)) <> 'eda685c7f21533f58a04c64de0c7f54e'
     or md5((select prosrc from pg_proc where oid = 'public.my_platform()'::regprocedure)) <> '8c8d1c4285535f51f46f4720aac310ea' then
    raise exception 'Empreinte de my_role()/my_platform() inattendue : annulation abandonnée, rien n''a été modifié.';
  end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'active users can read own profile')
       is distinct from '((id = auth.uid()) OR (my_role() = ANY (ARRAY[''editor''::wakabi_role, ''direction''::wakabi_role, ''admin''::wakabi_role])))'
     or (select qual from pg_policies where schemaname = 'public' and tablename = 'profile_platforms' and policyname = 'wakabi06 read assignments')
       is distinct from '((profile_id = auth.uid()) OR (my_role() = ANY (ARRAY[''admin''::wakabi_role, ''editor''::wakabi_role, ''direction''::wakabi_role])))' then
    raise exception 'Règles de lecture non rétablies à l''identique : annulation abandonnée, rien n''a été modifié.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and (proname like 'wakabi_srv%' or proname in ('wakabi_session_status','wakabi_am_admin','wakabi_self_fresh',
                    'wakabi_username_suggestion','wakabi_week_start','wakabi_auth_time','wakabi_session_fresh'))) then
    raise exception 'Fonctions de la migration 08 encore présentes : annulation abandonnée.';
  end if;
end $verif$;
commit;
-- Contrôles (à lancer après) :
-- select proname, md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname in ('my_role','my_platform');
-- select tablename, policyname, qual from pg_policies where policyname in ('active users can read own profile','wakabi06 read assignments');
-- Comptes encore bloqués dans Auth (à débloquer si besoin dans Authentication > Users) :
-- select email, banned_until from auth.users where banned_until > now();
