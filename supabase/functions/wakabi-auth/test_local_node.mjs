// Test d'intégration de la fonction Edge wakabi-auth : vraie logique SQL (base locale rs8), Auth simulé en mémoire.
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
import { copyFileSync } from "node:fs";
copyFileSync("/mnt/project-files/wakabi-supabase/functions/wakabi-auth/index.ts", "/var/tmp/wkpg/edge/fn.mjs");
const { makeHandler } = await import("/var/tmp/wkpg/edge/fn.mjs");
const DB = process.env.DB || "rs8n";
const psql = (sql) => execFileSync("psql", ["-h","127.0.0.1","-p","5544","-U","postgres","-X","-q","-At","-v","ON_ERROR_STOP=1","-d",DB,"-c",sql], { encoding: "utf8" }).trim();
const lit = (v) => v === null || v === undefined ? "NULL" : Array.isArray(v) ? `ARRAY[${v.map(lit).join(",")}]::uuid[]` : typeof v === "boolean" ? String(v) : `$q$${v}$q$`;
const callSql = (role, claims, fn, args) => {
  const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  return `begin; select set_config('request.jwt.claims', ${lit(JSON.stringify(claims || {}))}, true); set local role ${role}; select coalesce(to_jsonb(public.${fn}(${a})), $q$null$q$::jsonb); commit;`;
};
const parse = (out) => { const line = out.trim().split("\n").filter(Boolean).pop(); return line === "" || line === undefined ? null : JSON.parse(line); };
const call = (role, claims, fn, args) => parse(psql(callSql(role, claims, fn, args)));
// Version asynchrone (vraie connexion séparée par appel) : permet des requêtes réellement simultanées.
const callAsync = async (role, claims, fn, args) => {
  try { const { stdout } = await execFileP("psql", ["-h","127.0.0.1","-p","5544","-U","postgres","-X","-q","-At","-v","ON_ERROR_STOP=1","-d",DB,"-c",callSql(role, claims, fn, args)], { encoding: "utf8" }); return parse(stdout); }
  catch (e) { throw new Error(((e.stderr || e.message).split("\n").find((l) => l.includes("ERROR")) || e.message).replace(/^.*ERROR:\s+/, "")); }
};
// Auth simulé
const pw = new Map(), banned = new Set();
const jwtFor = (id, authTime) => Buffer.from(JSON.stringify({ sub: id, role: "authenticated", amr: [{ method: "password", timestamp: authTime }] })).toString("base64");
const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt, "base64").toString());
const now = () => Math.floor(Date.now() / 1000);
const deps = {
  now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (w, e) => console.log('   [log]', w, e && e.message || e),
  rpc: async (fn, args) => { if (failRpc.has(fn)) throw new Error("panne simulée " + fn); return callAsync("service_role", {}, fn, args); },
  signIn: async (email, password) => {
    signInCalls++;
    const id = psql(`select id from auth.users where email=${lit(email)}`);
    if (!id || banned.has(id) || pw.get(id) !== password) return { error: { message: "Invalid login credentials" } };
    return { data: { session: { access_token: jwtFor(id, now()), refresh_token: "r-" + id } } };
  },
  resetPassword: async (email) => { sent.push(email); return { error: null }; },
  getUser: async (jwt) => { try { return { id: claimsOf(jwt).sub }; } catch { return null; } },
  userRpc: async (jwt, fn, args) => call("authenticated", claimsOf(jwt), fn, args),
  createUser: async ({ email, password }) => {
    if (psql(`select count(*) from auth.users where email=${lit(email)}`) !== "0") return { error: { message: "A user with this email address has already been registered" } };
    const id = psql(`insert into auth.users(email, encrypted_password) values (${lit(email)}, 'h') returning id`).split("\n")[0];
    pw.set(id, password); return { data: { user: { id } } };
  },
  updateUser: async (id, o) => {
    if (o.password && failAuth) return { error: { message: "panne Auth simulée" } };
    if (o.password) { pw.set(id, o.password); psql(`update auth.users set encrypted_password = md5(random()::text) where id = ${lit(id)}`); }
    if (o.ban_duration) o.ban_duration === "none" ? banned.delete(id) : banned.add(id);
    return { error: null };
  },
};
let signInCalls = 0; const sent = []; const failRpc = new Set(); let failAuth = false; const ipsSeen = [];
const h = makeHandler(deps);
const post = async (body, jwt, ip = "10.0.0.1", extra = {}) => {
  const t = Date.now();
  const r = await h(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extra, ...(jwt ? { authorization: "Bearer " + jwt } : {}) }, body: JSON.stringify(body) }));
  return { ...(await r.json()), status: r.status, ms: Date.now() - t };
};
let fails = 0; const ok = (name, c, extra = "") => { console.log((c ? "OK  " : "ÉCHEC ") + name + (extra ? "  " + extra : "")); if (!c) fails++; };

