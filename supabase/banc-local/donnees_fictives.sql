-- Données FICTIVES pour la copie locale, aux volumes de la production au 03/11/2026 :
-- 7 profils (1 admin, 1 rédaction, 1 direction, 4 responsables plateforme), 4 affectations, 9 contenus,
-- 31 publications (sans date effective), 19 relevés J+7 dans l'ancienne table metrics, 6 lignes de KPI application.
-- Dates relatives au jour de construction. Aucune donnée réelle.
begin;
-- Comptes (le déclencheur de la 06 crée chaque profil : inactif, mot de passe à choisir).
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000002', 'redaction@local.test', now(), '{"full_name":"Awa Rédaction"}'),
 ('00000000-0000-4000-8000-000000000003', 'direction@local.test', now(), '{"full_name":"Koffi Direction"}'),
 ('00000000-0000-4000-8000-000000000004', 'tiktok@local.test', now(), '{"full_name":"Clémence Adjo"}'),
 ('00000000-0000-4000-8000-000000000005', 'instagram@local.test', now(), '{"full_name":"Margot Mensah"}'),
 ('00000000-0000-4000-8000-000000000006', 'facebook@local.test', now(), '{"full_name":"Yao Kpodar"}'),
 ('00000000-0000-4000-8000-000000000007', 'snapchat@local.test', now(), '{"full_name":"Ama Lawson"}');
update public.profiles set full_name = 'Administrateur Local', must_change_password = false where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'editor', active = true, must_change_password = false, country = 'Togo' where id = '00000000-0000-4000-8000-000000000002';
update public.profiles set role = 'direction', active = true, must_change_password = false where id = '00000000-0000-4000-8000-000000000003';
update public.profiles set active = true, must_change_password = false, country = 'Togo' where id in
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006');
update public.profiles set active = true, must_change_password = false, country = 'Bénin' where id = '00000000-0000-4000-8000-000000000007';
insert into public.profile_platforms(profile_id, platform_id)
select v.p::uuid, f.id from (values ('00000000-0000-4000-8000-000000000004', 'TikTok'), ('00000000-0000-4000-8000-000000000005', 'Instagram'),
  ('00000000-0000-4000-8000-000000000006', 'Facebook'), ('00000000-0000-4000-8000-000000000007', 'Snapchat')) v(p, code)
join public.platforms f on f.code = v.code;

-- 9 contenus.
insert into public.contents(id, title, concept, rubrique, rubrique_id, country, publish_date, created_by)
select v.id::uuid, v.t, v.c, r.name, r.id, v.co::public.wakabi_country, current_date + v.d, '00000000-0000-4000-8000-000000000001'
from (values
 ('10000000-0000-4000-8000-000000000001', 'On va où là ? — Restaurant Le Galion', 'On va où là ?', 'SPOT', 'Togo', -40),
 ('10000000-0000-4000-8000-000000000002', 'Explore With Wakabi — Plage de Baguida', 'Explore With Wakabi', 'IMMERSION', 'Togo', -35),
 ('10000000-0000-4000-8000-000000000003', 'Bon plan du week-end', NULL, 'BON PLAN', 'Togo', -30),
 ('10000000-0000-4000-8000-000000000004', 'Sans Filtre — Marché de Dantokpa', 'Sans Filtre', 'SPOT', 'Bénin', -27),
 ('10000000-0000-4000-8000-000000000005', 'WakaTrip Kpalimé', 'WakaTrip', 'GUIDE', 'Togo', -24),
 ('10000000-0000-4000-8000-000000000006', 'Zémi Tour Cotonou', 'Zémi Tour', 'IMMERSION', 'Bénin', -21),
 ('10000000-0000-4000-8000-000000000007', 'Versus — Deux maquis', 'Versus', 'ACTU', 'Togo', -18),
 ('10000000-0000-4000-8000-000000000008', 'Le Wakap de la semaine', 'Le Wakap', 'ACTU', 'Togo', -15),
 ('10000000-0000-4000-8000-000000000009', 'On va où là ? — Rooftop', 'On va où là ?', 'SPOT', 'Togo', -12)
) v(id, t, c, rub, co, d) join public.rubriques r on r.name = v.rub;

-- 31 publications : 4 plateformes pour 4 contenus, 3 pour 5 contenus (16 + 15).
insert into public.publications(content_id, platform, url)
select c.id, f.code::public.wakabi_platform, 'https://exemple.test/' || substr(c.id::text, 32) || '/' || lower(f.code)
from public.contents c
join public.platforms f on f.code in ('TikTok', 'Instagram', 'Facebook') or (f.code = 'Snapchat' and c.title ~ '(Galion|Baguida|Dantokpa|Cotonou)');

-- 19 relevés J+7 de l'ancienne interface (mesurés 9 à 20 jours après la date prévue).
insert into public.metrics(publication_id, snapshot, views, likes, comments, shares, reposts, saves, measured_at)
select p.id, 'j7', 800 + 137 * rn, 30 + 3 * rn, 4 + rn % 7, 2 + rn % 5, 0, 0, c.publish_date + (9 + rn % 12)::int
from (select p.*, row_number() over (order by p.content_id, p.platform) as rn from public.publications p) p
join public.contents c on c.id = p.content_id
where rn <= 19;

-- KPI de l'application (3 mois × 2 pays).
insert into public.app_kpis(month, country, downloads, signups, active_users, uninstalls)
select date_trunc('month', current_date - (k * interval '1 month'))::date, co::public.wakabi_country, 120 + 10 * k, 60 + k, 300 - 5 * k, 15 + k
from generate_series(1, 3) k, unnest(array['Togo', 'Bénin']) co;
commit;
