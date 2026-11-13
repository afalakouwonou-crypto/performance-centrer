-- Tests de la migration 08 (copie locale). Tout est annulé à la fin (rollback).
\set ON_ERROR_STOP 1
begin;
create function pg_temp.as_user(p_email text, p_auth timestamptz) returns void language plpgsql security definer as $$
declare v uuid; begin
  select id into v from public.profiles where email like p_email;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', case when p_auth is null then jsonb_build_object('sub', v)
     else jsonb_build_object('sub', v, 'role','authenticated', 'iat', extract(epoch from now())::bigint,
          'amr', jsonb_build_array(jsonb_build_object('method','password','timestamp', extract(epoch from p_auth)::bigint))) end::text, true);
end $$;
create function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'ÉCHEC : %', p_name; end if; raise notice 'OK  %', p_name; end $$;
create function pg_temp.tiktok_pub() returns uuid language sql security definer as $$ select p.id from public.publications p where p.platform='TikTok' and p.content_id='a0000000-0000-0000-0000-000000000006' $$;
grant execute on function pg_temp.tiktok_pub() to authenticated;
create function pg_temp.ws() returns timestamptz language sql security definer as $$ select public.wakabi_week_start() $$;
grant execute on function pg_temp.ws() to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function pg_temp.as_user(text, timestamptz), pg_temp.ok(text, boolean) to anon, authenticated, service_role;
update public.profiles set username = split_part(split_part(email,'+',2),'@',1) where email like 'afalakouwonou+%';
update public.profiles set username = 'r-admin' where email like 'test+r-admin%';

-- A. Début de semaine (Africa/Lome = UTC+0)
select pg_temp.ok('A1 mardi -> lundi 00:00', public.wakabi_week_start('2026-11-03 10:00+00') = '2026-11-02 00:00+00');
select pg_temp.ok('A2 lundi 00:00 pile', public.wakabi_week_start('2026-11-09 00:00+00') = '2026-11-09 00:00+00');
select pg_temp.ok('A3 dimanche 23:59:59', public.wakabi_week_start('2026-11-08 23:59:59+00') = '2026-11-02 00:00+00');
select pg_temp.ok('A4 heure du Bénin 00:30 lundi = dimanche 23:30 à Lomé', public.wakabi_week_start('2026-11-09 00:30+01') = '2026-11-02 00:00+00');

-- B/C/D/E. Session fraîche, d'avant le lundi, renouvelée, sans amr
set local role authenticated;
select pg_temp.as_user('%r-tiktok%', now() - interval '1 minute');
select pg_temp.ok('B1 session de la semaine : rôle', public.my_role() = 'platform_manager');
select pg_temp.ok('B2 session de la semaine : 8 contenus', (select count(*) from public.contents) = 8);
select pg_temp.ok('B3 statut ok', public.wakabi_session_status() = 'ok');
select pg_temp.as_user('%r-tiktok%', pg_temp.ws() - interval '1 second');
select pg_temp.ok('C1 authentifiée avant lundi 00:00 : aucun rôle', public.my_role() is null);
select pg_temp.ok('C2 avant lundi : aucun contenu', (select count(*) from public.contents) = 0);
select pg_temp.ok('C3 avant lundi : aucun relevé lisible', (select count(*) from public.metric_readings) = 0);
select pg_temp.ok('C4 statut week', public.wakabi_session_status() = 'week');
select pg_temp.ok('C5 avant lundi : son propre profil n''est plus lisible', (select count(*) from public.profiles) = 0);
select pg_temp.ok('C5b avant lundi : ses propres affectations ne sont plus lisibles', (select count(*) from public.profile_platforms) = 0);
select pg_temp.as_user('%r-tiktok%', pg_temp.ws());
select pg_temp.ok('D1 authentifiée lundi 00:00 pile : accès', public.my_role() = 'platform_manager');
select pg_temp.as_user('%r-tiktok%', null);
select pg_temp.ok('E1 jeton sans amr : refusé', public.my_role() is null and public.wakabi_session_status() = 'week');
-- Écriture refusée avec une session d'avant lundi
select pg_temp.as_user('%r-tiktok%', pg_temp.ws() - interval '1 hour');
do $$ begin
  insert into public.metric_readings(publication_id, reading_type, views, likes, comments, shares, measured_on)
  values (pg_temp.tiktok_pub(), 'j1', 1, 0, 0, 0, current_date);
  raise exception 'ÉCHEC : C6 insertion acceptée';