// Préparation : R-admin avec identifiant et mot de passe connus
const adminId = psql(`update public.profiles set username='r-admin' where email like 'test+r-admin%' returning id`).split("\n")[0];
pw.set(adminId, "Admin-Recette-1");
const adminJwt = jwtFor(adminId, now());

// 1. Création d'un compte par l'admin
let r = await post({ action: "create_user", username: "Clemence", email: "afalakouwonou+clemence@gmail.com", password: "Provisoire-123", full_name: "Clémence Test", role: "platform_manager", country: "Togo", platform: "TikTok", platform_ids: [] }, adminJwt);
ok("1a création par l'admin", r.ok && r.username === "clemence", JSON.stringify(r));
const clemId = r.id;
r = await post({ action: "create_user", username: "clemence", email: "afalakouwonou+clemence2@gmail.com", password: "Provisoire-123", full_name: "Autre Clémence", role: "editor" }, adminJwt);
ok("1b doublon d'identifiant refusé avec proposition", !r.ok && /clemence2/.test(r.message), r.message);
r = await post({ action: "create_user", username: "margot", email: "afalakouwonou+margot@gmail.com", password: "court", full_name: "Margot", role: "editor" }, adminJwt);
ok("1c mot de passe provisoire trop court refusé", !r.ok);
r = await post({ action: "create_user", username: "margot", email: "afalakouwonou+margot@gmail.com", password: "Provisoire-123", full_name: "Margot", role: "editor" }, jwtFor(clemId, now()));
ok("1d création par un non-admin refusée", !r.ok && r.status === 403);
r = await post({ action: "create_user", username: "margot", email: "afalakouwonou+margot@gmail.com", password: "Provisoire-123", full_name: "Margot", role: "editor" }, jwtFor(adminId, now() - 8 * 86400));
ok("1e admin avec session d'avant lundi refusé", !r.ok && r.status === 403);
r = await post({ action: "create_user", username: "margot", email: "afalakouwonou+margot@gmail.com", password: "Provisoire-123", full_name: "Margot", role: "editor" });
ok("1f sans jeton refusé", r.status === 403);

// 2. Connexion par identifiant
r = await post({ action: "login", username: "CLEMENCE ", password: "Provisoire-123" });
ok("2a connexion identifiant + mot de passe provisoire (casse ignorée)", r.ok && r.session && r.session.access_token, "");
ok("2b la réponse ne contient pas l'email", !JSON.stringify(r).includes("@"));
const st = call("authenticated", claimsOf(r.session.access_token), "wakabi_session_status", {});
ok("2c changement de mot de passe exigé par la base", st === "must_change", st);
const bad = await post({ action: "login", username: "clemence", password: "faux" });
const unknown = await post({ action: "login", username: "personne", password: "faux" });
ok("2d mauvais mot de passe et identifiant inconnu : même réponse", !bad.ok && bad.message === unknown.message && bad.status === unknown.status);
ok("2e durée minimale identique (≥ 900 ms)", bad.ms >= 890 && unknown.ms >= 890, `${bad.ms} / ${unknown.ms} ms`);
for (let i = 0; i < 4; i++) await post({ action: "login", username: "clemence", password: "faux" + i });
r = await post({ action: "login", username: "clemence", password: "Provisoire-123" });
ok("2f après 5 échecs : bon mot de passe aussi refusé (blocage 15 min)", !r.ok && r.message === bad.message);
psql(`update public.wakabi_login_attempts set attempted_at = attempted_at - interval '16 minutes' where username='clemence'`);
r = await post({ action: "login", username: "clemence", password: "Provisoire-123" });
ok("2g après 15 minutes : connexion à nouveau possible", r.ok);

// 3. Récupération
sent.length = 0;
const rec1 = await post({ action: "recover", username: "clemence", redirectTo: "https://wakabi-recette.pages.dev/" });
const rec2 = await post({ action: "recover", username: "personne", redirectTo: "https://wakabi-recette.pages.dev/" });
ok("3a récupération : email envoyé à l'adresse privée", sent.length === 1 && sent[0] === "afalakouwonou+clemence@gmail.com", JSON.stringify(sent));
ok("3b récupération : même réponse pour un identifiant inconnu", rec1.message === rec2.message && rec1.ok === rec2.ok);

