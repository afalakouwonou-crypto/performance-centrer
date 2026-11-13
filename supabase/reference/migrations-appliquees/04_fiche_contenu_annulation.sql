-- Annulation de la migration 04 : retire ce que la migration 04 a ajouté.
-- Toutes les colonnes et valeurs antérieures à la migration 04 sont conservées.
-- Attention : les objectifs, captions, scripts et archivages saisis après la migration 04 sont perdus
-- (les lignes déjà écrites dans activity_log, elles, sont conservées).
-- Les fonctions partagées des migrations 01, 02 et 03 sont conservées ; la vérification des listes
-- retrouve exactement sa version de la migration 03.
begin;
drop trigger if exists wakabi_contents_archive    on public.contents;
drop trigger if exists wakabi_contents_updated_by on public.contents;
drop function if exists public.wakabi_contents_archive();

create or replace function public.wakabi_contents_check_lists()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_name   text;
  v_status text;
begin
  -- l'application actuelle envoie le texte : si seul le texte change, on recalcule l'identifiant
  if tg_op = 'UPDATE' and new.rubrique is distinct from old.rubrique
     and new.rubrique_id is not distinct from old.rubrique_id then
    new.rubrique_id := null;
  end if;

  if new.rubrique_id is null then
    select r.id into new.rubrique_id from public.rubriques r where r.name = new.rubrique;
  end if;

  select r.name, r.status into v_name, v_status from public.rubriques r where r.id = new.rubrique_id;
  if v_name is null then
    raise exception 'Rubrique inconnue : %', coalesce(new.rubrique, '(vide)');
  end if;
  new.rubrique := v_name;

  if (tg_op = 'INSERT' or new.rubrique_id is distinct from old.rubrique_id) and v_status <> 'active' then
    raise exception 'La rubrique % n''est pas active', v_name;
  end if;

  if new.content_type_id is not null and (tg_op = 'INSERT' or new.content_type_id is distinct from old.content_type_id)
     and not exists (select 1 from public.content_types t where t.id = new.content_type_id and t.status = 'active') then
    raise exception 'Ce type de contenu n''est pas actif';
  end if;

  if new.campaign_id is not null and (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and not exists (select 1 from public.campaigns c where c.id = new.campaign_id and c.status = 'active') then
    raise exception 'Cette campagne n''est pas active';
  end if;

  return new;
end;
$function$;

alter table public.contents drop column if exists objective_id;
alter table public.contents drop column if exists caption;
alter table public.contents drop column if exists script;
alter table public.contents drop column if exists archived_at;
alter table public.contents drop column if exists archived_by;
alter table public.contents drop column if exists updated_at;
alter table public.contents drop column if exists updated_by;

drop table if exists public.content_objectives;  -- supprime aussi ses déclencheurs et règles
commit;