exception when insufficient_privilege or check_violation then raise notice 'OK  C6 saisie refusée avec une session d''avant lundi';
  when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  C6 saisie refusée (%)', sqlerrm;
end $$;
reset role;

-- F. Départ avec session ouverte, puis remplaçante
select pg_temp.as_user('%r-admin%', now() - interval '1 minute');
update public.profiles set archived_at = now() where email like '%r-tiktok%';
select pg_temp.ok('F1 retrait : sessions révoquées', (select sessions_valid_after = now() and not active from public.profiles where email like '%r-tiktok%'));
set local role authenticated;
select pg_temp.as_user('%r-tiktok%', now() - interval '1 minute');
select pg_temp.ok('F2 jeton encore valide après départ : aucun rôle', public.my_role() is null);
select pg_temp.ok('F3 après départ : aucun contenu', (select count(*) from public.contents) = 0);
select pg_temp.ok('F4 statut archived', public.wakabi_session_status() = 'archived');
reset role;
update public.profiles set archived_at = null where email like '%r-tiktok%';
update public.profiles set active = true where email like '%r-tiktok%';
set local role authenticated;
select pg_temp.as_user('%r-tiktok%', now() - interval '1 minute');
select pg_temp.ok('F5 réactivé : l''ancienne session reste refusée (revoked)', public.my_role() is null and public.wakabi_session_status() = 'revoked');
select pg_temp.as_user('%r-tiktok%', now() + interval '1 second');
select pg_temp.ok('F6 réactivé : nouvelle connexion acceptée', public.my_role() = 'platform_manager');
reset role;
-- Désactivation simple (sans retrait)
update public.profiles set active = false where email like '%r-multi%';
set local role authenticated;
select pg_temp.as_user('%r-multi%', now() - interval '1 minute');
select pg_temp.ok('F7 désactivé : refusé (inactive)', public.my_role() is null and public.wakabi_session_status() = 'inactive');
reset role;

-- G. Remplaçante : nouveau compte, identifiant distinct, historique conservé
insert into auth.users(email, encrypted_password) values ('afalakouwonou+r-tiktok2@gmail.com', 'x');
set local role authenticated; select pg_temp.as_user('%r-admin%', now());
select pg_temp.ok('G0 suggestion d''identifiant libre (doublon)', public.wakabi_username_suggestion('r-tiktok') = 'r-tiktok2');
reset role;
select public.wakabi_srv_setup_profile((select id from public.profiles where username='r-admin'),
  (select id from public.profiles where email like '%r-tiktok2%'), 'R-TikTok2', 'Remplaçante TikTok', 'platform_manager', null, 'Togo',
  'TikTok', array[(select id from public.platforms where code='TikTok')]);
select pg_temp.ok('G1 nouvel identifiant en minuscules, actif, mot de passe à changer',
  (select username='r-tiktok2' and active and must_change_password from public.profiles where email like '%r-tiktok2%'));
select pg_temp.ok('G2 affectation TikTok active', (select count(*) from public.profile_platforms a join public.profiles p on p.id=a.profile_id
  where p.username='r-tiktok2' and a.revoked_at is null) = 1);
select pg_temp.ok('G3 journal : auteur réel = administrateur', exists (select 1 from public.activity_log l join public.profiles p on p.id = l.actor_id
  where p.username='r-admin' and l.table_name='profiles' and l.row_id=(select id from public.profiles where username='r-tiktok2')));
