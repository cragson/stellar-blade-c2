/*
 * Stellar Blade: C2 - user interface: state, items, overview, changes
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The progress pages (wardrobe, upgrades, skills, story, ...) are in pages.js, the commands in commands.js.
 */
(function () {
  "use strict";

  const { el, icon, fmt, ring, meter, toast, hideTip } = window.SBUI;
  const G = window.SBGvas;
  const M = window.SBModel;
  const PR = window.SBProgress;
  const GAME = window.SB_GAME;
  const CHAPTERS = window.SB_CHAPTERS;
  // null-prototype copies: names read from a save ("constructor", "__proto__", ...) never hit built-ins
  const ITEMS = Object.assign(Object.create(null), window.SB_ITEMS);
  const CANON = Object.create(null);
  for (const a of Object.keys(ITEMS)) CANON[a.toLowerCase()] = a;
  const canon = (a) => (a ? CANON[String(a).toLowerCase()] || a : a);
  const GOLD = "BetaCrystal";

  const CATS = [
    ["currency", "Currency", "coin"],
    ["trade", "Micro parts", "nut"],
    ["material", "Materials", "layers"],
    ["upgrade", "Upgrade items", "core"],
    ["consumable", "Consumables", "potion"],
    ["ammo", "Ammo", "bullet"],
    ["fishing", "Fishing", "hook"],
    ["outfit", "Nanosuits", "suit"],
    ["cosmetic", "Cosmetics", "sparkle"],
    ["gear", "Gear", "chip"],
    ["exospine", "Exospines", "spine"],
    ["blueprint", "Design patterns", "pattern"],
    ["fish", "Fish", "fish"],
    ["collectible", "Cans", "can"],
    ["story", "Story items", "book"],
  ];
  const CAT = Object.create(null);
  for (const [k, label, ic] of CATS) CAT[k] = { label, icon: ic };
  // categories where you own each item once: they get a ring and "add all missing"
  const COLLECTIONS = ["outfit", "cosmetic", "gear", "exospine", "blueprint", "collectible"];

  const PAGES = [
    ["overview", "Overview", "grid", null],
    ["commands", "Commands", "terminal", null],
    ["map", "Map", "map", null],
    ["saves", "Saves", "file", null],
    ["wardrobe", "Wardrobe", "hanger", "Eve"],
    ["upgrades", "Upgrades", "chevrons", "Eve"],
    ["skills", "Skills", "tree", "Eve"],
    ["chapters", "Story", "flag", "World"],
    ["quests", "Quests", "list", "World"],
    ["camps", "Camps", "tent", "World"],
    ["shops", "Shops & music", "store", "World"],
    ["people", "People", "person", "World"],
    ["album", "Album", "photos", "Records"],
    ["trophies", "Trophies", "cup", "Records"],
    ["dlc", "DLC", "star", "Records"],
    ["bestiary", "Bestiary", "skull", "Codex"],
    ["moves", "Moves", "sword", "Codex"],
    ["builds", "Builds", "sliders", "Codex"],
    ["fishguide", "Fish", "fish", "Codex"],
    ["dialogues", "Dialogues", "bubble", "Codex"],
    ["manual", "Manual", "book", "Codex"],
    ...CATS.map(([k, l, i]) => [k, l, i, "Items"]),
    ["tools", "Tools", "wrench", null],
  ];
  // the 15 item categories fold into one entry; it opens by itself on an item page
  let itemsOpen = false;
  try { itemsOpen = localStorage.getItem("c2.itemsOpen") === "1"; } catch (e) { /* storage blocked */ }
  const PAGE = Object.create(null);
  for (const [k, label, ic, group] of PAGES) PAGE[k] = { label, icon: ic, group };
  const isItemView = (v) => v in CAT || v === "search";

  const GATE_TIP = "Needs that edition or DLC. The game checks your purchases and only shows it if you own it.";
  const EXP_TIP = "Experimental: not tested in the game yet. Keep a backup of your save.";
  const STEP = { currency: 100, trade: 100, material: 100, ammo: 100, fishing: 10 };

  const QUICK = [
    { key: "materials", title: "Every material", icon: "layers",
      items: { ElastomerFiber: 9999, PolymerOrganicFilm: 9999, ECelluloseRayon: 9999, LowDensityWafer: 9999,
               HighDensityWafer: 9999, "2DQuantumWafer": 9999, Money_JunkIron_A: 9999, Money_JunkIron_B: 9999,
               Money_JunkIron_C: 9999 } },
    { key: "upgrades", title: "Upgrade items", icon: "core",
      items: { BodyCore: 10, BetaCore: 10, GearCore: 10, DroneCore: 10, TumblerCore: 10, WeaponCore: 10, SPInitializer: 5 } },
    { key: "consumables", title: "Consumables", icon: "potion",
      items: { HP_Potion: 99, HP_Potion_Small: 99, HealGrenade: 99, ResurrectionItem: 10, ConcussionGrenade: 99,
               FlashGrenade: 99, PulseGrenade: 99, TrapGrenade: 99, Bullet_Normal: 999, Bullet_Scatter: 999,
               Bullet_Explosive: 999, Bullet_Missile: 999, Bullet_Railgun: 999 } },
    { key: "currencies", title: "Shop currencies", icon: "coin",
      items: { ETC_Item_VendingMachineCoin: 999, Money_Nier: 999, Money_Nikke: 999 } },
    { key: "bait", title: "Fishing bait", icon: "hook",
      items: { Item_Worm_Bait: 99, Item_Shrimp_Bait: 99, Item_Fish_Slice_Bait: 99, Item_Special_Bait: 99,
               Item_Lure_Megabait: 99, Item_Lure_Weird: 99 } },
  ];

  const S = {
    file: null,                      // { name, bytes, size }
    totals: Object.create(null),     // alias -> count in the opened save
    sp: null,
    summary: null,
    cur: null,                       // snapshot of the opened save (never changed)
    prog: null,                      // progress changes (see freshProg)
    pending: Object.create(null),    // alias -> new count
    pendingSp: null,
    view: "overview",
    lastView: "overview",
    filter: "all",                   // collection pages: all | owned | missing
  };

  // ------------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || one + "s"}`;
  /** 1,234 / 12.3k / 12.5M: short enough for a tile badge */
  const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(n < 1e8 ? 1 : 0)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(n < 1e5 ? 1 : 0)}k` : fmt(n));

  function parseCount(text) {
    const t = String(text).trim().toLowerCase().replace(/[,_\s]/g, "");
    const m = t.match(/^(\d+(?:\.\d+)?)([kmb]?)$/);
    if (!m) return null;
    return Math.floor(parseFloat(m[1]) * { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]]);
  }

  const section = (title, ...extra) => el("section", { class: "block" },
    el("div", { class: "block-head" }, el("h2", { text: title }), ...extra));
  const flag = (name, tip, cls) => el("span", { class: `flag${cls ? " " + cls : ""}`, tip, tabindex: "0", role: "img" }, icon(name));
  const expFlag = () => flag("flask", EXP_TIP, "flag-exp");
  const gateFlag = (text) => flag("ticket", text ? `${text}. ${GATE_TIP}` : GATE_TIP, "flag-gate");

  /** The action button that fills something up: "+ 48". Same look everywhere. */
  function fillBtn(n, tip, onclick, act) {
    return el("button", { type: "button", class: "fill", tip, "data-act": act, onclick: () => { onclick(); render(); } },
      icon("plus"), el("span", { text: fmt(n) }));
  }
  const undoBtn = (tip, onclick, act) => el("button", {
    type: "button", class: "icon-btn undo", tip, "data-act": act, onclick: () => { onclick(); render(); },
  }, icon("undo"));
  const doneMark = (tip) => el("span", { class: "done-mark", tip, tabindex: "0", role: "img" }, icon("check"));

  // ------------------------------------------------------------------ items
  const current = (a) => S.totals[a] || 0;
  const value = (a) => (a in S.pending ? S.pending[a] : current(a));
  const maxOf = (a) => (ITEMS[a] && ITEMS[a].max) || Infinity;
  /** Story items are shown but never changed. Edition and DLC items are checked by the game against your purchases. */
  const canAdd = (a) => !!ITEMS[a] && ITEMS[a].catalog;

  function setPending(a, n) {
    const it = ITEMS[a];
    if (!it || !it.catalog) return false;
    n = Math.max(0, Math.min(Math.floor(n), maxOf(a)));
    if (n === 0 && isWorn(a)) return false; // Eve is wearing it
    if (n === current(a)) delete S.pending[a];
    else S.pending[a] = n;
    return true;
  }

  /** How much of a category the player has, now and after saving. */
  function collection(cat) {
    const items = Object.keys(ITEMS).filter((a) => ITEMS[a].cat === cat && canAdd(a) && a !== GOLD);
    return {
      total: items.length,
      owned: items.filter((a) => current(a) > 0).length,
      after: items.filter((a) => value(a) > 0).length,
      added: items.filter((a) => current(a) === 0 && value(a) > 0).length,
      missing: items.filter((a) => value(a) === 0),
      gated: items.some((a) => ITEMS[a].gate),
    };
  }

  function addAllMissing(cat) {
    let n = 0;
    for (const a of collection(cat).missing) if (setPending(a, 1)) n++;
    toast(`${CAT[cat].label}: +${fmt(n)}`);
  }

  function undoCategory(cat) {
    for (const a of Object.keys(S.pending)) if (ITEMS[a].cat === cat) delete S.pending[a];
  }

  const changeCount = () => Object.keys(S.pending).length + (S.pendingSp !== null ? 1 : 0) + progressCount();

  // ------------------------------------------------------------------ item icons (an icon pack the user makes from their game)
  const ICONS = { map: null, lower: null };
  const iconUrl = (a) => (ICONS.map ? ICONS.map[a] || ICONS.lower[String(a).toLowerCase()] || null : null);

  /** Item artwork: the game's icon if an icon pack is loaded, else the category's symbol. */
  function art(a, big) {
    const it = ITEMS[a];
    const url = iconUrl(a);
    const box = el("span", { class: "art" + (big ? " art-big" : "") + (url ? " has-img" : "") });
    if (url) box.append(el("img", { src: url, alt: "", loading: "lazy", decoding: "async" }));
    else box.append(icon(it && CAT[it.cat] ? CAT[it.cat].icon : "crate", "art-glyph"));
    return box;
  }

  /**
   * One inventory tile. Single items (you own them once) toggle on click; stackable items open the amount editor.
   * data-state: owned | missing | added | removed | changed | locked
   */
  function itemTile(a, opts = {}) {
    const it = ITEMS[a];
    const was = current(a), now = value(a);
    const single = it.max === 1;
    const worn = isWorn(a);
    let st;
    if (!it.catalog) st = "locked";
    else if (single) st = now ? (was ? "owned" : "added") : was ? "removed" : "missing";
    else st = a in S.pending ? "changed" : now ? "owned" : "missing";
    const badge = el("span", { class: "tile-badge" });
    if (st === "locked") badge.append(icon("lock"));
    else if (single) badge.append(icon({ owned: worn ? "hanger" : "check", added: "check", removed: "minus", missing: "plus" }[st]));
    else if (st === "missing") badge.append(icon("plus"));
    else badge.textContent = short(now);

    const lines = [it.name];
    if (opts.showCat) lines.push(CAT[it.cat].label);
    if (!single && it.catalog) lines.push(now !== was ? `${fmt(was)} → ${fmt(now)}` : `${fmt(now)} of ${fmt(it.max)}`);
    if (worn) lines.push("Eve is wearing this");
    if (!it.catalog) lines.push("Story item: can't be changed");
    if (it.gate) lines.push(it.gate);
    const stateWord = { owned: "owned", missing: "missing", added: "added", removed: "removed", changed: "changed", locked: "can't be changed" }[st];
    // gear rarity is shown as colour, so the label keeps the part of the name that differs
    const rar = it.cat === "gear" && it.name.match(/^(.*?)\s*\((Common|Uncommon|Rare)\)$/);
    const tile = el("button", {
      type: "button", class: `tile${single ? " single" : ""}`, "data-alias": a, "data-state": st, "data-rarity": rar ? rar[2].toLowerCase() : null,
      "aria-label": `${it.name}: ${single || st === "missing" || st === "locked" ? stateWord : fmt(now)}`,
      "aria-pressed": single && it.catalog ? String(now > 0) : null,
      "aria-disabled": st === "locked" || (worn && now > 0 && single) ? "true" : null,
      "data-tip": lines.join("\n"),
      onclick: () => {
        if (!it.catalog) return;
        if (single) {
          if (worn && now) { toast(`${it.name}: Eve is wearing this. Change it in the Wardrobe first.`, true); return; }
          setPending(a, now ? 0 : 1);
          render();
        } else openInspector(a);
      },
    }, art(a), el("span", { class: "tile-name", text: rar ? rar[1] : it.name }), badge,
    it.gate ? el("span", { class: "tile-flag" }, icon("ticket")) : null);
    if (it.cat !== "exospine" || now <= 0) return tile;
    tile.classList.add("has-pips");
    return el("div", { class: "tile-wrap" }, tile, levelPips(a));
  }

  // ------------------------------------------------------------------ item levels (Exospines 1 to 3)
  const ITEM_MAX_LEVEL = 3;
  const itemLevelBase = (a) => (current(a) > 0 ? S.cur.itemLevels[a] || 1 : 1);
  const itemLevelNow = (a) => (a in S.prog.itemLevels ? S.prog.itemLevels[a] : itemLevelBase(a));
  function setItemLevel(a, n) {
    n = Math.max(1, Math.min(ITEM_MAX_LEVEL, n));
    if (n === itemLevelBase(a)) delete S.prog.itemLevels[a]; else S.prog.itemLevels[a] = n;
  }
  function levelPips(a) {
    const n = itemLevelNow(a), was = itemLevelBase(a);
    const row = el("span", { class: "tile-pips", role: "group", "aria-label": `${ITEMS[a].name} level` });
    for (let k = 1; k <= ITEM_MAX_LEVEL; k++) {
      row.append(el("button", {
        type: "button", class: `pip${k <= n ? " on" : ""}${(k <= n) !== (k <= was) ? " new" : ""}`, "aria-pressed": String(k <= n),
        tip: `Level ${k}`, "data-act": `level:${a}:${k}`,
        onclick: (e) => { e.stopPropagation(); setItemLevel(a, k === n && k > 1 ? k - 1 : k); render(); },
      }));
    }
    return row;
  }

  // ================================================================== progress state
  const DIFFICULTY = [[1, "Story Mode", "feather"], [0, "Normal Mode", "sword"], [2, "Hard Mode", "skull"]];
  const DIFF_NAME = Object.fromEntries(DIFFICULTY.map(([v, n]) => [v, n]));
  const DIFF_ICON = Object.fromEntries(DIFFICULTY.map(([v, , i]) => [v, i]));
  const LEVEL_ICON = { 1: "heart", 2: "bolt", 3: "potion", 4: "sword", 5: "chip", 6: "spine" };
  // real camps only (the game data also has developer test camps)
  const CAMPS = Object.entries(GAME.camps).filter(([k, v]) => v.n !== k).sort((x, y) => x[1].id - y[1].id);

  function freshProg() {
    return {
      difficulty: null, levels: {}, learn: new Set(), forget: new Set(), camps: new Set(),
      questsDone: new Set(), questsReset: new Set(), track: undefined, ach: new Map(),
      clearMarkers: false, restock: false, unstuck: false, finished: false, registerItems: false,
      chapter: null, chapterPlace: true, spoilers: false,
      equip: {}, shops: {}, unlocks: new Set(), music: undefined, hints: false, ng: null, itemLevels: {}, warp: null, questSteps: {}, questOpen: null,
      people: {}, revive: {}, // characters: "zone|spawnId" -> { change, label }; enemies to revive: world -> [zones]
      // what's open on the pages
      skillTree: GAME.skillTrees[0], questTab: "main", slot: null, earlier: false, albumOpen: null,
    };
  }
  S.prog = freshProg();

  /** What the opened save looks like now (the editor never changes this; changes are kept in S.prog). */
  function snapshot(save) {
    const P = new PR.Progress(save, GAME);
    const camps = {};
    for (const c of Object.keys(GAME.camps)) camps[c] = P.campState(c);
    const ach = P.achievements();
    const equipped = {};
    for (const [slot, a] of Object.entries(P.equipped())) equipped[slot] = canon(a);
    const hints = P.hintList();
    const ng = P.mapEntry("DataMap_int32", "NewGamePlusPlayCount");
    const itemLevels = {};
    const inv = new M.Inventory(save, ITEMS);
    for (const e of inv.inv) {
      const a = canon(inv.aliasOf(e));
      if (ITEMS[a] && ITEMS[a].cat === "exospine") itemLevels[a] = G.getProp(inv.instance(e), "StatLevel").value;
    }
    return {
      difficulty: P.difficulty, levels: (P.levelArray() || []).slice(), learned: P.learned(), camps,
      quests: P.questStates(), tracked: P.tracked()[0] || null,
      achDone: new Set([...ach].filter(([, v]) => v.done).map(([k]) => k)),
      trophies: P.trophyProgress(), markers: P.newMarkers(), bought: (P.shopHistory() || []).length,
      endings: P.endingsSeen(), hasCampSpot: !!(P.player && P.player.props.some((p) => p.name === "CampInteractActorLocation")),
      campSameWorld: (() => {
        // only offer "Unstuck" when Eve's last camp is in the world she's in (MapName "E04" = Xion, ...)
        const campProp = P.player && P.player.props.find((p) => p.name === "CampEnvSpawnAlias");
        const mapName = P.mapEntry("DataMap_FString", "MapName");
        const obj = campProp && Object.values(GAME.camps).map((c) => c.objs[campProp.value]).find(Boolean);
        return !!(obj && mapName && GAME.zoneMap[obj[1]] === mapName[1]);
      })(),
      chapterNow: (() => { try { return window.SBChapter.currentPoint(save, CHAPTERS); } catch (e) { return null; } })(),
      equipped, hasEquipment: !!P.equipmentMap(),
      shops: Object.fromEntries((GAME.shops || []).map((s) => [s.key, P.shopLevel(s.key)])),
      music: P.music(),
      hints: hints ? (GAME.hints || []).filter((h) => hints.includes(h)).length : null,
      ng: ng ? ng[1] : null, itemLevels, eve: P.evePosition(),
      questStep: Object.fromEntries(Object.keys(GAME.questSteps || {}).map((q) => [q, P.questStep(q)])),
      // every stored world object's state (supply boxes, cans, doors...): the map compares it with how it starts
      envTags: (() => { const o = Object.create(null); for (const [a, e] of P.envIndex()) o[a] = String(G.getProp(e, "EnvStateSlotTag").value); return o; })(),
      npcs: P.npcStorage(),
      envPlaces: P.envPlaces(),
    };
  }

  function progressCount() {
    const p = S.prog;
    const n = (b) => (b ? 1 : 0);
    return n(p.difficulty !== null) + Object.keys(p.levels).length + p.learn.size + p.forget.size + p.camps.size +
      p.questsDone.size + p.questsReset.size + n(p.track !== undefined) + p.ach.size + n(p.clearMarkers) + n(p.restock) +
      n(p.unstuck) + n(p.finished) + n(p.chapter) + n(p.registerItems) + Object.keys(p.equip).length +
      Object.keys(p.shops).length + p.unlocks.size + n(p.music !== undefined) + n(p.hints) + n(p.ng !== null) + Object.keys(p.itemLevels).length + n(p.warp) + Object.keys(p.questSteps).length +
      Object.keys(p.people).length + Object.keys(p.revive).length;
  }

  // ------------------------------------------------------------------ items the game never saw being picked up
  // In the game, picking an item up completes its "picked up" achievements: that's what the camp vending machine
  // (cans), the Album (fish), shops (design patterns, unlocks) and reward skills (fishing books) look at. Items the
  // editor adds get those events when you download. Items added by other tools can be registered the same way.
  const PICKUPS = Object.create(null);
  for (const ev of ["Acquire/Item", "Fishing/Item"]) {
    for (const [a, ps] of (GAME.ev && GAME.ev.rules[ev]) || []) {
      if (ps.length === 1 && ps[0][0] === "ItemAlias") (PICKUPS[ps[0][1].toLowerCase()] = PICKUPS[ps[0][1].toLowerCase()] || []).push(a);
    }
  }
  const pickupMissing = (a) => (PICKUPS[a.toLowerCase()] || []).some((x) => !S.cur.achDone.has(x));
  const unregisteredItems = () => Object.keys(S.totals).filter((a) => current(a) > 0 && ITEMS[a] && pickupMissing(a));
  const CAN_ITEMS = Object.keys(GAME.cans || {});
  const unregisteredCans = () => CAN_ITEMS.filter((a) => current(a) > 0 && pickupMissing(a));

  /** Can milestones (1, 7, 14, ... cans) the vending machine hands out; each gives a reward skill. */
  function canMilestones() {
    const registered = CAN_ITEMS.filter((a) => value(a) > 0 && (!pickupMissing(a) || current(a) === 0 || S.prog.registerItems)).length;
    return (GAME.canMilestones || []).filter((m) => m.n <= registered && !S.cur.achDone.has(m.ach));
  }

  // ------------------------------------------------------------------ upgrades
  const levelInfo = (i) => GAME.levels.find((l) => l.index === Number(i));
  const levelNow = (i) => (i in S.prog.levels ? S.prog.levels[i] : S.cur.levels[i] || 0);
  function setLevel(i, n) {
    const l = levelInfo(i);
    n = Math.max(0, Math.min(l.max, n));
    if (n === (S.cur.levels[i] || 0)) delete S.prog.levels[i];
    else S.prog.levels[i] = n;
  }

  // ------------------------------------------------------------------ skills
  const isLearned = (a) => (S.cur.learned.has(a) && !S.prog.forget.has(a)) || S.prog.learn.has(a);
  // a story unlock queued in this session counts too (the console can complete it)
  const skillLock = (s) => (s.ach && !S.cur.achDone.has(s.ach) && !S.prog.ach.has(s.ach) ? GAME.skillLocks[s.ach] || "Unlocked later in the story" : null);

  /** Learn a skill and whatever it needs first. Returns how many skills were added. */
  function learnSkill(a, seen = new Set()) {
    if (seen.has(a) || isLearned(a)) return 0;
    seen.add(a);
    const s = GAME.skills[a];
    if (!s || skillLock(s)) return 0;
    let n = 0;
    const reqs = s.req.filter((r) => GAME.skills[r]);
    if (s.or) { if (reqs.length && !reqs.some(isLearned)) n += learnSkill(reqs[0], seen); }
    else for (const r of reqs) n += learnSkill(r, seen);
    if (S.prog.forget.has(a)) S.prog.forget.delete(a); else S.prog.learn.add(a);
    return n + 1;
  }
  const dependents = (a) => Object.keys(GAME.skills).filter((b) => isLearned(b) && GAME.skills[b].req.includes(a) &&
    !(GAME.skills[b].or && GAME.skills[b].req.some((r) => r !== a && isLearned(r))));
  function forgetSkill(a) { if (S.prog.learn.has(a)) S.prog.learn.delete(a); else S.prog.forget.add(a); }
  /** Forget every skill bought in a tree and refund its SP (the developers' SBRestoreSkillPoint). Skills C2 added were free. */
  function resetTree(tree) {
    let refund = 0, n = 0;
    for (const [a, s] of Object.entries(GAME.skills)) {
      if (s.tree !== tree || !isLearned(a) || s.auto || !s.sp) continue;
      if (S.cur.learned.has(a)) refund += s.sp;
      forgetSkill(a);
      n++;
    }
    if (refund && S.sp !== null) {
      const v = Math.min(99999, (S.pendingSp !== null ? S.pendingSp : S.sp) + refund);
      S.pendingSp = v === S.sp ? null : v;
    }
    return { n, refund };
  }
  const treeRefund = (tree) => Object.entries(GAME.skills).reduce((sum, [a, s]) =>
    sum + (s.tree === tree && isLearned(a) && !s.auto && s.sp && S.cur.learned.has(a) ? s.sp : 0), 0);

  // ------------------------------------------------------------------ camps, quests, album
  const campNow = (c) => (S.prog.camps.has(c) ? "pending" : S.cur.camps[c]);
  const canCreateCamp = (c) => Object.values(GAME.camps[c].objs).every((o) => o.length >= 4);
  const questNow = (q) => (q in S.prog.questSteps ? "step-pending" : S.prog.questsDone.has(q) ? "done-pending" : S.prog.questsReset.has(q) ? "reset-pending" : S.cur.quests[q] || "none");
  const questStepNow = (q) => (q in S.prog.questSteps ? S.prog.questSteps[q] : S.cur.quests[q] === "active" ? S.cur.questStep[q] : -1);
  /** Start a side quest at a step, or move it there (the developers' SBAcquireQuest + SBQuestCompleteTaskGroup). */
  function setQuestStep(q, i) {
    S.prog.questsDone.delete(q);
    S.prog.questsReset.delete(q);
    if (S.cur.quests[q] === "active" && S.cur.questStep[q] === i) delete S.prog.questSteps[q];
    else S.prog.questSteps[q] = i;
  }
  const trackedNow = () => (S.prog.track !== undefined ? S.prog.track : S.cur.tracked);
  const achUnlocked = (a) => S.cur.achDone.has(a) || S.prog.ach.has(a);
  function unlockAch(list) {
    let n = 0;
    for (const a of list) if (!achUnlocked(a)) { S.prog.ach.set(a, GAME.achGoal[a] || 1); n++; }
    return n;
  }

  // ------------------------------------------------------------------ wardrobe
  const SLOT_ICON = { NanoSuit: "suit", Hair: "hair", EarRing: "earring", FaceAccessory: "glasses", Lily: "wrench", Adam: "person", Drone: "drone", ExoSpine: "spine", Gear: "chip" };
  const SLOTS = (GAME.equip || []).map((s) => ({ ...s, icon: SLOT_ICON[s.cat] || "hanger" }));
  const slotInfo = (slot) => SLOTS.find((s) => s.slot === Number(slot));
  const wornNow = (slot) => (slot in S.prog.equip ? S.prog.equip[slot] : (S.cur && S.cur.equipped[slot]) || null);
  const isWorn = (a) => !!S.cur && SLOTS.some((s) => wornNow(s.slot) === a || S.cur.equipped[s.slot] === a);
  const slotOpen = (s) => !s.needLevel || levelNow(s.needLevel[0]) >= s.needLevel[1];
  const itemSlotCat = (a) => (GAME.ev.itemCat[a] || [])[0];
  /** Owned items that fit a slot (not counting ones worn in another slot of the same kind). */
  const slotItems = (s) => Object.keys(ITEMS).filter((a) => itemSlotCat(a) === s.cat && value(a) > 0 &&
    !SLOTS.some((o) => o.slot !== s.slot && o.cat === s.cat && wornNow(o.slot) === a));
  const nameOf = (a) => (a && ITEMS[a] ? ITEMS[a].name : a || "none");

  // ------------------------------------------------------------------ teleport (the developers' SBWarpCamp / SBWarpPosition)
  const WARP = GAME.warp || { camps: {}, spots: [], regions: {} };
  const regionOfMap = (m) => WARP.regions[m] || null;
  function warpCamp(c) {
    const w = WARP.camps[c];
    if (!w) return false;
    S.prog.warp = { kind: "camp", key: c, label: GAME.camps[c].n, map: w[0], loc: w[1], yaw: w[2], approx: !!w[3] };
    return true;
  }
  function warpSpot(key) {
    const sp = WARP.spots.find((x) => x[3] === key);
    if (!sp) return false;
    S.prog.warp = { kind: "spot", key, label: sp[0], map: sp[1], loc: sp[2], yaw: null };
    return true;
  }
  function warpPosition(map, loc) {
    S.prog.warp = { kind: "pos", label: `${regionOfMap(map) || map} (${loc.map((v) => Math.round(v)).join(", ")})`, map, loc, yaw: null };
  }

  // ------------------------------------------------------------------ shops and camp music
  const shopNow = (k) => (k in S.prog.shops ? S.prog.shops[k] : S.cur.shops[k] || 0);
  const needKey = (t) => (t.need ? t.need.join(":") : null);
  /** open | pending | locked | dlc */
  function trackState(t) {
    if (!t.need) return "open";
    const [kind, v] = t.need;
    if (kind === "dlc" || (kind === "item" && !/^TurntableMusicBundle/.test(v)) || !["item", "event"].includes(kind)) return "dlc";
    if (kind === "item" ? current(canon(v)) > 0 : S.cur.achDone.has(v)) return "open";
    return S.prog.unlocks.has(needKey(t)) ? "pending" : "locked";
  }
  const trackName = (k) => { const t = (GAME.music || []).find((x) => x.key === k); return t ? t.n : k || "none"; };
  const musicNow = () => (S.prog.music !== undefined ? S.prog.music : S.cur.music);

  // ------------------------------------------------------------------ story
  const CHAPTER_LIST = CHAPTERS.chapters;
  /** A chapter's name, or a spoiler-free stand-in for chapters not reached yet. */
  function chapterLabel(c) {
    const now = S.cur && S.cur.chapterNow;
    const reached = now && c.i <= now.record;
    if (reached || S.prog.spoilers) return `${c.qn}: ${c.n}`;
    return `Chapter ${CHAPTER_LIST.indexOf(c) + 1}`;
  }

  function progressChanges() {
    const p = S.prog;
    const achievements = Object.fromEntries(p.ach);
    for (const m of canMilestones()) achievements[m.ach] = m.n; // completing them grants their reward skills
    const unlockTracks = [...p.unlocks].map((k) => (GAME.music.find((t) => needKey(t) === k) || {}).key).filter(Boolean);
    return {
      difficulty: p.difficulty, levels: p.levels, learn: [...p.learn], forget: [...p.forget], camps: [...p.camps],
      questsDone: [...p.questsDone], questsReset: [...p.questsReset], track: p.track === undefined ? null : p.track || "",
      achievements, clearMarkers: p.clearMarkers, restock: p.restock, unstuck: p.unstuck,
      finished: p.finished, registerItems: p.registerItems,
      equip: p.equip, shops: p.shops, unlockTracks, music: p.music === undefined ? null : p.music, hints: p.hints, newGamePlus: p.ng,
      itemLevels: Object.fromEntries(Object.entries(p.itemLevels).filter(([a]) => value(a) > 0)),
      warp: p.warp && { map: p.warp.map, loc: p.warp.loc, yaw: p.warp.yaw, label: p.warp.label }, questSteps: p.questSteps,
      people: Object.entries(p.people).map(([k, v]) => ({ zone: k.split("|")[0], id: Number(k.split("|")[1]), change: v.change, label: v.label })),
      reviveZones: Object.values(p.revive).flat(),
    };
  }

  /** Every change, for the sidebar: { ic, label, diff, undo, view } */
  function changeLines() {
    const p = S.prog;
    const out = [];
    const add = (ic, label, diff, undo, view) => out.push({ ic, label, diff, undo, view });
    if (S.pendingSp !== null) add("tree", "Skill points", ["num", S.sp, S.pendingSp], () => { S.pendingSp = null; }, "skills");
    if (p.difficulty !== null) add(DIFF_ICON[p.difficulty], "Difficulty", ["swap", DIFF_NAME[S.cur.difficulty] || "?", DIFF_NAME[p.difficulty]], () => { p.difficulty = null; }, "upgrades");
    for (const [i, n] of Object.entries(p.levels)) add(LEVEL_ICON[i] || "chevrons", levelInfo(i).name, ["num", S.cur.levels[i] || 0, n], () => { delete p.levels[i]; }, "upgrades");
    for (const [slot, a] of Object.entries(p.equip)) add(slotInfo(slot).icon, slotInfo(slot).n, ["swap", nameOf(S.cur.equipped[slot]), nameOf(a)], () => { delete p.equip[slot]; }, "wardrobe");
    if (p.learn.size || p.forget.size) add("tree", "Skills", ["pm", p.learn.size, p.forget.size], () => { p.learn.clear(); p.forget.clear(); }, "skills");
    if (p.chapter) { const c = CHAPTER_LIST.find((x) => x.k === p.chapter); add("flag", "Story", ["text", chapterLabel(c)], () => { p.chapter = null; }, "chapters"); }
    if (p.questsDone.size || p.questsReset.size) add("list", "Quests", ["qs", p.questsDone.size, p.questsReset.size], () => { p.questsDone.clear(); p.questsReset.clear(); }, "quests");
    for (const [k, v] of Object.entries(p.people)) {
      add("person", v.label, ["text", v.change.forget ? "forgotten" : v.change.here ? "brought back" : v.change.gone ? "sent away" : "moved to Eve"], () => { delete p.people[k]; }, "people");
    }
    for (const w of Object.keys(p.revive)) add("skull", "Enemies", ["text", `revived in ${regionOfMap(w) || w}`], () => { delete p.revive[w]; }, "map");
    const qs = Object.keys(p.questSteps);
    if (qs.length === 1) add("list", GAME.quests[qs[0]].n, ["text", `step ${p.questSteps[qs[0]] + 1}`], () => { delete p.questSteps[qs[0]]; }, "quests");
    else if (qs.length) add("list", "Quest steps", ["pm", qs.length, 0], () => { p.questSteps = {}; }, "quests");
    if (p.track !== undefined) add("target", "Tracked quest", ["text", p.track ? GAME.quests[p.track].n : "none"], () => { p.track = undefined; }, "quests");
    if (p.camps.size) add("tent", "Camps", ["pm", p.camps.size, 0], () => p.camps.clear(), "camps");
    for (const [k, lv] of Object.entries(p.shops)) add("store", (GAME.shops.find((s) => s.key === k) || { n: k }).n, ["num", S.cur.shops[k] || 0, lv], () => { delete p.shops[k]; }, "shops");
    if (p.unlocks.size) add("disc", "Music", ["pm", GAME.music.filter((t) => p.unlocks.has(needKey(t))).length, 0], () => p.unlocks.clear(), "shops");
    if (p.music !== undefined) add("play", "Camp music", ["swap", trackName(S.cur.music), trackName(p.music)], () => { p.music = undefined; }, "shops");
    if (p.ach.size) add("photos", "Unlocks", ["pm", p.ach.size, 0], () => p.ach.clear(), "album");
    if (p.registerItems) add("tag", "Picked up", ["pm", unregisteredItems().length, 0], () => { p.registerItems = false; }, "tools");
    if (p.clearMarkers) add("dotOff", "“New” markers", ["done"], () => { p.clearMarkers = false; }, "tools");
    if (p.restock) add("cart", "Restock shops", ["done"], () => { p.restock = false; }, "tools");
    if (p.hints) add("bubble", "Tutorial pop-ups", ["done"], () => { p.hints = false; }, "tools");
    if (p.unstuck) add("pin", "Eve to her camp", ["done"], () => { p.unstuck = false; }, "tools");
    if (p.finished) add("flag", "All endings seen", ["done"], () => { p.finished = false; }, "tools");
    if (p.ng !== null) add("loop", "New Game+", ["swap", S.cur.ng ? "on" : "off", p.ng ? "on" : "off"], () => { p.ng = null; }, "tools");
    if (p.warp) add("pin", "Teleport", ["text", `${p.warp.label}`], () => { p.warp = null; }, "camps");
    const lv = Object.keys(p.itemLevels);
    if (lv.length === 1) add("spine", `${ITEMS[lv[0]].name} level`, ["num", itemLevelBase(lv[0]), p.itemLevels[lv[0]]], () => { delete p.itemLevels[lv[0]]; }, "exospine");
    else if (lv.length) add("spine", "Exospine levels", ["pm", lv.length, 0], () => { p.itemLevels = {}; }, "exospine");
    // items: bulk changes to a collection are one line per category
    const groups = new Map();
    for (const a of Object.keys(S.pending)) {
      const key = COLLECTIONS.includes(ITEMS[a].cat) ? "@" + ITEMS[a].cat : a;
      groups.set(key, [...(groups.get(key) || []), a]);
    }
    for (const [key, aliases] of groups) {
      if (aliases.length <= 3) {
        for (const a of aliases) {
          const it = ITEMS[a];
          add(CAT[it.cat].icon, it.name, it.max === 1 ? ["pm", S.pending[a] ? 1 : 0, S.pending[a] ? 0 : 1] : ["num", current(a), S.pending[a]],
            () => { delete S.pending[a]; }, it.cat);
        }
        continue;
      }
      const cat = key.slice(1);
      add(CAT[cat].icon, CAT[cat].label, ["pm", aliases.filter((a) => S.pending[a] > 0).length, aliases.filter((a) => S.pending[a] === 0).length],
        () => undoCategory(cat), cat);
    }
    return out;
  }

  // ================================================================== opening a save
  /** source (optional): { handle, folder, path, force } when the file comes from the connected save folder */
  async function openFile(file, source) {
    $("openError").hidden = true;
    if (!file) return;
    if (changeCount() && !(source && source.force) && !confirm("Open another save? Your unsaved changes to the current one will be lost.")) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const save = G.parse(bytes);
      const inv = new M.Inventory(save, ITEMS);
      S.file = { name: file.name, bytes, size: bytes.length, handle: (source && source.handle) || null, folder: source && source.folder, path: (source && source.path) || file.name };
      S.totals = inv.totals();
      S.sp = inv.sp;
      S.summary = M.summary(save, ITEMS);
      S.cur = snapshot(save);
      S.prog = freshProg();
      S.pending = Object.create(null);
      S.pendingSp = null;
      $("app").dataset.state = "loaded";
      $("fileName").textContent = file.name;
      $("fileMeta").textContent = `${S.file.handle ? `${S.file.folder} folder, ` : ""}${(bytes.length / 1048576).toFixed(1)} MB, ${fmt(Object.keys(S.totals).length)} items`;
      $("fileCard").hidden = false;
      $("openBtn").hidden = true;
      $("searchWrap").hidden = false;
      show("overview");
      toast(`Opened ${file.name}`);
    } catch (e) {
      const msg = e instanceof G.GvasError ? e.message : `This file couldn't be read: ${e.message}`;
      $("openError").textContent = msg;
      $("openError").hidden = false;
      if (S.file) toast(msg, true);
    }
  }

  // ================================================================== navigation
  function show(view) {
    if (view !== "search") { S.lastView = view; if ($("search").value) $("search").value = ""; }
    if (view !== S.view && COLLECTIONS.includes(view)) S.filter = "all";
    if (view !== S.view) S.prog.slot = null;
    S.view = view;
    closeInspector();
    closeMenu();
    render();
    window.scrollTo(0, 0);
  }

  /** Keyboard focus survives a re-render: remember the focused control by its data attribute. */
  function focusKey() {
    const a = document.activeElement;
    if (!a || a === document.body || !a.matches || !(a.matches(":focus-visible") || a.tagName === "INPUT")) return null;
    if (a.id === "search") return null;
    for (const k of ["data-act", "data-alias", "data-view", "data-slot", "data-key"]) {
      const v = a.getAttribute(k);
      if (v !== null) return `${a.closest("#nav") ? "#nav " : a.closest("#inspector") ? "#inspector " : "#page "}[${k}="${CSS.escape(v)}"]`;
    }
    return null;
  }

  function render() {
    hideTip();
    const keep = focusKey();
    renderNav();
    renderChanges();
    const loaded = !!S.file;
    $("pageEmpty").hidden = loaded;
    $("page").hidden = !loaded;
    if (!loaded) { setTitle("Open your save", "upload"); closeInspector(); if (window.SBSaves) window.SBSaves.renderStart($("folderStart")); return; }
    const page = $("page");
    page.textContent = "";
    page.dataset.view = S.view;
    if (S.view === "search") setTitle(`“${$("search").value.trim()}”`, "search");
    else setTitle(PAGE[S.view].label, PAGE[S.view].icon);
    if (S.view === "overview") pageOverview(page);
    else if (isItemView(S.view)) pageItems(page);
    else window.SBPages[S.view](page);
    renderInspector();
    if (keep) { const e = document.querySelector(keep); if (e && e !== document.activeElement) e.focus({ preventScroll: true }); }
  }

  function setTitle(text, ic) {
    const t = $("pageTitle");
    t.textContent = "";
    t.append(icon(ic, "title-ic"), el("span", { text }));
  }

  function navCounts() {
    const c = {};
    if (!S.file) return c;
    for (const [a, n] of Object.entries(S.totals)) {
      const it = ITEMS[a];
      if (n > 0 && it && !COLLECTIONS.includes(it.cat)) c[it.cat] = (c[it.cat] || 0) + 1;
    }
    for (const cat of COLLECTIONS) { const k = collection(cat); c[cat] = [k.after, k.total]; }
    const skills = Object.keys(GAME.skills);
    c.skills = [skills.filter(isLearned).length, skills.length];
    c.camps = [CAMPS.filter(([k]) => ["active", "pending"].includes(campNow(k))).length, CAMPS.length];
    const quests = Object.keys(GAME.quests);
    c.quests = [quests.filter((q) => ["done", "done-pending"].includes(questNow(q))).length, quests.length];
    const album = Object.values(GAME.album);
    c.album = [album.filter((a) => achUnlocked(a.ach)).length, album.length];
    c.trophies = [S.cur.trophies.filter((t) => t.done).length, S.cur.trophies.length];
    return c;
  }

  const editedViews = () => new Set(changeLines().map((l) => l.view));

  function renderNav() {
    const nav = $("nav");
    nav.textContent = "";
    const loaded = !!S.file;
    const counts = navCounts();
    const edited = loaded ? editedViews() : new Set();
    let group = null, box = null;
    const openItems = itemsOpen || S.view in CAT;
    for (const [key, label, ic, g] of PAGES) {
      if (g !== group || !box) {
        group = g;
        let head = g ? el("div", { class: "nav-head", text: g }) : null;
        if (g === "Items") {
          const itemEdited = CATS.some(([k]) => edited.has(k));
          head = el("button", {
            type: "button", class: "nav-fold", "aria-expanded": String(openItems), disabled: !loaded, "data-act": "nav:items",
            onclick: () => { itemsOpen = !openItems; try { localStorage.setItem("c2.itemsOpen", itemsOpen ? "1" : "0"); } catch (e) { /* fine */ } renderNav(); },
          }, icon("crate"), el("span", { class: "nav-label", text: "Items" }), itemEdited ? el("span", { class: "edited", tip: "Changed" }) : null,
          el("span", { class: "count", text: String(CATS.length) }), icon(openItems ? "chevronDown" : "chevronRight", "nav-chev"));
        }
        box = el("div", { class: "nav-group" + (g === "Items" ? " nav-items" : "") }, head);
        nav.append(box);
      }
      const n = counts[key];
      let count = null;
      if (Array.isArray(n)) count = el("span", { class: "count" + (n[0] >= n[1] ? " full" : "") }, el("span", { text: `${fmt(n[0])}/${fmt(n[1])}` }));
      else if (n) count = el("span", { class: "count", text: String(n) });
      box.append(el("button", {
        type: "button", "data-view": key, "aria-current": S.view === key ? "page" : null, disabled: !loaded, onclick: () => show(key),
        hidden: g === "Items" && !openItems ? true : null, class: g === "Items" ? "nav-sub" : key === "commands" ? "nav-cmd" : null,
      }, icon(ic), el("span", { class: "nav-label", text: label }), edited.has(key) ? el("span", { class: "edited", tip: "Changed" }) : null, count,
      key === "commands" ? el("kbd", { class: "search-key", "aria-hidden": "true", text: "/" }) : null));
    }
  }

  // ------------------------------------------------------------------ the change list: what the download will change
  function diffNode(d) {
    const box = el("span", { class: "diff" });
    if (d[0] === "num") box.append(el("s", { text: fmt(d[1]) }), icon("chevronRight", "diff-arrow"), el("b", { text: fmt(d[2]) }));
    // names are long: only the new one is shown (the old one is in the tooltip)
    else if (d[0] === "swap") box.append(icon("chevronRight", "diff-arrow"), el("b", { text: d[2] }));
    else if (d[0] === "pm") {
      if (d[1]) box.append(el("b", { class: "plus", text: `+${fmt(d[1])}` }));
      if (d[2]) box.append(el("b", { class: "minus", text: `−${fmt(d[2])}` }));
    } else if (d[0] === "qs") {
      if (d[1]) box.append(el("b", { class: "plus" }, icon("check"), fmt(d[1])));
      if (d[2]) box.append(el("b", { class: "plus" }, icon("reset"), fmt(d[2])));
    } else if (d[0] === "text") box.append(el("b", { text: d[1] }));
    else box.append(el("b", { class: "plus" }, icon("check")));
    return box;
  }

  function renderChanges() {
    const list = $("changeList");
    list.textContent = "";
    const n = changeCount();
    $("changeCount").textContent = String(n);
    $("changeCount").classList.toggle("on", n > 0);
    $("downloadBtn").disabled = n === 0;
    const toFolder = !!(S.file && S.file.handle);
    $("downloadLabel").textContent = toFolder ? "Save to folder" : "Download save";
    $("copyBtn").hidden = !toFolder || n === 0;
    $("discardBtn").disabled = n === 0;
    $("mobileBar").hidden = n === 0;
    $("mobileCount").textContent = String(n);
    $("changes").classList.toggle("has", n > 0);
    if (!n) {
      list.append(el("li", { class: "empty-changes" }, icon("sliders"), el("span", { text: S.file ? "No changes yet" : "Open a save to start" })));
      return;
    }
    for (const line of changeLines()) {
      list.append(el("li", null,
        el("button", {
          type: "button", class: "what", onclick: () => show(line.view),
          tip: line.diff[0] === "swap" ? `${line.label}\n${line.diff[1]} → ${line.diff[2]}` : `Go to ${PAGE[line.view] ? PAGE[line.view].label : line.label}`,
        },
          icon(line.ic), el("span", { class: "what-label", text: line.label }), diffNode(line.diff)),
        el("button", { type: "button", class: "icon-btn", tip: `Undo: ${line.label}`, onclick: () => { line.undo(); render(); } }, icon("x"))));
    }
  }

  // ================================================================== overview
  function pageOverview(page) {
    page.append(hero(), statStrip(), board(), packs());
  }

  function hero() {
    const s = S.summary || {};
    const t = s.playTime || 0;
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
    const time = el("div", { class: "hero-time", tip: "Play time", tabindex: "0" },
      el("b", { text: fmt(h) }), el("small", { text: "h" }), el("b", { text: String(m).padStart(2, "0") }), el("small", { text: "m" }));
    const diffNow = S.prog.difficulty !== null ? S.prog.difficulty : S.cur.difficulty;
    const worn = wornNow(5);
    const chips = el("div", { class: "hero-chips" },
      diffNow !== null && diffNow !== undefined
        ? el("button", { type: "button", class: "hero-chip" + (S.prog.difficulty !== null ? " new" : ""), tip: "Difficulty", onclick: () => show("upgrades") },
          icon(DIFF_ICON[diffNow] || "sword"), el("span", { text: DIFF_NAME[diffNow] || `Difficulty ${diffNow}` })) : null,
      s.playthrough ? el("span", { class: "hero-chip" + (s.playthrough > 1 ? "" : " quiet"), tip: "Playthrough", tabindex: "0" },
        icon("loop"), el("span", { text: s.playthrough > 1 ? `New Game+ ${s.playthrough - 1}` : "First playthrough" })) : null,
      worn && ITEMS[worn] ? el("button", { type: "button", class: "hero-chip" + (5 in S.prog.equip ? " new" : ""), tip: "Wearing", onclick: () => show("wardrobe") },
        art(worn), el("span", { text: ITEMS[worn].name })) : null);
    return el("section", { class: "hero" }, el("div", { class: "hero-top" }, time, chips), journey());
  }

  /** The main story as one line: done in blue, the jump target in gold, Eve's marker where the save is. */
  function journey() {
    const now = S.cur.chapterNow;
    if (!now || now.record < 0) return null;
    const idx = CHAPTER_LIST.findIndex((c) => c.k === now.chapter);
    const target = S.prog.chapter ? CHAPTER_LIST.findIndex((c) => c.k === S.prog.chapter) : -1;
    const total = CHAPTER_LIST.length;
    const runs = [];
    CHAPTER_LIST.forEach((c, i) => {
      const r = runs[runs.length - 1];
      if (r && r.quest === c.quest) r.to = i; else runs.push({ quest: c.quest, from: i, to: i });
    });
    const line = el("div", { class: "journey-line" });
    for (const r of runs) {
      const seg = el("span", { class: "j-seg" });
      seg.style.flexGrow = String(r.to - r.from + 1);
      const len = r.to - r.from + 1;
      const done = Math.max(0, Math.min(len, idx - r.from + 1));
      const gold = target > idx ? Math.max(0, Math.min(len, target - r.from + 1)) - done : 0;
      const a = el("span", { class: "j-own" }), b = el("span", { class: "j-new" });
      a.style.width = `${(done / len) * 100}%`;
      b.style.width = `${(Math.max(0, gold) / len) * 100}%`;
      seg.append(a, b);
      line.append(seg);
    }
    const here = idx >= 0 ? CHAPTER_LIST[idx] : null;
    const marker = (i, cls) => { const e = el("span", { class: `j-marker ${cls}` }, icon("pin")); e.style.left = `${((i + 0.5) / total) * 100}%`; return e; };
    if (idx >= 0) line.append(marker(idx, "here"));
    if (target > idx) line.append(marker(target, "target"));
    return el("button", { type: "button", class: "journey", onclick: () => show("chapters"), tip: "Story progress" },
      el("span", { class: "journey-label" }, icon("flag"),
        el("b", { text: here ? here.qn : "Prologue" }), here ? el("span", { text: here.n }) : null,
        el("span", { class: "journey-pct", text: `${Math.round(((idx + 1) / total) * 100)}%` })),
      line);
  }

  function statStrip() {
    const s = S.summary || {};
    const has = (v) => v !== null && v !== undefined;
    const box = el("div", { class: "stats" });
    const tile = (ic, val, label, view, sub) => box.append(el(view ? "button" : "div", {
      type: view ? "button" : null, class: "stat", onclick: view ? () => show(view) : null,
    }, icon(ic), el("b", { class: "stat-value", text: val }), el("span", { class: "stat-label", text: label }), sub ? el("span", { class: "stat-sub", text: sub }) : null));
    if (has(s.level)) tile("star", fmt(s.level), "Level");
    if (has(s.enemies)) tile("skull", fmt(s.enemies), "Enemies defeated");
    if (has(s.questsDone)) tile("list", fmt(s.questsDone), "Quests done", "quests", has(s.questsActive) ? `${fmt(s.questsActive)} active` : null);
    if (has(s.skills)) tile("tree", fmt(s.skills), "Skills", "skills");
    if (has(s.camps)) tile("tent", fmt(s.camps), "Camps", "camps");
    if (has(s.records)) tile("photos", fmt(s.records), "Records", "album");
    if (s.endings) tile("flag", `${s.endings.seen}/${s.endings.total}`, "Endings", "chapters");
    return box;
  }

  /** A ring card: what you have of something, and a "+" that fills it up. */
  function gauge(o) {
    // o: { key, label, icon, have, added, total, missing, fill, undo, extra, act, flags }
    const done = o.have + o.added >= o.total;
    const center = el("span", { class: "gauge-num" }, el("b", { text: fmt(o.have + o.added) }), el("small", { text: `/${fmt(o.total)}` }));
    const open = el("button", { type: "button", class: "gauge-open", "data-view": o.key, onclick: () => show(o.key), tip: `Open ${o.label}` },
      el("span", { class: "gauge-ring" }, ring(o.have, o.added, o.total), center),
      el("span", { class: "gauge-label" }, icon(o.icon), el("span", { text: o.label })));
    const acts = el("div", { class: "gauge-acts" });
    if (o.added && o.undo) acts.append(undoBtn(`Undo ${o.label}`, o.undo));
    if (o.missing && o.fill) acts.append(fillBtn(o.missing, o.fillTip || `Add all ${fmt(o.missing)} missing`, o.fill, o.act));
    else if (done) acts.append(doneMark(o.added ? "Complete after you download" : "Complete"));
    return el("div", { class: "gauge" + (o.added ? " new" : "") + (done ? " full" : "") }, open, acts,
      o.flags && o.flags.length ? el("div", { class: "gauge-flags" }, ...o.flags) : null, o.extra || null);
  }

  function board() {
    const sec = section("Collection");
    const grid = el("div", { class: "board" });
    for (const cat of COLLECTIONS) {
      const c = collection(cat);
      const flags = [];
      if (c.gated) flags.push(gateFlag("Includes edition, pre-order and collaboration items"));
      let extra = null;
      if (cat === "collectible") {
        const u = unregisteredCans().length;
        if (u) {
          const on = S.prog.registerItems;
          extra = el("button", {
            type: "button", class: "register" + (on ? " on" : ""), "data-act": "register", "aria-pressed": String(on),
            tip: on ? "Registered when you download. Click to undo."
              : `${plural(u, "can")} you own don't show in the camp vending machine: the game only counts cans it saw you pick up. Click to register them.`,
            onclick: () => { S.prog.registerItems = !on; render(); },
          }, icon(on ? "check" : "tag"), el("span", { text: fmt(u) }));
        }
      }
      grid.append(gauge({
        key: cat, label: CAT[cat].label, icon: CAT[cat].icon, have: c.after - c.added, added: c.added, total: c.total,
        missing: c.missing.length, fill: () => addAllMissing(cat), undo: () => undoCategory(cat), act: `fill:${cat}`, flags, extra,
      }));
    }
    // progress collections
    const skills = Object.entries(GAME.skills);
    const learnable = skills.filter(([a, s]) => !isLearned(a) && !skillLock(s));
    grid.append(gauge({
      key: "skills", label: "Skills", icon: "tree", have: skills.filter(([a]) => S.cur.learned.has(a) && !S.prog.forget.has(a)).length,
      added: S.prog.learn.size, total: skills.length, missing: learnable.length, act: "fill:skills",
      fillTip: `Learn all ${learnable.length} skills you can learn now`,
      fill: () => { let n = 0; for (const [a] of learnable) n += learnSkill(a); toast(`Skills: +${n}`); },
      undo: () => { S.prog.learn.clear(); },
    }));
    const visited = CAMPS.filter(([k]) => campNow(k) === "inactive");
    grid.append(gauge({
      key: "camps", label: "Camps", icon: "tent", have: CAMPS.filter(([k]) => campNow(k) === "active").length, added: S.prog.camps.size,
      total: CAMPS.length, missing: visited.length, act: "fill:camps", fillTip: `Activate the ${visited.length} camps you've visited`,
      fill: () => { for (const [k] of visited) S.prog.camps.add(k); }, undo: () => S.prog.camps.clear(),
    }));
    const album = Object.values(GAME.album);
    const missAlbum = album.filter((e) => !achUnlocked(e.ach));
    const albumAdded = album.filter((e) => S.prog.ach.has(e.ach)).length;
    grid.append(gauge({
      key: "album", label: "Album", icon: "photos", have: album.filter((e) => S.cur.achDone.has(e.ach)).length, added: albumAdded,
      total: album.length, missing: missAlbum.length, act: "fill:album", fillTip: `Unlock all ${missAlbum.length} missing Album entries`,
      fill: () => unlockAch(missAlbum.map((e) => e.ach)), undo: () => { for (const e of album) S.prog.ach.delete(e.ach); },
    }));
    sec.append(grid);
    return sec;
  }

  // ------------------------------------------------------------------ supply packs
  function packState(pack) {
    const entries = Object.entries(pack.items).filter(([a]) => ITEMS[a]);
    return {
      entries,
      need: entries.filter(([a, want]) => canAdd(a) && value(a) < Math.min(want, maxOf(a))).length,
      changed: entries.some(([a]) => a in S.pending),
    };
  }

  function applyPack(pack) {
    let n = 0;
    for (const [a, want] of Object.entries(pack.items)) {
      if (!ITEMS[a]) continue;
      const before = value(a);
      setPending(a, Math.max(before, want));
      if (value(a) !== before) n++;
    }
    toast(`${pack.title}: +${n}`);
  }

  function packs() {
    const sec = section("Supply packs");
    const grid = el("div", { class: "packs" });
    for (const pack of QUICK) {
      const st = packState(pack);
      const minis = el("span", { class: "pack-items" }, ...st.entries.slice(0, 7).map(([a]) => art(a)),
        st.entries.length > 7 ? el("span", { class: "pack-more", text: `+${st.entries.length - 7}` }) : null);
      const tip = st.entries.map(([a, n]) => `${ITEMS[a].name} ${fmt(Math.min(n, maxOf(a)))}`).join("\n");
      let action;
      if (st.need) action = el("button", { type: "button", class: "fill", "data-act": `pack:${pack.key}`, tip: `Top up ${plural(st.need, "item")}`, onclick: () => { applyPack(pack); render(); } }, icon("plus"), el("span", { text: fmt(st.need) }));
      else action = doneMark(st.changed ? "Topped up when you download" : "You have enough");
      grid.append(el("div", { class: "pack" + (st.changed ? " new" : "") + (st.need ? "" : " full"), "data-tip": tip, tabindex: "0", "data-key": pack.key },
        el("span", { class: "pack-head" }, icon(pack.icon), el("b", { text: pack.title })), minis,
        el("span", { class: "pack-foot" },
          st.changed ? undoBtn(`Undo ${pack.title}`, () => { for (const a of Object.keys(pack.items)) delete S.pending[a]; }) : el("span"),
          action)));
    }
    sec.append(grid);
    return sec;
  }

  // ================================================================== item pages
  function visibleItems() {
    if (S.view === "search") {
      const words = $("search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return Object.keys(ITEMS).filter((a) => {
        const it = ITEMS[a];
        if (!it.catalog && !current(a)) return false;
        const hay = `${it.name} ${a} ${it.keys}`.toLowerCase();
        return words.every((w) => hay.includes(w) || (w.length > 3 && w.endsWith("s") && hay.includes(w.slice(0, -1))));
      });
    }
    const inCat = Object.keys(ITEMS).filter((a) => ITEMS[a].cat === S.view);
    if (S.view === "story") return inCat.filter((a) => current(a) > 0);
    const shown = inCat.filter((a) => canAdd(a) || current(a) > 0);
    if (COLLECTIONS.includes(S.view)) {
      // "missing" keeps items you just added in the list, so you can see and undo them there
      if (S.filter === "missing") return shown.filter((a) => current(a) === 0);
      if (S.filter === "owned") return shown.filter((a) => value(a) > 0);
    }
    return shown;
  }

  function pageItems(page) {
    const isSearch = S.view === "search";
    const cat = isSearch ? null : S.view;
    if (cat && cat !== "story") {
      const c = collection(cat);
      const isColl = COLLECTIONS.includes(cat);
      const head = el("div", { class: "items-head" });
      if (isColl) {
        head.append(el("span", { class: "items-ring", tip: "Collected", tabindex: "0" },
          ring(c.after - c.added, c.added, c.total), el("span", { class: "gauge-num" }, el("b", { text: fmt(c.after) }), el("small", { text: `/${fmt(c.total)}` }))));
        head.append(window.SBUI.seg([
          { key: "all", icon: "grid", n: c.total, tip: "Everything", act: "filter:all" },
          { key: "owned", icon: "check", n: c.after, tip: "Owned", act: "filter:owned" },
          { key: "missing", icon: "plus", n: c.total - c.owned, tip: "Missing", act: "filter:missing" },
        ], S.filter, (k) => { S.filter = k; render(); }, "Show"));
      }
      const acts = el("div", { class: "items-acts" });
      const changed = Object.keys(S.pending).some((a) => ITEMS[a].cat === cat);
      if (changed) acts.append(undoBtn(`Undo all ${CAT[cat].label}`, () => undoCategory(cat), `undo:${cat}`));
      if (isColl && c.missing.length) acts.append(fillBtn(c.missing.length, `Add all ${fmt(c.missing.length)} missing`, () => addAllMissing(cat), `fill:${cat}`));
      else if (!isColl) {
        const notMax = Object.keys(ITEMS).filter((a) => ITEMS[a].cat === cat && canAdd(a) && value(a) < maxOf(a));
        if (notMax.length) {
          acts.append(el("button", {
            type: "button", class: "fill", "data-act": `max:${cat}`, tip: `Set all ${fmt(notMax.length)} to their maximum`,
            onclick: () => { for (const a of notMax) setPending(a, maxOf(a)); render(); },
          }, icon("chevrons"), el("span", { text: "Max" })));
        }
      }
      if (cat === "exospine") {
        const low = Object.keys(ITEMS).filter((a) => ITEMS[a].cat === "exospine" && value(a) > 0 && itemLevelNow(a) < ITEM_MAX_LEVEL);
        if (low.length) {
          acts.append(el("button", { type: "button", class: "fill", "data-act": "levels:exospine", tip: `Raise ${plural(low.length, "Exospine")} to level ${ITEM_MAX_LEVEL}`,
            onclick: () => { for (const a of low) setItemLevel(a, ITEM_MAX_LEVEL); render(); } }, icon("chevrons"), el("span", { text: fmt(low.length) })));
        }
      }
      if (c.gated) acts.append(gateFlag("Includes edition, pre-order and collaboration items"));
      head.append(acts);
      page.append(head);
    }
    const list = visibleItems().sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));
    if (!list.length) {
      const [ic, text] = isSearch ? ["search", "No item matches"] : S.filter === "missing" ? ["check", "Nothing missing"] : ["crate", "Nothing here yet"];
      page.append(el("div", { class: "empty-state" }, icon(ic), el("span", { text })));
      return;
    }
    page.append(el("div", { class: "tiles" }, ...list.map((a) => itemTile(a, { showCat: isSearch }))));
  }

  // ------------------------------------------------------------------ the amount editor for stackable items
  const INSP = { alias: null };
  function openInspector(a) { INSP.alias = a; renderInspector(); }
  function closeInspector() { INSP.alias = null; const b = $("inspector"); if (b) { b.hidden = true; b.textContent = ""; } }

  function renderInspector() {
    const box = $("inspector");
    const a = INSP.alias;
    if (!a || !S.file || !isItemView(S.view)) { box.hidden = true; INSP.alias = null; return; }
    const it = ITEMS[a];
    const was = current(a), now = value(a), max = maxOf(a);
    const step = STEP[it.cat] || 1;
    const set = (n) => { setPending(a, n); render(); };
    box.textContent = "";
    const input = el("input", {
      class: "insp-input" + (now !== was ? " new" : ""), inputmode: "numeric", autocomplete: "off", "data-act": "insp-input",
      "aria-label": `Amount of ${it.name}`, value: fmt(now),
    });
    input.addEventListener("change", () => {
      const n = parseCount(input.value);
      if (n === null) { input.classList.add("bad"); toast("Type a whole number, like 500 or 5k.", true); return; }
      set(n);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    const presets = [0, 10, 99, 999, 9999, 99999].filter((n) => n < max);
    box.append(
      el("div", { class: "insp-head" }, art(a, true),
        el("div", { class: "insp-title" }, el("b", { text: it.name }), el("small", { text: CAT[it.cat].label }), it.gate ? gateFlag(it.gate) : null),
        el("button", { type: "button", class: "icon-btn", tip: "Close", onclick: closeInspector }, icon("x"))),
      el("div", { class: "insp-count" },
        now !== was ? el("s", { text: fmt(was), tip: "In your save", tabindex: "0" }) : null,
        now !== was ? icon("chevronRight", "diff-arrow") : null,
        el("button", { type: "button", class: "step", tip: `−${fmt(step)}`, "data-act": "insp-less", onclick: () => set(now - step) }, icon("minus")),
        input,
        el("button", { type: "button", class: "step", tip: `+${fmt(step)}`, "data-act": "insp-more", onclick: () => set(now + step) }, icon("plus"))),
      Number.isFinite(max) ? el("div", { class: "insp-meter", tip: `${fmt(now)} of ${fmt(max)}` }, meter(Math.min(now, was), Math.max(0, now - was), max)) : null,
      el("div", { class: "insp-presets", role: "group", "aria-label": "Set to" },
        ...presets.map((n) => el("button", { type: "button", class: "chip-btn" + (now === n ? " on" : ""), "data-act": `insp-set:${n}`, onclick: () => set(n) }, fmt(n))),
        Number.isFinite(max) ? el("button", { type: "button", class: "chip-btn max" + (now === max ? " on" : ""), "data-act": "insp-max", tip: fmt(max), onclick: () => set(max) }, icon("chevrons"), "Max") : null,
        now !== was ? el("button", { type: "button", class: "chip-btn undo-chip", "data-act": "insp-undo", tip: `Back to ${fmt(was)}`, onclick: () => set(was) }, icon("undo")) : null));
    box.hidden = false;
    placeInspector();
  }

  function placeInspector() {
    const box = $("inspector");
    const t = INSP.alias && document.querySelector(`#page .tile[data-alias="${CSS.escape(INSP.alias)}"]`);
    document.querySelectorAll("#page .tile.inspected").forEach((x) => x.classList.remove("inspected"));
    if (t) t.classList.add("inspected");
    if (!t || matchMedia("(max-width: 700px)").matches) { box.classList.add("sheet"); box.style.left = ""; box.style.top = ""; return; }
    box.classList.remove("sheet");
    const r = t.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, document.documentElement.clientWidth - w - 12));
    let top = r.bottom + 10;
    if (top + h > innerHeight - 12 && r.top - h - 10 > 12) top = r.top - h - 10;
    box.style.left = `${Math.round(left + scrollX)}px`;
    box.style.top = `${Math.round(top + scrollY)}px`;
  }

  // ================================================================== download
  /** The edited save: every change applied, re-read and checked. */
  function buildSave() {
    const chapter = S.prog.chapter ? { key: S.prog.chapter, place: S.prog.chapterPlace } : null;
    return M.applyChanges(S.file.bytes, ITEMS,
      { chapter, items: S.pending, sp: S.pendingSp, progress: progressCount() || canMilestones().length ? progressChanges() : null }, GAME, CHAPTERS);
  }
  const WRITE = { fn: null }; // saves.js: writes into the connected save folder

  function download(asCopy) {
    if (!S.file || !changeCount()) return;
    const btn = $("downloadBtn");
    btn.disabled = true;
    btn.classList.add("busy");
    setTimeout(async () => {
      try {
        const { bytes, report } = buildSave();
        if (WRITE.fn && S.file.handle && asCopy !== true) { await WRITE.fn(bytes, report); return; }
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
        const link = el("a", { href: url, download: S.file.name || "StellarBladeSave00.sav" });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        $("installDialog").showModal();
        toast(`Downloaded with ${plural(report.length, "change")}`);
      } catch (e) {
        toast(`The save couldn't be written: ${e.message}`, true);
      } finally {
        btn.classList.remove("busy");
        btn.disabled = !changeCount();
      }
    }, 30);
  }

  // ================================================================== mobile menu
  function openMenu() { $("app").classList.add("menu"); $("scrim").hidden = false; $("menuClose").focus(); }
  function closeMenu() { $("app").classList.remove("menu"); $("scrim").hidden = true; }

  // ================================================================== item icons (an icon pack the user makes)
  // The pack is a JSON file {format: "sb-icons", icons: {alias: "data:image/png;base64,..."}} made by
  // tools/icon-pack/make_icon_pack.py from the player's own game files. It's kept in IndexedDB, in this browser only.
  function iconDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("sb-save-editor", 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        // snapshots: what's listed, and the file itself (kept apart so a list doesn't load every file)
        if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("snapbytes")) db.createObjectStore("snapbytes");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  const iconStore = (mode, fn) => dbStore("kv", mode, fn);
  /** One IndexedDB transaction on a store: fn(store) returns a request; resolves with its result. */
  async function dbStore(store, mode, fn) {
    const db = await iconDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  function setIcons(icons) {
    ICONS.map = icons;
    ICONS.lower = Object.create(null);
    if (icons) for (const [a, u] of Object.entries(icons)) ICONS.lower[a.toLowerCase()] = u;
  }
  async function loadStoredIcons() {
    try {
      const pack = await iconStore("readonly", (s) => s.get("icons"));
      if (pack && pack.icons) { setIcons(Object.assign(Object.create(null), pack.icons)); render(); }
    } catch (e) { /* private window or storage blocked: icons just stay off */ }
  }
  /**
   * The game's texts in a pack (version 3): {lang, tables: {StringTable_X: {key: text}}}, flattened to key -> text.
   * Longer texts (manual pages, enemy descriptions, dialogue lines) come only from the player's own pack.
   */
  function packTexts(texts) {
    if (!texts || typeof texts !== "object" || typeof texts.tables !== "object") return null;
    const map = Object.create(null);
    for (const tab of Object.values(texts.tables)) {
      if (!tab || typeof tab !== "object") continue;
      for (const [k, v] of Object.entries(tab)) if (typeof v === "string") map[k] = v;
    }
    return Object.keys(map).length ? { lang: String(texts.lang || "en").slice(0, 8), map } : null;
  }
  /** The game's text for a string key, from the pack ("" until loaded; loadTexts() loads it once). */
  const TEXTS = { map: null, lang: null, loaded: null };
  function loadTexts() {
    if (!TEXTS.loaded) {
      TEXTS.loaded = iconStore("readonly", (s) => s.get("texts")).then((t) => { if (t && t.map) { TEXTS.map = t.map; TEXTS.lang = t.lang; } }).catch(() => {});
    }
    return TEXTS.loaded;
  }
  /** Game text with its markup (<Orange>…</>, <NewLine></>) turned into plain lines. */
  function gameText(key) {
    const t = TEXTS.map && key ? TEXTS.map[key] : null;
    return t ? t.replace(/<NewLine><\/>/g, "").replace(/<[A-Za-z]+>([^<]*)<\/>/g, "$1").replace(/\r/g, "").trim() : "";
  }
  /** The game's world map images in a pack (version 2): {level: [{name, img, bg, x0, x1, y0, y1, z}]}, checked. */
  function packMaps(maps) {
    if (!maps || typeof maps !== "object") return null;
    const out = {};
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    const png = (u) => typeof u === "string" && u.startsWith("data:image/png;base64,");
    for (const [level, list] of Object.entries(maps)) {
      if (!/^[A-Za-z0-9_]+$/.test(level) || !Array.isArray(list)) continue;
      const ok = list.filter((m) => m && png(m.img) && (m.bg === undefined || m.bg === null || png(m.bg)) && ["x0", "x1", "y0", "y1"].every((k) => num(m[k])) && m.x1 > m.x0 && m.y1 > m.y0)
        .map((m) => ({ name: String(m.name || level).slice(0, 40), img: m.img, bg: png(m.bg) ? m.bg : null, x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1, z: num(m.z) ? m.z : 0 }));
      if (ok.length) out[level] = ok;
    }
    return Object.keys(out).length ? out : null;
  }
  async function importIconPack(file) {
    if (!file) return;
    try {
      const pack = JSON.parse(await file.text());
      if (!pack || pack.format !== "sb-icons" || typeof pack.icons !== "object") throw new Error("not an icon pack");
      const icons = Object.create(null);
      for (const [a, url] of Object.entries(pack.icons)) if (typeof url === "string" && url.startsWith("data:image/png;base64,")) icons[a] = url;
      const maps = packMaps(pack.maps);
      const texts = packTexts(pack.texts);
      if (!Object.keys(icons).length && !maps && !texts) throw new Error("the pack has no icons");
      if (Object.keys(icons).length) setIcons(icons);
      try {
        if (Object.keys(icons).length) await iconStore("readwrite", (s) => s.put({ format: "sb-icons", icons }, "icons"));
        if (maps) await iconStore("readwrite", (s) => s.put(maps, "worldmaps"));
        if (texts) await iconStore("readwrite", (s) => s.put(texts, "texts"));
      } catch (e) { toast("Icons loaded for now, but this browser won't keep them.", true); }
      if (maps) window.dispatchEvent(new Event("sb-worldmaps"));
      if (texts) { TEXTS.map = texts.map; TEXTS.lang = texts.lang; TEXTS.loaded = Promise.resolve(); }
      render();
      const nMaps = maps ? Object.values(maps).reduce((n, l) => n + l.length, 0) : 0;
      toast([Object.keys(icons).length ? `${fmt(Object.keys(icons).length)} item icons` : "", nMaps ? `${nMaps} world maps` : "",
        texts ? `${fmt(Object.keys(texts.map).length)} game texts` : ""].filter(Boolean).join(", ") + " loaded");
    } catch (e) {
      toast(`That file isn't an icon pack from make_icon_pack.py (${e.message}).`, true);
    }
  }
  async function removeIcons() {
    setIcons(null);
    try {
      for (const k of ["icons", "worldmaps", "texts"]) await iconStore("readwrite", (s) => s.delete(k));
    } catch (e) { /* nothing stored */ }
    TEXTS.map = null;
    TEXTS.loaded = null;
    window.dispatchEvent(new Event("sb-worldmaps"));
    render();
    toast("Item icons removed");
  }

  // ================================================================== wiring
  for (const p of document.querySelectorAll("[data-icon]")) p.replaceWith(icon(p.getAttribute("data-icon"), p.className || null));

  if (window.matchMedia && matchMedia("(pointer: coarse)").matches) {
    // Phone and tablet file pickers grey out file types they don't know (like .sav) when filtered,
    // so don't filter there: the editor checks the file itself.
    $("fileInput").removeAttribute("accept");
    $("dropHint").textContent = "Tap to choose it";
  }
  $("openBtn").addEventListener("click", () => $("fileInput").click());
  $("reopenBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => { openFile(e.target.files[0]); e.target.value = ""; });
  const drop = $("drop");
  for (const t of ["dragenter", "dragover"]) window.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.classList.remove("over"); });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer.files.length) openFile(e.dataTransfer.files[0]);
  });
  for (const b of document.querySelectorAll("[data-copy]")) {
    b.addEventListener("click", async () => {
      const text = $(b.getAttribute("data-copy")).textContent;
      try { await navigator.clipboard.writeText(text); toast("Folder copied"); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($(b.getAttribute("data-copy"))); getSelection().removeAllRanges(); getSelection().addRange(r); }
    });
  }


  $("downloadBtn").addEventListener("click", () => download());
  $("mobileDownload").addEventListener("click", () => download());
  $("copyBtn").addEventListener("click", () => download(true));
  $("discardBtn").addEventListener("click", () => {
    if (!confirm("Discard all changes?")) return;
    S.pending = Object.create(null);
    S.pendingSp = null;
    S.prog = freshProg();
    render();
    toast("Changes discarded");
  });

  $("menuOpen").addEventListener("click", openMenu);
  $("menuClose").addEventListener("click", closeMenu);
  $("scrim").addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); closeInspector(); } });
  document.addEventListener("click", (e) => {
    // clicks outside the amount editor close it (clicking another tile opens that one instead)
    if (INSP.alias && !e.target.closest("#inspector") && !e.target.closest(".tile")) closeInspector();
  });
  window.addEventListener("resize", () => { if (INSP.alias) placeInspector(); });

  window.addEventListener("beforeunload", (e) => {
    if (changeCount()) { e.preventDefault(); e.returnValue = ""; }
  });

  const iconInput = el("input", { type: "file", id: "iconInput", accept: ".json,application/json", hidden: true });
  iconInput.addEventListener("change", (e) => { importIconPack(e.target.files[0]); e.target.value = ""; });
  document.body.append(iconInput);

  // ------------------------------------------------------------------ shared with pages.js
  window.SBApp = {
    S, GAME, ITEMS, CHAPTERS, CAT, CATS, COLLECTIONS, PAGE, CAMPS, SLOTS, DIFFICULTY, DIFF_NAME, DIFF_ICON, LEVEL_ICON,
    GATE_TIP, EXP_TIP, ICONS, CHAPTER_LIST,
    render, show, setPending, current, value, maxOf, canAdd, canon, collection, plural, short, parseCount,
    section, flag, expFlag, gateFlag, fillBtn, undoBtn, doneMark, art, itemTile,
    levelInfo, levelNow, setLevel, isLearned, skillLock, learnSkill, dependents, forgetSkill,
    campNow, canCreateCamp, questNow, trackedNow, achUnlocked, unlockAch, unregisteredItems,
    slotInfo, wornNow, slotOpen, slotItems, nameOf, shopNow, needKey, trackState, trackName, musicNow, chapterLabel,
    importIcons: () => iconInput.click(), removeIcons, openInspector, closeInspector, changeLines, changeCount,
    ITEM_MAX_LEVEL, itemLevelNow, itemLevelBase, setItemLevel, resetTree, treeRefund, openFile, buildSave, WRITE, dbStore,
    WARP, regionOfMap, warpCamp, warpSpot, warpPosition, questStepNow, setQuestStep, loadTexts, gameText, hasTexts: () => !!TEXTS.map,
  };
  // hook for automated tests
  window.__sbEditor = { openFile, state: S, setPending, render, collection, icons: ICONS };

  loadStoredIcons();
  document.addEventListener("DOMContentLoaded", render);
})();
