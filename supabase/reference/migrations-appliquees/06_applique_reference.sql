-- RÉFÉRENCE UNIQUEMENT — NE PAS EXÉCUTER : migration 06 réellement appliquée et validée en production (2026-11-03),
-- transmise dans le fil le 2026-11-03 (SQL recopié tel quel, entités HTML décodées).
-- État confirmé après COMMIT : 7 profils actifs (1 admin, 1 editor, 1 direction, 4 platform_manager),
-- 9 contenus, 31 publications, 19 metrics, 19 metric_readings.
-- Remplace le fichier 06_equipe_roles.sql (proposition non appliquée, conservée pour mémoire).
begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
do $$ begin
 if to_regclass('public.metric_readings') is null or to_regclass('public.content_objectives') is null or to_regclass('public.profile_platforms') is not null then raise exception 'Prérequis absents ou migration 06 déjà présente'; end if;
 if not exists(select 1 from public.profiles where role='admin' and active) then raise exception 'Aucun administrateur actif'; end if;
end $$;
lock table public.profiles in share row exclusive mode;
create temporary table wakabi06_before on commit drop as select (select count(*) from public.profiles) profiles,(select count(*) from public.contents) contents,(select count(*) from public.publications) publications,(select count(*) from public.metrics) metrics,(select count(*) from public.metric_readings) readings;
alter table public.profiles add column job_title text,add column archived_at timestamptz,add column archived_by uuid references public.profiles(id),add column must_change_password boolean not null default false,add column password_changed_at timestamptz;
alter table public.profiles alter column must_change_password set default true;
alter table public.profiles add constraint wakabi_profile_archive_inactive check(archived_at is null or active=false);
create table public.profile_platforms(id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.profiles(id) on delete restrict,platform_id uuid not null references public.platforms(id) on delete restrict,created_at timestamptz not null default now(),created_by uuid references public.profiles(id),revoked_at timestamptz,unique(profile_id,platform_id));
insert into public.profile_platforms(profile_id,platform_id) select p.id,f.id from public.profiles p join public.platforms f on f.code=p.platform::text;
alter table public.profile_platforms enable row level security;
create or replace function public.my_role() returns public.wakabi_role language sql stable security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password $$;
create or replace function public.my_platform() returns public.wakabi_platform language sql stable security definer set search_path='' as $$ select platform from public.profiles where id=auth.uid() and active and archived_at is null and not must_change_password $$;
create function public.wakabi_can_manage_platform(target uuid) returns boolean language sql stable security definer set search_path='' as $$ select coalesce(public.my_role() in ('editor','admin') or (public.my_role()='platform_manager' and exists(select 1 from public.profile_platforms a where a.profile_id=auth.uid() and a.platform_id=target and a.revoked_at is null)),false) $$;
revoke all on function public.wakabi_can_manage_platform(uuid) from public,anon; grant execute on function public.wakabi_can_manage_platform(uuid) to authenticated;
create function public.wakabi_profiles_serialize() returns trigger language plpgsql security definer set search_path='' as $$ begin lock table public.profiles in share row exclusive mode; return null; end $$;
create trigger wakabi_profiles_serialize before update or delete on public.profiles for each statement execute function public.wakabi_profiles_serialize();
create function public.wakabi_profiles_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'Suppression physique interdite : désactiver puis archiver le membre'; end if;
 if new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Identité et date de création immuables'; end if;
 if btrim(new.full_name)='' then raise exception 'Nom obligatoire'; end if;
 if new.archived_at is not null then new.active:=false;
  if old.archived_at is null then new.archived_at:=now(); new.archived_by:=auth.uid(); else new.archived_at:=old.archived_at; new.archived_by:=old.archived_by; end if;
 else new.archived_by:=null; end if;
 if old.role='admin' and old.active and old.archived_at is null and not old.must_change_password and (new.role<>'admin' or not new.active or new.archived_at is not null or new.must_change_password) and not exists(select 1 from public.profiles p where p.id<>old.id and p.role='admin' and p.active and p.archived_at is null and not p.must_change_password) then raise exception 'Le dernier administrateur actif doit être conservé'; end if;
 return new; end $$;
