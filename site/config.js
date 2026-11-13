// Wakabi Performance Center — configuration publique. Une seule base : le projet Supabase « wakabi-performance ».
// La clé « publishable » est faite pour le navigateur : les données restent protégées par la connexion et les règles RLS.
// Ne jamais mettre ici une clé secret / service_role.
window.WAKABI_CONFIG = {
  SUPABASE_URL: "https://dchrvyzdfrvrbdfgvstn.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_kh2GdhD2bNnxRUvhkRBFZw_6WtClSF2"
  // Connexion par identifiant personnel : décommenter UNIQUEMENT après l'application de la migration 08 en production,
  // le déploiement de la fonction wakabi-auth et l'activation du hook (voir docs/MISE_EN_PRODUCTION.md).
  // , AUTH_MODE: "identifiant"
};
