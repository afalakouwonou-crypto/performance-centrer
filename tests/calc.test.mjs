// Tests des calculs (node --test wakabi-tests/calc.test.mjs). Aucune dépendance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.env.WAKABI_SITE || path.join(here, "..", "site");
await import(pathToFileURL(path.join(site, "js", "calc.js")).href);
const C = globalThis.WakabiCalc;

const R = (o) => ({ likes: 0, comments: 0, shares: 0, reposts: null, saves: null, ...o });

test("interactions = likes + commentaires + partages (republications et enregistrements exclus)", () => {
  assert.equal(C.interactionsOf(R({ likes: 10, comments: 3, shares: 2, reposts: 50, saves: 70 })), 15);
});

test("taux : null si vues nulles ou absentes (jamais de division par zéro)", () => {
  assert.equal(C.rateOf(0, 5), null);
  assert.equal(C.rateOf(-1, 5), null);
  assert.equal(C.rateOf(200, 10), 0.05);
});

test("taux pondéré d'un ensemble ≠ moyenne des taux", () => {
  const a = C.aggregate([R({ views: 1000, likes: 10 }), R({ views: 10, likes: 5 })]);
  assert.equal(a.views, 1010);
  assert.equal(a.interactions, 15);
  assert.equal(a.rate, 15 / 1010);
  assert.notEqual(a.rate, (0.01 + 0.5) / 2);
});

test("republications / enregistrements : N/D (null) si aucune valeur connue, jamais 0", () => {
  const a = C.aggregate([R({ views: 10 }), R({ views: 20 })]);
  assert.equal(a.reposts, null);
  assert.equal(a.saves, null);
  const b = C.aggregate([R({ views: 10, reposts: 0 }), R({ views: 20 })]);
  assert.equal(b.reposts, 0);
  assert.equal(b.repostsN, 1);
});

test("agrégat vide : n = 0, taux null", () => {
  const a = C.aggregate([null, undefined]);
  assert.equal(a.n, 0);
  assert.equal(a.rate, null);
});

test("évolution : relative seulement si la valeur précédente est > 0", () => {
  assert.deepEqual(C.evolution(100, 150), { abs: 50, rel: 0.5 });
  assert.deepEqual(C.evolution(0, 150), { abs: 150, rel: null });
  assert.equal(C.evolution(null, 150), null);
});

test("relevés en vigueur : une correction remplace le relevé corrigé, en chaîne", () => {
  const rs = [
    { id: "a", publication_id: "p", reading_type: "j7", views: 1 },
    { id: "b", publication_id: "p", reading_type: "j7", views: 2, corrects_reading_id: "a" },
    { id: "c", publication_id: "p", reading_type: "j7", views: 3, corrects_reading_id: "b" },
  ];
  assert.deepEqual(C.effectiveReadings(rs).map(r => r.id), ["c"]);
});

test("relevé de référence : J+1, J+7 ou le plus récent (date de mesure puis saisie)", () => {
  const list = [
    { id: "j1", reading_type: "j1", measured_on: "2026-11-02", entered_at: "2026-11-02T10:00:00Z" },
    { id: "j7", reading_type: "j7", measured_on: "2026-11-08", entered_at: "2026-11-08T10:00:00Z" },
    { id: "o", reading_type: "other", measured_on: "2026-11-20", entered_at: "2026-11-20T10:00:00Z" },
  ];
  assert.equal(C.referenceReading(list, "j1").id, "j1");
  assert.equal(C.referenceReading(list, "j7").id, "j7");
  assert.equal(C.referenceReading(list, "latest").id, "o");
  assert.equal(C.referenceReading([], "j7"), null);
});

test("périodes : bornes incluses et période précédente de même durée", () => {
  assert.deepEqual(C.periodRange("7", "2026-11-12"), { start: "2026-11-06", end: "2026-11-12", days: 7, prevStart: "2026-10-30", prevEnd: "2026-11-05" });
  assert.deepEqual(C.periodRange("month", "2026-11-12"), { start: "2026-11-01", end: "2026-11-12", days: 12, prevStart: "2026-10-20", prevEnd: "2026-10-31" });
  assert.equal(C.periodRange("all", "2026-11-12"), null);
  assert.equal(C.periodRange("custom", "2026-11-12", "2026-11-10", "2026-11-01"), null);
  assert.equal(C.periodRange("30", "2026-03-01").start, "2026-01-31");
});

