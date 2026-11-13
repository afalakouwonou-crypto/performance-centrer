-- Annulation de la migration 01 : remet la base exactement dans l'état du 2026-10-28.
begin;
drop trigger if exists wakabi_contents_created_by on public.contents;
drop trigger if exists wakabi_metrics_updated_by  on public.metrics;
drop trigger if exists wakabi_app_kpis_updated_by on public.app_kpis;
drop function if exists public.wakabi_set_created_by();
drop function if exists public.wakabi_set_updated_by();
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles(id,email,full_name,role,active)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),'platform_manager',true);
  return new;
end;
$function$;
commit;
