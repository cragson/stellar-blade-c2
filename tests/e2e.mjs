// End-to-end test in a real (headless) Chromium, driven over the DevTools protocol.
//
//   node tests/e2e.mjs --save /path/to/StellarBladeSave00.sav [--out ./e2e-out] [--chromium chromium]
//
// Opens the editor from a local static server, loads the save through the real file input, uses every
// page the way a player would (tiles, the amount editor, fill buttons, the wardrobe, pips, the skill tree,
// the story timeline, ...), downloads the edited save and checks the file. Fails on any console error
// (CSP violations included). Screenshots go to --out.
//
// Copyright (C) 2026 cragson - SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO, "docs"); // the web app (served by GitHub Pages from /docs)
const G = require(path.join(ROOT, "gvas.js"));
const { Inventory } = require(path.join(ROOT, "model.js"));
const ITEMS = require(path.join(ROOT, "items.js"));
const GAME = require(path.join(ROOT, "gamedata.js"));
const { Progress } = require(path.join(ROOT, "progress.js"));
const CHAPTERS = require(path.join(ROOT, "chapters.js"));
const CH = require(path.join(ROOT, "chapter.js"));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
if (!args.save) { console.error("usage: node tests/e2e.mjs --save StellarBladeSave00.sav [--out dir]"); process.exit(2); }
const OUT = path.resolve(args.out || path.join(REPO, "e2e-out"));
const DL = path.join(OUT, "downloads");
await rm(OUT, { recursive: true, force: true });
await mkdir(DL, { recursive: true });

// ---------------------------------------------------------------- static server
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  const rel = path.relative(ROOT, p);
  if (rel.startsWith("..") || path.isAbsolute(rel)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }).end(await readFile(p));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