function ctx() {
  const contents = [
    { id: "c1", title: "On va où là ? — Restaurant X", country: "Togo", rubrique: "SPOT", rubrique_id: "r1", content_type_id: "t-video", campaign_id: null, objective_id: null, publish_date: "2026-10-10", archived_at: null },
    { id: "c2", title: "Zémi Tour Cotonou", country: "Bénin", rubrique: "GUIDE", rubrique_id: "r2", content_type_id: "t-photo", campaign_id: "vsd", objective_id: "o1", publish_date: "2026-10-20", archived_at: "2026-11-01T00:00:00Z" },
    { id: "c3", title: "Sans publication", country: "Togo", rubrique: "SPOT", rubrique_id: "r1", publish_date: "2026-11-08", archived_at: null },
  ];
  const pubs = {
    c1: [{ id: "p1", platform_id: "tt", published_on: "2026-10-11" }, { id: "p2", platform_id: "ig", published_on: null }],
    c2: [{ id: "p3", platform_id: "tt", published_on: "2026-10-21" }],
    c3: [],
  };
  return {
    contents, pubsOf: id => pubs[id], basisDate: (p, c) => p.published_on || c.publish_date, platformIdOf: p => p.platform_id,
    ownerPlatforms: id => (id === "clemence" ? new Set(["tt"]) : new Set()),
    states: p => (p.id === "p1" ? { j1: "missed", j7: "done" } : { j1: "due", j7: "upcoming" }), today: "2026-11-12",
  };
}

test("filtres combinés : TikTok + vidéo + rubrique + octobre", () => {
  const f = { ...C.EMPTY_FILTERS, platform: "tt", type: "t-video", rubrique: "r1", period: "custom", from: "2026-10-01", to: "2026-10-31" };
  const r = C.applyFilters(f, ctx());
  assert.deepEqual(r.contents.map(c => c.id), ["c1"]);
  assert.deepEqual(r.pubs.map(p => p.id), ["p1"]);
});

test("filtres : statut archivé, recherche sans accents, responsable, état de mesure", () => {
  const x = ctx();
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, status: "archived" }, x).contents.map(c => c.id), ["c2"]);
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, status: "active" }, x).contents.map(c => c.id), ["c1", "c3"]);
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, q: "zemi" }, x).contents.map(c => c.id), ["c2"]);
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, owner: "clemence" }, x).pubs.map(p => p.id), ["p1", "p3"]);
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, measure: "missed" }, x).pubs.map(p => p.id), ["p1"]);
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, measure: "todo" }, x).pubs.map(p => p.id), ["p2", "p3"]);
});

test("contenu sans publication : retenu seulement sans filtre de publication et dans la période", () => {
  const x = ctx();
  assert.ok(C.applyFilters({ ...C.EMPTY_FILTERS }, x).contents.some(c => c.id === "c3"));
  assert.ok(!C.applyFilters({ ...C.EMPTY_FILTERS, platform: "tt" }, x).contents.some(c => c.id === "c3"));
  assert.ok(C.applyFilters({ ...C.EMPTY_FILTERS, period: "7" }, x).contents.some(c => c.id === "c3"));
  assert.ok(!C.applyFilters({ ...C.EMPTY_FILTERS, period: "custom", from: "2026-10-01", to: "2026-10-31" }, x).contents.some(c => c.id === "c3"));
});

test("période : date effective prioritaire, sinon date prévue", () => {
  const r = C.applyFilters({ ...C.EMPTY_FILTERS, period: "custom", from: "2026-10-10", to: "2026-10-10" }, ctx());
  assert.deepEqual(r.pubs.map(p => p.id), ["p2"]);
});

test("filtres <-> adresse : aller-retour et compteur", () => {
  const f = { ...C.EMPTY_FILTERS, platform: "tt", period: "30", q: "on va où" };
  const back = C.filtersFromQuery(C.filtersToQuery(f));
  assert.deepEqual(back, f);
  assert.equal(C.activeFilterCount(f), 3);
  assert.equal(C.filtersFromQuery("period=nimporte").period, "all");
  assert.equal(C.filtersToQuery(C.EMPTY_FILTERS), "");
});

