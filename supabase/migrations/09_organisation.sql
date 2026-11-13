-- Wakabi Performance Center — Migration 09 : organisation de l'équipe (Phase 2).
-- Base unique « wakabi-performance ». À exécuter UNE FOIS, après la 08P et l'accord écrit d'Andréas.
-- Additive : aucune ligne existante supprimée, aucune valeur d'enum ajoutée (les états sont du texte contrôlé).
-- Droits par AFFECTATION, sans nouveaux rôles techniques (pas de 06c) :
--   - administrateur et rédaction organisent (états, tâches, validations) ;
--   - chaque membre actif fait avancer les tâches qui lui sont confiées, dépose des fichiers sur leurs contenus,
--     et peut proposer un contenu « à valider » quand il y a une tâche ;
--   - tout membre actif lit tâches, états, retours et fichiers ; chacun ne voit que ses notifications.
-- Contenu : 1. état de production des contenus  2. historique des états  3. tâches  4. retours et validations
--           5. fichiers (stockage privé « wakabi-fichiers »)  6. notifications  7. passage automatique à « Publié »
--           8. fonction « proposer à la validation »  9. droits et journal.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 0. Garde-fous.
do $check$
begin
  if to_regclass('public.publication_schedule') is null or to_regclass('public.profile_platforms') is null
     or to_regprocedure('public.my_role()') is null or to_regprocedure('public.wakabi_log_activity()') is null then
    raise exception 'Migrations 06 / 07 absentes : migration 09 annulée, rien n''a été modifié.';
  end if;
  if to_regclass('public.content_tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contents' and column_name = 'production_status') then
    raise exception 'Migration 09 déjà présente : rien n''a été modifié.';
  end if;
end
$check$;

-- 1. État de production (distinct de l'état de mesure J+1 / J+7).
alter table public.contents
  add column production_status text not null default 'idee',
  add column production_status_at timestamptz not null default now(),
  add column production_status_by uuid references public.profiles(id);
alter table public.contents add constraint wakabi_contents_production_status
  check (production_status in ('idee', 'a_produire', 'en_production', 'a_valider', 'valide', 'programme', 'publie'));
-- État de départ des contenus existants : « Publié » s'ils ont au moins un lien, sinon « À produire ».
-- Déclencheurs « modifié le / par » et journal suspendus pendant cette seule mise à jour : les colonnes existantes
-- (updated_at, updated_by) et le journal ne sont pas touchés.
alter table public.contents disable trigger wakabi_contents_updated_by;
alter table public.contents disable trigger wakabi_log_contents;
update public.contents c
   set production_status = case when exists (select 1 from public.publications p where p.content_id = c.id) then 'publie' else 'a_produire' end,
       production_status_at = coalesce(c.updated_at, c.created_at, now());
alter table public.contents enable trigger wakabi_contents_updated_by;
alter table public.contents enable trigger wakabi_log_contents;

-- 2. Historique des états : rempli par la base, jamais modifiable ni supprimable.
create table public.content_status_history (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.contents(id),
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles(id),
  changed_at  timestamptz not null default now(),
  comment     text
);
create index content_status_history_content_idx on public.content_status_history (content_id, changed_at);

-- Notification interne (appelée seulement par les déclencheurs ci-dessous).
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  recipient  uuid not null references public.profiles(id),
  kind       text not null check (kind in ('tache_affectee', 'a_valider', 'a_corriger', 'valide', 'commentaire')),
  content_id uuid references public.contents(id),
  task_id    uuid,
  message    text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient, read_at, created_at desc);
