-- Wakabi Performance Center — Migration 10 : analyse, imports et préférences (Phases 3, 4 et 5).
-- Base unique « wakabi-performance ». À exécuter UNE FOIS, après la 09 et l'accord écrit d'Andréas.
-- Additive : aucune ligne existante supprimée, aucune valeur d'enum ajoutée.
-- 1. objectifs (mensuels, trimestriels ou par campagne ; jamais obligatoires par contenu)
-- 2. publications.promotion : organique / sponsorisé / inconnu (défaut « inconnu » : rien n'est reconstitué)
-- 3. lots d'import CSV / Excel (traçabilité : qui, quand, quel fichier, combien de lignes créées ou ignorées)
-- 4. état des connexions aux plateformes (AUCUN jeton ni mot de passe ici : les jetons resteront côté serveur)
-- 5. vues de filtres enregistrées (chacun les siennes)
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $check$
begin
  if to_regclass('public.content_tasks') is null then
    raise exception 'Migration 09 absente : migration 10 annulée, rien n''a été modifié.';
  end if;
  if to_regclass('public.objectives') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'publications' and column_name = 'promotion') then
    raise exception 'Migration 10 déjà présente : rien n''a été modifié.';
  end if;
end
$check$;

-- 1. Objectifs.
create table public.objectives (
  id           uuid primary key default gen_random_uuid(),
  period_kind  text not null check (period_kind in ('mois', 'trimestre', 'campagne')),
  period_start date,
  period_end   date,
  campaign_id  uuid references public.campaigns(id),
  country      public.wakabi_country,
  platform_id  uuid references public.platforms(id),
  metric       text not null check (metric in ('vues', 'interactions', 'taux', 'publications', 'telechargements', 'inscriptions', 'utilisateurs_actifs')),
  target       numeric not null check (target >= 0),
  note         text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint objectives_period check (
    (period_kind = 'campagne' and campaign_id is not null)
    or (period_kind <> 'campagne' and period_start is not null and period_end is not null and period_end >= period_start)),
  constraint objectives_rate check (metric <> 'taux' or target <= 1)
);
create index objectives_period_idx on public.objectives (period_start, period_end);

-- 2. Organique / sponsorisé (par publication).
alter table public.publications add column promotion text not null default 'inconnu'
  check (promotion in ('organique', 'sponsorise', 'inconnu'));
grant update (promotion), insert (promotion) on public.publications to authenticated;

-- 3. Lots d'import.
create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null check (btrim(file_name) <> ''),
  platform_id      uuid references public.platforms(id),
  rows_total       integer not null default 0 check (rows_total >= 0),
  contents_created integer not null default 0 check (contents_created >= 0),
  publications_created integer not null default 0 check (publications_created >= 0),
  readings_created integer not null default 0 check (readings_created >= 0),
  rows_skipped     integer not null default 0 check (rows_skipped >= 0),
  report           jsonb,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);

-- 4. Connexions aux plateformes (état seulement ; aucun jeton, aucun mot de passe).
create table public.platform_connections (
  platform_id   uuid primary key references public.platforms(id),
  status        text not null default 'non_configuree' check (status in ('non_configuree', 'connectee', 'erreur', 'deconnectee')),
  account_label text,
  last_sync_at  timestamptz,
  last_error    text,
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now()
);
insert into public.platform_connections(platform_id) select id from public.platforms;

-- 5. Vues de filtres enregistrées (préférences personnelles).
create table public.saved_views (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references public.profiles(id),
  name       text not null check (btrim(name) <> '' and length(name) <= 80),
  view       text not null check (view in ('contents', 'calendar', 'analytics', 'direction', 'reports', 'tasks')),
  query      text not null default '' check (length(query) <= 2000),
  created_at timestamptz not null default now()
);
create index saved_views_owner_idx on public.saved_views (owner, view);

-- Auteur, date et journal.
create function public.wakabi_set_author_10()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_table_name = 'objectives' then
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now();
    else new.created_by := old.created_by; new.created_at := old.created_at; end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  elsif tg_table_name = 'import_batches' then
    new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now();
  elsif tg_table_name = 'platform_connections' then
    new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  elsif tg_table_name = 'saved_views' then
    new.owner := coalesce(auth.uid(), new.owner); new.created_at := now();
  end if;
  return new;
end;
$function$;
create trigger wakabi_objectives_author before insert or update on public.objectives for each row execute function public.wakabi_set_author_10();
create trigger wakabi_import_batches_author before insert on public.import_batches for each row execute function public.wakabi_set_author_10();
create trigger wakabi_platform_connections_author before update on public.platform_connections for each row execute function public.wakabi_set_author_10();
create trigger wakabi_saved_views_author before insert on public.saved_views for each row execute function public.wakabi_set_author_10();
create trigger wakabi_log_objectives after insert or update or delete on public.objectives for each row execute function public.wakabi_log_activity();
create trigger wakabi_log_import_batches after insert or update or delete on public.import_batches for each row execute function public.wakabi_log_activity();

-- Règles d'accès.
alter table public.objectives enable row level security;
alter table public.import_batches enable row level security;
alter table public.platform_connections enable row level security;
alter table public.saved_views enable row level security;
revoke all on public.objectives, public.import_batches, public.platform_connections, public.saved_views from public, anon, authenticated;
grant select, insert, update on public.objectives to authenticated;
grant select, insert on public.import_batches to authenticated;
grant select on public.platform_connections to authenticated;
grant update (account_label, status) on public.platform_connections to authenticated;
grant select, insert, delete on public.saved_views to authenticated;
create policy "wakabi10 lire objectifs" on public.objectives for select to authenticated using (public.my_role() is not null);
create policy "wakabi10 creer objectifs" on public.objectives for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy "wakabi10 modifier objectifs" on public.objectives for update to authenticated
  using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));
create policy "wakabi10 lire imports" on public.import_batches for select to authenticated using (public.my_role() in ('admin', 'editor', 'direction'));
create policy "wakabi10 creer imports" on public.import_batches for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy "wakabi10 lire connexions" on public.platform_connections for select to authenticated using (public.my_role() in ('admin', 'editor', 'direction'));
create policy "wakabi10 modifier connexions" on public.platform_connections for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "wakabi10 mes vues" on public.saved_views for select to authenticated using (owner = auth.uid() and public.my_role() is not null);
create policy "wakabi10 creer mes vues" on public.saved_views for insert to authenticated with check (owner = auth.uid() and public.my_role() is not null);
create policy "wakabi10 supprimer mes vues" on public.saved_views for delete to authenticated using (owner = auth.uid());
revoke all on function public.wakabi_set_author_10() from public, anon, authenticated;

commit;
select 'Migration 10 appliquée' as resultat, (select count(*) from public.platform_connections) as plateformes;
