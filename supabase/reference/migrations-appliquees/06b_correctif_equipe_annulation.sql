-- Annulation de la migration 06b : revient exactement à l'état de la migration 06 appliquée.
-- Ne supprime aucune donnée. Les affectations créées ou révoquées entre-temps (y compris par la synchronisation
-- de la plateforme principale) restent telles quelles, et restent visibles dans activity_log.
-- Droits : revient aux droits constatés en production avant 06b (diagnostic D06 du 3 novembre 2026) :
-- authenticated garde SELECT et UPDATE sur les 7 colonnes de la migration 06 ; seule la colonne
-- must_change_password redevient non modifiable. Aucun droit de table n'est rétabli (il n'en existait pas).
begin;
drop trigger if exists wakabi_profiles_sync_platform on public.profiles;
drop function if exists public.wakabi_profiles_sync_platform();
drop trigger if exists wakabi_profiles_password_flag on public.profiles;
drop function if exists public.wakabi_profiles_password_flag();

create or replace function public.wakabi_assignment_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then if current_user='authenticated' then new.created_by:=auth.uid(); end if; new.created_at:=now();
 elsif (new.id,new.profile_id,new.platform_id,new.created_at,new.created_by) is distinct from (old.id,old.profile_id,old.platform_id,old.created_at,old.created_by) then raise exception 'Révoquer ou réactiver une affectation sans changer son identité'; end if;
 if new.revoked_at is null and not exists(select 1 from public.platforms f where f.id=new.platform_id and f.status='active') then raise exception 'Plateforme inactive'; end if;
 if tg_op='UPDATE' and new.revoked_at is not null and old.revoked_at is null then new.revoked_at:=now(); end if; return new; end $$;
revoke all on function public.wakabi_assignment_guard() from public, anon, authenticated;

revoke update (must_change_password) on public.profiles from authenticated;
commit;