create function public.wakabi_notify(p_recipient uuid, p_kind text, p_content uuid, p_task uuid, p_message text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(recipient, kind, content_id, task_id, message)
  select p_recipient, p_kind, p_content, p_task, p_message
  where p_recipient is not null and p_recipient is distinct from auth.uid()
    and exists (select 1 from public.profiles p where p.id = p_recipient and p.active and p.archived_at is null)
$$;

create function public.wakabi_contents_status_set()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'INSERT' or new.production_status is distinct from old.production_status then
    new.production_status_at := now();
    new.production_status_by := auth.uid();
  else
    new.production_status_at := old.production_status_at;
    new.production_status_by := old.production_status_by;
  end if;
  return new;
end;
$function$;
create trigger wakabi_contents_status_set before insert or update on public.contents
  for each row execute function public.wakabi_contents_status_set();
create function public.wakabi_contents_status_log()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_comment text := nullif(btrim(coalesce(current_setting('wakabi.commentaire_etat', true), '')), '');
  r record;
begin
  if tg_op = 'INSERT' or new.production_status is distinct from old.production_status then
    insert into public.content_status_history(content_id, from_status, to_status, changed_by, comment)
    values (new.id, case when tg_op = 'UPDATE' then old.production_status end, new.production_status, auth.uid(), v_comment);
    if new.production_status = 'a_valider' then
      for r in select id from public.profiles where role in ('admin', 'editor') and active and archived_at is null loop
        perform public.wakabi_notify(r.id, 'a_valider', new.id, null, 'À valider : ' || new.title);
      end loop;
    end if;
  end if;
  return null;
end;
$function$;
create trigger wakabi_contents_status_log after insert or update of production_status on public.contents
  for each row execute function public.wakabi_contents_status_log();

-- 3. Tâches (alimentent « Mes tâches » et le calendrier ; le brief est un champ de la tâche).
create table public.content_tasks (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id),
  kind       text not null check (kind in ('redaction', 'tournage', 'montage', 'graphisme', 'publication', 'validation', 'autre')),
  title      text check (title is null or btrim(title) <> ''),
  assignee   uuid references public.profiles(id),
  due_on     date,
  status     text not null default 'a_faire' check (status in ('a_faire', 'en_cours', 'fait', 'annule')),
  brief      text,
  location   text,
  shoot_on   date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  done_at    timestamptz,
  done_by    uuid references public.profiles(id)
);
create index content_tasks_assignee_idx on public.content_tasks (assignee, status);
create index content_tasks_content_idx on public.content_tasks (content_id);
create index content_tasks_due_idx on public.content_tasks (due_on);
alter table public.notifications add constraint notifications_task_fk foreign key (task_id) references public.content_tasks(id);
-- Un membre non organisateur ne peut changer QUE l'avancement de ses tâches (à faire → en cours → fait), jamais les annuler.
-- La personne affectée doit être un membre actif.
create function public.wakabi_tasks_guard()
returns trigger language plpgsql set search_path = '' as $function$
declare
  v_role public.wakabi_role := public.my_role();
  v_keys text[] := array['status', 'updated_at', 'updated_by', 'done_at', 'done_by'];
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and v_role is distinct from 'admin' and v_role is distinct from 'editor' then
    if (to_jsonb(new) - v_keys) is distinct from (to_jsonb(old) - v_keys) then
      raise exception 'Seule la rédaction peut modifier une tâche : vous pouvez seulement la faire avancer';
    end if;
    if new.status = 'annule' or old.status = 'annule' then
      raise exception 'Seule la rédaction peut annuler ou rouvrir une tâche annulée';
    end if;
  end if;
  if new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee)
     and not exists (select 1 from public.profiles p where p.id = new.assignee and p.active and p.archived_at is null) then
    raise exception 'La personne affectée doit être un membre actif de l''équipe';
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by; new.created_at := old.created_at;
  else
    new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status is distinct from 'fait') then
    new.done_at := now(); new.done_by := coalesce(auth.uid(), new.done_by);
  elsif new.status <> 'fait' then
    new.done_at := null; new.done_by := null;
  end if;
  return new;
end;
$function$;
create trigger wakabi_tasks_guard before insert or update on public.content_tasks
  for each row execute function public.wakabi_tasks_guard();
