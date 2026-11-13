-- Annulation de la migration 07 (NE PAS EXÉCUTER sans accord).
-- Retire la vue, les 3 déclencheurs, les 5 fonctions, l'index et la contrainte ajoutés.
-- GARDE les colonnes published_on, published_at et external_id et leurs valeurs : aucune date saisie n'est perdue,
-- et des colonnes facultatives ne gênent pas l'ancienne interface.
-- Aucun droit de table ni règle RLS n'est touché (la 07 n'en modifie aucun) ; les droits d'exécution des
-- fonctions disparaissent avec elles. Les relevés et publications ne sont pas modifiés.
begin;
drop view if exists public.publication_schedule;
drop trigger if exists wakabi_metric_readings_publication_date on public.metric_readings;
drop function if exists public.wakabi_metric_readings_publication_date();
drop trigger if exists wakabi_contents_country_dates on public.contents;
drop function if exists public.wakabi_contents_country_dates();
drop trigger if exists wakabi_publications_effective_date on public.publications;
drop function if exists public.wakabi_publications_effective_date();
drop function if exists public.wakabi_local_date(public.wakabi_country, timestamptz);
drop function if exists public.wakabi_country_tz(public.wakabi_country);
drop index if exists public.publications_external_id_key;
alter table public.publications drop constraint if exists publications_external_id_not_blank;
commit;
