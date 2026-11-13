-- Wakabi Performance Center — Migration 05 : statistiques J+1 / J+7 et historique des relevés (cahier des charges, Phase 1)
-- À exécuter dans Supabase > SQL Editor, en une seule fois, APRÈS les migrations 01, 02, 03 et 04.
-- Uniquement additive :
--  - la table metrics et ses 19 lignes ne sont ni modifiées ni supprimées ;
--  - les 19 relevés existants sont COPIÉS dans la nouvelle table metric_readings, avec leur vraie date
--    et leur vrai auteur, sans heure de relevé inventée, et marqués comme repris de metrics ;
--  - l'application actuelle continue d'écrire dans metrics : chaque enregistrement y est recopié
--    automatiquement dans metric_readings (sens unique, rien n'est jamais écrasé).
begin;

-- 0. Garde-fous : migrations 01 à 04 en place et PostgreSQL 15 ou plus (vues security_invoker).
do $check$
begin
  if (select count(*) from pg_trigger where tgname in
      ('wakabi_contents_created_by','wakabi_metrics_updated_by','wakabi_app_kpis_updated_by')) <> 3
     or to_regclass('public.activity_log') is null
     or to_regclass('public.platforms') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.publications'::regclass
                    and attname = 'platform_id' and not attisdropped)
     or not exists (select 1 from pg_trigger where tgname = 'wakabi_contents_archive') then
    raise exception 'Migrations 01/02/03/04 absentes : migration 05 annulée, rien n''a été modifié.';
  end if;
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'PostgreSQL 15 ou plus requis (vues security_invoker) : migration 05 annulée.';
  end if;
end;
$check$;

-- Pendant la migration, les écritures dans metrics attendent quelques instants :
-- aucun enregistrement fait depuis l'application ne peut passer entre la reprise et la recopie automatique.
lock table public.metrics in share row exclusive mode;

