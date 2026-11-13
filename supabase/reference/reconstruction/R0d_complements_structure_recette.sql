-- R0d — Compléments de structure constatés en PRODUCTION (R0_detail_structure, 3 novembre 2026) et absents des
-- migrations 01 à 07 : 3 index créés avant la reprise du projet (absents de l'export du 28/10). Réservé à la RECETTE
-- et à la copie locale ; la production les possède déjà et n'est pas modifiée.
do $g$ begin
  if exists (select 1 from public.contents where title not like '[RECETTE]%')
     and current_setting('wakabi.copie_locale', true) is distinct from 'oui' then
    raise exception 'Base contenant de vrais contenus : R0d refusé (production). Rien n''a été modifié.';
  end if;
end $g$;
create index if not exists idx_contents_publish_date on public.contents using btree (publish_date desc);
create index if not exists idx_metrics_publication   on public.metrics using btree (publication_id);
create index if not exists idx_publications_content  on public.publications using btree (content_id);
