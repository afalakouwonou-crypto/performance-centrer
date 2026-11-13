-- Annulation du durcissement 11 : redonne au rôle anon exactement les droits enregistrés avant le retrait.
begin;
do $r$
declare r record;
begin
  if to_regclass('public.wakabi_m11_state') is null then raise exception 'Durcissement 11 absent : rien n''a été modifié.'; end if;
  for r in select distinct table_name, privilege from public.wakabi_m11_state loop
    execute format('grant %s on public.%I to anon', r.privilege, r.table_name);
  end loop;
end
$r$;
commit;
select 'Droits du rôle anon rétablis' as resultat;
