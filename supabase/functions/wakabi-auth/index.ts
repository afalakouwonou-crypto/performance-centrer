// Wakabi Performance Center — fonction Edge « wakabi-auth » (projet de RECETTE).
// Rôle : tout ce qui exige la clé service_role reste ici, côté serveur Supabase ; le navigateur n'a que la clé publishable.
//  - login    : identifiant + mot de passe -> session Supabase Auth (l'email privé n'est jamais renvoyé au navigateur) ;
//  - recover  : identifiant -> email de réinitialisation envoyé à l'adresse privée ; réponse toujours identique ;
//  - create_user / set_password / sync_access : réservées à un administrateur connecté (jeton vérifié).
// Réponses génériques, durée minimale identique pour login / recover, limitation des tentatives en base
// (wakabi_srv_login_begin / _end / wakabi_srv_recovery_email, migration 08 v2) : la tentative est RÉSERVÉE en base
// avant l'appel à Auth ; si la fonction s'arrête avant la fin, la tentative reste comptée comme un échec.
// Mot de passe provisoire en 3 étapes fail-closed : (1) obligation + révocation en base, (2) Auth, (3) clôture en base.
// Adresse IP : en-tête cf-connecting-ip (posé par Cloudflare devant Supabase), sinon DERNIÈRE valeur de
// x-forwarded-for (celle ajoutée par la passerelle) ; jamais la première, que le client peut inventer.
// Réglage de déploiement : « Verify JWT » DÉSACTIVÉ (la clé publishable n'est pas un JWT) ; le jeton de
// l'administrateur est vérifié ici pour les actions d'administration.
// Ce fichier est du JavaScript valide (aucune syntaxe propre à TypeScript) : il est aussi testé tel quel sous Node.

const GENERIC_LOGIN = "Identifiant ou mot de passe incorrect, ou trop de tentatives. Réessayez dans quelques minutes.";
const GENERIC_RECOVER = "Si cet identifiant correspond à un compte actif, un email permettant de choisir un nouveau mot de passe vient d’être envoyé à l’adresse personnelle enregistrée.";
const MIN_MS = 900;
const ROLES = ["admin", "editor", "direction", "platform_manager"];
const COUNTRIES = ["Togo", "Bénin"];
const PLATFORMS = ["TikTok", "Instagram", "Facebook", "Snapchat", "YouTube"];
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAN_FOREVER = "876000h";

