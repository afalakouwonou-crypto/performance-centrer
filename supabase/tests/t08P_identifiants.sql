-- Tests de la migration 08P sur la copie locale (données fictives). Tout est annulé à la fin (rollback).
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/t08P_identifiants.sql   (une ligne « OK » par test ; arrêt au premier échec)
\set ON_ERROR_STOP 1
begin;
create function pg_temp.as_user(p_email text, p_auth timestamptz) returns void language plpgsql security definer as $$
declare v uuid; begin
  select id into v from public.profiles where email = p_email;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', case when p_auth is null then jsonb_build_object('sub', v, 'role', 'authenticated')
     else jsonb_build_object('sub', v, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from p_auth)::bigint))) end::text, true);
end $$;
create function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'ÉCHEC : %', p_name; end if; raise notice 'OK  %', p_name; end $$;
create function pg_temp.ws() returns timestamptz language sql security definer as $$ select public.wakabi_week_start() $$;
grant execute on function pg_temp.as_user(text, timestamptz), pg_temp.ok(text, boolean), pg_temp.ws() to anon, authenticated, service_role;

-- A. Identifiants attribués aux comptes existants
select pg_temp.ok('A1 tous les profils ont un identifiant', not exists (select 1 from public.profiles where username is null));
select pg_temp.ok('A2 identifiants uniques', (select count(distinct username) from public.profiles) = (select count(*) from public.profiles));
select pg_temp.ok('A3 sans accent : clemence', exists (select 1 from public.profiles where email = 'tiktok@local.test' and username = 'clemence'));
select pg_temp.ok('A4 format respecté', not exists (select 1 from public.profiles where username !~ '^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$'));
do $$ begin
  begin update public.profiles set username = 'autre' where email = 'tiktok@local.test'; raise exception 'pas de refus';
  exception when others then if sqlerrm = 'pas de refus' then raise exception 'ÉCHEC : A5 identifiant modifiable'; end if; end;
  raise notice 'OK  A5 un identifiant attribué ne peut plus être modifié';
end $$;

-- B. Début de semaine (Lomé = UTC+0)
select pg_temp.ok('B1 mardi -> lundi 00:00', public.wakabi_week_start('2026-11-03 10:00+00') = '2026-11-02 00:00+00');
select pg_temp.ok('B2 lundi 00:00 pile', public.wakabi_week_start('2026-11-09 00:00+00') = '2026-11-09 00:00+00');
select pg_temp.ok('B3 lundi 00:30 au Bénin = dimanche 23:30 à Lomé', public.wakabi_week_start('2026-11-09 00:30+01') = '2026-11-02 00:00+00');

-- C. Sessions : de la semaine, d'avant le lundi, sans heure d'authentification
set local role authenticated;
select pg_temp.as_user('tiktok@local.test', now() - interval '1 minute');
select pg_temp.ok('C1 session de la semaine : rôle', public.my_role() = 'platform_manager');
select pg_temp.ok('C2 session de la semaine : 9 contenus lisibles', (select count(*) from public.contents) = 9);
select pg_temp.ok('C3 statut ok', public.wakabi_session_status() = 'ok');
select pg_temp.ok('C4 un responsable ne lit que son profil', (select count(*) from public.profiles) = 1);
select pg_temp.as_user('tiktok@local.test', pg_temp.ws() - interval '1 second');
select pg_temp.ok('C5 authentifiée avant lundi 00:00 : aucun rôle', public.my_role() is null);
select pg_temp.ok('C6 avant lundi : aucun contenu', (select count(*) from public.contents) = 0);
select pg_temp.ok('C7 avant lundi : statut week', public.wakabi_session_status() = 'week');
select pg_temp.as_user('tiktok@local.test', null);
select pg_temp.ok('C8 jeton sans heure d''authentification : aucun rôle', public.my_role() is null);
select pg_temp.as_user('redaction@local.test', now() - interval '1 minute');
select pg_temp.ok('C9 la rédaction lit tous les profils', (select count(*) from public.profiles) = 7);

-- D. Départ : désactivation -> sessions antérieures refusées, même après réactivation
reset role;
update public.profiles set active = false where email = 'instagram@local.test';
select pg_temp.ok('D1 désactivation : date de révocation posée', (select sessions_valid_after from public.profiles where email = 'instagram@local.test') is not null);
update public.profiles set active = true where email = 'instagram@local.test';
set local role authenticated;
select pg_temp.as_user('instagram@local.test', now() - interval '1 hour');
select pg_temp.ok('D2 ancienne session après réactivation : refusée (revoked)', public.wakabi_session_status() = 'revoked' and public.my_role() is null);
select pg_temp.as_user('instagram@local.test', now() + interval '1 second');
select pg_temp.ok('D3 nouvelle connexion : acceptée', public.my_role() = 'platform_manager');

-- E. Tentatives de connexion (fonction serveur, rôle service_role)
reset role;
set local role service_role;
select pg_temp.ok('E1 identifiant inconnu : autorisé, sans email (aucune énumération)', (select (r ->> 'allowed')::boolean and r ->> 'email' is null from public.wakabi_srv_login_begin('inconnu', '1.1.1.1') r));
select pg_temp.ok('E2 identifiant connu : email retrouvé côté serveur', (select r ->> 'email' = 'tiktok@local.test' from public.wakabi_srv_login_begin('CLEMENCE', '1.1.1.2') r));
select public.wakabi_srv_login_begin('margot', '2.2.2.' || g) from generate_series(1, 5) g;
select pg_temp.ok('E3 6e essai en 15 min sur le même identifiant : refusé', (select not (r ->> 'allowed')::boolean from public.wakabi_srv_login_begin('margot', '2.2.2.9') r));
reset role;

-- F. Droits : rien pour anon, rien de serveur pour le navigateur connecté
set local role anon;
do $$ begin
  begin perform public.wakabi_srv_login_begin('x', 'y'); raise exception 'pas de refus';
  exception when insufficient_privilege then raise notice 'OK  F1 anon ne peut pas appeler les fonctions serveur'; end;
end $$;
reset role;
set local role authenticated;
select pg_temp.as_user('admin@local.test', now());
do $$ begin
  begin perform public.wakabi_srv_login_begin('x', 'y'); raise exception 'pas de refus';
  exception when insufficient_privilege then raise notice 'OK  F2 un compte connecté ne peut pas appeler les fonctions serveur'; end;
end $$;
select pg_temp.ok('F3 suggestion d''identifiant pour l''admin : clemence2', public.wakabi_username_suggestion('clemence') = 'clemence2');
reset role;

-- G. Hook d'accès : jeton d'avant lundi refusé, jeton frais accepté
select pg_temp.ok('G1 hook : jeton d''avant lundi refusé (403)', (public.wakabi_access_token_hook(jsonb_build_object('user_id', (select id from public.profiles where email = 'tiktok@local.test'),
  'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from pg_temp.ws() - interval '1 hour')::bigint))))) -> 'error' ->> 'http_code') = '403');
select pg_temp.ok('G2 hook : jeton frais accepté', (public.wakabi_access_token_hook(jsonb_build_object('user_id', (select id from public.profiles where email = 'tiktok@local.test'),
  'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))))) ? 'claims'));

select 'TOUS LES TESTS 08P RÉUSSIS' as resultat;
rollback;
