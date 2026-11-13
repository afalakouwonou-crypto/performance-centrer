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