// ---------------------------------------------------------------- browser
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(args.chromium || "chromium", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", `--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(OUT, "profile")}`, "--window-size=1280,900", "about:blank",
], { stdio: "ignore" });
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { /* not up yet */ }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const waiting = new Map();
const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value || a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
  if (m.method === "Page.javascriptDialogOpening") cdp("Page.handleJavaScriptDialog", { accept: true });
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr}\n${r.exceptionDetails.exception?.description}`);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { try { chrome.kill(); } catch (e) { /* gone */ } process.exit(130); });
process.on("exit", () => { try { chrome.kill(); } catch (e) { /* gone */ } });
// headless Chromium can stall on a screenshot: give up on that one after 20 s and carry on (they're for looking at, not checks)
const shot = async (name) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await Promise.race([cdp("Page.captureScreenshot", { format: "png" }), sleep(20000).then(() => null)]);
    if (r) { await writeFile(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64")); return; }
  }
  console.log(`note  screenshot ${name} timed out`);
};
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };

try {
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable");
  await cdp("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  await cdp("Page.navigate", { url: URL_ });
  await sleep(800);
  check(await js(`!document.querySelector("#pageEmpty").hidden && !!document.querySelector("#drop")`), "start page shows the drop zone");
  check(await js(`typeof showDirectoryPicker !== "function" || !!document.querySelector("#folderStart .connect")`), "start page offers to connect the save folder");
  check(await js(`document.fonts.check("16px Saira")`), "the bundled font loads");
  await shot("1-start");

  // open the save through the real file input
  const { root } = await cdp("DOM.getDocument");
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "#fileInput" });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [path.resolve(args.save)] });
  await cdp("Page.bringToFront"); // a file handed to an input leaves headless Chromium hidden (no frames)
  for (let i = 0; i < 50 && !(await js("!!window.__sbEditor.state.file")); i++) await sleep(100);
  check(await js("!!window.__sbEditor.state.file"), "save opened");
  const gold0 = await js(`window.__sbEditor.state.totals.BetaCrystal || 0`);
  const click = (sel, scope = "") => js(`(() => { const b = document.querySelector(${JSON.stringify((scope ? scope + " " : "") + sel)}); if (!b) throw new Error("nothing matches " + ${JSON.stringify(sel)}); b.click(); return true; })()`);
  const tryClick = (sel) => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); return !!b; })()`);
  const nav = async (view) => { await click(`#nav [data-view="${view}"]`); await sleep(120); };
  await shot("2-overview");
  check(await js(`/Stellar Blade: C2 by cragson/.test(document.querySelector(".credits").textContent.replace(/\\s+/g, " "))`), "author credit is visible");
  check(await js(`/made with/.test(document.querySelector(".made-by").textContent)`), "made-with line is visible");
  check(await js(`["x.com/cracksohn", "youtube.com/@cragson", "github.com/cragson"].every((u) => [...document.querySelectorAll(".socials a")].some((a) => a.href.includes(u)))`), "social links are there");
  check(await js(`document.querySelectorAll("#page .stat").length >= 6 && !!document.querySelector("#page .hero-time")`), "save stats and play time are shown");
  check(await js(`!!document.querySelector("#page .journey .j-marker.here")`), "story progress line shows where the save is");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await sleep(150);
  await shot("2-overview-light");
  await cdp("Emulation.setEmulatedMedia", { features: [] });

  // tooltips: hovering a control shows what it does
  const box = await js(`(() => { const r = document.querySelector('#page [data-act^="fill:"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box[0], y: box[1] });
  await sleep(450);
  check(await js(`document.querySelector("#tip").classList.contains("show") && document.querySelector("#tip").textContent.length > 5`), "hovering a button shows its tooltip");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });

  // supply pack and can registration on the overview
  const pack = await js(`(document.querySelector('#page [data-act^="pack:"]') || {}).dataset?.act || null`);
  if (pack) {
    await click(`#page [data-act="${pack}"]`);
    check(await js(`Object.keys(window.__sbEditor.state.pending).length >= 1`), `a supply pack adds changes (${pack})`);
  } else console.log("     every supply pack is already full");
  console.log(`     cans to register: ${await tryClick('#page [data-act="register"]')}`);

  // Gold through the amount editor on the Currency page
  await nav("currency");
  await click(`#page .tile[data-alias="BetaCrystal"]`);
  await sleep(80);
  check(await js(`!document.querySelector("#inspector").hidden`), "clicking a stackable item opens the amount editor");
  await js(`(() => { const i = document.querySelector('#inspector [data-act="insp-input"]'); i.value = "12.5m"; i.dispatchEvent(new Event("change")); })()`);
  check(await js(`window.__sbEditor.state.pending.BetaCrystal`) === 12500000, "the amount editor accepts 12.5m");
  check(await js(`document.querySelector('#page .tile[data-alias="BetaCrystal"]').dataset.state === "changed"`), "the changed tile turns gold");
  await shot("3-amount-editor");
  await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);

  // icon pack: a tiny made-up pack (no game art in the tests), loaded on the Tools page
  const dot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  await writeFile(path.join(OUT, "pack.json"), JSON.stringify({ format: "sb-icons", version: 1, icons: { BetaCore: dot, BodyCore: dot } }));
  await nav("tools");
  const { root: root2 } = await cdp("DOM.getDocument");
  const { nodeId: iconNode } = await cdp("DOM.querySelector", { nodeId: root2.nodeId, selector: "#iconInput" });
  await cdp("DOM.setFileInputFiles", { nodeId: iconNode, files: [path.join(OUT, "pack.json")] });
  await cdp("Page.bringToFront"); // a file handed to an input leaves headless Chromium hidden (no frames)
  for (let i = 0; i < 30 && !(await js("!!window.__sbEditor.icons.map")); i++) await sleep(100);
  check(await js(`Object.keys(window.__sbEditor.icons.map || {}).length`) === 2, "icon pack loads");
  await nav("upgrade");
  check(await js(`document.querySelectorAll("#page .tile .art img").length`) === 2, "item tiles show the pack's icons");
  // an item you don't have yet: a dashed tile; give it an amount
  const ghost = await js(`(() => { const t = document.querySelector('#page .tile:not(.single)[data-state="missing"]'); return t ? t.dataset.alias : null; })()`);
  if (ghost) {
    await click(`#page .tile[data-alias="${ghost}"]`);
    await click(`#inspector [data-act="insp-set:10"]`);
    check(await js(`window.__sbEditor.state.pending[${JSON.stringify(ghost)}] === Math.min(10, SB_ITEMS[${JSON.stringify(ghost)}].max || 10)`), `a missing item (${ghost}) can be added from its tile`);
    await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  }
  await shot("4-category");

  // collections: fill Exospines and Nanosuits from the overview rings
  await nav("overview");
  const outfitsBefore = JSON.parse(await js(`JSON.stringify(Object.fromEntries(Object.keys(SB_ITEMS)
    .filter(a => SB_ITEMS[a].cat === "outfit").map(a => [a, window.__sbEditor.state.totals[a] || 0])))`));
  for (const cat of ["exospine", "outfit"]) await tryClick(`#page [data-act="fill:${cat}"]`);
  check(await js(`window.__sbEditor.collection("exospine").missing.length === 0 && window.__sbEditor.collection("outfit").missing.length === 0`),
    "the + on a ring adds every missing Exospine and Nanosuit");
  check(await js(`"BS_Nikke_01" in window.__sbEditor.state.pending || (window.__sbEditor.state.totals.BS_Nikke_01 || 0) > 0`),
    "edition and DLC nanosuits are included");
  if (Object.values(outfitsBefore).filter((n) => n === 0).length > 3) {
    check(await js(`[...document.querySelectorAll("#changeList li")].some(li => /Nanosuits/.test(li.textContent) && /\\+\\d+/.test(li.textContent))`),
      "bulk adds show as one line in the change list");
  }
  await shot("4b-collection");
  if (Object.values(outfitsBefore).some((n) => n === 0)) {
    await nav("outfit");
    await click(`#page [data-act="filter:missing"]`);
    await sleep(80);
    check(await js(`document.querySelectorAll("#page .tile").length > 0 && [...document.querySelectorAll("#page .tile")].every(t => t.dataset.state === "added")`),
      "the missing filter shows the added nanosuits in gold");
  }
  await nav("gear");
  check(await js(`!!document.querySelector('#page .tile[data-rarity="rare"]')`), "gear rarity is shown as colour");
  // a collection that still has gaps (the save may already have every gear piece)
  const gapCat = await js(`["gear", "cosmetic", "blueprint", "collectible"].find((c) => window.__sbEditor.collection(c).missing.length) || null`);
  console.log(`     collection with gaps: ${gapCat}`);
  if (gapCat) await nav(gapCat);
  await click(`#page [data-act="filter:missing"]`);
  await sleep(80);
  check(await js(`[...document.querySelectorAll("#page .tile")].every(t => t.dataset.state === "missing" && t.querySelector(".tile-badge .ic"))`),
    "missing items show as dashed tiles with a +");
  await shot("4d-missing");
  // clicking a missing single item adds it, clicking again undoes it
  const g = await js(`(document.querySelector('#page .tile.single[data-state="missing"]') || {}).dataset?.alias || null`);
  if (g) {
    await click(`#page .tile[data-alias="${g}"]`);
    check(await js(`window.__sbEditor.state.pending[${JSON.stringify(g)}]`) === 1, "clicking a missing tile adds it");
    await click(`#page .tile[data-alias="${g}"]`);
    check(await js(`!(${JSON.stringify(g)} in window.__sbEditor.state.pending)`), "clicking it again undoes it");
  }

  // wardrobe: open the nanosuit slot and pick another suit
  // Exospine levels: raise one that isn't at level 3 yet
  await nav("exospine");
  const lvl = await js(`(() => { const w = [...document.querySelectorAll('#page .tile-wrap')].find((x) => x.querySelectorAll('.pip.on').length < 3); if (!w) return null; w.querySelector('.pip:last-child').click(); return w.querySelector('.tile').dataset.alias; })()`);
  if (lvl) check(await js(`window.__sbEditor.state.prog.itemLevels[${JSON.stringify(lvl)}]`) === 3, `Exospine ${lvl} raised to level 3`);
  else console.log("     every Exospine is at level 3");
  await nav("wardrobe");
  await click(`#page [data-slot="5"]`);
  await sleep(80);
  const suit = await js(`(() => { const t = document.querySelector('#page .picker .tile.pick[data-state="option"]'); if (!t) return null; t.click(); return t.dataset.alias; })()`);
  check(!!suit && (await js(`window.__sbEditor.state.prog.equip[5]`)) === suit, `wardrobe: Eve will wear ${suit}`);
  await shot("5-wardrobe");

  // skills: one more skill point, then learn every skill
  const sp0 = await js(`window.__sbEditor.state.sp`);
  await nav("skills");
  await click(`#page [data-act="sp:+1"]`);
  check(await js(`document.querySelectorAll("#page .skill").length > 10 && document.querySelectorAll("#page .skill-lines .edge").length > 5`), "the skill tree is drawn as a graph");
  await tryClick(`#page [data-act="skills:all"]`);
  await shot("6-skills");

  // upgrades and difficulty
  await nav("upgrades");
  await click(`#page [data-act="difficulty:2"]`);
  await click(`#page [data-act="levels:max"]`);
  check(await js(`document.querySelectorAll("#page .pip.ng").length > 0`), "New Game+ levels are shown as their own pips");
  await shot("7-upgrades");

  await nav("camps");
  check(await js(`document.querySelectorAll("#page .camp-map .pin").length > 50`), "camps are drawn on region maps");
  await tryClick(`#page [data-act="camps:visited"]`);
  await shot("8-camps");
  // teleport: the camp map's second mode
  await click(`#page [data-act="camps:mode:travel"]`);
  await sleep(80);
  await click(`#page button.camp-chip[data-key]`);
  let warp = JSON.parse(await js(`JSON.stringify(window.__sbEditor.state.prog.warp)`));
  check(!!warp && !!warp.map && warp.loc.length === 3, `teleport target picked on the map (${warp && warp.label})`);
  await shot("8b-teleport");
  // the world map: loot search, an object's card, and teleporting to it
  await nav("map");
  for (let i = 0; i < 40 && !(await js(`!!document.querySelector("#page .map-canvas")`)); i++) await sleep(100);
  check(await js(`!!document.querySelector("#page .map-canvas") && document.querySelectorAll("#page .layer").length > 4`), "the world map draws with its layers");
  check(await js(`SBMap.results("beta core")[0].label === "Beta Core" && SBMap.results("beta core")[0].ids.length > 5`), "searching loot finds the places that hold it");
  await js(`SBMap.pick(0, "beta core")`);
  await sleep(150);
  check(await js(`SBMap.V.hl && SBMap.V.hl.size > 5 && !!document.querySelector("#page .map-hl")`), "a loot search lights up its places");
  await js(`SBMap.pick(SBMap.results("supply box").findIndex((r) => r.type === "marker"), "supply box")`);
  await sleep(150);
  check(await js(`!!document.querySelector("#page .map-card .map-loot li")`), "an object's card lists what's inside");
  await shot("8c-map");
  check(await js(`SBMap.count("item") > 500 && SBMap.count("enemy") > 500 && SBMap.count("quest") > 30`), "the map has loose items, enemies and side quest steps");
  check(await js(`(() => { const g = SBMap.results("lily").find((r) => r.type === "group"); return !g || g.ids.length <= 4; })()`), "people are placed where the save has them, not at every story spawn");
  check(await js(`SBMap.passcodes().length >= 30 && document.querySelectorAll("#page .pc-card").length === SBMap.passcodes().length`), "every passcode is on the board");
  check(await js(`(() => { const r = SBMap.results("creeper"); return r.length && r[0].type === "group" && r[0].ids.length > 50; })()`), "searching an enemy finds all its spawns");
  check(await js(`(() => { const pc = SBMap.passcodes().find((p) => p.state === "unknown"); if (!pc) return true; const el = document.querySelector('#page [data-pc="' + pc.key + '"] .pc-code'); return el && el.classList.contains("masked") && !el.textContent.includes(pc.code); })()`), "passcodes the save hasn't found stay hidden");
  await js(`SBMap.pick(SBMap.results("supply box").findIndex((r) => r.type === "marker"), "supply box")`);
  await sleep(150);
  await click(`#page [data-act="map:teleport"]`);
  warp = JSON.parse(await js(`JSON.stringify(window.__sbEditor.state.prog.warp)`));
  check(!!warp && warp.kind === "pos", `teleport target set from the map (${warp && warp.label})`);
  // the codex pages
  const pageReady = async (view, sel) => { await nav(view); for (let i = 0; i < 50 && !(await js(`!!document.querySelector(${JSON.stringify(sel)})`)); i++) await sleep(100); return js(`document.querySelectorAll(${JSON.stringify(sel)}).length`); };
  check((await pageReady("bestiary", "#page .beast")) > 50, "the bestiary lists the enemies");
  check((await pageReady("moves", "#page .move")) > 80, "the move list has every move");
  check((await pageReady("builds", "#page .stat-row")) > 10, "the build planner computes the save's stats");
  check((await pageReady("fishguide", "#page .fishes .fish")) >= 30, "the fish guide lists the fish");
  check((await pageReady("dialogues", "#page .dlg-pick")) > 100, "the dialogue browser lists the conversations");
  check((await pageReady("manual", "#page .manual-entry")) > 60, "the manual lists its pages");
  check((await pageReady("dlc", "#page .check")) > 20, "the DLC checklists are there");
  check((await pageReady("people", "#page .people tbody tr")) > 3, "the people page lists who's there");
  await click(`#page [data-act="people:send away"]`);
  check(await js(`Object.keys(window.__sbEditor.state.prog.people).length === 1`), "a people change is pending");
  await js(`window.__sbEditor.state.prog.people = {}`);

  await nav("quests");
  await click(`#page [data-act="quests:request"]`);
  await sleep(80);
  await click(`#page [data-act="quest-done"]`);
  await shot("9-quests");
  // side quest steps: open a quest that hasn't started and put it at its 2nd step
  await click(`#page [data-act="quests:side"]`);
  await sleep(80);
  const stepQuest = await js(`(() => { const c = [...document.querySelectorAll('#page .qcard[data-state="none"]')].find((x) => x.querySelector('[data-act="quest-steps"]') && (SB_GAME.questSteps[x.dataset.key] || []).length > 1); if (!c) return null; c.querySelector('[data-act="quest-steps"]').click(); return c.dataset.key; })()`);
  if (stepQuest) {
    await sleep(80);
    await click(`#page [data-act="step:${stepQuest}:1"]`);
    check(await js(`window.__sbEditor.state.prog.questSteps[${JSON.stringify(stepQuest)}]`) === 1, `side quest ${stepQuest} set to step 2`);
  }

  await nav("chapters");
  await click(`#page [data-act="chapter"]`);
  const chapterKey = await js(`window.__sbEditor.state.prog.chapter`);
  check(!!chapterKey, `chapter picked on the timeline: ${chapterKey}`);
  const logBeforePreset = await js(`SBCommands.LOG.length`);
  await click(`#page [data-act="preset:2"]`);
  for (let i = 0; i < 40 && (await js(`SBCommands.LOG.length`)) === logBeforePreset; i++) await sleep(100);
  check(await js(`SBCommands.LOG.length`) > logBeforePreset, `gear up ran (${await js(`SBCommands.LOG[0] && SBCommands.LOG[0].msg`)})`);
  await shot("10-story");

  await nav("shops");
  const shopsRaised = await tryClick(`#page [data-act="shops:max"]`);
  await tryClick(`#page [data-act="music:all"]`);
  const track = await js(`(() => { const r = [...document.querySelectorAll('#page .record[data-state="open"]')].pop(); if (!r) return null; r.click(); return r.dataset.key; })()`);
  check(!!track && (await js(`window.__sbEditor.state.prog.music`)) === track, `camp music set to ${track}`);
  await shot("11-shops-music");

  await nav("album");
  await tryClick(`#page [data-act="boss:all"]`);
  await tryClick(`#page [data-act="album:all"]`);
  await shot("12-album");
  await nav("trophies");
  check(await js(`document.querySelectorAll("#page .medal").length > 30`), "trophies are shown as medals");
  await shot("13-trophies");
  await nav("tools");
  await tryClick(`#page [data-act="tool:markers"]`);
  const hints = await tryClick(`#page [data-act="tool:hints"]`);
  await shot("14-tools");

  // commands: the search field is also a console
  const potions0 = await js(`window.__sbEditor.state.totals.HP_Potion_Small || 0`);
  const potions = potions0 === 7 ? 8 : 7;
  const type = (sel, text) => js(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); return true; })()`);
  const enter = (sel) => js(`(() => { document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
  await type("#search", "SBPlayerSet");
  await sleep(80);
  check(await js(`!document.querySelector("#omniList").hidden && /SBPlayerSetLevel/.test(document.querySelector("#omniList").textContent)`), "typing SB suggests commands");
  await type("#search", `SBSetItemCount HP_Potion_Small ${potions}`);
  await enter("#search");
  await sleep(80);
  check(await js(`window.__sbEditor.state.pending.HP_Potion_Small`) === potions, "a typed command changes the save plan");
  await nav("commands");
  await type("#console", "SBFoo 1");
  await enter("#console");
  check(await js(`/Unknown command/.test(document.querySelector(".console-log li").textContent)`), "an unknown command is reported in the console");
  const logBefore = await js(`SBCommands.LOG.length`);
  await click(`#page [data-act^="recipe:"]`);
  check(await js(`SBCommands.LOG.length`) > logBefore, "a developer command set runs");
  check(await js(`document.querySelector("#page pre.script").textContent.split(String.fromCharCode(10)).length >= 10`), "every change is shown as a command");
  await shot("14b-commands");
  // saves: a snapshot in this browser, and what the download will change
  await nav("saves");
  await click(`#page [data-act="snap:take"]`);
  for (let i = 0; i < 30 && !(await js(`(window.SBSaves.UI.snaps || []).length > 0`)); i++) await sleep(100);
  check(await js(`(window.SBSaves.UI.snaps || []).length > 0`), "a snapshot is kept in the browser");
  await click(`#page [data-act="cmp:run"]`);
  for (let i = 0; i < 60 && !(await js(`!!document.querySelector("#page .diff-row")`)); i++) await sleep(100);
  check(await js(`document.querySelectorAll("#page .diff-row").length > 3`), "comparing the open save with your changes lists the differences");
  await shot("14d-saves");
  await nav("commands");
  await click(`#page [data-act="tab:catalog"]`);
  for (let i = 0; i < 40 && !(await js("!!window.SB_INTEL")); i++) await sleep(100);
  await sleep(150);
  check(await js(`document.querySelectorAll("#page .cmd-entry").length > 100 && document.querySelectorAll("#page .cmd-entry.st-rebuilt").length > 10`), "the catalog lists the developers' commands with their status");
  await js(`(() => { const i = document.querySelector('#page [data-act="catalog:q"]'); i.value = "warp"; i.dispatchEvent(new Event("input")); })()`);
  check(await js(`[...document.querySelectorAll("#page .cmd-entry .cmd-name")].every(e => /warp/i.test(e.closest(".cmd-entry").textContent))`), "the catalog filter works");
  await click(`#page [data-act="tab:sets"]`);
  await sleep(300);
  check(await js(`document.querySelectorAll("#page .set-entry").length > 20`), "the developer sets are listed");
  await shot("14c-catalog");
  await click(`#page [data-act="tab:console"]`);
  const prog = await js(`JSON.stringify({ learn: [...window.__sbEditor.state.prog.learn], camps: [...window.__sbEditor.state.prog.camps], done: [...window.__sbEditor.state.prog.questsDone], ach: [...window.__sbEditor.state.prog.ach.keys()], shops: window.__sbEditor.state.prog.shops })`);
  check(JSON.parse(prog).learn.length + JSON.parse(prog).ach.length + JSON.parse(prog).camps.length + JSON.parse(prog).done.length > 0, "progress pages queue changes");
  check(await js(`document.querySelectorAll("#changeList li").length >= 10`), "every change is listed in the sidebar");

  // phone layout: no page may scroll sideways
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  const wide = [];
  for (const v of ["overview", "map", "saves", "people", "dlc", "bestiary", "moves", "builds", "fishguide", "dialogues", "manual", "wardrobe", "upgrades", "skills", "chapters", "quests", "camps", "shops", "album", "trophies", "tools", "commands", "gear", "currency"]) {
    await js(`document.querySelector('#nav [data-view="${v}"]').click()`);
    await sleep(80);
    if (await js(`document.documentElement.scrollWidth > innerWidth + 1`)) wide.push(v);
  }
  check(!wide.length, `phone layout fits the screen${wide.length ? ": too wide on " + wide.join(", ") : ""}`);
  await nav("overview");
  await shot("15-mobile");
  await js(`document.querySelector("#menuOpen").click()`);
  await sleep(300);
  await shot("16-mobile-menu");
  await js(`document.querySelector("#menuClose").click()`);
  await cdp("Emulation.clearDeviceMetricsOverride");

  // download
  const pending = await js(`JSON.stringify(window.__sbEditor.state.pending)`);
  await js(`document.querySelector("#downloadBtn").click()`);
  let files = [];
  for (let i = 0; i < 80 && !files.some((f) => f.endsWith(".sav")); i++) { await sleep(150); files = await readdir(DL); }
  const savFile = files.find((f) => f.endsWith(".sav"));
  check(!!savFile, `edited save downloaded (${savFile})`);
  check(await js(`document.querySelector("#installDialog").open`), "install steps shown after download");
  await shot("17-downloaded");

  if (savFile) {
    const bytes = new Uint8Array(await readFile(path.join(DL, savFile)));
    const inv = new Inventory(G.parse(bytes), ITEMS);
    const want = JSON.parse(pending);
    for (const [a, n] of Object.entries(want)) {
      const got = inv.count(a);
      if (got !== n) check(false, `${a}: expected ${n}, file has ${got}`);
    }
    check(Object.entries(want).every(([a, n]) => inv.count(a) === n), `downloaded file has all ${Object.keys(want).length} item changes`);
    check(inv.sp === (sp0 === null ? null : sp0 + 1), `skill points ${sp0} -> ${inv.sp}`);
    check(Object.keys(outfitsBefore).every((a) => inv.count(a) >= 1), "file has every nanosuit");
    check(inv.count("BetaCrystal") === 12500000 && gold0 !== 12500000, `Gold is 12,500,000 in the file (file ${inv.count("BetaCrystal")}, plan ${want.BetaCrystal}, save ${gold0})`);
    const P = new Progress(G.parse(bytes), GAME);
    const want2 = JSON.parse(prog);
    check(P.difficulty === 2, "difficulty is Hard Mode in the file");
    check(GAME.levels.every((l) => P.level(l.index) === l.max), "every upgrade is at its maximum in the file");
    check(want2.learn.every((a) => P.learned().has(a)), `${want2.learn.length} skills learned in the file`);
    check(want2.camps.every((c) => P.campState(c) === "active"), `${want2.camps.length} camps active in the file`);
    check(want2.done.every((q) => P.questStates()[q] === "done"), "bounty request marked done in the file");
    const achs = P.achievements();
    check(want2.ach.every((a) => achs.get(a) && achs.get(a).done), `${want2.ach.length} Album and Boss Challenge unlocks in the file`);
    check(P.newMarkers() === 0, "no \"new\" markers left in the file");
    const cans = Object.keys(GAME.cans).filter((c) => inv.count(c) > 0);
    check(cans.every((c) => achs.get(GAME.cans[c]) && achs.get(GAME.cans[c]).done), `all ${cans.length} cans are registered for the vending machine`);
    check(GAME.canMilestones.filter((m) => m.n <= cans.length).every((m) => achs.get(m.ach) && achs.get(m.ach).done && m.skills.every((sk) => P.learned().has(sk))),
      "can milestones and their reward skills are in the file");
    check(CH.currentPoint(G.parse(bytes), CHAPTERS).chapter === chapterKey, `the file is at chapter ${chapterKey}`);
    check(P.equipped()[5] === suit, `Eve wears ${suit} in the file`);
    check(P.music() === track, "camp music is set in the file");
    const eve = P.evePosition();
    check(eve.map === warp.map && eve.loc.every((v, i) => Math.abs(v - warp.loc[i]) < 1), `Eve is at the teleport target in the file (${eve.map})`);
    if (lvl) check(P.itemLevel(lvl, ITEMS) === 3, `${lvl} is level 3 in the file`);
    if (stepQuest) check(P.questStates()[stepQuest] === "active" && P.questStep(stepQuest) === 1, `${stepQuest} is at step 2 in the file`);
    if (shopsRaised) check(Object.entries(want2.shops).every(([k, lv]) => P.shopLevel(k) === lv), "shop levels are raised in the file");
    if (hints) check(new Set(P.hintList()).size >= GAME.hints.length, "every tutorial pop-up is marked seen in the file");
  }
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
console.log(failures ? `${failures} failure(s)` : "all good");
process.exit(failures ? 1 : 0);