export function makeHandler(deps) {
  const cors = {
    "Access-Control-Allow-Origin": deps.allowOrigin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
  const pad = async (t0) => { const left = MIN_MS - (deps.now() - t0); if (left > 0) await deps.sleep(left); };
  const clientIp = (req) => {
    const cf = (req.headers.get("cf-connecting-ip") || "").trim();
    if (cf) return cf.slice(0, 64);
    const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
    return xff.length ? xff[xff.length - 1].slice(0, 64) : "inconnue";
  };

  async function requireAdmin(req) {
    const h = req.headers.get("authorization") || "";
    const jwt = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!jwt) return null;
    const user = await deps.getUser(jwt).catch(() => null);
    if (!user) return null;
    const ok = await deps.userRpc(jwt, "wakabi_am_admin", {}).catch(() => false);
    return ok === true ? { id: user.id, jwt } : null;
  }

  return async function handle(req) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply({ ok: false, message: "Méthode non autorisée" }, 405);
    let body;
    try { body = await req.json(); } catch { return reply({ ok: false, message: "Requête invalide" }, 400); }
    const action = str(body && body.action, 32);
    const ip = clientIp(req);

    if (action === "login") {
      const t0 = deps.now();
      const username = (str(body.username, 64) || "").trim().toLowerCase();
      const password = str(body.password, 128) || "";
      try {
        const begin = await deps.rpc("wakabi_srv_login_begin", { p_username: username, p_ip: ip });
        if (!begin || !begin.allowed) { await pad(t0); return reply({ ok: false, message: GENERIC_LOGIN }); }
        let session = null;
        if (begin.email && password) {
          const r = await deps.signIn(begin.email, password, ip);
          if (!r.error && r.data && r.data.session) session = r.data.session;
        }
        // Si cette clôture échoue, la tentative reste comptée comme un échec (plus restrictif, jamais moins).
        await deps.rpc("wakabi_srv_login_end", { p_attempt: begin.attempt, p_success: !!session }).catch((e) => deps.log("login_end", e));
        await pad(t0);
        if (!session) return reply({ ok: false, message: GENERIC_LOGIN });
        return reply({ ok: true, session: { access_token: session.access_token, refresh_token: session.refresh_token } });
      } catch (e) {
        deps.log("login", e);
        await pad(t0);
        return reply({ ok: false, message: GENERIC_LOGIN });
      }
    }

    if (action === "recover") {
      const t0 = deps.now();
      const username = (str(body.username, 64) || "").trim().toLowerCase();
      const redirectTo = str(body.redirectTo, 300);
      try {
        const email = await deps.rpc("wakabi_srv_recovery_email", { p_username: username, p_ip: ip });
        if (email) {
          const r = await deps.resetPassword(email, redirectTo && /^https?:\/\//.test(redirectTo) ? redirectTo : undefined);
          if (r && r.error) deps.log("recover", r.error);
        }
      } catch (e) { deps.log("recover", e); }
      await pad(t0);
      return reply({ ok: true, message: GENERIC_RECOVER });
    }

    // ---- Actions d'administration ----
    if (!["create_user", "set_password", "sync_access"].includes(action || "")) return reply({ ok: false, message: "Action inconnue" }, 400);
    const caller = await requireAdmin(req);
    if (!caller) return reply({ ok: false, message: "Réservé à un administrateur connecté (session de la semaine)." }, 403);

    if (action === "create_user") {
      const username = (str(body.username, 64) || "").trim().toLowerCase();
      const email = (str(body.email, 254) || "").trim();
      const password = str(body.password, 128) || "";
      const fullName = (str(body.full_name, 120) || "").trim();
      const role = str(body.role, 32), country = body.country || null, platform = body.platform || null;
      const platformIds = Array.isArray(body.platform_ids) ? body.platform_ids : [];
      if (!USERNAME_RE.test(username)) return reply({ ok: false, message: "Identifiant invalide : 2 à 32 caractères (minuscules, chiffres, point, tiret, souligné), sans accent ni espace." });
      if (!EMAIL_RE.test(email)) return reply({ ok: false, message: "Adresse email personnelle invalide." });
      if (password.length < 8) return reply({ ok: false, message: "Le mot de passe provisoire doit contenir au moins 8 caractères." });
      if (!fullName) return reply({ ok: false, message: "Le nom est obligatoire." });
      if (!ROLES.includes(role || "")) return reply({ ok: false, message: "Rôle invalide." });
      if (country !== null && !COUNTRIES.includes(country)) return reply({ ok: false, message: "Pays invalide." });
      if (platform !== null && !PLATFORMS.includes(platform)) return reply({ ok: false, message: "Plateforme principale invalide." });
      if (platformIds.length > 10 || !platformIds.every((x) => typeof x === "string" && UUID_RE.test(x))) return reply({ ok: false, message: "Plateformes invalides." });
      const free = await deps.userRpc(caller.jwt, "wakabi_username_suggestion", { p_base: username }).catch(() => null);
      if (free !== username) return reply({ ok: false, message: `Identifiant déjà utilisé. Proposition : ${free || "—"}` });
      const c = await deps.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
      if (c.error || !c.data || !c.data.user) return reply({ ok: false, message: "Création refusée par Supabase Auth : " + ((c.error && c.error.message) || "erreur inconnue") });
      const id = c.data.user.id;
      try {
        await deps.rpc("wakabi_srv_setup_profile", { p_caller: caller.id, p_target: id, p_username: username, p_full_name: fullName,
          p_role: role, p_job_title: str(body.job_title, 120), p_country: country, p_platform: platform, p_platform_ids: platformIds });
      } catch (e) {
        // Rien n'est supprimé : le compte Auth reste bloqué et son profil inactif, visible dans l'écran Équipe.
        await deps.updateUser(id, { ban_duration: BAN_FOREVER }).catch(() => null);
        return reply({ ok: false, message: "Compte créé dans Auth mais configuration refusée (compte laissé bloqué) : " + (e.message || e) });
      }
      return reply({ ok: true, id, username });
    }

    const target = str(body.target, 36);
    if (!target || !UUID_RE.test(target)) return reply({ ok: false, message: "Membre invalide." });

    if (action === "set_password") {
      const password = str(body.password, 128) || "";
      if (password.length < 8) return reply({ ok: false, message: "Le mot de passe provisoire doit contenir au moins 8 caractères." });
      if (target === caller.id) return reply({ ok: false, message: "Un administrateur ne peut pas se donner un mot de passe provisoire : utilisez « Mot de passe oublié » ou le changement de mot de passe." });
      // Étape 1 (base) : obligation posée et sessions révoquées AVANT de toucher Auth. En cas d'échec, Auth n'est pas modifié.
      let op;
      try { op = await deps.rpc("wakabi_srv_password_reset_begin", { p_caller: caller.id, p_target: target }); }
      catch (e) { return reply({ ok: false, message: "Aucun changement : " + (e.message || e) }); }
      // Étape 2 (Auth). Pendant l'opération, le déclencheur de changement de mot de passe ne lève plus l'obligation.
      const u = await deps.updateUser(target, { password }).catch((e) => ({ error: e }));
      if (u.error) {
        await deps.rpc("wakabi_srv_password_reset_abort", { p_caller: caller.id, p_target: target, p_op: op }).catch((e) => deps.log("reset_abort", e));
        return reply({ ok: false, message: "Mot de passe refusé par Supabase Auth : " + (u.error.message || u.error) + ". Ancien mot de passe conservé ; le membre devra en choisir un nouveau à sa prochaine connexion." });
      }
      // Étape 3 (base) : clôture. Si elle échoue, l'obligation reste posée (sécurité maintenue) ; il suffit de recommencer.
      try { await deps.rpc("wakabi_srv_password_reset_end", { p_caller: caller.id, p_target: target, p_op: op }); }
      catch (e) { return reply({ ok: false, message: "Mot de passe provisoire enregistré, mais l'opération n'a pas pu être close : l'obligation de changement reste posée. Recommencez dans 15 minutes si besoin. (" + (e.message || e) + ")" }); }
      return reply({ ok: true });
    }

    if (action === "sync_access") {
      try {
        const state = await deps.rpc("wakabi_srv_access_state", { p_caller: caller.id, p_target: target });
        const u = await deps.updateUser(target, { ban_duration: state === "blocked" ? BAN_FOREVER : "none" });
        if (u.error) return reply({ ok: false, message: "Blocage Auth non appliqué : " + u.error.message });
        return reply({ ok: true, state });
      } catch (e) { return reply({ ok: false, message: e.message || String(e) }); }
    }
    return reply({ ok: false, message: "Action inconnue" }, 400);
  };
}