select pg_temp.ok('G4 relevé saisi par l''ancien compte toujours attribué à lui',
  (select count(*) from public.metric_readings r join public.profiles p on p.id=r.entered_by where p.username='r-admin') >= 1);
set local role authenticated;
select pg_temp.as_user('%r-tiktok2%', now());
select pg_temp.ok('G5 remplaçante : accès bloqué tant que le mot de passe provisoire n''est pas changé', public.my_role() is null and public.wakabi_session_status()='must_change');
reset role;
update public.profiles set must_change_password = false where username = 'r-tiktok2';  -- simule wakabi_password_changed
set local role authenticated;
select pg_temp.as_user('%r-tiktok2%', now());
select pg_temp.ok('G6 après changement du mot de passe : accès', public.my_role() = 'platform_manager');
reset role;
do $$ begin
  perform public.wakabi_srv_setup_profile((select id from public.profiles where username='r-admin'),
    (select id from public.profiles where username='r-redac'), 'r-tiktok2', 'X', 'editor', null, null, null, null);
  raise exception 'ÉCHEC : G7';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  G7 doublon d''identifiant refusé (%)', sqlerrm; end $$;
do $$ begin
  perform public.wakabi_srv_setup_profile((select id from public.profiles where username='r-redac'),
    (select id from public.profiles where email like '%r-tiktok2%'), 'zz', 'X', 'admin', null, null, null, null);
  raise exception 'ÉCHEC : G8';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  G8 création par un non-admin refusée (%)', sqlerrm; end $$;