// 4. Mot de passe provisoire réimposé par l'admin (3 étapes, pannes simulées)
const pwChanged = () => psql(`update public.profiles set must_change_password=false where id='${clemId}'`);
pwChanged();
const oldJwt = jwtFor(clemId, now() - 60);
ok("4a avant : accès normal", call("authenticated", claimsOf(oldJwt), "wakabi_session_status", {}) === "ok");
r = await post({ action: "set_password", target: clemId, password: "Nouveau-Provisoire-9" }, adminJwt);
ok("4b mot de passe provisoire défini", r.ok, JSON.stringify(r));
ok("4c obligation posée et opération close (le déclencheur de changement n'a rien levé)", psql(`select must_change_password and provisional_op is null from public.profiles where id='${clemId}'`) === "t");
ok("4d ancienne session révoquée", call("authenticated", claimsOf(oldJwt), "wakabi_session_status", {}) === "revoked");
r = await post({ action: "login", username: "clemence", password: "Provisoire-123" });
ok("4e ancien mot de passe refusé", !r.ok);
r = await post({ action: "set_password", target: adminId, password: "Auto-Provisoire-1" }, adminJwt);
ok("4f admin qui se donne un mot de passe provisoire : refusé, Auth non touché", !r.ok && pw.get(adminId) === "Admin-Recette-1", r.message);
// panne Auth (étape 2) : ancien mot de passe conservé, obligation posée, opération close
pwChanged(); failAuth = true;
r = await post({ action: "set_password", target: clemId, password: "Jamais-Applique-1" }, adminJwt); failAuth = false;
ok("4g panne Auth : refus signalé, mot de passe inchangé", !r.ok && pw.get(clemId) === "Nouveau-Provisoire-9", r.message);
ok("4h panne Auth : obligation posée, sessions révoquées, opération close", psql(`select must_change_password and provisional_op is null and sessions_valid_after is not null from public.profiles where id='${clemId}'`) === "t");
// panne de l'étape 3 : mot de passe provisoire actif, obligation TOUJOURS posée, opération en attente
pwChanged(); failRpc.add("wakabi_srv_password_reset_end");
r = await post({ action: "set_password", target: clemId, password: "Provisoire-Etape3" }, adminJwt); failRpc.clear();
ok("4i panne de l'étape 3 : signalée", !r.ok && /obligation de changement reste posée/.test(r.message), r.message);
ok("4j panne de l'étape 3 : obligation posée malgré le changement dans Auth", psql(`select must_change_password and provisional_op is not null from public.profiles where id='${clemId}'`) === "t");
await deps.sleep(1100);  // amr est à la seconde : une connexion dans la même seconde que la révocation est refusée (prudence)
r = await post({ action: "login", username: "clemence", password: "Provisoire-Etape3" });
ok("4k connexion avec le provisoire pendant la panne : changement imposé, aucune donnée", r.ok && call("authenticated", claimsOf(r.session.access_token), "wakabi_session_status", {}) === "must_change" && call("authenticated", claimsOf(r.session.access_token), "my_role", {}) === null);
r = await post({ action: "set_password", target: clemId, password: "Provisoire-Bis-1" }, adminJwt);
ok("4l relance immédiate : refusée tant que l'opération précédente est en cours (15 min)", !r.ok && /déjà en cours/.test(r.message), r.message);
psql(`update public.profiles set provisional_pending_at = provisional_pending_at - interval '16 minutes' where id='${clemId}'`);
r = await post({ action: "set_password", target: clemId, password: "Provisoire-Bis-1" }, adminJwt);
ok("4m relance après 15 min : acceptée et close", r.ok && psql(`select must_change_password and provisional_op is null from public.profiles where id='${clemId}'`) === "t", JSON.stringify(r));
// panne de l'étape 1 : Auth jamais touché
failRpc.add("wakabi_srv_password_reset_begin");
r = await post({ action: "set_password", target: clemId, password: "Jamais-Applique-2" }, adminJwt); failRpc.clear();
ok("4n panne de l'étape 1 : Auth non modifié", !r.ok && pw.get(clemId) === "Provisoire-Bis-1");
pw.set(clemId, "Nouveau-Provisoire-9");

