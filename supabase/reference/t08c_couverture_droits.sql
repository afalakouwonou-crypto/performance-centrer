-- Couverture de la règle de session (migration 08) sur TOUTES les règles RLS, vues et fonctions accessibles au
-- navigateur connecté. Copie locale ; tout est annulé à la fin. Les listes sont lues dans le catalogue : une table,
-- une règle ou une fonction ajoutée plus tard est testée automatiquement (ou fait échouer l'inventaire).
\set ON_ERROR_STOP 1
begin;
create function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'ÉCHEC : %', p_name; end if; raise notice 'OK  %', p_name; end $$;
grant execute on function pg_temp.ok(text, boolean) to authenticated;
create function pg_temp.claims(p_user text, p_auth timestamptz) returns void language plpgsql security definer as $$
declare v uuid; begin
  select id into v from public.profiles where username = p_user;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', case when p_auth is null then jsonb_build_object('sub', v, 'role', 'authenticated')
     else jsonb_build_object('sub', v, 'role', 'authenticated',
          'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from p_auth)::bigint))) end::text, true);
end $$;
grant execute on function pg_temp.claims(text, timestamptz) to authenticated;
update public.profiles set username = split_part(split_part(email,'+',2),'@',1) where email like 'afalakouwonou+%';
update public.profiles set username = 'r-admin' where email like 'test+r-admin%';
update public.profiles set must_change_password = false, active = true where username in ('r-redac','r-direction','r-tiktok');
create temp table wk_case(state text, uname text, auth_at timestamptz) on commit drop;
grant select on wk_case to authenticated;

-- 0. Inventaire : la liste des fonctions exécutables par le navigateur connecté est exactement celle attendue.
select pg_temp.ok('0a fonctions non-déclencheur accessibles au navigateur = liste examinée (9)',
  (select array_agg(p.proname order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute'))
  = array['my_platform','my_role','wakabi_am_admin','wakabi_can_manage_platform','wakabi_country_tz','wakabi_local_date',
          'wakabi_self_fresh','wakabi_session_status','wakabi_username_suggestion']::name[]);
select pg_temp.ok('0b aucune fonction accessible à anon hors déclencheurs et fonctions de calcul de date',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('wakabi_country_tz','wakabi_local_date','my_role','my_platform','wakabi_can_manage_platform')));
-- Chaque règle RLS des rôles navigateur passe par une fonction qui applique la règle de session.
select pg_temp.ok('0c chaque règle (lecture et écriture) dépend de my_role(), wakabi_can_manage_platform() ou wakabi_self_fresh()',
  not exists (select 1 from pg_policies where schemaname = 'public'
    and (roles && array['authenticated','anon','public']::name[])
    and ((qual is not null and qual !~ '(my_role\(\)|wakabi_can_manage_platform\(|wakabi_self_fresh\(\))')
      or (with_check is not null and with_check !~ '(my_role\(\)|wakabi_can_manage_platform\(|wakabi_self_fresh\(\))'))));
select pg_temp.ok('0d aucune branche « auth.uid() seul » : chaque auth.uid() d''une règle est accompagné d''une condition de session',
  not exists (select 1 from pg_policies where schemaname = 'public'
    and coalesce(qual,'') ~ 'auth\.uid\(\)' and coalesce(qual,'') !~ '\(\(\w+ = auth\.uid\(\)\) AND (wakabi_self_fresh\(\)|\(my_role\(\) IS NOT NULL\))\)'));
select pg_temp.ok('0e toutes les tables du schéma public ont RLS ; vues en security_invoker',
  not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity)
  and not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
                    and not coalesce(c.reloptions @> array['security_invoker=true'], false)));

-- Contrôle positif : session de la semaine, rôle admin -> les données sont visibles (le test n'est pas vide).
set local role authenticated;
select pg_temp.claims('r-admin', now());
select pg_temp.ok('P1 contrôle : admin avec session de la semaine voit les contenus et les profils',
  (select count(*) from public.contents) > 0 and (select count(*) from public.profiles) > 1 and public.my_role() = 'admin');
reset role;

-- États refusés x 4 rôles : authentifié avant lundi, sans amr, révoqué, désactivé, retiré.
insert into wk_case select s, u, a from (values
  ('avant lundi', public.wakabi_week_start() - interval '1 minute'),
  ('sans amr', null::timestamptz),
  ('révoqué', now() - interval '1 minute'),
  ('désactivé', now() - interval '1 minute'),
  ('retiré', now() - interval '1 minute')) v(s, a)
  cross join (values ('r-admin'), ('r-redac'), ('r-direction'), ('r-tiktok')) w(u);

do $t$
declare
  c record; t record; v_n bigint; v_cnt int := 0; v_col text; v_err text; v_state text; v_row jsonb;
begin
  for c in select * from wk_case order by state, uname loop
    -- mise en place de l'état (en administrateur de la base), dans un sous-bloc annulé ensuite
    begin
      if c.state = 'révoqué' then update public.profiles set sessions_valid_after = now() where username = c.uname; end if;
      if c.state = 'désactivé' then
        if c.uname = 'r-admin' then update public.profiles set role = 'admin', active = true, must_change_password = false where username = 'r-redac'; end if;
        update public.profiles set active = false where username = c.uname;
      end if;
      if c.state = 'retiré' then
        if c.uname = 'r-admin' then update public.profiles set role = 'admin', active = true, must_change_password = false where username = 'r-redac'; end if;
        update public.profiles set archived_at = now() where username = c.uname;
      end if;
      perform pg_temp.claims(c.uname, c.auth_at);
      set local role authenticated;
      v_state := public.wakabi_session_status();
      if v_state = 'ok' then raise exception 'ÉCHEC : % / % : statut ok', c.state, c.uname; end if;
      if public.my_role() is not null or public.my_platform() is not null or public.wakabi_am_admin() or public.wakabi_self_fresh() then
        raise exception 'ÉCHEC : % / % : une fonction de droit répond encore', c.state, c.uname;
      end if;
      if exists (select 1 from public.platforms where public.wakabi_can_manage_platform(id)) then
        raise exception 'ÉCHEC : % / % : wakabi_can_manage_platform vrai', c.state, c.uname;
      end if;
      begin perform public.wakabi_username_suggestion('abc'); raise exception 'ÉCHEC : % / % : suggestion accessible', c.state, c.uname;
      exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; end;
      -- lecture : toutes les tables et vues lisibles par le navigateur
      for t in select c2.relname from pg_class c2 where c2.relnamespace = 'public'::regnamespace and c2.relkind in ('r','v')
                 and has_table_privilege('authenticated', c2.oid, 'select') order by 1 loop
        execute format('select count(*) from public.%I', t.relname) into v_n;
        if v_n <> 0 then raise exception 'ÉCHEC : % / % : % ligne(s) lisibles dans %', c.state, c.uname, v_n, t.relname; end if;
        v_cnt := v_cnt + 1;
      end loop;
      -- modification : toutes les tables modifiables (une colonne autorisée réécrite à l'identique) -> 0 ligne
      for t in select c2.relname, (select a.attname from pg_attribute a where a.attrelid = c2.oid and a.attnum > 0 and not a.attisdropped
                        and has_column_privilege('authenticated', c2.oid, a.attnum, 'update') order by a.attnum limit 1) col
                 from pg_class c2 where c2.relnamespace = 'public'::regnamespace and c2.relkind = 'r'
                 and exists (select 1 from pg_attribute a where a.attrelid = c2.oid and a.attnum > 0
                               and has_column_privilege('authenticated', c2.oid, a.attnum, 'update')) order by 1 loop
        begin
          execute format('update public.%I set %I = %I', t.relname, t.col, t.col);
          get diagnostics v_n = row_count;
        exception when others then v_n := 0; end;
        if v_n <> 0 then raise exception 'ÉCHEC : % / % : % ligne(s) modifiées dans %', c.state, c.uname, v_n, t.relname; end if;
        v_cnt := v_cnt + 1;
      end loop;
      raise exception 'FIN';
    exception when others then
      if sqlerrm like 'ÉCHEC%' then raise; end if;
      if sqlerrm <> 'FIN' then raise exception 'ÉCHEC : % / % : erreur inattendue %', c.state, c.uname, sqlerrm; end if;
    end;
  end loop;
  raise notice 'OK  1 % contrôles de lecture et de modification : 5 états refusés x 4 rôles, aucune ligne lisible ni modifiable', v_cnt;
end $t$;

-- Insertion : une copie d'une ligne existante de chaque table insérable est refusée (par RLS ou par un contrôle qui ne voit plus les listes)
-- (contrôle : la même insertion par un admin avec une session de la semaine n'est pas refusée par RLS).
do $i$
declare
  t record; v_row jsonb; v_cols text; v_err_stale text; v_err_ok text; v_n int := 0;
begin
  for t in select c2.oid, c2.relname from pg_class c2 where c2.relnamespace = 'public'::regnamespace and c2.relkind = 'r'
             and has_table_privilege('authenticated', c2.oid, 'insert') order by 1 loop
    execute format('select to_jsonb(x) from public.%I x limit 1', t.relname) into v_row;
    if v_row is null then v_row := '{}'::jsonb; end if;   -- table vide : ligne de valeurs par défaut
    select string_agg(quote_ident(a.attname), ',') into v_cols from pg_attribute a
     where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attname <> 'id'
       and has_column_privilege('authenticated', t.oid, a.attnum, 'insert') and v_row ? a.attname::text;
    -- session refusée (admin authentifié avant lundi)
    begin
      perform pg_temp.claims('r-admin', public.wakabi_week_start() - interval '1 minute');
      set local role authenticated;
      if v_cols is null then execute format('insert into public.%I default values', t.relname);
      else execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I, $1)', t.relname, v_cols, v_cols, t.relname) using v_row; end if;
      v_err_stale := 'ACCEPTÉE';
      raise exception 'FIN';
    exception when others then if sqlerrm <> 'FIN' then v_err_stale := sqlstate || ' ' || sqlerrm; end if; end;
    -- contrôle : admin avec session de la semaine
    begin
      perform pg_temp.claims('r-admin', now());
      set local role authenticated;
      if v_cols is null then execute format('insert into public.%I default values', t.relname);
      else execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I, $1)', t.relname, v_cols, v_cols, t.relname) using v_row; end if;
      v_err_ok := 'acceptée';
      raise exception 'FIN';
    exception when others then if sqlerrm <> 'FIN' then v_err_ok := sqlstate || ' ' || sqlerrm; end if; end;
    if v_err_stale = 'ACCEPTÉE' then
      raise exception 'ÉCHEC : insertion dans % avec session refusée : % (contrôle : %)', t.relname, v_err_stale, v_err_ok;
    end if;
    if v_err_ok like '42501 %row-level security%' then
      raise exception 'ÉCHEC : contrôle non probant pour % : %', t.relname, v_err_ok;
    end if;
    raise notice 'OK  2 insertion dans % refusée : % (contrôle admin de la semaine : %)', t.relname, left(v_err_stale, 80), left(v_err_ok, 60);
    v_n := v_n + 1;
  end loop;
  raise notice 'OK  2 % tables insérables testées', v_n;
end $i$;

-- Changement de mot de passe obligatoire (session de la semaine) : seul son propre profil reste lisible.
update public.profiles set must_change_password = true where username = 'r-redac';
set local role authenticated;
select pg_temp.claims('r-redac', now());
select pg_temp.ok('3a changement obligatoire : statut must_change', public.wakabi_session_status() = 'must_change');
select pg_temp.ok('3b changement obligatoire : son propre profil lisible (écran de changement), rien d''autre',
  (select count(*) from public.profiles) = 1 and (select count(*) from public.profile_platforms) = 0
  and (select count(*) from public.contents) = 0 and (select count(*) from public.metric_readings) = 0 and public.my_role() is null);
reset role;
-- Les fonctions de déclencheur accessibles ne sont pas appelables directement.
do $$ begin perform public.wakabi_log_activity(); raise exception 'ÉCHEC : 4';
exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if; raise notice 'OK  4 fonction de déclencheur non appelable directement (%)', sqlerrm; end $$;
rollback;
