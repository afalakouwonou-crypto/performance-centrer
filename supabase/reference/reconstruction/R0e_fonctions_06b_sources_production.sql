-- R0e — Sources EXACTES de production des 3 fonctions de la 06b, telles qu'exécutées par ChatGPT (forme compacte).
-- Fournies par R0_detail_3_fonctions.sql (lecture seule, 3 novembre 2026). Logique identique jeton par jeton à
-- migrations/06b_correctif_equipe.sql ; seuls l'espacement, les commentaires et le « ; » final diffèrent.
-- Réservé à la RECETTE et à la copie locale (après R0b) ; la production n'est pas modifiée.
-- md5 attendus de prosrc : wakabi_assignment_guard f46e1f3e54d1f4420a082cceb4833116, wakabi_profiles_password_flag a9ff7f951f0d6b60127d01bfa95c9ae2, wakabi_profiles_sync_platform 4be84948d9e5966fef0df6b48f9cb57a
do $g$ begin
  if exists (select 1 from public.contents where title not like '[RECETTE]%')
     and current_setting('wakabi.copie_locale', true) is distinct from 'oui' then
    raise exception 'Base contenant de vrais contenus : R0e refusé (production). Rien n''a été modifié.';
  end if;
end $g$;
create or replace function public.wakabi_assignment_guard() returns trigger language plpgsql set search_path = '' as $wk$ begin
 if tg_op='INSERT' then
  if current_user='authenticated' then new.created_by:=auth.uid(); end if; new.created_at:=now();
 elsif (new.id,new.profile_id,new.platform_id,new.created_at,new.created_by) is distinct from (old.id,old.profile_id,old.platform_id,old.created_at,old.created_by) then raise exception 'Révoquer ou réactiver une affectation sans changer son identité'; end if;
 if new.revoked_at is null and not exists(select 1 from public.platforms f where f.id=new.platform_id and f.status='active') then raise exception 'Plateforme inactive'; end if;
 if tg_op='UPDATE' and new.revoked_at is not null then
  if old.revoked_at is null then
   if exists(select 1 from public.profiles p join public.platforms f on f.code=p.platform::text where p.id=new.profile_id and f.id=new.platform_id) then raise exception 'C''est la plateforme principale de ce membre : changez d''abord sa plateforme principale'; end if;
   new.revoked_at:=now();
  else new.revoked_at:=old.revoked_at; end if;
 end if;
 return new; end $wk$;
create or replace function public.wakabi_profiles_password_flag() returns trigger language plpgsql set search_path = '' as $wk$ begin
 if current_user in ('anon','authenticated') and old.must_change_password and not new.must_change_password then raise exception 'L''obligation de changer de mot de passe ne peut être levée que par un vrai changement de mot de passe'; end if;
 return new; end $wk$;
create or replace function public.wakabi_profiles_sync_platform() returns trigger language plpgsql security definer set search_path = '' as $wk$ begin
 if new.platform is not distinct from old.platform then return null; end if;
 if old.platform is not null then
  update public.profile_platforms a set revoked_at=now() from public.platforms f where a.profile_id=new.id and f.id=a.platform_id and f.code=old.platform::text and a.revoked_at is null;
 end if;
 if new.platform is not null then
  insert into public.profile_platforms(profile_id,platform_id,created_by) select new.id,f.id,auth.uid() from public.platforms f where f.code=new.platform::text
  on conflict(profile_id,platform_id) do update set revoked_at=null where public.profile_platforms.revoked_at is not null;
 end if;
 return null; end $wk$;
-- Contrôle : les 3 md5 doivent être identiques à ceux de la production.
select proname, md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('wakabi_assignment_guard','wakabi_profiles_password_flag','wakabi_profiles_sync_platform') order by 1;
