-- Tests de la migration 09 (organisation) sur la copie locale, après la 08P. Tout est annulé à la fin (rollback).
\set ON_ERROR_STOP 1
begin;
create function pg_temp.as_user(p_email text) returns void language plpgsql security definer as $$
declare v uuid; begin
  select id into v from public.profiles where email = p_email;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true);
end $$;
create function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'ÉCHEC : %', p_name; end if; raise notice 'OK  %', p_name; end $$;
create function pg_temp.refus(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'OK  % (refusé : %)', p_name, left(sqlerrm, 70); return; end;
  raise exception 'ÉCHEC : % (accepté)', p_name;
end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.refus(text, text) to anon, authenticated;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;

-- Un membre de production sans plateforme (« Graphiste ») et un membre inactif.
insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000008', 'graphiste@local.test', '{"full_name":"Kodjo Graphiste"}'),
  ('00000000-0000-4000-8000-000000000009', 'inactif@local.test', '{"full_name":"Membre Inactif"}');
update public.profiles set active = true, must_change_password = false, job_title = 'Graphiste', username = 'kodjo' where email = 'graphiste@local.test';
update public.profiles set username = 'inactif' where email = 'inactif@local.test';

-- A. États de production
select pg_temp.ok('A1 contenus existants avec lien : « publie »', (select count(*) from public.contents where production_status = 'publie') = 9);
set local role authenticated;
select pg_temp.as_user('redaction@local.test');
insert into public.contents(title, rubrique, rubrique_id, country, publish_date)
select 'Nouveau tournage Lomé', r.name, r.id, 'Togo', current_date + 7 from public.rubriques r where r.name = 'SPOT';
insert into ids select 'c', id from public.contents where title = 'Nouveau tournage Lomé';
select pg_temp.ok('A2 nouveau contenu : état « idee »', (select production_status from public.contents where id = (select v from ids where k = 'c')) = 'idee');
update public.contents set production_status = 'a_produire' where id = (select v from ids where k = 'c');
update public.contents set production_status = 'en_production' where id = (select v from ids where k = 'c');
select pg_temp.ok('A3 historique : création + 2 changements, auteur = rédaction',
  (select count(*) from public.content_status_history h where h.content_id = (select v from ids where k = 'c')) = 3
  and (select changed_by from public.content_status_history h where h.content_id = (select v from ids where k = 'c') and h.to_status = 'en_production')
      = (select id from public.profiles where email = 'redaction@local.test'));
select pg_temp.refus('A4 état inconnu', $$update public.contents set production_status = 'n_importe' where id = (select v from ids where k = 'c')$$);

-- B. Tâches et notifications
insert into public.content_tasks(content_id, kind, title, assignee, due_on, brief)
values ((select v from ids where k = 'c'), 'graphisme', 'Visuel de couverture', (select id from public.profiles where email = 'graphiste@local.test'), current_date + 3, 'Format 9:16, logo Wakabi');
insert into ids select 't', id from public.content_tasks where title = 'Visuel de couverture';
select pg_temp.refus('B1 affecter un membre inactif', $$insert into public.content_tasks(content_id, kind, assignee) values ((select v from ids where k = 'c'), 'autre', (select id from public.profiles where email = 'inactif@local.test'))$$);
select pg_temp.as_user('graphiste@local.test');
select pg_temp.ok('B2 le graphiste voit sa tâche', (select count(*) from public.content_tasks where assignee = auth.uid()) = 1);
select pg_temp.ok('B3 le graphiste a 1 notification « tâche affectée »', (select count(*) from public.notifications where kind = 'tache_affectee') = 1);
update public.content_tasks set status = 'en_cours' where id = (select v from ids where k = 't');
select pg_temp.ok('B4 il fait avancer sa tâche (en cours)', (select status from public.content_tasks where id = (select v from ids where k = 't')) = 'en_cours');
select pg_temp.refus('B5 il ne peut pas changer l''échéance', $$update public.content_tasks set due_on = current_date + 30 where id = (select v from ids where k = 't')$$);
select pg_temp.refus('B6 il ne peut pas annuler la tâche', $$update public.content_tasks set status = 'annule' where id = (select v from ids where k = 't')$$);
select pg_temp.refus('B7 il ne peut pas créer de tâche', $$insert into public.content_tasks(content_id, kind) values ((select v from ids where k = 'c'), 'autre')$$);
update public.content_tasks set status = 'fait' where id = (select v from ids where k = 't');
select pg_temp.ok('B8 tâche faite : date et auteur posés par la base', (select done_at is not null and done_by = auth.uid() from public.content_tasks where id = (select v from ids where k = 't')));

-- C. Validation
select pg_temp.as_user('tiktok@local.test');
select pg_temp.refus('C1 un membre sans tâche ne peut pas proposer à la validation', $$select public.wakabi_content_submit((select v from ids where k = 'c'), null)$$);
update public.contents set title = 'piraté' where id = (select v from ids where k = 'c');
select pg_temp.ok('C2 un membre ne modifie pas un contenu (RLS)', (select title from public.contents where id = (select v from ids where k = 'c')) = 'Nouveau tournage Lomé');
select pg_temp.as_user('graphiste@local.test');
select public.wakabi_content_submit((select v from ids where k = 'c'), 'Visuel prêt');
select pg_temp.ok('C3 le graphiste propose : « a_valider », commentaire dans l''historique',
  (select production_status from public.contents where id = (select v from ids where k = 'c')) = 'a_valider'
  and exists (select 1 from public.content_status_history where content_id = (select v from ids where k = 'c') and to_status = 'a_valider' and comment = 'Visuel prêt'));
select pg_temp.refus('C4 le graphiste ne peut pas valider', $$insert into public.content_feedback(content_id, decision) values ((select v from ids where k = 'c'), 'valide')$$);
insert into public.content_feedback(content_id, decision, comment) values ((select v from ids where k = 'c'), 'commentaire', 'Deux versions déposées');
select pg_temp.as_user('redaction@local.test');
select pg_temp.ok('C5 la rédaction est notifiée « à valider »', (select count(*) from public.notifications where kind = 'a_valider') = 1);
select pg_temp.refus('C6 « à corriger » sans texte', $$insert into public.content_feedback(content_id, decision) values ((select v from ids where k = 'c'), 'a_corriger')$$);
insert into public.content_feedback(content_id, decision, comment) values ((select v from ids where k = 'c'), 'a_corriger', 'Logo trop petit');
select pg_temp.ok('C7 « à corriger » : retour en production', (select production_status from public.contents where id = (select v from ids where k = 'c')) = 'en_production');
select pg_temp.as_user('graphiste@local.test');
select pg_temp.ok('C8 le graphiste est notifié « à corriger »', (select count(*) from public.notifications where kind = 'a_corriger') = 1);
select public.wakabi_content_submit((select v from ids where k = 'c'), 'Corrigé');
select pg_temp.as_user('redaction@local.test');
insert into public.content_feedback(content_id, decision) values ((select v from ids where k = 'c'), 'valide');
select pg_temp.ok('C9 validé', (select production_status from public.contents where id = (select v from ids where k = 'c')) = 'valide');

-- D. Fichiers et stockage privé
select pg_temp.as_user('graphiste@local.test');
insert into public.content_files(content_id, task_id, storage_path, file_name, mime_type, size_bytes)
values ((select v from ids where k = 'c'), (select v from ids where k = 't'), 'contents/' || (select v from ids where k = 'c') || '/couverture.png', 'couverture.png', 'image/png', 2048);
select pg_temp.ok('D1 dépôt sur son contenu : accepté, auteur posé par la base', (select uploaded_by = auth.uid() from public.content_files where file_name = 'couverture.png'));
select pg_temp.refus('D2 dépôt sur un contenu sans tâche', $$insert into public.content_files(content_id, storage_path, file_name) select id, 'contents/' || id || '/x.png', 'x.png' from public.contents where title like 'Bon plan%' limit 1$$);
select pg_temp.refus('D3 chemin incohérent avec le contenu', $$insert into public.content_files(content_id, storage_path, file_name) values ((select v from ids where k = 'c'), 'contents/00000000-0000-4000-8000-000000000000/x.png', 'x.png')$$);
insert into storage.objects(bucket_id, name, owner) values ('wakabi-fichiers', 'contents/' || (select v from ids where k = 'c') || '/couverture.png', auth.uid());
select pg_temp.ok('D4 stockage : dépôt accepté dans son dossier', exists (select 1 from storage.objects where name like 'contents/%/couverture.png'));
select pg_temp.refus('D5 stockage : dépôt refusé hors de ses contenus', $$insert into storage.objects(bucket_id, name) select 'wakabi-fichiers', 'contents/' || id || '/y.png' from public.contents where title like 'Bon plan%' limit 1$$);
select pg_temp.as_user('tiktok@local.test');
update public.content_files set removed_at = now() where file_name = 'couverture.png';
select pg_temp.ok('D6 un autre membre ne retire pas le fichier', (select removed_at is null from public.content_files where file_name = 'couverture.png'));
select pg_temp.as_user('graphiste@local.test');
update public.content_files set removed_at = now() where file_name = 'couverture.png';
select pg_temp.ok('D7 l''auteur retire son fichier (rien n''est supprimé)', (select removed_at is not null and removed_by = auth.uid() from public.content_files where file_name = 'couverture.png'));

-- E. Notifications : chacun les siennes, seule la date de lecture se modifie
update public.notifications set read_at = now();
select pg_temp.ok('E1 lecture : notifications marquées lues', (select count(*) from public.notifications where read_at is null) = 0);
select pg_temp.refus('E2 le texte d''une notification ne se modifie pas', $$update public.notifications set message = 'x'$$);
select pg_temp.as_user('tiktok@local.test');
select pg_temp.ok('E3 un autre membre ne voit aucune notification du graphiste', (select count(*) from public.notifications) = 0);

-- F. Publication automatique, direction, anonyme
select pg_temp.as_user('redaction@local.test');
insert into public.publications(content_id, platform, url, published_on) values ((select v from ids where k = 'c'), 'TikTok', 'https://exemple.test/nouveau', current_date);
select pg_temp.ok('F1 date effective saisie : contenu « publie » automatiquement', (select production_status from public.contents where id = (select v from ids where k = 'c')) = 'publie');
select pg_temp.as_user('direction@local.test');
select pg_temp.ok('F2 la direction lit les tâches', (select count(*) from public.content_tasks) = 1);
select pg_temp.refus('F3 la direction ne crée pas de tâche', $$insert into public.content_tasks(content_id, kind) values ((select v from ids where k = 'c'), 'autre')$$);
reset role;
set local role anon;
select pg_temp.refus('F4 anonyme : aucune tâche lisible', $$select count(*) from public.content_tasks$$);
select pg_temp.refus('F5 anonyme : aucune notification lisible', $$select count(*) from public.notifications$$);
reset role;
select pg_temp.ok('F6 journal : tâches, retours et fichiers journalisés', (select count(distinct table_name) from public.activity_log where table_name in ('content_tasks', 'content_feedback', 'content_files')) = 3);

select 'TOUS LES TESTS 09 RÉUSSIS' as resultat;
rollback;