-- 1. Ce que chaque plateforme fournit (ajustable par l'administrateur). Par défaut : tout.
alter table public.platforms add column if not exists supports_reposts boolean not null default true;
alter table public.platforms add column if not exists supports_saves   boolean not null default true;

-- 2. Table des relevés : une ligne = un relevé, jamais modifiée ni supprimée depuis l'application.
create table if not exists public.metric_readings (
  id                  uuid primary key default gen_random_uuid(),
  publication_id      uuid not null references public.publications(id) on delete restrict,
  reading_type        text not null check (reading_type in ('j1','j7','other')),   -- J+1, J+7, autre relevé manuel
  source              text not null default 'manual' check (source in ('manual','api')),
  origin              text not null default 'direct'
                      check (origin in ('direct','metrics_legacy','metrics_sync')),
                      -- direct         : saisi directement dans metric_readings
                      -- metrics_legacy : repris de l'ancienne table metrics lors de la migration 05
                      -- metrics_sync   : recopié automatiquement depuis metrics (application actuelle)
  legacy_metric_id    uuid,          -- ligne de metrics d'où vient le relevé (origines metrics_*)
  views               bigint not null check (views    >= 0),
  likes               bigint not null check (likes    >= 0),
  comments            bigint not null check (comments >= 0),
  shares              bigint not null check (shares   >= 0),
  reposts             bigint check (reposts >= 0),  -- vide = non renseigné / non fourni par la plateforme (différent de 0)
  saves               bigint check (saves   >= 0),
  measured_on         date not null,                -- date du relevé
  measured_at         timestamptz,                  -- heure exacte du relevé ; vide si inconnue (jamais inventée)
  corrects_reading_id uuid references public.metric_readings(id) on delete restrict,
  correction_reason   text,
  original_reading_id uuid references public.metric_readings(id) on delete restrict,  -- 1er relevé de la chaîne
  entered_by          uuid references public.profiles(id),
  entered_at          timestamptz not null default now(),
  constraint metric_readings_correction_reason check (
    (corrects_reading_id is null and correction_reason is null)
    or (corrects_reading_id is not null and correction_reason is not null and btrim(correction_reason) <> '')),
  constraint metric_readings_legacy_link check ((origin = 'direct') = (legacy_metric_id is null))
);

-- Un seul relevé d'origine J+1 et un seul J+7 par publication ; les corrections ne sont pas concernées.
create unique index if not exists metric_readings_one_original_key
  on public.metric_readings (publication_id, reading_type)
  where corrects_reading_id is null and reading_type in ('j1','j7');
-- Un relevé ne peut être corrigé qu'une fois : les corrections forment une chaîne, la dernière fait foi.
create unique index if not exists metric_readings_one_correction_key
  on public.metric_readings (corrects_reading_id) where corrects_reading_id is not null;
create index if not exists metric_readings_publication_idx on public.metric_readings (publication_id, reading_type);
create index if not exists metric_readings_legacy_idx      on public.metric_readings (legacy_metric_id);
create index if not exists metric_readings_original_idx    on public.metric_readings (original_reading_id);

-- 3. Contrôles à la création d'un relevé.
--    Depuis l'application (rôles anon / authenticated) : auteur, heure de saisie, origine et source
--    sont imposés par la base ; la date et l'heure du relevé ne peuvent pas être dans le futur ;
--    reposts / enregistrements restent vides pour une plateforme qui ne les fournit pas.
--    Depuis la base (migration, recopie depuis metrics, SQL Editor) : l'auteur et l'heure de saisie
--    fournis sont conservés (reprise de l'historique sans écraser l'auteur d'origine).
create or replace function public.wakabi_metric_readings_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_parent public.metric_readings%rowtype;
  v_reposts boolean;
  v_saves   boolean;
  v_label   text := case new.reading_type when 'j1' then 'J+1' when 'j7' then 'J+7' else 'autre' end;
begin
  if current_user in ('anon', 'authenticated') then
    if auth.uid() is null then
      raise exception 'Utilisateur non connecté';
    end if;
    new.entered_by       := auth.uid();
    new.entered_at       := now();
    new.origin           := 'direct';
    new.legacy_metric_id := null;
    new.source           := 'manual';
  else
    new.entered_by := coalesce(new.entered_by, auth.uid());
    new.entered_at := coalesce(new.entered_at, now());
  end if;

  if new.origin = 'direct' then
    -- tolérance d'un jour / quelques minutes pour les fuseaux horaires (Togo UTC+0, Bénin UTC+1)
    if new.measured_on > current_date + 1 or new.measured_at > now() + interval '10 minutes' then
      raise exception 'La date ou l''heure du relevé ne peut pas être dans le futur';
    end if;
    select pf.supports_reposts, pf.supports_saves into v_reposts, v_saves
    from public.publications p join public.platforms pf on pf.id = p.platform_id
    where p.id = new.publication_id;
    if new.reposts is not null and v_reposts is false then
      raise exception 'Cette plateforme ne fournit pas les republications : laissez le champ vide';
    end if;
    if new.saves is not null and v_saves is false then
      raise exception 'Cette plateforme ne fournit pas les enregistrements : laissez le champ vide';
    end if;
  end if;

  if new.corrects_reading_id is null then
    new.original_reading_id := new.id;
    if new.reading_type in ('j1','j7') and exists (
         select 1 from public.metric_readings r
         where r.publication_id = new.publication_id and r.reading_type = new.reading_type
           and r.corrects_reading_id is null) then
      raise exception 'Un relevé % d''origine existe déjà pour cette publication : enregistrez une correction', v_label;
    end if;
  else
    select * into v_parent from public.metric_readings r where r.id = new.corrects_reading_id;
    if v_parent.id is null then
      raise exception 'Relevé à corriger introuvable';
    end if;
    if v_parent.publication_id <> new.publication_id or v_parent.reading_type <> new.reading_type then
      raise exception 'Une correction doit porter sur la même publication et le même type de relevé';
    end if;
    if exists (select 1 from public.metric_readings r where r.corrects_reading_id = v_parent.id) then
      raise exception 'Ce relevé a déjà été corrigé : corrigez la dernière version';
    end if;
    new.original_reading_id := coalesce(v_parent.original_reading_id, v_parent.id);
  end if;
  return new;
end;
$function$;

-- Append-only : aucune modification ni suppression depuis l'application (en plus du retrait des droits).
create or replace function public.wakabi_metric_readings_append_only()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Un relevé ne peut être ni modifié ni supprimé : enregistrez une correction';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists wakabi_metric_readings_before_insert on public.metric_readings;
create trigger wakabi_metric_readings_before_insert before insert on public.metric_readings
  for each row execute function public.wakabi_metric_readings_before_insert();
drop trigger if exists wakabi_metric_readings_append_only on public.metric_readings;
create trigger wakabi_metric_readings_append_only before update or delete on public.metric_readings
  for each row execute function public.wakabi_metric_readings_append_only();
-- Journal (fonction de la migration 02), créé avant la reprise pour qu'elle soit journalisée.
drop trigger if exists wakabi_log_metric_readings on public.metric_readings;
create trigger wakabi_log_metric_readings after insert or update or delete on public.metric_readings
  for each row execute function public.wakabi_log_activity();

-- 4. Droits : mêmes règles que metrics pour la lecture et la saisie ; ni modification ni suppression.
alter table public.metric_readings enable row level security;
revoke all on public.metric_readings from anon, authenticated;
grant select, insert on public.metric_readings to authenticated;

drop policy if exists "active users read metric readings" on public.metric_readings;
create policy "active users read metric readings" on public.metric_readings for select to authenticated
  using (public.my_role() is not null);
drop policy if exists "authorized users insert metric readings" on public.metric_readings;
create policy "authorized users insert metric readings" on public.metric_readings for insert to authenticated
  with check (
    public.my_role() = any (array['editor'::public.wakabi_role, 'admin'::public.wakabi_role])
    or exists (select 1 from public.publications p
               where p.id = metric_readings.publication_id
                 and public.my_role() = 'platform_manager'::public.wakabi_role
                 and p.platform = public.my_platform()));

-- 5. Reprise des relevés existants de metrics (19 relevés J+7 au 2026-10-30).
--    Date = metrics.measured_at (date seule) ; heure du relevé laissée vide ;
--    auteur et heure de saisie = metrics.updated_by / updated_at ; valeurs copiées telles quelles
--    (les 0 de reposts / enregistrements sont conservés : l'ancienne saisie ne distinguait pas « vide » de 0).
--    Relancer le script ne recopie rien en double.
insert into public.metric_readings
  (publication_id, reading_type, source, origin, legacy_metric_id,
   views, likes, comments, shares, reposts, saves,
   measured_on, measured_at, entered_by, entered_at)
select m.publication_id, case m.snapshot when 'j7' then 'j7' else 'other' end, 'manual', 'metrics_legacy', m.id,
       m.views, m.likes, m.comments, m.shares, m.reposts, m.saves,
       m.measured_at, null, m.updated_by, m.updated_at
from public.metrics m
where not exists (select 1 from public.metric_readings r where r.legacy_metric_id = m.id)
order by m.updated_at, m.id;

-- 6. Recopie automatique depuis metrics (sens unique) : l'application actuelle continue de fonctionner
--    et chaque enregistrement devient un relevé. Une modification d'un relevé existant devient une
--    correction (nouvelle ligne) ; rien n'est recopié si aucune valeur n'a changé. Une suppression dans
--    metrics ne supprime rien dans l'historique.
create or replace function public.wakabi_metrics_to_readings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_type   text := case new.snapshot when 'j7' then 'j7' else 'other' end;
  v_target uuid;
begin
  if tg_op = 'UPDATE'
     and (new.publication_id, new.snapshot, new.views, new.likes, new.comments, new.shares,
          new.reposts, new.saves, new.measured_at)
         is not distinct from
         (old.publication_id, old.snapshot, old.views, old.likes, old.comments, old.shares,
          old.reposts, old.saves, old.measured_at) then
    return null;
  end if;

  -- dernière version (non corrigée) du relevé concerné
  select r.id into v_target
  from public.metric_readings r
  where r.publication_id = new.publication_id and r.reading_type = v_type
    and (v_type <> 'other' or r.legacy_metric_id = new.id)
    and not exists (select 1 from public.metric_readings c where c.corrects_reading_id = r.id)
  order by r.entered_at desc, r.id
  limit 1;

  insert into public.metric_readings
    (publication_id, reading_type, source, origin, legacy_metric_id,
     views, likes, comments, shares, reposts, saves,
     measured_on, measured_at, corrects_reading_id, correction_reason, entered_by, entered_at)
  values
    (new.publication_id, v_type, 'manual', 'metrics_sync', new.id,
     new.views, new.likes, new.comments, new.shares, new.reposts, new.saves,
     new.measured_at, null, v_target,
     case when v_target is not null then 'Mise à jour depuis l''application actuelle (table metrics)' end,
     coalesce(new.updated_by, auth.uid()), now());
  return null;
end;
$function$;

drop trigger if exists wakabi_metrics_to_readings on public.metrics;
create trigger wakabi_metrics_to_readings after insert or update on public.metrics
  for each row execute function public.wakabi_metrics_to_readings();

-- 7. Vues de calcul (rien de calculé n'est stocké). security_invoker = true : chaque utilisateur
--    ne voit que ce que les règles RLS de metric_readings et publications lui permettent de voir.
--    Taux d'interaction = (likes + commentaires + partages) / vues (vide si 0 vue).

-- 7a. Version en vigueur de chaque relevé (dernière correction, ou le relevé d'origine s'il n'a pas été corrigé).
create or replace view public.metric_readings_effective
with (security_invoker = true) as
select r.id, r.original_reading_id, r.publication_id, p.content_id, p.platform, p.platform_id,
       r.reading_type, r.source, r.origin, r.legacy_metric_id,
       r.views, r.likes, r.comments, r.shares, r.reposts, r.saves,
       r.likes + r.comments + r.shares as interactions,
       case when r.views > 0 then round((r.likes + r.comments + r.shares)::numeric / r.views, 4) end as interaction_rate,
       r.measured_on, r.measured_at, r.entered_by, r.entered_at,
       (r.corrects_reading_id is not null) as is_corrected,
       r.correction_reason
from public.metric_readings r
join public.publications p on p.id = r.publication_id
where not exists (select 1 from public.metric_readings c where c.corrects_reading_id = r.id);

-- 7b. Synthèse par publication : J+1, J+7, dernier relevé et évolution.
create or replace view public.publication_performance
with (security_invoker = true) as
with latest as (
  select distinct on (e.publication_id) e.*
  from public.metric_readings_effective e
  order by e.publication_id, e.measured_on desc, e.measured_at desc nulls last, e.entered_at desc
)
select p.id as publication_id, p.content_id, p.platform, p.platform_id,
       j1.views as j1_views, j1.interactions as j1_interactions, j1.interaction_rate as j1_interaction_rate,
       j1.measured_on as j1_measured_on, j1.id as j1_reading_id,
       j7.views as j7_views, j7.likes as j7_likes, j7.comments as j7_comments, j7.shares as j7_shares,
       j7.reposts as j7_reposts, j7.saves as j7_saves,
       j7.interactions as j7_interactions, j7.interaction_rate as j7_interaction_rate,
       j7.measured_on as j7_measured_on, j7.id as j7_reading_id,
       l.reading_type as latest_reading_type, l.views as latest_views, l.interactions as latest_interactions,
       l.interaction_rate as latest_interaction_rate, l.measured_on as latest_measured_on,
       l.measured_at as latest_measured_at, l.id as latest_reading_id,
       j7.views - j1.views as views_change_j1_j7,
       case when j1.views > 0 then round((j7.views - j1.views)::numeric / j1.views, 4) end as views_growth_j1_j7,
       l.views - j7.views as views_change_j7_latest
from public.publications p
left join public.metric_readings_effective j1 on j1.publication_id = p.id and j1.reading_type = 'j1'
left join public.metric_readings_effective j7 on j7.publication_id = p.id and j7.reading_type = 'j7'
left join latest l on l.publication_id = p.id;

revoke all on public.metric_readings_effective, public.publication_performance from anon, authenticated;
grant select on public.metric_readings_effective, public.publication_performance to authenticated;

commit;

-- Vérification (à lancer après) :
-- 1) doit renvoyer : metrics_legacy | j7 | 19
-- select origin, reading_type, count(*) from public.metric_readings group by 1, 2;
-- 2) doit renvoyer 0 (chaque relevé repris est identique à sa ligne metrics, même date, même auteur, aucune heure)
-- select count(*) from public.metrics m join public.metric_readings r on r.legacy_metric_id = m.id and r.origin = 'metrics_legacy'
--  where (m.views, m.likes, m.comments, m.shares, m.reposts, m.saves, m.measured_at, m.updated_by, m.updated_at)
--        is distinct from (r.views, r.likes, r.comments, r.shares, r.reposts, r.saves, r.measured_on, r.entered_by, r.entered_at)
--     or r.measured_at is not null;
-- 3) doit renvoyer 4 lignes
-- select tgname from pg_trigger where tgname in ('wakabi_metric_readings_before_insert','wakabi_metric_readings_append_only',
--   'wakabi_log_metric_readings','wakabi_metrics_to_readings');
-- 4) doit renvoyer 2 lignes avec security_invoker=true
-- select relname, reloptions from pg_class where relname in ('metric_readings_effective','publication_performance');