-- H. Connexion par identifiant, casse, non-énumération, limitation (réservation avant l'appel à Auth)
delete from public.wakabi_login_attempts;
select pg_temp.ok('H1 identifiant connu -> email privé et numéro de tentative', (select j->>'email' like 'afalakouwonou+r-redac@%' and (j->>'attempt') is not null from (select public.wakabi_srv_login_begin('r-redac','1.1.1.1') j) x));
select pg_temp.ok('H2 casse et espaces ignorés', (public.wakabi_srv_login_begin('  R-Redac ','1.1.1.1') ->> 'email') like 'afalakouwonou+r-redac@%');
select pg_temp.ok('H3 identifiant inconnu : autorisé mais sans email', (select (j->>'allowed')::boolean and j->>'email' is null from (select public.wakabi_srv_login_begin('inconnu','1.1.1.1') j) x));
select pg_temp.ok('H4 compte inactif : sans email', (public.wakabi_srv_login_begin('r-multi','1.1.1.1') ->> 'email') is null);
select pg_temp.ok('H5 compte retiré puis réactivé : email', (public.wakabi_srv_login_begin('r-tiktok','1.1.1.1') ->> 'email') is not null);
delete from public.wakabi_login_attempts;
select ((public.wakabi_srv_login_begin('r-redac','2.2.2.'||g)) ->> 'allowed') from generate_series(1,5) g;
select pg_temp.ok('H6 5 tentatives réservées non closes (fonction interrompue) : la 6e est refusée', (public.wakabi_srv_login_begin('r-redac','3.3.3.3') ->> 'allowed')::boolean = false);
delete from public.wakabi_login_attempts;
select public.wakabi_srv_login_end(((public.wakabi_srv_login_begin('r-redac','2.2.2.2')) ->> 'attempt')::bigint, true) from generate_series(1,6);
select pg_temp.ok('H6b réussites closes : non comptées comme échecs', (public.wakabi_srv_login_begin('r-redac','2.2.2.2') ->> 'allowed')::boolean);
select pg_temp.ok('H6c une tentative ne se clôt qu''une fois', (select public.wakabi_srv_login_end(max(id), true) from public.wakabi_login_attempts where success) is null);
select public.wakabi_srv_login_end(((public.wakabi_srv_login_begin('inconnu2','2.2.2.2')) ->> 'attempt')::bigint, false) from generate_series(1,5);
select pg_temp.ok('H7 même blocage pour un identifiant inexistant', (public.wakabi_srv_login_begin('inconnu2','3.3.3.3') ->> 'allowed')::boolean = false);
delete from public.wakabi_login_attempts;
select public.wakabi_srv_login_begin('x'||g,'9.9.9.9') from generate_series(1,30) g;
select pg_temp.ok('H8 30 échecs depuis une IP : IP bloquée', (public.wakabi_srv_login_begin('r-direction','9.9.9.9') ->> 'allowed')::boolean = false);
select pg_temp.ok('H9 autre IP non bloquée', (public.wakabi_srv_login_begin('r-direction','8.8.8.8') ->> 'allowed')::boolean = true);
delete from public.wakabi_login_attempts;
insert into public.wakabi_login_attempts(kind, username, ip, success) select 'login', 'y'||g, 'ip'||g, false from generate_series(1,200) g;
select pg_temp.ok('H9b 200 échecs au total sur 15 min (IP variées) : blocage global', (public.wakabi_srv_login_begin('r-direction','7.7.7.7') ->> 'allowed')::boolean = false);
delete from public.wakabi_login_attempts;
select public.wakabi_srv_login_begin('r-redac','3.3.3.3') from generate_series(1,5);
update public.wakabi_login_attempts set attempted_at = attempted_at - interval '16 minutes' where username = 'r-redac';
select pg_temp.ok('H10 blocage levé après 15 minutes', (public.wakabi_srv_login_begin('r-redac','3.3.3.3') ->> 'allowed')::boolean);
select pg_temp.ok('H11 récupération : email', public.wakabi_srv_recovery_email('r-direction','4.4.4.4') like 'afalakouwonou+r-direction@%');
select public.wakabi_srv_recovery_email('r-direction','4.4.4.4') from generate_series(1,2);
select pg_temp.ok('H12 récupération : 4e demande dans l''heure refusée', public.wakabi_srv_recovery_email('r-direction','4.4.4.4') is null);
select pg_temp.ok('H13 récupération identifiant inconnu : rien', public.wakabi_srv_recovery_email('personne','4.4.4.5') is null);
select public.wakabi_srv_login_begin('r-redac', null);
select pg_temp.ok('H14 IP vide ou absente : rangée sous « inconnue »', exists (select 1 from public.wakabi_login_attempts where ip = 'inconnue'));

-- I. Droits : navigateur sans accès aux fonctions serveur ni à la table des tentatives, identifiant immuable
set local role anon;
do $$ begin perform public.wakabi_srv_login_begin('r-redac','x'); raise exception 'ÉCHEC : I1';
exception when insufficient_privilege then raise notice 'OK  I1 anon ne peut pas appeler la recherche identifiant -> email'; end $$;
do $$ begin perform public.wakabi_session_status(); raise exception 'ÉCHEC : I2';
exception when insufficient_privilege then raise notice 'OK  I2 anon sans accès aux fonctions d''information'; end $$;
do $$ begin perform count(*) from public.profiles; raise exception 'ÉCHEC : I3';
exception when insufficient_privilege then raise notice 'OK  I3 anon ne lit pas profiles (aucune correspondance identifiant/email)'; end $$;
reset role;
set local role authenticated;
select pg_temp.as_user('%r-admin%', now());
do $$ begin perform public.wakabi_srv_login_begin('r-redac','x'); raise exception 'ÉCHEC : I4';
exception when insufficient_privilege then raise notice 'OK  I4 utilisateur connecté sans accès aux fonctions serveur'; end $$;
do $$ begin perform count(*) from public.wakabi_login_attempts; raise exception 'ÉCHEC : I5';
exception when insufficient_privilege then raise notice 'OK  I5 table des tentatives illisible'; end $$;
do $$ begin update public.profiles set username='autre' where username='r-redac'; raise exception 'ÉCHEC : I6';
exception when insufficient_privilege then raise notice 'OK  I6 identifiant non modifiable depuis le navigateur (admin compris)'; end $$;
do $$ begin update public.profiles set sessions_valid_after=null where username='r-tiktok'; raise exception 'ÉCHEC : I7';
exception when insufficient_privilege then raise notice 'OK  I7 révocation non effaçable depuis le navigateur'; end $$;
select pg_temp.ok('I8 admin : wakabi_am_admin', public.wakabi_am_admin());
select pg_temp.as_user('%r-redac%', now());
select pg_temp.ok('I9 non-admin : wakabi_am_admin faux', not public.wakabi_am_admin());
do $$ begin perform public.wakabi_username_suggestion('abc'); raise exception 'ÉCHEC : I10';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  I10 suggestion réservée à l''admin'; end $$;
reset role;
do $$ begin update public.profiles set username='autre' where username='r-redac'; raise exception 'ÉCHEC : I11';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  I11 identifiant immuable même en SQL (%)', sqlerrm; end $$;

-- J. Mot de passe provisoire en 3 étapes (le déclencheur wakabi_password_changed de 06 n'est pas modifié)
select set_config('wk.admin', (select id::text from public.profiles where username='r-admin'), true);
select set_config('wk.redac', (select id::text from public.profiles where username='r-redac'), true);
update public.profiles set must_change_password = false where username = 'r-redac';
select set_config('wk.op', public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid)::text, true);
select pg_temp.ok('J1 étape 1 : obligation posée et sessions révoquées AVANT tout changement dans Auth',
  (select must_change_password and sessions_valid_after = now() and provisional_op::text = current_setting('wk.op') from public.profiles where username='r-redac'));
set local role authenticated;
select pg_temp.as_user('%r-redac%', now() - interval '1 minute');
select pg_temp.ok('J2 ancienne session refusée dès l''étape 1', public.my_role() is null);
reset role;
update auth.users set encrypted_password = 'provisoire-' || gen_random_uuid() where id = current_setting('wk.redac')::uuid;  -- étape 2 (Auth)
select pg_temp.ok('J3 changement dans Auth pendant l''opération : l''obligation n''est PAS levée par le déclencheur',
  (select must_change_password and password_changed_at = now() from public.profiles where username='r-redac'));
update auth.users set encrypted_password = 'membre-' || gen_random_uuid() where id = current_setting('wk.redac')::uuid;
select pg_temp.ok('J4 2e changement pendant l''opération (membre avec un ancien jeton) : obligation maintenue',
  (select must_change_password from public.profiles where username='r-redac'));
select public.wakabi_srv_password_reset_end(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid, current_setting('wk.op')::uuid);
select pg_temp.ok('J5 étape 3 : opération close, obligation toujours posée',
  (select must_change_password and provisional_op is null from public.profiles where username='r-redac'));
do $$ begin perform public.wakabi_srv_password_reset_end(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid, current_setting('wk.op')::uuid);
  raise exception 'ÉCHEC : J6';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  J6 étape 3 rejouée : refusée (%)', sqlerrm; end $$;
update auth.users set encrypted_password = 'choisi-' || gen_random_uuid() where id = current_setting('wk.redac')::uuid;
select pg_temp.ok('J7 après l''opération : le changement fait par le membre lève l''obligation',
  (select not must_change_password from public.profiles where username='r-redac'));
-- Étape 3 sans changement constaté dans Auth : refusée, obligation maintenue
select set_config('wk.op', public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid)::text, true);
update public.profiles set password_changed_at = now() - interval '1 second' where username = 'r-redac';
do $$ begin perform public.wakabi_srv_password_reset_end(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid, current_setting('wk.op')::uuid);
  raise exception 'ÉCHEC : J8';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  J8 étape 3 sans changement dans Auth : refusée (%)', sqlerrm; end $$;