create trigger wakabi_profiles_guard before update or delete on public.profiles for each row execute function public.wakabi_profiles_guard();
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.profiles(id,email,full_name,role,active,must_change_password) values(new.id,new.email,coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),'platform_manager',false,true); return new; end $$;
create function public.wakabi_password_changed() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.profiles set must_change_password=false,password_changed_at=now() where id=new.id; return new; end $$;
create trigger wakabi_password_changed after update of encrypted_password on auth.users for each row when(old.encrypted_password is distinct from new.encrypted_password and coalesce(new.encrypted_password,'')<>'') execute function public.wakabi_password_changed();
grant update(full_name,role,country,platform,active,job_title,archived_at) on public.profiles to authenticated;
create policy "wakabi06 admins update profiles" on public.profiles for update to authenticated using(public.my_role()='admin') with check(public.my_role()='admin');
revoke all on public.profile_platforms from public,anon,authenticated;
grant select,insert on public.profile_platforms to authenticated; grant update(revoked_at) on public.profile_platforms to authenticated; revoke delete,truncate on public.profile_platforms from authenticated,anon;
create policy "wakabi06 read assignments" on public.profile_platforms for select to authenticated using(profile_id=auth.uid() or public.my_role() in ('admin','editor','direction'));
create policy "wakabi06 admins assign" on public.profile_platforms for insert to authenticated with check(public.my_role()='admin');
create policy "wakabi06 admins revoke" on public.profile_platforms for update to authenticated using(public.my_role()='admin') with check(public.my_role()='admin');
create function public.wakabi_assignment_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then if current_user='authenticated' then new.created_by:=auth.uid(); end if; new.created_at:=now();
 elsif (new.id,new.profile_id,new.platform_id,new.created_at,new.created_by) is distinct from (old.id,old.profile_id,old.platform_id,old.created_at,old.created_by) then raise exception 'Révoquer ou réactiver une affectation sans changer son identité'; end if;
 if new.revoked_at is null and not exists(select 1 from public.platforms f where f.id=new.platform_id and f.status='active') then raise exception 'Plateforme inactive'; end if;
 if tg_op='UPDATE' and new.revoked_at is not null and old.revoked_at is null then new.revoked_at:=now(); end if; return new; end $$;
create trigger wakabi_assignment_guard before insert or update on public.profile_platforms for each row execute function public.wakabi_assignment_guard();
create trigger wakabi_log_profile_platforms after insert or update on public.profile_platforms for each row execute function public.wakabi_log_activity();
drop policy "authorized users insert metrics" on public.metrics; drop policy "authorized users update metrics" on public.metrics; drop policy "authorized users insert metric readings" on public.metric_readings;
create policy "authorized users insert metrics" on public.metrics for insert to authenticated with check(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id)));
create policy "authorized users update metrics" on public.metrics for update to authenticated using(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id))) with check(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id)));
create policy "authorized users insert metric readings" on public.metric_readings for insert to authenticated with check(exists(select 1 from public.publications p where p.id=publication_id and public.wakabi_can_manage_platform(p.platform_id)));
revoke all on function public.wakabi_profiles_serialize(),public.wakabi_profiles_guard(),public.wakabi_password_changed(),public.wakabi_assignment_guard() from public,anon,authenticated;
do $$ declare b record; begin select * into b from wakabi06_before;
 if b.profiles<>(select count(*) from public.profiles) or b.contents<>(select count(*) from public.contents) or b.publications<>(select count(*) from public.publications) or b.metrics<>(select count(*) from public.metrics) or b.readings<>(select count(*) from public.metric_readings) then raise exception 'Contrôle de conservation échoué'; end if;
 if exists(select 1 from public.profiles where must_change_password) then raise exception 'Un profil existant a été forcé à changer son mot de passe'; end if;
 if exists(select 1 from public.profiles p where p.platform is not null and not exists(select 1 from public.profile_platforms a join public.platforms f on f.id=a.platform_id where a.profile_id=p.id and f.code=p.platform::text and a.revoked_at is null)) then raise exception 'Reprise des affectations incomplète'; end if;
end $$;
commit;
