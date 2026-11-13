-- Entre R0a et R0b : donne le rôle admin au compte R-admin, créé juste avant dans Auth du projet de RECETTE
-- (le déclencheur on_auth_user_created lui a donné un profil actif « platform_manager »).
-- Remplacer ADRESSE_R_ADMIN par l'adresse du compte de recette. Ne jamais lancer en production.
do $g$ begin
  if (select count(*) from public.contents) > 0 or (select count(*) from public.profiles) <> 1 then
    raise exception 'Réservé au projet de RECETTE neuf (un seul profil, aucun contenu) : rien n''a été modifié.';
  end if;
end $g$;
update public.profiles set role = 'admin', active = true where email = 'ADRESSE_R_ADMIN' returning email, role, active;