create function public.wakabi_tasks_notify()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_title text;
begin
  if new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) and new.status <> 'annule' then
    select title into v_title from public.contents where id = new.content_id;
    perform public.wakabi_notify(new.assignee, 'tache_affectee', new.content_id, new.id,
      'Nouvelle tâche (' || new.kind || ') : ' || coalesce(new.title, v_title) || coalesce(' · échéance ' || to_char(new.due_on, 'DD/MM/YYYY'), ''));
  end if;
  return null;
end;
$function$;
create trigger wakabi_tasks_notify after insert or update of assignee on public.content_tasks
  for each row execute function public.wakabi_tasks_notify();

-- 4. Retours et validations (ajout seul). « À corriger » et « commentaire » exigent un texte.
create table public.content_feedback (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id),
  author     uuid references public.profiles(id),
  decision   text not null check (decision in ('valide', 'a_corriger', 'commentaire')),
  comment    text,
  created_at timestamptz not null default now(),
  constraint content_feedback_comment check (decision = 'valide' or btrim(coalesce(comment, '')) <> '')
);
create index content_feedback_content_idx on public.content_feedback (content_id, created_at);
create function public.wakabi_feedback_set()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.author := coalesce(auth.uid(), new.author);
  new.created_at := now();
  return new;
end;
$function$;
create trigger wakabi_feedback_set before insert on public.content_feedback
  for each row execute function public.wakabi_feedback_set();
create function public.wakabi_feedback_apply()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_title text; v_status text; v_creator uuid; r record;
begin
  select title, production_status, created_by into v_title, v_status, v_creator from public.contents where id = new.content_id;
  if new.decision = 'valide' and v_status in ('a_valider', 'en_production', 'a_produire', 'idee') then
    perform set_config('wakabi.commentaire_etat', coalesce(new.comment, ''), true);
    update public.contents set production_status = 'valide' where id = new.content_id;
  elsif new.decision = 'a_corriger' and v_status in ('a_valider', 'valide') then
    perform set_config('wakabi.commentaire_etat', new.comment, true);
    update public.contents set production_status = 'en_production' where id = new.content_id;
  end if;
  perform set_config('wakabi.commentaire_etat', '', true);
  for r in select distinct assignee as id from public.content_tasks
            where content_id = new.content_id and assignee is not null and status <> 'annule'
           union select v_creator where new.decision = 'commentaire' loop
    perform public.wakabi_notify(r.id, new.decision, new.content_id, null,
      case new.decision when 'valide' then 'Validé : ' when 'a_corriger' then 'À corriger : ' else 'Commentaire : ' end
      || v_title || coalesce(' — ' || left(new.comment, 140), ''));
  end loop;
  return null;
end;
$function$;
create trigger wakabi_feedback_apply after insert on public.content_feedback
  for each row execute function public.wakabi_feedback_apply();