select pg_temp.ok('J9 obligation et opération toujours en place', (select must_change_password and provisional_op is not null from public.profiles where username='r-redac'));
do $$ begin perform public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid);
  raise exception 'ÉCHEC : J10';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  J10 2e opération simultanée refusée (%)', sqlerrm; end $$;
-- Abandon (Auth a refusé) : obligation maintenue
select public.wakabi_srv_password_reset_abort(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid, current_setting('wk.op')::uuid);
select pg_temp.ok('J11 abandon : opération close, obligation maintenue', (select must_change_password and provisional_op is null from public.profiles where username='r-redac'));
-- Opération abandonnée sans abandon explicite (fonction coupée) : bloquante 15 minutes, puis le membre peut changer lui-même
select set_config('wk.op', public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, current_setting('wk.redac')::uuid)::text, true);
update public.profiles set provisional_pending_at = now() - interval '16 minutes' where username = 'r-redac';
update auth.users set encrypted_password = 'apres-' || gen_random_uuid() where id = current_setting('wk.redac')::uuid;
select pg_temp.ok('J12 opération expirée (> 15 min) : le changement du membre lève l''obligation et clôt l''opération',
  (select not must_change_password and provisional_op is null from public.profiles where username='r-redac'));
-- Cas refusés
do $$ begin perform public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, current_setting('wk.admin')::uuid);
  raise exception 'ÉCHEC : J13';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  J13 admin qui se donne un mot de passe provisoire : refusé (%)', sqlerrm; end $$;