// ---- Démarrage sur Supabase (Deno). Ignoré sous Node (tests). ----
if (typeof Deno !== "undefined" && Deno.serve) {
  const { createClient } = await import("npm:@supabase/supabase-js@2.49.4");
  const URL_ = Deno.env.get("SUPABASE_URL");
  const ANON = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(URL_, SERVICE, opts);
  const asIp = (ip) => createClient(URL_, ANON, { ...opts, global: { headers: { "X-Forwarded-For": ip } } });
  Deno.serve(makeHandler({
    allowOrigin: Deno.env.get("WAKABI_ALLOWED_ORIGIN") || "*",
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (where, e) => console.error("wakabi-auth", where, (e && e.message) || e),
    rpc: async (fn, args) => { const { data, error } = await admin.rpc(fn, args); if (error) throw error; return data; },
    signIn: (email, password, ip) => asIp(ip).auth.signInWithPassword({ email, password }),
    resetPassword: (email, redirectTo) => createClient(URL_, ANON, opts).auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined),
    getUser: async (jwt) => { const { data, error } = await admin.auth.getUser(jwt); return error ? null : data.user; },
    userRpc: async (jwt, fn, args) => {
      const c = createClient(URL_, ANON, { ...opts, global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data, error } = await c.rpc(fn, args); if (error) throw error; return data;
    },
    createUser: (o) => admin.auth.admin.createUser(o),
    updateUser: (id, o) => admin.auth.admin.updateUserById(id, o),
  }));
}