-- 5. Fichiers : compartiment PRIVÉ « wakabi-fichiers », chemin contents/<id du contenu>/<nom>. Rien n'est supprimé :
--    un fichier se « retire » (removed_at), l'objet reste dans le stockage.
create table public.content_files (
  id           uuid primary key default gen_random_uuid(),
  content_id   uuid not null references public.contents(id),
  task_id      uuid references public.content_tasks(id),
  storage_path text not null unique check (storage_path ~ '^contents/[0-9a-f-]{36}/.+'),
  file_name    text not null check (btrim(file_name) <> ''),
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  uploaded_by  uuid references public.profiles(id),
  uploaded_at  timestamptz not null default now(),
  removed_at   timestamptz,
  removed_by   uuid references public.profiles(id)
);
create index content_files_content_idx on public.content_files (content_id);
-- Peut déposer sur un contenu : administrateur, rédaction, ou membre ayant une tâche (non annulée) sur ce contenu.
create function public.wakabi_can_work_on(p_content uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_role() in ('admin', 'editor')
      or (public.my_role() is not null and exists (select 1 from public.content_tasks t
           where t.content_id = p_content and t.assignee = auth.uid() and t.status <> 'annule'))
$$;
create function public.wakabi_can_upload_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare v_id uuid;
begin
  if p_name !~ '^contents/[0-9a-f-]{36}/[^/]+$' then return false; end if;
  v_id := split_part(p_name, '/', 2)::uuid;
  return public.wakabi_can_work_on(v_id);
exception when others then return false;
end;
$function$;
create function public.wakabi_files_guard()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by); new.uploaded_at := now();
    new.removed_at := null; new.removed_by := null;
    if split_part(new.storage_path, '/', 2) <> new.content_id::text then
      raise exception 'Le chemin du fichier ne correspond pas au contenu';
    end if;
  else
    if (to_jsonb(new) - array['removed_at', 'removed_by']) is distinct from (to_jsonb(old) - array['removed_at', 'removed_by']) then
      raise exception 'Un fichier déposé ne se modifie pas : retirez-le et déposez-en un nouveau';
    end if;
    if auth.uid() is not null and old.uploaded_by is distinct from auth.uid() and public.my_role() is distinct from 'admin' and public.my_role() is distinct from 'editor' then
      raise exception 'Seuls l''auteur du dépôt et la rédaction peuvent retirer un fichier';
    end if;
    if new.removed_at is not null and old.removed_at is null then new.removed_at := now(); new.removed_by := auth.uid(); end if;
  end if;
  return new;
end;
$function$;
create trigger wakabi_files_guard before insert or update on public.content_files
  for each row execute function public.wakabi_files_guard();
insert into storage.buckets(id, name, public, file_size_limit)
values ('wakabi-fichiers', 'wakabi-fichiers', false, 26214400)
on conflict (id) do nothing;
create policy "wakabi09 lire fichiers" on storage.objects for select to authenticated
  using (bucket_id = 'wakabi-fichiers' and public.my_role() is not null);
create policy "wakabi09 deposer fichiers" on storage.objects for insert to authenticated
  with check (bucket_id = 'wakabi-fichiers' and public.wakabi_can_upload_path(name));

-- 7. Passage automatique à « Publié » dès qu'une date effective de publication est enregistrée (aucune saisie de plus).
create function public.wakabi_publications_mark_published()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.published_on is not null and (tg_op = 'INSERT' or old.published_on is null) then
    update public.contents set production_status = 'publie' where id = new.content_id and production_status <> 'publie';
  end if;
  return null;
end;
$function$;
create trigger wakabi_publications_mark_published after insert or update of published_on on public.publications
  for each row execute function public.wakabi_publications_mark_published();

-- 8. Un membre affecté propose son contenu à la validation (il ne peut pas modifier le contenu lui-même).
create function public.wakabi_content_submit(p_content uuid, p_comment text default null)
returns text language plpgsql security definer set search_path = '' as $function$
declare v_status text;
begin
  if not public.wakabi_can_work_on(p_content) then
    raise exception 'Réservé à la rédaction et aux membres ayant une tâche sur ce contenu';
  end if;
  select production_status into v_status from public.contents where id = p_content and archived_at is null for update;
  if v_status is null then raise exception 'Contenu introuvable ou archivé'; end if;
  if v_status not in ('a_produire', 'en_production') then
    raise exception 'Ce contenu ne peut pas être proposé à la validation depuis l''état « % »', v_status;
  end if;
  perform set_config('wakabi.commentaire_etat', coalesce(p_comment, ''), true);
  update public.contents set production_status = 'a_valider' where id = p_content;
  perform set_config('wakabi.commentaire_etat', '', true);
  return 'a_valider';
end;
$function$;