// 4bis. Limites : appels simultanés à la fonction, panne de clôture, IP
psql(`delete from public.wakabi_login_attempts`);
signInCalls = 0;
const par = await Promise.all(Array.from({ length: 12 }, (_, k) => post({ action: "login", username: "r-admin", password: "faux" + k }, null, "10.3.3." + k)));
ok("4o 12 connexions simultanées via la fonction (mauvais mot de passe) : exactement 5 appels à Auth, 7 refusées avant", signInCalls === 5 && par.every((x) => !x.ok) && psql(`select count(*) from public.wakabi_login_attempts where username='r-admin' and success is null`) === "0", signInCalls + " appels à Auth");
psql(`delete from public.wakabi_login_attempts`);
failRpc.add("wakabi_srv_login_end");
r = await post({ action: "login", username: "r-admin", password: "Admin-Recette-1" }); failRpc.clear();
ok("4p panne de clôture : connexion rendue, tentative restée comptée comme échec", r.ok && psql(`select count(*) from public.wakabi_login_attempts where username='r-admin' and success is null`) === "1");
psql(`delete from public.wakabi_login_attempts`);
await post({ action: "login", username: "x", password: "y" }, null, "6.6.6.6, 203.0.113.9");
ok("4q x-forwarded-for falsifié par le client : seule la dernière valeur (passerelle) est retenue", psql(`select ip from public.wakabi_login_attempts order by id desc limit 1`) === "203.0.113.9");
await post({ action: "login", username: "x", password: "y" }, null, "6.6.6.6, 203.0.113.9", { "cf-connecting-ip": "198.51.100.7" });
ok("4r cf-connecting-ip prioritaire", psql(`select ip from public.wakabi_login_attempts order by id desc limit 1`) === "198.51.100.7");
psql(`delete from public.wakabi_login_attempts`);

// 5. Départ avec session ouverte, puis remplaçante
psql(`update public.profiles set must_change_password=false where id='${clemId}'`);
await deps.sleep(1100); const openJwt = jwtFor(clemId, now()); await deps.sleep(1100);
psql(`begin; select set_config('request.jwt.claims', '{"sub":"${adminId}"}', true); update public.profiles set archived_at = now() where id='${clemId}'; commit;`);
r = await post({ action: "sync_access", target: clemId }, adminJwt);
ok("5a départ : compte bloqué dans Auth", r.ok && r.state === "blocked" && banned.has(clemId));
ok("5b départ : session ouverte refusée par la base", call("authenticated", claimsOf(openJwt), "wakabi_session_status", {}) === "archived");
r = await post({ action: "login", username: "clemence", password: "Nouveau-Provisoire-9" });
ok("5c départ : connexion refusée (réponse générique)", !r.ok && r.message === bad.message);
r = await post({ action: "create_user", username: "clemence", email: "afalakouwonou+clemence-b@gmail.com", password: "Provisoire-456", full_name: "Remplaçante", role: "platform_manager", platform: "TikTok" }, adminJwt);
ok("5d remplaçante : l'identifiant de l'ancienne n'est pas réutilisable", !r.ok && /clemence2/.test(r.message));
r = await post({ action: "create_user", username: "clemence2", email: "afalakouwonou+clemence-b@gmail.com", password: "Provisoire-456", full_name: "Remplaçante", role: "platform_manager", platform: "TikTok" }, adminJwt);
ok("5e remplaçante : nouveau compte avec ses propres rôle et plateforme", r.ok && psql(`select role||'/'||platform from public.profiles where id='${r.id}'`) === "platform_manager/TikTok");
ok("5f historique de l'ancienne conservé (profil et journal)", psql(`select count(*) from public.profiles where id='${clemId}'`) === "1" && Number(psql(`select count(*) from public.activity_log where row_id='${clemId}'`)) > 0);
psql(`update public.profiles set archived_at = null where id='${clemId}'`); psql(`update public.profiles set active = true where id='${clemId}'`);
r = await post({ action: "sync_access", target: clemId }, adminJwt);
ok("5g retour : débloquée dans Auth", r.ok && r.state === "allowed" && !banned.has(clemId));
ok("5h retour : l'ancienne session reste refusée", call("authenticated", claimsOf(openJwt), "wakabi_session_status", {}) === "revoked");
console.log(fails ? `${fails} ÉCHEC(S)` : "TOUS LES TESTS RÉUSSIS");
process.exit(fails ? 1 : 0);