test("filtres de la période précédente : mêmes critères, dates décalées", () => {
  const f = { ...C.EMPTY_FILTERS, platform: "tt", period: "7" };
  const range = C.periodRange("7", "2026-11-12");
  assert.deepEqual(C.previousPeriodFilters(f, range), { ...f, period: "custom", from: "2026-10-30", to: "2026-11-05" });
  assert.equal(C.previousPeriodFilters(f, null), null);
});

test("semaine du lundi, bornes de mois, décalage de mois", () => {
  assert.equal(C.weekStart("2026-11-12"), "2026-11-09");
  assert.equal(C.weekStart("2026-11-09"), "2026-11-09");
  assert.equal(C.weekStart("2026-11-15"), "2026-11-09");
  assert.deepEqual(C.monthBounds("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(C.monthBounds("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  assert.equal(C.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(C.shiftMonth("2026-12", 1), "2027-01");
});

test("CSV : formules neutralisées, séparateur ; virgule décimale, vide ≠ 0", () => {
  assert.equal(C.csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
  assert.equal(C.csvCell("+33 6"), "'+33 6");
  assert.equal(C.csvCell("@moi"), "'@moi");
  assert.equal(C.csvCell("-1"), "'-1");
  assert.equal(C.csvCell(-1), "-1");
  assert.equal(C.csvCell(0.048), "0,048");
  assert.equal(C.csvCell(null), "");
  assert.equal(C.csvCell(0), "0");
  assert.equal(C.csvCell("a;b"), "\"a;b\"");
  const t = C.toCsv([["Titre", "Vues"], ["On va où là ?", 1200]]);
  assert.ok(t.startsWith("﻿"));
  assert.equal(t.slice(1), "Titre;Vues\r\nOn va où là ?;1200");
});

test("filtres état de production et promotion (organique / sponsorisé / inconnu par défaut)", () => {
  const x = ctx();
  x.contents[0].production_status = "publie"; x.contents[1].production_status = "a_valider";
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, prod: "a_valider" }, x).contents.map(c => c.id), ["c2"]);
  const pubs = { p1: "sponsorise", p2: undefined, p3: "organique" };
  const y = { ...x, pubsOf: id => x.pubsOf(id).map(p => ({ ...p, promotion: pubs[p.id] })) };
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, promo: "sponsorise" }, y).pubs.map(p => p.id), ["p1"]);
  assert.deepEqual(C.applyFilters({ ...C.EMPTY_FILTERS, promo: "inconnu" }, y).pubs.map(p => p.id), ["p2"]);
  assert.ok(!C.applyFilters({ ...C.EMPTY_FILTERS, promo: "organique" }, y).contents.some(c => c.id === "c3"));
});

test("CSV : séparateur deviné, guillemets, retours à la ligne, BOM", () => {
  const r = C.parseCsv('﻿Titre;Vues\r\n"On va où là ; Lomé";"1 234"\r\n"Dit ""bonjour""";5\n\n');
  assert.equal(r.sep, ";");
  assert.deepEqual(r.rows, [["Titre", "Vues"], ["On va où là ; Lomé", "1 234"], ['Dit "bonjour"', "5"]]);
  assert.equal(C.parseCsv("a,b\n1,2").sep, ",");
  assert.deepEqual(C.parseCsv('a;b\n"ligne 1\nligne 2";3').rows[1], ["ligne 1\nligne 2", "3"]);
});

test("Import : nombres à la française, dates, adresses comparables", () => {
  assert.equal(C.parseCount("1 234"), 1234);
  assert.equal(C.parseCount("1.234"), 1234);
  assert.equal(C.parseCount("12 500"), 12500);
  assert.equal(C.parseCount(""), null);
  assert.ok(Number.isNaN(C.parseCount("-3")));
  assert.ok(Number.isNaN(C.parseCount("1,5")));
  assert.equal(C.parseDateFr("05/11/2026"), "2026-11-05");
  assert.equal(C.parseDateFr("2026-11-05"), "2026-11-05");
  assert.equal(C.parseDateFr("31/02/2026"), null);
  assert.equal(C.normalizeUrl("https://www.TikTok.com/@wakabi/video/123?lang=fr/"), "tiktok.com/@wakabi/video/123");
  assert.equal(C.normalizeUrl("http://tiktok.com/@wakabi/video/123/"), "tiktok.com/@wakabi/video/123");
});
