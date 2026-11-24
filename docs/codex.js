/*
 * Stellar Blade: C2 - the codex: bestiary, fishing, manual, DLC checklists and the people editor
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Built from codex-data.js (the game's data tables, loaded when a codex page opens). Names and numbers ship with
 * C2; longer texts (descriptions, manual pages, tips) come from the player's own pack (Tools > Item icons and map
 * art), like the game's artwork.
 */
(function () {
  "use strict";

  const { el, icon, fmt, seg, toast } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS } = A;
  const C = { open: null, qs: {}, cat: "all", diff: "Normal", tab: "manual", fishCat: "all", peopleWorld: null };

  // ------------------------------------------------------------------ loading
  const loaders = {};
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (!loaders[src]) {
      loaders[src] = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = src;
        tag.onload = resolve;
        tag.onerror = () => { delete loaders[src]; reject(new Error(`${src.split("?")[0]} couldn't be loaded.`)); };
        document.head.append(tag);
      });
    }
    return loaders[src];
  }
  const loadCodex = () => loadScript("codex-data.js?v=42cb95a0b6", () => !!window.SB_CODEX);
  /** Wait for data (and the pack's texts), then render; show a loading state meanwhile. */
  function needs(page, ...waits) {
    const missing = waits.filter((w) => !w.ready());
    if (!missing.length) return false;
    page.append(el("div", { class: "empty-state" }, icon("book"), el("span", { text: "Loading…" })));
    Promise.all(missing.map((w) => w.load())).then(() => A.render()).catch((e) => toast(e.message, true));
    return true;
  }
  const CODEX = { ready: () => !!window.SB_CODEX, load: loadCodex };
  const WORLD = { ready: () => !!(window.SBMap && window.SBMap.ready()), load: () => window.SBMap.whenReady() };
  let textsAsked = false;
  function texts() {
    if (!textsAsked) { textsAsked = true; A.loadTexts().then(() => { if (A.hasTexts()) A.render(); }); }
    return A.hasTexts();
  }
  /** A note where the pack's texts would go. */
  const packNote = (what) => el("p", { class: "pack-note" }, icon("info"),
    el("span", { text: `${what} come from your own copy of the game: load a pack made with make_icon_pack.py under Tools.` }));
  const paragraphs = (text) => text.split(/\n+/).filter((l) => l.trim()).map((l) => el("p", { text: l.trim() }));

  const pct = (p) => (p >= 1 ? "" : `${p < 0.1 ? Math.round(p * 1000) / 10 : Math.round(p * 100)} %`);
  const itemName = (a) => { const c = A.canon(a); return ITEMS[c] ? ITEMS[c].name : a.replace(/_/g, " "); };
  const lootList = (loot) => el("ul", { class: "map-loot" }, ...loot.map(([a, min, max, p]) => {
    const c = A.canon(a);
    return el("li", null, ITEMS[c] ? A.art(c) : icon("crate"), el("span", { text: itemName(a) }),
      p < 1 ? el("small", { class: "chance", text: pct(p) }) : null,
      el("b", { text: min === max ? (min > 1 ? `×${fmt(min)}` : "") : `×${fmt(min)}–${fmt(max)}` }));
  }));
  const search = (placeholder, onInput) => {
    // each page keeps its own search: what you typed in the bestiary doesn't filter the dialogues
    const input = el("input", { type: "search", class: "map-search-input", placeholder, value: C.qs[S.view] || "", "aria-label": placeholder, "data-act": "codex:q" });
    input.addEventListener("input", () => { C.qs[S.view] = input.value; onInput(); });
    return el("label", { class: "map-search codex-search" }, icon("search"), input);
  };
  const matches = (text) => (C.qs[S.view] || "").toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.toLowerCase().includes(w));

  // ================================================================== bestiary
  const DIFF = [["StoryMode", "Story"], ["Normal", "Normal"], ["Hard", "Hard"]];
  function scaled(v, stat, diff) {
    const D = window.SB_CODEX.difficulty;
    const group = v[v.length - 1];
    const change = (D[group] && D[group][diff] && D[group][diff][stat]) || 0;
    return Math.round(v[1 + window.SB_CODEX.stats.indexOf(stat)] * (1 + change / 100));
  }
  const range = (vals) => { const lo = Math.min(...vals), hi = Math.max(...vals); return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`; };
  /**
   * The variants that matter: those placed in the world (the map's spawns), else the base one. The game also keeps
   * training-room, cutscene and test variants with very different numbers; they stay in the details table.
   */
  function mainVariants(b) {
    const placed = window.SBMap && window.SBMap.ready() ? window.SBMap.spawnTypes() : null;
    const inWorld = placed ? b.v.filter((v) => placed.has(v[0])) : [];
    if (inWorld.length) return inWorld;
    const base = b.v.filter((v) => v[0] === b.base || v[0].replace(/^[A-Za-z]+_(?=M_)/, "").replace(/_\d+$/, "") === b.base);
    if (base.length) return base;
    const hp = b.v.map((v) => v[1]).sort((x, y) => x - y);
    return b.v.filter((v) => v[1] === hp[Math.floor(hp.length / 2)]).slice(0, 1);
  }

  function bestiary(page) {
    if (needs(page, CODEX)) return;
    texts();
    const B = window.SB_CODEX.bestiary;
    const cats = [...new Set(B.map((b) => b.cat || "Other"))];
    const list = B.filter((b) => (C.cat === "all" || (b.cat || "Other") === C.cat) && matches(`${b.n} ${b.cat || ""} ${b.v.map((v) => v[0]).join(" ")}`));
    const grid = el("div", { class: "beasts" });
    const fill = () => {
      grid.textContent = "";
      for (const b of B.filter((x) => (C.cat === "all" || (x.cat || "Other") === C.cat) && matches(`${x.n} ${x.cat || ""} ${x.v.map((v) => v[0]).join(" ")}`))) grid.append(beastCard(b));
    };
    page.append(el("div", { class: "codex-top" },
      search("Find an enemy", fill),
      seg([{ key: "all", label: "All", n: `${B.length}` }, ...cats.map((c) => ({ key: c, label: c.replace(/ Naytiba$/, ""), n: `${B.filter((b) => (b.cat || "Other") === c).length}` }))],
        C.cat, (k) => { C.cat = k; A.render(); }, "Kind"),
      seg(DIFF.map(([k, l]) => ({ key: k, label: l })), C.diff, (k) => { C.diff = k; A.render(); }, "Difficulty")));
    for (const b of list) grid.append(beastCard(b));
    page.append(grid);
    if (!WORLD.ready() && window.SBMap) window.SBMap.whenReady().then(() => A.render()).catch(() => {});
  }

  function beastCard(b) {
    const open = C.open === `beast:${b.n}`;
    const seen = b.ach ? A.achUnlocked(b.ach) : null;
    const main = mainVariants(b);
    const hp = main.map((v) => scaled(v, "MaxHP", C.diff));
    const atk = main.map((v) => scaled(v, "PhysicAttackPower", C.diff));
    const kind = b.rank === "Boss" ? "boss" : "enemy";
    const spawns = window.SBMap && window.SBMap.ready() && window.SBMap.hasGroup(`${kind}:${b.n}`);
    const card = el("article", { class: `beast${open ? " open" : ""}${b.rank === "Boss" ? " boss" : b.rank === "Elite" ? " elite" : ""}` },
      el("button", { type: "button", class: "beast-head", "aria-expanded": String(open), "data-act": `beast:${b.n}`, onclick: () => { C.open = open ? null : `beast:${b.n}`; A.render(); } },
        el("span", { class: "beast-ic" }, icon(b.rank === "Boss" ? "crown" : "skull")),
        el("span", { class: "beast-name" }, el("b", { text: b.n }), el("small", { text: [b.cat, b.rank === "Boss" || b.rank === "Elite" ? null : null].filter(Boolean).join(" · ") || "Naytiba" })),
        seen === null ? null : el("span", { class: `beast-seen ${seen ? "yes" : ""}`, tip: seen ? "In your Album" : "Not in your Album yet" }, icon(seen ? "check" : "dot")),
        el("span", { class: "beast-stats" },
          el("span", null, el("small", { text: "HP" }), el("b", { text: range(hp) })),
          el("span", null, el("small", { text: "Attack" }), el("b", { text: range(atk) })))));
    if (!open) return card;
    const desc = b.desc && A.gameText(b.desc);
    const ai = window.SBCodexAI ? window.SBCodexAI(b) : null;
    card.append(el("div", { class: "beast-body" },
      desc ? el("div", { class: "beast-desc" }, ...paragraphs(desc)) : b.desc && !A.hasTexts() ? packNote("Descriptions") : null,
      el("table", { class: "beast-table" },
        el("thead", null, el("tr", null, ...["Variant", "HP", "Shield", "Stamina", "Attack", "Ranged", "Shield dmg", "Tachy"].map((h) => el("th", { text: h })))),
        el("tbody", null, ...b.v.map((v) => el("tr", { class: main.includes(v) ? "main" : "" }, el("td", null, el("code", { text: v[0] })),
          ...["MaxHP", "MaxShield", "MaxStamina", "PhysicAttackPower", "RangeAttackPower", "ShieldAttackPower"].map((s) => el("td", { text: fmt(scaled(v, s, C.diff)) })),
          el("td", { text: fmt(v[7]) }))))),
      b.drops.length ? el("div", null, el("h4", { text: "Drops" }), lootList(b.drops)) : null,
      ai,
      el("div", { class: "map-card-acts" },
        spawns ? el("button", { type: "button", class: "fill", "data-act": "beast:map", onclick: () => window.SBMap.showGroup(`${kind}:${b.n}`, b.n) }, icon("map"), el("span", { text: "Where to find them" })) : null,
        b.ach && !seen ? el("button", { type: "button", class: "toggle", "data-act": "beast:album", tip: "Add to your Album when you download", onclick: () => { A.unlockAch([b.ach]); A.render(); } }, icon("plus"), el("span", { text: "Album entry" })) : null)));
    return card;
  }

  // ================================================================== fishing
  function fishing(page) {
    if (needs(page, CODEX)) return;
    texts();
    const F = window.SB_CODEX.fish.filter((f) => !f.nikke);
    const NK = window.SB_CODEX.fish.filter((f) => f.nikke);
    const cats = [...new Set(F.map((f) => f.cat || "Other"))];
    const caught = (f) => f.ach && A.achUnlocked(f.ach);
    page.append(el("div", { class: "codex-top" },
      el("span", { class: "big-count" }, el("b", { text: fmt(F.filter(caught).length) }), el("small", { text: `/${F.length} caught` })),
      seg([{ key: "all", label: "All" }, ...cats.map((c) => ({ key: c, label: c, n: `${F.filter((f) => (f.cat || "Other") === c).length}` }))], C.fishCat, (k) => { C.fishCat = k; A.render(); }, "Size")));
    const card = (f) => el("article", { class: `fish${caught(f) ? " caught" : ""}` },
      el("div", { class: "fish-head" }, ITEMS[f.a] ? A.art(f.a) : el("span", { class: "fish-ic" }, icon("fish")),
        el("div", null, el("b", { text: f.n }), el("small", { text: [f.cat, f.rarity].filter(Boolean).join(" · ") })),
        el("span", { class: `beast-seen ${caught(f) ? "yes" : ""}`, tip: caught(f) ? "Caught: in your Album" : "Not caught yet" }, icon(caught(f) ? "check" : "dot"))),
      el("div", { class: "fish-stats" },
        el("span", null, el("small", { text: "Strength" }), el("b", { text: fmt(f.stamina) })),
        el("span", null, el("small", { text: "Fight" }), el("b", { text: `${f.time} s` })),
        f.points ? el("span", null, el("small", { text: "Points" }), el("b", { text: fmt(f.points) })) : null),
      A.gameText(f.desc) ? el("p", { class: "fish-desc", text: A.gameText(f.desc) }) : null,
      f.loot.length ? lootList(f.loot) : null);
    page.append(el("div", { class: "fishes" }, ...F.filter((f) => C.fishCat === "all" || (f.cat || "Other") === C.fishCat).map(card)));
    if (!A.hasTexts()) page.append(packNote("Fish descriptions"));
    page.append(A.section("Lures", null));
    page.lastChild.append(el("div", { class: "fishes lures" }, ...window.SB_CODEX.lures.map((l) => el("article", { class: "fish" },
      el("div", { class: "fish-head" }, ITEMS[l.a] ? A.art(l.a) : el("span", { class: "fish-ic" }, icon("fish")), el("div", null, el("b", { text: l.n }))),
      A.gameText(l.desc) ? el("p", { class: "fish-desc", text: A.gameText(l.desc) } ) : null))));
    if (NK.length) {
      page.append(A.section("NIKKE fishing", null));
      page.lastChild.append(el("div", { class: "fishes" }, ...NK.map(card)));
    }
  }

  // ================================================================== manual, tips, credits
  function manual(page) {
    if (needs(page, CODEX)) return;
    texts();
    const D = window.SB_CODEX;
    page.append(el("div", { class: "codex-top" }, seg([["manual", "Manual", D.manual.length], ["tips", "Loading tips", D.tips.length], ["credits", "Credits", null]]
      .map(([k, l, n]) => ({ key: k, label: l, n: n ? `${n}` : null })), C.tab, (k) => { C.tab = k; A.render(); }, "Show")));
    if (C.tab === "credits") { page.append(credits(D.credits)); return; }
    if (!A.hasTexts()) page.append(packNote(C.tab === "tips" ? "The tips" : "The manual's pages"));
    if (C.tab === "tips") {
      page.append(el("ol", { class: "tips" }, ...D.tips.map((k) => el("li", { text: A.gameText(k) || k }))));
      return;
    }
    const types = [...new Set(D.manual.map((m) => m.type))];
    for (const t of types) {
      const sec = A.section(t.replace(/([a-z])([A-Z])/g, "$1 $2"), null);
      sec.append(el("div", { class: "manual" }, ...D.manual.filter((m) => m.type === t).map((m) => {
        const open = C.open === `man:${m.k}`;
        const body = m.desc.map((k) => A.gameText(k)).filter(Boolean).join("\n");
        return el("article", { class: `manual-entry${open ? " open" : ""}` },
          el("button", { type: "button", class: "beast-head", "aria-expanded": String(open), onclick: () => { C.open = open ? null : `man:${m.k}`; A.render(); } },
            el("span", { class: "beast-ic" }, icon("book")), el("span", { class: "beast-name" }, el("b", { text: m.title })),
            m.movies.length ? el("span", { class: "muted", tip: `Video in the game folder: Movies/${m.movies.join(", ")}` }, icon("play")) : null),
          open ? el("div", { class: "beast-body" }, ...(body ? paragraphs(body) : [packNote("The manual's pages")]),
            m.movies.length ? el("small", { class: "muted", text: `Video: ${m.movies.join(", ")} (Bink 2, in the game's Movies folder)` }) : null) : null);
      })));
      page.append(sec);
    }
  }
  function credits(rows) {
    const out = el("div", { class: "credits-roll" });
    for (const [type, ...args] of rows) {
      if (type === "Space") continue;
      if (/^title/.test(type)) out.append(el(type === "title_company" ? "h3" : "h4", { class: `cr-${type}`, text: args.filter(Boolean).join(" ") }));
      else if (type === "Copyright") out.append(el("p", { class: "cr-copy", text: args.filter(Boolean).join(" ") }));
      else out.append(el("p", { class: "cr-line" }, ...args.filter(Boolean).map((a, i) => el(i === 0 && args.length > 1 && /H/.test(type) ? "b" : "span", { text: a }))));
    }
    return out;
  }

  // ================================================================== DLC checklists
  function dlc(page) {
    if (needs(page, CODEX)) return;
    const D = window.SB_CODEX;
    const got = (ach) => A.achUnlocked(ach);
    const owned = (item) => (item && ITEMS[A.canon(item)] && A.current(A.canon(item)) > 0) || got(`Acquire_Item_${item}`);
    const row = (label, done, extra) => el("li", { class: `check${done ? " done" : ""}` }, icon(done ? "check" : "dot"), el("span", { text: label }), extra || null);
    const block = (title, items, mapKind) => {
      const n = items.filter((x) => x[1]).length;
      const sec = A.section(title, el("span", { class: "muted", text: `${n}/${items.length}` }));
      sec.append(el("ul", { class: "checklist" }, ...items.map(([l, d]) => row(l, d))));
      if (mapKind && window.SBMap) sec.append(el("button", { type: "button", class: "toggle", "data-act": `dlc:map:${mapKind}`, onclick: () => window.SBMap.showGroup(`kind:${mapKind}`, title).then((ok) => { if (!ok) toast("Your save doesn't place them yet: they show once you've been to their area."); }) }, icon("map"), el("span", { text: "On the map" })));
      return sec;
    };
    const N = D.nikke;
    page.append(el("h2", { class: "dlc-title", text: "Goddess of Victory: NIKKE" }));
    page.append(block("Lost items", N.lost.filter((x) => x.item && /HiddenReward_Item/.test(x.cat)).map((x) => [x.n || itemName(x.item), owned(x.item)]), "lostitem"));
    page.append(block("Hidden rewards", N.lp.map((a, i) => [`Hidden reward ${i + 1}`, got(a)])));
    const MEET = { Ach_Nikke_Meet_Volt: "Met Volt", Ach_Nikke_Meet_Dororong: "Met Dororong", Ach_Nikke_GoodBye_Complete: "Said goodbye" };
    page.append(block("Meetings", N.meet.map((a) => [MEET[a] || a.replace(/^Ach_Nikke_/, "").replace(/_/g, " "), got(a)])));
    page.append(block("Outfits and hairstyles", N.outfits.map((a) => { const it = a.replace(/^Acquire_Item_/, ""); return [itemName(it), got(a) || owned(it)]; })));
    page.append(A.section("Minigame stages", null));
    page.lastChild.append(el("ul", { class: "checklist" }, ...N.stages.map((s) => el("li", { class: "check" }, icon("flag"), el("span", { text: `${s.n}: ${s.type}${s.waves ? `, ${s.waves} waves` : ""}` })))));
    page.append(el("h2", { class: "dlc-title", text: "NieR:Automata" }));
    page.append(block("Stellar Tears", D.nier.album.map((x) => [`${x.n}${x.region ? ` (${x.region})` : ""}`, got(x.ach)]), "tear"));
    page.append(block("Outfits", D.nier.outfits.map((a) => { const it = a.replace(/^Acquire_Item_/, ""); return [itemName(it), got(a) || owned(it)]; })));
  }

  // ================================================================== people
  function people(page) {
    if (needs(page, WORLD)) return;
    const W = window.SB_WORLD;
    const P = W.people || { names: {}, zones: {} };
    const p = S.prog;
    const byWorld = {};
    for (const n of S.cur.npcs || []) {
      const map = P.zones[n.zone];
      if (!map) continue;
      (byWorld[map] = byWorld[map] || []).push(n);
    }
    const worlds = Object.keys(byWorld).sort((a, b) => (A.regionOfMap(a) || a).localeCompare(A.regionOfMap(b) || b));
    if (!worlds.length) { page.append(el("div", { class: "empty-state" }, icon("person"), el("span", { text: "Your save hasn't stored anyone yet." }))); return; }
    if (!C.peopleWorld || !byWorld[C.peopleWorld]) C.peopleWorld = (S.cur.eve && byWorld[S.cur.eve.map] && S.cur.eve.map) || worlds[0];
    page.append(el("p", { class: "lead muted", text: "Everyone your save keeps per area, where they are and whether they're there. Changes apply when you download (experimental)." }));
    page.append(seg(worlds.map((w) => ({ key: w, label: A.regionOfMap(w) || w, n: `${byWorld[w].filter((n) => P.names[n.alias]).length}` })), C.peopleWorld, (k) => { C.peopleWorld = k; A.render(); }, "World"));
    const list = byWorld[C.peopleWorld];
    const named = list.filter((n) => P.names[n.alias]);
    const state = (n) => (n.life === 5 ? "gone" : n.hidden || !n.active ? "hidden" : n.stay !== "None" && n.stay !== n.zone ? "moved" : "here");
    const LABEL = { here: "Here", gone: "Gone", hidden: "Hidden", moved: "Moved on" };
    const eveHere = S.cur.eve && S.cur.eve.map === C.peopleWorld;
    const shown = C.peopleAll ? named : named.filter((n) => state(n) === "here" || p.people[`${n.zone}|${n.spawnId}`]);
    page.append(el("div", { class: "map-layers" }, el("button", {
      type: "button", class: "toggle" + (C.peopleAll ? " on" : ""), "aria-pressed": String(!!C.peopleAll), "data-act": "people:all",
      tip: "Also everyone the story has removed, hidden or moved on (earlier and later story moments)", onclick: () => { C.peopleAll = !C.peopleAll; A.render(); },
    }, icon(C.peopleAll ? "eye" : "eyeOff"), el("span", { text: `Also gone and hidden (${named.length - named.filter((n) => state(n) === "here").length})` }))));
    const rows = shown.sort((a, b) => P.names[a.alias].localeCompare(P.names[b.alias]) || a.zone.localeCompare(b.zone)).map((n) => {
      const key = `${n.zone}|${n.spawnId}`;
      const pend = p.people[key];
      const st = state(n);
      const set = (change, label) => { if (pend && JSON.stringify(pend.change) === JSON.stringify(change)) delete p.people[key]; else p.people[key] = { change, label: P.names[n.alias] }; A.render(); };
      const btn = (label, ic, change, tip, on) => el("button", { type: "button", class: "icon-btn" + (on ? " on" : ""), tip, "aria-label": `${label}: ${P.names[n.alias]}`, "data-act": `people:${label}`, onclick: () => set(change) }, icon(ic));
      return el("tr", { class: pend ? "pending" : "" },
        el("td", null, el("b", { text: P.names[n.alias] }), el("small", { class: "muted", text: ` ${n.alias}` })),
        el("td", null, el("code", { text: n.zone.replace(/^Zone_/, "") })),
        el("td", null, el("span", { class: `pstate ${st}`, text: LABEL[st] }), pend ? el("span", { class: "pstate pending", text: pend.change.forget ? "→ forget" : pend.change.here ? "→ here" : pend.change.gone ? "→ gone" : "→ Eve" }) : null),
        el("td", { class: "people-acts" },
          st !== "here" ? btn("bring back", "undo", { here: true }, "Bring back: alive, shown, not moved on", pend && pend.change.here) : null,
          st === "here" ? btn("send away", "x", { gone: true }, "Send away (as if the story had removed them)", pend && pend.change.gone) : null,
          eveHere ? btn("move to Eve", "pin", { here: true, loc: [S.cur.eve.loc[0] + 150, S.cur.eve.loc[1], S.cur.eve.loc[2]] }, "Move next to Eve", pend && pend.change.loc) : null,
          btn("forget", "trash", { forget: true }, "Forget: the game places them again by its own rules", pend && pend.change.forget),
          window.SBMap ? el("button", { type: "button", class: "icon-btn", tip: "Show on the map", "data-act": "people:map",
            onclick: () => { A.show("map"); window.SBMap.focusAt(C.peopleWorld, n.loc); } }, icon("map")) : null));
    });
    page.append(el("table", { class: "people" }, el("thead", null, el("tr", null, ...["Who", "Area", "State", ""].map((h) => el("th", { text: h })))), el("tbody", null, ...rows)));
    // enemies the save has killed here
    const dead = list.filter((n) => !n.alias.startsWith("N_") && n.life === 5);
    const zones = [...new Set(dead.map((n) => n.zone))];
    const sec = A.section("Enemies", el("span", { class: "muted", text: `${fmt(dead.length)} killed in your save` }));
    sec.append(el("div", { class: "map-card-acts" }, el("button", {
      type: "button", class: "toggle" + (p.revive[C.peopleWorld] ? " on" : ""), "data-act": "people:revive", disabled: !dead.length && !p.revive[C.peopleWorld],
      tip: "Bring them all back, like resting at a camp (experimental)",
      onclick: () => { if (p.revive[C.peopleWorld]) delete p.revive[C.peopleWorld]; else p.revive[C.peopleWorld] = zones; A.render(); },
    }, icon("reset"), el("span", { text: p.revive[C.peopleWorld] ? "Revived when you download" : "Revive them" }))));
    page.append(sec);
    const others = list.length - named.length - list.filter((n) => !n.alias.startsWith("N_")).length;
    if (others > 0) page.append(el("p", { class: "muted", text: `Plus ${fmt(others)} unnamed people (citizens, drones, guards).` }));
  }

  // ================================================================== pages that read data from the other modules
  function pending(page, what) {
    page.append(el("div", { class: "empty-state" }, icon("clock"), el("span", { text: `${what} is still being built.` })));
  }
  const moves = (page) => (window.SBMoves ? window.SBMoves(page) : pending(page, "The move list"));
  const builds = (page) => (window.SBBuilds ? window.SBBuilds(page) : pending(page, "The build planner"));
  const dialogues = (page) => (window.SBDialogues ? window.SBDialogues(page) : pending(page, "The dialogue browser"));

  Object.assign(window.SBPages, { bestiary, fishguide: fishing, manual, dlc, people, moves, builds, dialogues });
  window.SBCodex = { C, loadScript, loadCodex, needs, texts, packNote, paragraphs, lootList, itemName, matches, search };
})();
