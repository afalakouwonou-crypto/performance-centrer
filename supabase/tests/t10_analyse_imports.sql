-- Tests de la migration 10 sur la copie locale (après 08P et 09). Tout est annulé à la fin (rollback).
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

select pg_temp.ok('A1 publications existantes : promotion « inconnu »', (select count(*) from public.publications where promotion = 'inconnu') = 31);
select pg_temp.ok('A2 5 plateformes « non configurées »', (select count(*) from public.platform_connections where status = 'non_configuree') = 5);
set local role authenticated;

-- B. Objectifs
select pg_temp.as_user('redaction@local.test');
insert into public.objectives(period_kind, period_start, period_end, metric, target) values ('mois', date_trunc('month', current_date), (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'vues', 50000);
select pg_temp.ok('B1 la rédaction crée un objectif mensuel, auteur posé', (select created_by = auth.uid() from public.objectives limit 1));
select pg_temp.refus('B2 période incohérente', $$insert into public.objectives(period_kind, period_start, period_end, metric, target) values ('mois', current_date, current_date - 1, 'vues', 1)$$);
select pg_temp.refus('B3 taux cible > 100 %', $$insert into public.objectives(period_kind, period_start, period_end, metric, target) values ('mois', current_date, current_date, 'taux', 5)$$);
select pg_temp.as_user('tiktok@local.test');
select pg_temp.refus('B4 un responsable plateforme ne crée pas d''objectif', $$insert into public.objectives(period_kind, period_start, period_end, metric, target) values ('mois', current_date, current_date, 'vues', 1)$$);
select pg_temp.ok('B5 mais le lit', (select count(*) from public.objectives) = 1);

-- C. Organique / sponsorisé
select pg_temp.as_user('redaction@local.test');
update public.publications set promotion = 'sponsorise' where id = (select id from public.publications order by id limit 1);
select pg_temp.ok('C1 la rédaction marque une publication « sponsorisé »', (select count(*) from public.publications where promotion = 'sponsorise') = 1);
select pg_temp.refus('C2 valeur inconnue refusée', $$update public.publications set promotion = 'pub' where id = (select id from public.publications order by id limit 1)$$);
select pg_temp.as_user('tiktok@local.test');
update public.publications set promotion = 'organique';
select pg_temp.ok('C3 un responsable plateforme ne change rien (RLS)', (select count(*) from public.publications where promotion = 'organique') = 0);

-- D. Imports, connexions, vues enregistrées
select pg_temp.as_user('redaction@local.test');
insert into public.import_batches(file_name, rows_total, readings_created) values ('export_tiktok.csv', 12, 10);
select pg_temp.ok('D1 lot d''import enregistré, auteur posé', (select created_by = auth.uid() from public.import_batches));
update public.platform_connections set account_label = 'x';
select pg_temp.ok('D2 la rédaction ne modifie pas les connexions', (select count(*) from public.platform_connections where account_label = 'x') = 0);
select pg_temp.as_user('tiktok@local.test');
select pg_temp.ok('D3 un responsable plateforme ne voit ni imports ni connexions', (select count(*) from public.import_batches) = 0 and (select count(*) from public.platform_connections) = 0);
insert into public.saved_views(name, view, query) values ('Mon TikTok', 'contents', 'platform=x');
select pg_temp.ok('D4 vue enregistrée personnelle', (select count(*) from public.saved_views) = 1);
select pg_temp.as_user('direction@local.test');
select pg_temp.ok('D5 la direction lit imports et connexions, pas les vues des autres', (select count(*) from public.import_batches) = 1 and (select count(*) from public.platform_connections) = 5 and (select count(*) from public.saved_views) = 0);
select pg_temp.as_user('admin@local.test');
update public.platform_connections set account_label = '@wakabi_tg' where platform_id = (select id from public.platforms where code = 'TikTok');
select pg_temp.ok('D6 l''administrateur renseigne le compte d''une plateforme', (select account_label from public.platform_connections pc join public.platforms f on f.id = pc.platform_id where f.code = 'TikTok') = '@wakabi_tg');
select pg_temp.refus('D7 l''administrateur ne peut pas écrire d''erreur de synchronisation', $$update public.platform_connections set last_error = 'x'$$);
reset role;
set local role anon;
select pg_temp.refus('D8 anonyme : aucun objectif lisible', $$select count(*) from public.objectives$$);
reset role;
select 'TOUS LES TESTS 10 RÉUSSIS' as resultat;
rollback;
