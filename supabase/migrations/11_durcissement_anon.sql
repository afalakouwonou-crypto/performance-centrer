-- Wakabi Performance Center — 11 : durcissement des droits du visiteur non connecté (décision D8). Facultatif.
-- En clair : aujourd'hui, le rôle « anon » a encore un droit de lecture sur les 5 listes et sur le journal, mais les
-- règles RLS l'empêchent de voir la moindre ligne (vérifié le 12/11/2026 : 0 ligne). Ce script retire aussi ce droit :
-- une seconde protection, sans effet pour l'équipe connectée.
-- Annulation : 11_durcissement_anon_annulation.sql (redonne exactement les droits retirés, enregistrés ici).
begin;
set local lock_timeout = '5s';
create table if not exists public.wakabi_m11_state (table_name text, privilege text, noted_at timestamptz not null default now());
alter table public.wakabi_m11_state enable row level security;
revoke all on public.wakabi_m11_state from public, anon, authenticated;
insert into public.wakabi_m11_state(table_name, privilege)
select g.table_name, g.privilege_type from information_schema.role_table_grants g
where g.grantee = 'anon' and g.table_schema = 'public'
  and g.table_name in ('rubriques', 'platforms', 'content_types', 'campaigns', 'content_objectives', 'activity_log');
revoke all on public.rubriques, public.platforms, public.content_types, public.campaigns, public.content_objectives, public.activity_log from anon;
commit;
select table_name, string_agg(privilege, ', ') as droits_retires_a_anon from public.wakabi_m11_state group by 1 order by 1;
