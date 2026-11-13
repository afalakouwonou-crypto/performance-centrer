// Wakabi Performance Center — calculs (script classique : expose window.WakabiCalc ; testé seul par tests/calc.test.mjs).
(function(){
"use strict";
// Calculs de Wakabi Performance Center — formule validée le 30/10/2026 (README_REPRISE § 5, prompt § 10).
// Fonctions pures : aucun accès à la page ni à la base. Elles sont testées seules (wakabi-tests/calc.test.mjs).
//  - Interactions = likes + commentaires + partages.
//  - Taux d'interaction = interactions / vues, seulement si vues > 0 (sinon null, affiché « N/D »).
//  - Ensemble de publications : somme des interactions / somme des vues (taux pondéré), jamais une moyenne de taux.
//  - Republications et enregistrements : à part, hors taux ; absents = null (« N/D »), jamais 0.
//  - Évolution absolue = récent − précédent ; relative seulement si précédent > 0.
//  - Jamais J+1 + J+7 : un seul relevé de référence par publication (J+1, J+7 ou dernier relevé).

const REF_LABEL = { j1: "J+1", j7: "J+7", latest: "Dernier relevé" };

const interactionsOf = r => (+r.likes || 0) + (+r.comments || 0) + (+r.shares || 0);
const rateOf = (views, interactions) => (views > 0 ? interactions / views : null);

// Version en vigueur des relevés : un relevé est remplacé dès qu'une correction le vise (même règle que la vue
// metric_readings_effective de la migration 05).
function effectiveReadings(readings) {
  const corrected = new Set(readings.filter(r => r.corrects_reading_id).map(r => r.corrects_reading_id));
  return readings.filter(r => !corrected.has(r.id));
}

function groupByPublication(readings) {
  const m = new Map();
  for (const r of readings) {
    if (!m.has(r.publication_id)) m.set(r.publication_id, []);
    m.get(r.publication_id).push(r);
  }
  return m;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Plus récent d'abord : date du relevé, puis heure du relevé, puis heure de saisie (ordre de publication_performance).
const byRecent = (a, b) =>
  cmp(b.measured_on || "", a.measured_on || "") || cmp(b.measured_at || "", a.measured_at || "") || cmp(b.entered_at || "", a.entered_at || "");

// Relevé de référence d'une publication parmi ses relevés en vigueur.
function referenceReading(effList, ref) {
  const rs = effList || [];
  if (ref === "latest") return rs.slice().sort(byRecent)[0] || null;
  return rs.find(r => r.reading_type === ref) || null;
}

// Agrégat d'un ensemble de relevés (au plus un par publication).
function aggregate(readings) {
  const rs = readings.filter(Boolean);
  const s = k => rs.reduce((a, r) => a + (+r[k] || 0), 0);
  const views = s("views"), likes = s("likes"), comments = s("comments"), shares = s("shares");
  const interactions = likes + comments + shares;
  const rep = rs.filter(r => r.reposts != null), sav = rs.filter(r => r.saves != null);
  return {
    n: rs.length, views, likes, comments, shares, interactions,
    rate: rateOf(views, interactions),
    reposts: rep.length ? rep.reduce((a, r) => a + (+r.reposts || 0), 0) : null, repostsN: rep.length,
    saves: sav.length ? sav.reduce((a, r) => a + (+r.saves || 0), 0) : null, savesN: sav.length,
  };
}

function evolution(prev, cur) {
  if (prev == null || cur == null) return null;
  const abs = cur - prev;
  return { abs, rel: prev > 0 ? abs / prev : null };
}

// ---------- Dates (chaînes AAAA-MM-JJ, calcul en UTC pour éviter tout décalage) ----------
function addDays(s, n) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

// Période choisie et période précédente de même durée, juste avant. null = toute la période (pas de comparaison).
const PERIODS = { all: "Toute la période", "7": "7 derniers jours", "30": "30 derniers jours", "90": "90 derniers jours", month: "Mois en cours", custom: "Dates choisies" };
function periodRange(period, today, from, to) {
  let start, end = today;
  if (period === "7" || period === "30" || period === "90") start = addDays(today, -(+period - 1));
  else if (period === "month") start = today.slice(0, 8) + "01";
  else if (period === "custom") {
    if (!from || !to || to < from) return null;
    start = from; end = to;
  } else return null;
  const days = daysBetween(start, end) + 1;
  return { start, end, days, prevStart: addDays(start, -days), prevEnd: addDays(start, -1) };
}
const inRange = (d, a, b) => !!d && d >= a && d <= b;

// ---------- Filtres combinés (même logique sur Contenus, Performance et Direction) ----------
const EMPTY_FILTERS = { q: "", period: "all", from: "", to: "", country: "", rubrique: "", platform: "", type: "", campaign: "", objective: "", status: "", measure: "", owner: "", prod: "", promo: "" };
const MEASURES = { todo: "Relevé à saisir", late: "Relevé en retard", missed: "J+1 manqué", complete: "J+7 saisi", waiting: "En attente du J+7" };

function activeFilterCount(f) {
  return Object.keys(EMPTY_FILTERS).filter(k => k !== "from" && k !== "to" && (f[k] || "") !== EMPTY_FILTERS[k]).length;
}
const normalize = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// État de mesure d'une publication à partir de ses états J+1 / J+7 (voir rstate dans app.js).
function measureMatches(measure, j1, j7) {
  const doneish = s => s === "done" || s === "done_late";
  switch (measure) {
    case "todo": return ["due", "late"].includes(j1) || ["due", "late"].includes(j7);
    case "late": return j1 === "late" || j7 === "late";
    case "missed": return j1 === "missed";
    case "complete": return doneish(j7);
    case "waiting": return j7 === "upcoming";
    default: return true;
  }
}

// ctx : { contents, pubsOf(cid), basisDate(p,c), platformIdOf(p), ownerPlatforms(ownerId) -> Set|null,
//         states(p,c) -> {j1,j7}, today }
// Un contenu est retenu s'il passe les filtres de contenu ET a au moins une publication retenue ; un contenu sans
// publication n'est retenu que si aucun filtre de publication n'est actif et si sa date prévue est dans la période.
function applyFilters(f, ctx) {
  const range = periodRange(f.period, ctx.today, f.from, f.to);
  const q = normalize(f.q).trim();
  const owner = f.owner ? ctx.ownerPlatforms(f.owner) : null;
  const pubFilter = !!(f.platform || f.owner || f.measure || f.promo);
  const contentOk = c =>
    (!q || normalize([c.title, c.concept, c.caption, c.rubrique].join(" ")).includes(q)) &&
    (!f.country || c.country === f.country) &&
    (!f.rubrique || c.rubrique_id === f.rubrique) &&
    (!f.type || c.content_type_id === f.type) &&
    (!f.campaign || c.campaign_id === f.campaign) &&
    (!f.objective || c.objective_id === f.objective) &&
    (!f.status || (f.status === "archived" ? !!c.archived_at : !c.archived_at)) &&
    (!f.prod || (c.production_status || "") === f.prod);
  const pubOk = (p, c) => {
    if (f.platform && ctx.platformIdOf(p) !== f.platform) return false;
    if (f.promo && (p.promotion || "inconnu") !== f.promo) return false;
    if (owner && !owner.has(ctx.platformIdOf(p))) return false;
    if (range && !inRange(ctx.basisDate(p, c), range.start, range.end)) return false;
    if (f.measure) { const s = ctx.states(p, c); if (!measureMatches(f.measure, s.j1, s.j7)) return false; }
    return true;
  };
  const contents = [], pubs = [], byContent = new Map();
  for (const c of ctx.contents) {
    if (!contentOk(c)) continue;
    const all = ctx.pubsOf(c.id), kept = all.filter(p => pubOk(p, c));
    const keep = kept.length > 0 || (all.length === 0 && !pubFilter && (!range || inRange(c.publish_date, range.start, range.end)));
    if (!keep) continue;
    contents.push(c); pubs.push(...kept); byContent.set(c.id, kept);
  }
  return { contents, pubs, byContent, range };
}

// Même filtre appliqué à la période précédente (pour les évolutions) : seules les dates changent.
function previousPeriodFilters(f, range) {
  return range ? { ...f, period: "custom", from: range.prevStart, to: range.prevEnd } : null;
}

// Filtres <-> paramètres d'adresse (lien partageable, retour arrière du navigateur).
function filtersToQuery(f) {
  const p = new URLSearchParams();
  for (const k of Object.keys(EMPTY_FILTERS)) if ((f[k] || "") !== EMPTY_FILTERS[k]) p.set(k, f[k]);
  return p.toString();
}
function filtersFromQuery(qs) {
  const p = new URLSearchParams(qs || ""), f = { ...EMPTY_FILTERS };
  for (const k of Object.keys(EMPTY_FILTERS)) if (p.has(k)) f[k] = p.get(k);
  if (!PERIODS[f.period]) f.period = "all";
  return f;
}

// ---------- Calendrier et rapports ----------
// Lundi de la semaine d'une date (semaine du lundi au dimanche, comme la règle du lundi).
function weekStart(s) {
  const k = (new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7;
  return addDays(s, -k);
}
// Premier et dernier jour d'un mois « AAAA-MM ».
function monthBounds(m) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${m}-01`, end: `${m}-${String(last).padStart(2, "0")}` };
}
function shiftMonth(m, n) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// Cellule CSV protégée contre l'injection de formules (=, +, -, @, tabulation, retour chariot en tête) ;
// séparateur « ; » et virgule décimale pour Excel en français ; une valeur absente reste vide (jamais 0).
function csvCell(v) {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = rows => "﻿" + rows.map(r => r.map(csvCell).join(";")).join("\r\n");
// ---------- Import CSV / Excel (fichiers exportés en CSV) ----------
// Lecture d'un CSV : séparateur deviné (« ; », « , » ou tabulation), guillemets doubles, retours à la ligne dans les cellules.
function parseCsv(text) {
  text = String(text || "").replace(/^﻿/, "");
  const first = text.split(/\r?\n/)[0] || "";
  const count = c => first.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return { sep, rows: rows.filter(r => r.some(c => String(c).trim() !== "")) };
}
// Nombre entier positif écrit à la française (« 1 234 », « 1.234 », « 1234 ») ; vide = null ; invalide = NaN.
function parseCount(v) {
  const t = String(v ?? "").replace(/[\s  ]/g, "");
  if (t === "") return null;
  if (!/^\d{1,3}([.,]?\d{3})*$|^\d+$/.test(t)) return NaN;
  return Number(t.replace(/[.,]/g, ""));
}
// Date « AAAA-MM-JJ », « JJ/MM/AAAA » ou « JJ-MM-AAAA » -> « AAAA-MM-JJ » ; sinon null.
function parseDateFr(v) {
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; } else if ((m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) { [, d, mo, y] = m; } else return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(iso + "T00:00:00Z");
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}
// Adresse de publication comparable : sans protocole, « www. », paramètres de suivi ni barre finale ; en minuscules.
function normalizeUrl(u) {
  const t = String(u || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return t;
}

const api={parseCsv,parseCount,parseDateFr,normalizeUrl,REF_LABEL,interactionsOf,rateOf,effectiveReadings,groupByPublication,byRecent,referenceReading,aggregate,evolution,addDays,daysBetween,PERIODS,periodRange,inRange,EMPTY_FILTERS,MEASURES,activeFilterCount,normalize,measureMatches,applyFilters,previousPeriodFilters,filtersToQuery,filtersFromQuery,weekStart,monthBounds,shiftMonth,csvCell,toCsv};
if(typeof window!=="undefined")window.WakabiCalc=api;
globalThis.WakabiCalc=api;
})();
