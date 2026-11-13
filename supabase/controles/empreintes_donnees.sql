-- Empreintes des données (LECTURE SEULE) : une ligne par table, nombre de lignes + md5 du contenu trié.
-- À lancer avant et après chaque migration : les tables métier doivent garder la même empreinte.
-- Pour contents, publications et profiles, seules les colonnes d'origine sont prises (les migrations ajoutent des colonnes).
select 'contents (colonnes d''origine)' as table_, count(*) as lignes, md5(coalesce(string_agg((t.id, t.title, t.concept, t.rubrique, t.country, t.publish_date, t.created_by, t.created_at, t.rubrique_id, t.content_type_id, t.campaign_id, t.objective_id, t.caption, t.script, t.archived_at, t.archived_by, t.updated_at, t.updated_by)::text, '|' order by t.id), '')) as empreinte from public.contents t
union all select 'publications', count(*), md5(coalesce(string_agg((t.id, t.content_id, t.platform, t.url, t.published_on, t.published_at, t.external_id)::text, '|' order by t.id), '')) from public.publications t
union all select 'metrics', count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.metrics t
union all select 'metric_readings', count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.metric_readings t
union all select 'profile_platforms', count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.profile_platforms t
union all select 'profiles (colonnes d''origine)', count(*), md5(coalesce(string_agg((t.id, t.email, t.full_name, t.role, t.country, t.platform, t.active, t.job_title, t.archived_at, t.must_change_password)::text, '|' order by t.id), '')) from public.profiles t
union all select 'app_kpis', count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.app_kpis t
union all select 'rubriques', count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.rubriques t
union all select 'platforms', count(*), md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.platforms t
order by 1;