do $$ begin perform public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, (select id from public.profiles where username='r-tiktok'));
  perform public.wakabi_srv_password_reset_begin(current_setting('wk.redac')::uuid, current_setting('wk.admin')::uuid);
  raise exception 'ÉCHEC : J14';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  J14 opération lancée par un non-admin : refusée (%)', sqlerrm; end $$;
update public.profiles set archived_at = now() where username = 'r-direction';
do $$ begin perform public.wakabi_srv_password_reset_begin(current_setting('wk.admin')::uuid, (select id from public.profiles where username='r-direction'));
  raise exception 'ÉCHEC : J15';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  J15 membre retiré : refusé avant tout appel à Auth (%)', sqlerrm; end $$;
update public.profiles set archived_at = null where username = 'r-direction';
update public.profiles set active = true where username = 'r-direction';
select pg_temp.ok('J16 état d''accès pour Auth', public.wakabi_srv_access_state((select id from public.profiles where username='r-admin'),
  (select id from public.profiles where username='r-multi')) = 'blocked');

-- K. Hook d'Auth
select pg_temp.ok('K1 hook : jeton accepté (session de la semaine)',
  public.wakabi_access_token_hook(jsonb_build_object('user_id',(select id from public.profiles where username='r-admin'),
   'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint))))) ? 'claims');
select pg_temp.ok('K2 hook : renouvellement d''une session d''avant lundi refusé',
  public.wakabi_access_token_hook(jsonb_build_object('user_id',(select id from public.profiles where username='r-direction'),
   'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from pg_temp.ws() - interval '1 minute')::bigint))))) ? 'error');
select pg_temp.ok('K3 hook : compte inactif refusé',
  public.wakabi_access_token_hook(jsonb_build_object('user_id',(select id from public.profiles where username='r-multi'),
   'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint))))) ? 'error');
select pg_temp.ok('K4 hook : session antérieure à la révocation refusée',
  public.wakabi_access_token_hook(jsonb_build_object('user_id',(select id from public.profiles where username='r-redac'),
   'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now() - interval '1 minute')::bigint))))) ? 'error');
select set_config('wk.dir', (select id::text from public.profiles where username='r-direction'), true);
set local role supabase_auth_admin;
select pg_temp.ok('K5 hook exécutable par supabase_auth_admin (jeton sans amr refusé)', public.wakabi_access_token_hook(jsonb_build_object('user_id',
  current_setting('wk.dir'), 'claims', '{}'::jsonb)) ? 'error');
reset role;
rollback;
