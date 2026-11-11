// SITE DE RECETTE : projet Supabase de recette uniquement (jamais la production).
// Clé publishable seulement ; jamais de clé secret/service_role.
window.WAKABI_CONFIG = {
  SUPABASE_URL: "https://tbpyymdbflsntouascbz.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_cHnAHHf-pLhyAecheg9KRA_v4Nms2Ke",
  // Connexion par identifiant (migration 08 + fonction Edge wakabi-auth). Retirer cette ligne = ancienne connexion par email.
  AUTH_MODE: "identifiant"
};