-- 9. Règles d'accès (RLS), droits, journal.
alter table public.content_status_history enable row level security;
alter table public.content_tasks enable row level security;
alter table public.content_feedback enable row level security;
alter table public.content_files enable row level security;
alter table public.notifications enable row level security;
revoke all on public.content_status_history, public.content_tasks, public.content_feedback, public.content_files, public.notifications
  from public, anon, authenticated;
grant select on public.content_status_history to authenticated;
grant select, insert, update on public.content_tasks to authenticated;
grant select, insert on public.content_feedback to authenticated;
grant select, insert on public.content_files to authenticated;
grant update (removed_at) on public.content_files to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "wakabi09 lire historique" on public.content_status_history for select to authenticated using (public.my_role() is not null);
create policy "wakabi09 lire taches" on public.content_tasks for select to authenticated using (public.my_role() is not null);
create policy "wakabi09 creer taches" on public.content_tasks for insert to authenticated
  with check (public.my_role() in ('admin', 'editor'));
create policy "wakabi09 avancer taches" on public.content_tasks for update to authenticated
  using (public.my_role() in ('admin', 'editor') or (public.my_role() is not null and assignee = auth.uid()))
  with check (public.my_role() in ('admin', 'editor') or (public.my_role() is not null and assignee = auth.uid()));
create policy "wakabi09 lire retours" on public.content_feedback for select to authenticated using (public.my_role() is not null);
create policy "wakabi09 donner retour" on public.content_feedback for insert to authenticated
  with check (public.my_role() is not null and (decision = 'commentaire' or public.my_role() in ('admin', 'editor')));
create policy "wakabi09 lire fichiers" on public.content_files for select to authenticated using (public.my_role() is not null);
create policy "wakabi09 deposer fichiers" on public.content_files for insert to authenticated
  with check (public.wakabi_can_work_on(content_id));
create policy "wakabi09 retirer fichiers" on public.content_files for update to authenticated
  using (public.my_role() in ('admin', 'editor') or (public.my_role() is not null and uploaded_by = auth.uid()))
  with check (public.my_role() in ('admin', 'editor') or (public.my_role() is not null and uploaded_by = auth.uid()));
create policy "wakabi09 mes notifications" on public.notifications for select to authenticated
  using (recipient = auth.uid() and public.my_role() is not null);
create policy "wakabi09 lire mes notifications" on public.notifications for update to authenticated
  using (recipient = auth.uid() and public.my_role() is not null) with check (recipient = auth.uid());
-- Fonctions : rien pour PUBLIC ni anon ; le navigateur connecté n'appelle que wakabi_content_submit et wakabi_can_work_on.
revoke all on function public.wakabi_notify(uuid, text, uuid, uuid, text), public.wakabi_contents_status_set(),
  public.wakabi_contents_status_log(), public.wakabi_tasks_guard(), public.wakabi_tasks_notify(), public.wakabi_feedback_set(),
  public.wakabi_feedback_apply(), public.wakabi_can_work_on(uuid), public.wakabi_can_upload_path(text), public.wakabi_files_guard(),
  public.wakabi_publications_mark_published(), public.wakabi_content_submit(uuid, text)
  from public, anon, authenticated;
grant execute on function public.wakabi_content_submit(uuid, text), public.wakabi_can_work_on(uuid), public.wakabi_can_upload_path(text) to authenticated;
-- Journal automatique (mêmes déclencheurs que les autres tables).
create trigger wakabi_log_content_tasks after insert or update or delete on public.content_tasks for each row execute function public.wakabi_log_activity();
create trigger wakabi_log_content_feedback after insert or update or delete on public.content_feedback for each row execute function public.wakabi_log_activity();
create trigger wakabi_log_content_files after insert or update or delete on public.content_files for each row execute function public.wakabi_log_activity();

commit;

-- Vérification : états de départ (attendu : « publie » pour les contenus avec lien, « a_produire » sinon).
select production_status as etat, count(*) as contenus from public.contents group by 1 order by 1;
