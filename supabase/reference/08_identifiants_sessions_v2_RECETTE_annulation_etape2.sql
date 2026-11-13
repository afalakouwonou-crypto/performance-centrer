-- Annulation de la migration 08, étape 2 sur 2 (RECETTE UNIQUEMENT), facultative.
-- À lancer seulement APRÈS : (a) l'étape 1 ; (b) Authentication > Hooks > « Customize Access Token » DÉSACTIVÉ.
-- Effets : supprime la fonction neutre du hook ; retire le droit USAGE de supabase_auth_admin sur le schéma public
-- SEULEMENT s'il ne l'avait pas avant la migration 08 (valeur enregistrée dans wakabi_m08_state).
-- Conservés : wakabi_m08_state, les colonnes ajoutées à profiles, la table des tentatives renommée.
begin;
set local lock_timeout = '5s';
do $check$ begin
  if exists (select 1 from public.contents where title not like '[RECETTE]%')
     and current_setting('wakabi.copie_locale', true) is distinct from 'oui' then
    raise exception 'Base contenant de vrais contenus : réservé à la RECETTE. Rien n''a été modifié.';
  end if;
  if to_regclass('public.wakabi_m08_state') is null
     or not exists (select 1 from public.wakabi_m08_state where key = 'annulled_at')
     or to_regprocedure('public.wakabi_srv_login_begin(text,text)') is not null then
    raise exception 'Étape 1 de l''annulation non faite (ou migration 08 réinstallée) : rien n''a été modifié.';
  end if;
  if (select prosrc from pg_proc where oid = to_regprocedure('public.wakabi_access_token_hook(jsonb)'))
       is distinct from ' select jsonb_build_object(''claims'', event -> ''claims'') ' then
    raise exception 'La fonction du hook n''est pas la version neutre de l''étape 1 : rien n''a été modifié.';
  end if;
end $check$;
drop function public.wakabi_access_token_hook(jsonb);
do $u$ begin
  if (select value from public.wakabi_m08_state where key = 'auth_admin_had_schema_usage') = 'false' then
    revoke usage on schema public from supabase_auth_admin;
  end if;
end $u$;
insert into public.wakabi_m08_state(key, value) values ('step2_at', now()::text)
on conflict (key) do update set value = excluded.value, noted_at = now();
commit;
-- Contrôle : select has_schema_privilege('supabase_auth_admin','public','usage');  -- valeur d'origine attendue
