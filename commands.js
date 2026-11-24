/*
 * Stellar Blade: C2 - the developers' console commands, rebuilt as save edits
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Stellar Blade ships ~670 developer console commands (USBCheatManager), but their code is compiled out of
 * the released game. Those that only change what's stored in a save are rebuilt here: typing
 * "SBPlayerSetLevel weapon 40" queues the same change the Upgrades page makes when you click a pip, and
 * the download goes through the editor's usual, tested save pipeline. Commands marked "C2" aren't the
 * developers' own: they name things the pages can do that had no console command.
 */
(function () {
  "use strict";

  const { el, icon, fmt, toast } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS } = A;
  const $ = (id) => document.getElementById(id);

  class CmdError extends Error {}
  const fail = (msg) => { throw new CmdError(msg); };
  const lc = (s) => String(s).toLowerCase();
  const DIFFS = [["Normal", 0, "Normal Mode"], ["Story", 1, "Story Mode"], ["Hard", 2, "Hard Mode"]];

  // ------------------------------------------------------------------ what a command may complete
  // Album and Boss Challenge entries and the story unlocks that gate skills. Everything else drives the story
  // (use a story jump for that), and trophies are never touched.
  const LOCK_ACHS = new Set(Object.values(GAME.skills).map((s) => s.ach).filter(Boolean));
  const BOSS_ACHS = new Set(GAME.boss.flatMap((b) => b.achs));
  const ALBUM_BY_ACH = Object.create(null);
  for (const e of Object.values(GAME.album)) ALBUM_BY_ACH[e.ach] = e;
  const achAllowed = (a) => a in ALBUM_BY_ACH || BOSS_ACHS.has(a) || LOCK_ACHS.has(a) || a === "OpenMode_TPS";
  const achName = (a) => (ALBUM_BY_ACH[a] ? `Album: ${ALBUM_BY_ACH[a].n}` : BOSS_ACHS.has(a) ? `Boss Challenge: ${GAME.boss.find((b) => b.achs.includes(a)).n}`
    : GAME.skillLocks[a] ? GAME.skillLocks[a].replace(/ first$/, "").replace(/^(Unlock|Get) /, "") : a);
  const questLabel = (q, v) => (v.t === "main" && A.questNow(q) === "none" && !S.prog.spoilers ? "Main quest you haven't reached" : v.n);

  // ------------------------------------------------------------------ argument types
  // list(): suggestions [[value, label]]; parse(text): the value the command gets (CmdError when it's wrong)
  function pick(list, t, what) {
    const hit = list.find(([v]) => lc(v) === lc(t));
    if (!hit) fail(`No ${what} called “${t}”.`);
    return hit[0];
  }
  const T = {
    item: {
      what: "item", list: () => Object.keys(ITEMS).filter((a) => ITEMS[a].catalog).map((a) => [a, ITEMS[a].name]),
      parse(t) {
        const a = A.canon(t);
        if (!ITEMS[a]) fail(`No item called “${t}”.`);
        if (!ITEMS[a].catalog) fail(`${ITEMS[a].name} is a story item: changing it could break quests.`);
        return a;
      },
    },
    /** items that fit the slot named in the previous argument, and that you own */
    wearable: {
      what: "item",
      list(prev) {
        const slot = A.SLOTS.find((x) => lc(x.key) === lc(prev[0] || ""));
        return Object.keys(ITEMS).filter((a) => (!slot || (GAME.ev.itemCat[a] || [])[0] === slot.cat) && A.value(a) > 0 && (GAME.ev.itemCat[a] || [])[0])
          .map((a) => [a, ITEMS[a].name]);
      },
      parse(t) { return T.item.parse(t); },
    },
    count: { what: "number", hint: "a number, like 500 or 5k", parse(t) { const n = A.parseCount(t); if (n === null) fail(`“${t}” isn't a number.`); return n; } },
    bool: { what: "true or false", list: () => [["true", "yes"], ["false", "no"]],
      parse(t) { if (/^(1|true|yes|on)$/i.test(t)) return true; if (/^(0|false|no|off)$/i.test(t)) return false; return fail(`“${t}” isn't true or false.`); } },
    level: { what: "upgrade", list: () => GAME.levels.map((l) => [lc(l.key), l.name]),
      parse(t) { const k = pick(this.list(), t, "upgrade"); return GAME.levels.find((l) => lc(l.key) === k); } },
    difficulty: { what: "difficulty", list: () => DIFFS.map(([k, , n]) => [k, n]),
      parse(t) { const k = pick(this.list(), t, "difficulty"); return DIFFS.find(([x]) => x === k)[1]; } },
    skill: { what: "skill", list: () => Object.entries(GAME.skills).map(([a, s]) => [a, `${s.n} (${s.tree})`]) },
    camp: { what: "camp", list: () => A.CAMPS.map(([k, v]) => [k, `${v.n} (${v.region})`]) },
    quest: { what: "quest", list: () => Object.entries(GAME.quests).map(([q, v]) => [q, questLabel(q, v)]) },
    questOrNone: { what: "quest", list: () => [["none", "stop tracking"], ...T.quest.list()] },
    chapter: { what: "chapter", list: () => A.CHAPTER_LIST.map((c) => [c.k, A.chapterLabel(c)]) },
    ach: {
      what: "achievement",
      list: () => [...[...LOCK_ACHS, "OpenMode_TPS"].map((a) => [a, achName(a)]), ...GAME.boss.map((b) => [b.achs[0], `Boss Challenge: ${b.n}`]),
        ...Object.values(GAME.album).map((e) => [e.ach, `Album: ${e.n}`])],
      parse(t) {
        if (/^trophy_/i.test(t)) fail("C2 never changes trophies.");
        if (!this.map) { this.map = Object.create(null); for (const [v] of this.list()) this.map[lc(v)] = v; }
        const a = this.map[lc(t)];
        if (!a) fail(`C2 only completes Album, Boss Challenge and skill-unlock achievements: “${t}” isn't one. Story progress moves with SBGameProgressEpicQuest.`);
        return a;
      },
    },
    exospine: { what: "Exospine", list: () => Object.keys(ITEMS).filter((a) => ITEMS[a].cat === "exospine").map((a) => [a, ITEMS[a].name]) },
    tree: { what: "skill tree", list: () => GAME.skillTrees.map((t) => [t.split(" ")[0], t]),
      parse(t) { const k = pick(this.list(), t, "skill tree"); return GAME.skillTrees.find((x) => x.split(" ")[0] === k); } },
    number: { what: "number", hint: "a coordinate", parse(t) { const n = Number(t); if (!Number.isFinite(n)) fail(`“${t}” isn't a number.`); return n; } },
    map: { what: "world", list: () => Object.entries(A.WARP.regions).map(([m, r]) => [m, r]) },
    warpCamp: { what: "camp", list: () => A.CAMPS.filter(([k]) => A.WARP.camps[k]).map(([k, v]) => [k, `${v.n} (${v.region})`]) },
    spot: { what: "place", list: () => A.WARP.spots.map(([n, m, , k]) => [k, `${n} (${A.regionOfMap(m) || m})`]) },
    sidequest: { what: "side quest or bounty request", list: () => Object.keys(GAME.questSteps || {}).map((q) => [q, GAME.quests[q] ? GAME.quests[q].n : q]) },
    taskgroup: { what: "quest step", list: () => Object.entries(GAME.questSteps || {}).flatMap(([q, steps]) => steps.map(([g, d], i) => [g, `${GAME.quests[q] ? GAME.quests[q].n : q}, step ${i + 1}: ${d}`])) },
    preset: {
      what: "story point with a preset",
      list: () => (window.SB_INTEL ? A.CHAPTER_LIST.filter((c) => window.SB_INTEL.presets[c.k]).map((c) => [c.k, A.chapterLabel(c)]) : []),
      parse(t) {
        if (!window.SB_INTEL) { loadIntel(); fail("The developers' presets are still loading: run it again in a moment."); }
        const k = Object.keys(window.SB_INTEL.presets).find((x) => lc(x) === lc(t));
        if (!k) fail(`No preset for “${t}”.`);
        return window.SB_INTEL.presets[k];
      },
    },
    slot: { what: "equipment slot", list: () => A.SLOTS.map((s) => [s.key, s.n]),
      parse(t) { const k = pick(this.list(), t, "equipment slot (C2 knows NanoSuit, Hair1, Accessory1, Accessory2, Lily, Adam, Drone, Protector1-2, GearCommon1-4)"); return A.SLOTS.find((s) => s.key === k); } },
    shop: { what: "shop", list: () => GAME.shops.map((s) => [s.key, s.n]), parse(t) { const k = pick(this.list(), t, "shop"); return GAME.shops.find((s) => s.key === k); } },
    track: { what: "track", list: () => [["all", "every track"], ...GAME.music.map((t) => [t.key, t.n])] },
    hint: { what: "hint", list: () => [["all", "every tutorial pop-up"]] },
    recipe: {
      what: "command set",
      list: () => (window.SB_INTEL ? window.SB_INTEL.sets.map((x) => [x[0], x[1] || ""]) : GAME.recipes.list.map(([g, n]) => [g, n])),
      parse(t) { const g = setLines(t) ? setKey(t) : null; if (!g) fail(`No command set called “${t}”.`); return g; },
    },
    command: { what: "command", list: () => CMDS.map((c) => [c.name, c.help]) },
  };
  const parseArg = (type, t) => (T[type].parse ? T[type].parse.call(T[type], t) : pick(T[type].list(), t, T[type].what));

  // ------------------------------------------------------------------ the commands
  const CMDS = [];
  /** args: type names from T, "?" = optional. opts: c2 (not a developer command), exp (experimental), alias, names */
  function def(name, args, help, run, opts = {}) {
    CMDS.push({ name, args: args.map((a) => ({ type: a.replace("?", ""), opt: a.endsWith("?") })), names: opts.names || [], help, run,
      dev: !opts.c2, exp: !!opts.exp, alias: opts.alias || [] });
  }
  const byName = (n) => CMDS.find((c) => lc(c.name) === lc(n) || c.alias.some((x) => lc(x) === lc(n)));
  const usage = (c) => [c.name, ...c.args.map((a, i) => { const n = c.names[i] || a.type; return a.opt ? `[${n}]` : `<${n}>`; })].join(" ");
  const needSave = () => { if (!S.file) fail("Open a save first."); };

  function itemSet(a, n) {
    const it = ITEMS[a], before = A.value(a);
    if (!A.setPending(a, n)) fail(`${it.name}: Eve is wearing it. Change it in the Wardrobe first.`);
    return `${it.name} ${fmt(before)} → ${fmt(A.value(a))}`;
  }

  // items
  def("SBPlayerItemBucketItemAdd", ["item", "count?"], "Add an item (1 if no amount is given)", (a, n = 1) => itemSet(a, A.value(a) + n));
  def("SBPlayerItemBucketItemRemove", ["item", "count?"], "Remove an item (all of it if no amount is given)",
    (a, n) => itemSet(a, n === undefined ? 0 : A.value(a) - n));
  def("SBSetItemCount", ["item", "count"], "Set an item to an exact amount", (a, n) => itemSet(a, n), { c2: true });
  // Eve
  def("SBPlayerSP", ["count"], "Set unspent skill points", (n) => {
    if (S.sp === null) fail("This save has no skill points.");
    n = Math.min(99999, n);
    const now = S.pendingSp !== null ? S.pendingSp : S.sp;
    if (DEPTH > 0 && n <= now) return `Skill points: already ${fmt(now)}`;
    S.pendingSp = n === S.sp ? null : n;
    return `Skill points ${fmt(S.sp)} → ${fmt(n)}`;
  }, { names: ["points"] });
  def("SBPlayerSetLevel", ["level", "count", "bool?"], "Set an upgrade: body, beta, rechargeablepotion, weapon, gearslot, protectorslot", (l, n) => {
    const was = A.levelNow(l.index);
    // the developers' sets only raise: their "max" values can be older than the game's
    if (DEPTH > 0 && n <= was) return `${l.name}: already at ${was}`;
    A.setLevel(l.index, n);
    return `${l.name} ${was} → ${A.levelNow(l.index)}`;
  }, { names: ["upgrade", "level", "consumeitem"] });
  def("SBSetDifficulty", ["difficulty"], "Switch between Normal, Story and Hard Mode", (d) => {
    S.prog.difficulty = d === S.cur.difficulty ? null : d;
    return `Difficulty: ${A.DIFF_NAME[d]}`;
  });
  def("SBAcquireSkill", ["skill", "bool?", "bool?"], "Learn a skill, and whatever it needs first", (a) => {
    const s = GAME.skills[a];
    if (A.isLearned(a)) return `${s.n}: already learned`;
    const lock = A.skillLock(s);
    if (lock) fail(`${s.n}: ${lock}.`);
    const n = A.learnSkill(a);
    return `${s.n} learned${n > 1 ? ` (and ${n - 1} it needs)` : ""}`;
  }, { names: ["skill", "progressachievement", "freesp"] });
  def("SBAcquireSkillAll", ["bool?", "bool?", "bool?"], "Learn every skill you can (options: progress achievements, New Game+ skills, drone skills)", (_p, ng = true, drone = true) => {
    let n = 0;
    for (const [a, s] of Object.entries(GAME.skills)) {
      if ((!ng && s.ng) || (!drone && s.tree === "Drone") || A.isLearned(a) || A.skillLock(s)) continue;
      n += A.learnSkill(a);
    }
    return `${fmt(n)} skills learned`;
  }, { names: ["progressachievement", "newgameplus", "drone"] });
  def("SBRemoveSkill", ["skill"], "Forget a skill", (a) => {
    const s = GAME.skills[a];
    if (!A.isLearned(a)) return `${s.n}: not learned`;
    const d = A.dependents(a);
    if (d.length) fail(`${s.n} is needed by ${GAME.skills[d[0]].n}.`);
    A.forgetSkill(a);
    return `${s.n} forgotten`;
  });
  def("SBRestoreSkillPoint", ["bool", "tree"], "Reset a skill tree: forget the skills you bought and get their SP back", (_c, tree) => {
    const r = A.resetTree(tree);
    return r.n ? `${tree}: ${fmt(r.n)} skills forgotten, ${fmt(r.refund)} SP back` : `${tree}: nothing to reset`;
  }, { names: ["consumeitem", "tree"] });
  def("SBSetBodySuitLevel", ["exospine", "count", "bool?"], "Set an Exospine's level (1 to 3)", (a, n) => {
    if (A.value(a) <= 0) fail(`${ITEMS[a].name} isn't in your inventory: add it first.`);
    const was = A.itemLevelNow(a);
    A.setItemLevel(a, n);
    return `${ITEMS[a].name}: level ${was} → ${A.itemLevelNow(a)}`;
  }, { names: ["exospine", "level", "consumeitem"] });
  def("SBRemoveSkillAll", [], "Forget every skill", () => {
    let n = 0;
    for (const [a, s] of Object.entries(GAME.skills)) if (A.isLearned(a) && !s.auto) { A.forgetSkill(a); n++; }
    return `${fmt(n)} skills forgotten`;
  });
  def("SBPlayerEquipItem", ["slot", "bool", "wearable"], "Wear an item: SBPlayerEquipItem NanoSuit true BS_Nier_01", (s, on, a) => {
    if (!on) fail("Taking things off isn't supported: wear something else instead.");
    if (!A.slotOpen(s)) fail(`${s.n} is locked: upgrade the slot first.`);
    if ((GAME.ev.itemCat[a] || [])[0] !== s.cat) fail(`${ITEMS[a].name} doesn't fit ${s.n}.`);
    if (A.value(a) <= 0) fail(`${ITEMS[a].name} isn't in your inventory: add it first.`);
    if (A.wornNow(s.slot) !== a && !A.slotItems(s).includes(a)) fail(`${ITEMS[a].name} is already worn in another slot.`);
    if (S.cur.equipped[s.slot] === a) delete S.prog.equip[s.slot]; else S.prog.equip[s.slot] = a;
    return `${s.n}: ${ITEMS[a].name}`;
  }, { names: ["slot", "equip", "item"] });
  // world
  def("SBActiveCamp", ["camp"], "Activate a camp", (c) => {
    const v = GAME.camps[c], st = A.campNow(c);
    if (st === "active" || st === "pending") return `${v.n}: already active`;
    if (st === "unvisited" && !A.canCreateCamp(c)) fail(`${v.n} has no position in the level files.`);
    S.prog.camps.add(c);
    return `${v.n} activated${st === "unvisited" ? " (experimental: you haven't been there yet)" : ""}`;
  });
  def("SBCompleteQuest", ["quest", "bool?"], "Finish a side quest or bounty request, with its reward", (q) => {
    const v = GAME.quests[q], st = A.questNow(q);
    if (v.t === "main") fail("Main story quests move with SBGameProgressEpicQuest.");
    if (st === "done" || st === "done-pending") return `${v.n}: already done`;
    if (st === "failed") fail(`${v.n} failed: reset it first with SBQuestReset.`);
    S.prog.questsReset.delete(q);
    delete S.prog.questSteps[q];
    S.prog.questsDone.add(q);
    return `${v.n} done`;
  }, { alias: ["SBQuestComplete"], names: ["quest", "reward"] });
  def("SBAcquireQuest", ["sidequest"], "Start a side quest or bounty request, also one you missed (experimental)", (q) => {
    const st = A.questNow(q);
    if (st === "active" || st === "step-pending") return `${GAME.quests[q].n}: already active`;
    A.setQuestStep(q, 0);
    return `${GAME.quests[q].n} started`;
  }, { exp: true, alias: ["SBQuestAcquire"], names: ["quest"] });
  def("SBQuestCompleteTaskGroup", ["taskgroup"], "Finish a quest step: the quest moves to the next one (experimental)", (g) => {
    const [q, steps] = Object.entries(GAME.questSteps).find(([, l]) => l.some(([x]) => x === g));
    const i = steps.findIndex(([x]) => x === g);
    if (i === steps.length - 1) { delete S.prog.questSteps[q]; S.prog.questsDone.add(q); return `${GAME.quests[q].n} done`; }
    A.setQuestStep(q, i + 1);
    return `${GAME.quests[q].n}: step ${i + 2}`;
  }, { exp: true, names: ["step"] });
  def("SBQuestSetStep", ["sidequest", "count"], "Put a side quest at a step (1 = the first) (experimental)", (q, n) => {
    const steps = GAME.questSteps[q];
    if (n < 1 || n > steps.length) fail(`${GAME.quests[q].n} has steps 1 to ${steps.length}.`);
    A.setQuestStep(q, n - 1);
    return `${GAME.quests[q].n}: step ${n}`;
  }, { c2: true, exp: true, names: ["quest", "step"] });
  def("SBQuestReset", ["quest"], "Make a finished side quest or bounty request available again", (q) => {
    const v = GAME.quests[q], st = A.questNow(q);
    if (v.t === "main") fail("Main story quests can't be reset.");
    if (st === "done-pending") { S.prog.questsDone.delete(q); return `${v.n}: back as it was`; }
    if (st !== "done" && st !== "failed") return `${v.n}: not finished`;
    S.prog.questsReset.add(q);
    return `${v.n} reset`;
  }, { c2: true });
  def("SBQuestTrack", ["questOrNone"], "Track an active quest, or none", (q) => {
    if (q !== "none" && A.questNow(q) !== "active") fail(`${GAME.quests[q].n} isn't active.`);
    const t = q === "none" ? null : q;
    S.prog.track = t === S.cur.tracked ? undefined : t;
    return q === "none" ? "No quest tracked" : `Tracking ${GAME.quests[q].n}`;
  }, { c2: true, names: ["quest"] });
  def("SBGameProgressEpicQuest", ["chapter", "difficulty?", "count?", "count?"], "Move the main story forward to a chapter (experimental)", (k) => {
    const now = S.cur.chapterNow;
    if (!now || now.record < 0) fail("This save has no story progress records.");
    const c = A.CHAPTER_LIST.find((x) => x.k === k);
    if (c.i <= now.record) fail(`${A.chapterLabel(c)}: your save is already there or past it. Story jumps only go forward.`);
    S.prog.chapter = k;
    return `Story: jump to ${A.chapterLabel(c)}`;
  }, { exp: true, alias: ["SBCheatProgressQuest"], names: ["chapter", "difficulty", "preset", "round"] });
  def("SBChapterPlaceEve", ["bool"], "Whether a story jump also moves Eve to the chapter's start", (on) => {
    S.prog.chapterPlace = on;
    return on ? "Story jumps move Eve to the chapter's start" : "Story jumps leave Eve where she is";
  }, { c2: true, names: ["move"] });
  def("SBShopFriendshipLevel", ["shop", "count"], "Raise a shop's relationship level", (sh, n) => {
    const was = S.cur.shops[sh.key] || 0, max = sh.levels.length + 1;
    if (!was) fail(`${sh.n}: meet them in the game first.`);
    n = Math.max(1, Math.min(max, n));
    if (n < was) fail(`${sh.n} is at level ${was}: shop levels only go up.`);
    if (n === was) delete S.prog.shops[sh.key]; else S.prog.shops[sh.key] = n;
    return `${sh.n}: level ${n}`;
  }, { c2: true, names: ["shop", "level"] });
  def("SBTurntableUnlock", ["track"], "Unlock a camp music track, or all of them", (k) => {
    const list = k === "all" ? GAME.music : [GAME.music.find((t) => t.key === k)];
    let n = 0;
    for (const t of list) {
      const st = A.trackState(t);
      if (st === "dlc") { if (k !== "all") fail(`${t.n} comes with a DLC: the game unlocks it if you own it.`); continue; }
      if (st === "locked") { S.prog.unlocks.add(A.needKey(t)); n++; }
    }
    return k === "all" ? `${fmt(n)} tracks unlocked` : `${list[0].n} ${n ? "unlocked" : "is already unlocked"}`;
  }, { c2: true });
  def("SBTurntablePlay", ["track"], "Pick the track that plays at your camps", (k) => {
    const t = GAME.music.find((x) => x.key === k);
    if (!t) fail("Pick one track.");
    const st = A.trackState(t);
    if (st === "dlc") fail(`${t.n} comes with a DLC.`);
    if (st === "locked") S.prog.unlocks.add(A.needKey(t));
    S.prog.music = k === S.cur.music ? undefined : k;
    return `Camp music: ${t.n}`;
  }, { c2: true });
  // records
  def("SBWarpCamp", ["warpCamp"], "Teleport Eve to a camp, in any region (experimental)", (c) => {
    A.warpCamp(c);
    return `Eve will be at ${GAME.camps[c].n}${A.WARP.camps[c][3] ? " (in front of it)" : ""}`;
  }, { exp: true, names: ["camp"] });
  def("SBWarpSpot", ["spot"], "Teleport Eve to one of the developers' named places (experimental)", (k) => {
    A.warpSpot(k);
    return `Eve will be at ${S.prog.warp.label}`;
  }, { c2: true, exp: true, names: ["place"] });
  def("SBWarpPosition", ["number", "number", "number", "bool?", "map?"], "Teleport Eve to coordinates, in her world or the one given (experimental)", (x, y, z, _n, map) => {
    const m = map || SET_MAP || (S.cur.eve && S.cur.eve.map);
    if (!m) fail("This save doesn't say which world Eve is in: add the world, like E04.");
    A.warpPosition(m, [x, y, z]);
    return `Eve will be at ${S.prog.warp.label}`;
  }, { exp: true, names: ["x", "y", "z", "nowarp", "world"] });
  def("SBCharacterSetting", ["preset", "count", "count?"], "Gear Eve up like the developers did for a story point: 1 minimum, 2 standard, 3 maximum (only raises)", (base, slot, round) => {
    if (slot < 1 || slot > 3) fail("The preset is 1 (minimum), 2 (standard) or 3 (maximum).");
    const r = runPreset(base, slot, round === 2 || (round === undefined && S.cur.ng > 0));
    return `${["Minimum", "Standard", "Maximum"][slot - 1]} preset: ${fmt(r.ok)} changes${r.skipped.length ? `, ${fmt(r.skipped.length)} skipped` : ""}`;
  }, { names: ["storypoint", "preset", "round"] });
  def("SBPlayerCompleteAchievement", ["ach"], "Complete an Album, Boss Challenge or skill-unlock achievement", (a) => {
    if (A.achUnlocked(a)) return `${achName(a)}: already complete`;
    A.unlockAch([a]);
    return `${achName(a)} complete`;
  }, { alias: ["SBPlayerCompleteAchievementOnlyOne"], names: ["achievement"] });
  def("SBBossChallengeUnlockAll", [], "Unlock every Boss Challenge stage",
    () => `${fmt(A.unlockAch([...BOSS_ACHS]))} Boss Challenge unlocks`, { alias: ["SBBossChallengeUnlockAllStage"] });
  def("SBAlbumUnlockAll", [], "Unlock every Album entry", () => `${fmt(A.unlockAch(Object.keys(ALBUM_BY_ACH)))} Album entries unlocked`, { c2: true });
  // tools
  def("SBCompleteHint", ["hint"], "Mark every tutorial pop-up as seen: SBCompleteHint all", () => {
    if (S.cur.hints === null) fail("This save has no tutorial list.");
    S.prog.hints = true;
    return "Every tutorial pop-up marked as seen";
  });
  def("SBSetNewGamePlus", ["bool?"], "Turn New Game+ mode on, or off with false (experimental)", (on = true) => {
    if (S.cur.ng === null) fail("This save has no New Game+ counter.");
    S.prog.ng = on === S.cur.ng > 0 ? null : on ? 1 : 0;
    return `New Game+ ${on ? "on" : "off"}`;
  }, { exp: true, names: ["on"] });
  const toolCmd = (name, help, key, msg, opts) => def(name, [], help, () => { S.prog[key] = true; return msg; }, { c2: true, ...opts });
  toolCmd("SBClearRedDots", "Clear every red “new” marker in the menus", "clearMarkers", "“New” markers cleared");
  toolCmd("SBShopRestock", "Restock the shops' limited items", "restock", "Shops restocked");
  toolCmd("SBRegisterPickedUpItems", "Count items added by other tools as picked up", "registerItems", "Items registered as picked up");
  toolCmd("SBEndingAllSeen", "Record all three endings as seen (experimental)", "finished", "All endings marked as seen", { exp: true });
  def("SBWarpToLastCamp", [], "Move Eve in front of the camp where she last rested (experimental)", () => {
    if (!S.cur.hasCampSpot || !S.cur.campSameWorld) fail("Eve's last camp isn't in the world she's in.");
    S.prog.unstuck = true;
    return "Eve will be at her last camp";
  }, { c2: true, exp: true });
  // sets and help
  def("SBCheatGroup", ["recipe"], "Run one of the developers' command sets", (g) => runRecipe(g).msg, { names: ["set"] });
  def("SBHelp", ["command?"], "List the commands, or show how to use one", (c) => {
    if (!c) return `${CMDS.length} commands. Type SB and pick one, or open the Commands page.`;
    const x = byName(c);
    return `${usage(x)}: ${x.help}`;
  }, { c2: true });

  // ------------------------------------------------------------------ running
  function tokens(text) { return String(text).trim().split(/\s+/).filter(Boolean); }

  /** Parse and run one line. Returns { ok, msg }. Lines starting with # are comments. */
  let DEPTH = 0;
  function runLine(text, depth = 0) {
    const t = tokens(text);
    if (!t.length || t[0].startsWith("#")) return { ok: true, msg: "", skip: true };
    try {
      needSave();
      const c = byName(t[0]);
      if (!c) fail(`Unknown command “${t[0]}”. ${CMDS.some((x) => lc(x.name).startsWith(lc(t[0]).slice(0, 6))) ? "Did you mean one of the suggestions?" : "Type SB to see them all."}`);
      if (depth > 6) fail("Command sets nest too deep.");
      const vals = c.args.map((a, i) => {
        const raw = t[i + 1];
        if (raw === undefined) { if (a.opt) return undefined; fail(`Usage: ${usage(c)}`); }
        return parseArg(a.type, raw);
      });
      const prev = DEPTH;
      DEPTH = depth;
      try { return { ok: true, msg: c.run(...vals) || "Done" }; } finally { DEPTH = prev; }
    } catch (e) {
      if (e instanceof CmdError) return { ok: false, msg: e.message };
      throw e;
    }
  }

  // a set's lines: the curated ones ship with C2, the rest come with the catalog (intel.js)
  let SETS = null;
  function intelSets() {
    if (!SETS && window.SB_INTEL) { SETS = Object.create(null); for (const x of window.SB_INTEL.sets) SETS[lc(x[0])] = x; }
    return SETS;
  }
  function setKey(t) {
    const k = Object.keys(GAME.recipes.groups).find((x) => lc(x) === lc(t));
    if (k) return k;
    const x = intelSets() && intelSets()[lc(t)];
    return x ? x[0] : null;
  }
  function setLines(t) {
    const k = Object.keys(GAME.recipes.groups).find((x) => lc(x) === lc(t));
    if (k) return GAME.recipes.groups[k];
    const x = intelSets() && intelSets()[lc(t)];
    return x ? x[4] : null;
  }
  function setName(g) {
    const r = GAME.recipes.list.find(([x]) => x === g);
    if (r) return r[1];
    const x = intelSets() && intelSets()[lc(g)];
    return (x && x[1]) || g;
  }

  /** The developers' loadout for a story point: their set for that strength, what Eve wears with it, and the progress table's extra. */
  function presetLines(base, slot, ng) {
    const suf = ["_Min", "", "_Max"][slot - 1];
    const has = (g) => !!setLines(g);
    const main = ng && has(base + suf + "_NewGamePlus") ? base + suf + "_NewGamePlus" : base + suf;
    const equip = base + (suf ? suf + "_Equip" : "_Equip");
    const extra = ((window.SB_INTEL.gpSlots || {})[base] || [])[(ng ? 3 : 0) + slot - 1] || "";
    return [...(setLines(main) || []), ...(setLines(equip) || []), ...extra.split(/[;|]/).map((x) => x.trim()).filter(Boolean)];
  }
  function runPreset(base, slot, ng) {
    let ok = 0;
    const skipped = [];
    for (const line of presetLines(base, slot, ng)) {
      const r = runLine(line, DEPTH + 1);
      if (r.skip) continue;
      if (r.ok) ok++; else skipped.push(r.msg);
    }
    return { ok, skipped };
  }

  let SET_MAP = null; // a developer set's world: their SBWarpPosition lines are coordinates in it
  function runRecipe(g) {
    const name = setName(g);
    const spot = A.WARP.spots.find((x) => lc(x[3]) === lc(g));
    const iset = intelSets() && intelSets()[lc(g)];
    const tabRegion = iset && window.SB_INTEL.tabs[iset[3]];
    const prevMap = SET_MAP;
    SET_MAP = spot ? spot[1] : Object.keys(A.WARP.regions).find((m) => A.WARP.regions[m] === tabRegion) || SET_MAP;
    try { return runRecipeLines(g, name); } finally { SET_MAP = prevMap; }
  }
  function runRecipeLines(g, name) {
    let ok = 0;
    const skipped = [];
    for (const line of setLines(g) || []) {
      const r = runLine(line, DEPTH + 1);
      if (r.skip) continue;
      if (r.ok) ok++; else skipped.push(`${line.split(" ")[0]}: ${r.msg}`);
    }
    return { ok, skipped, msg: `${name}: ${fmt(ok)} done${skipped.length ? `, ${fmt(skipped.length)} skipped` : ""}` };
  }

  /** What a command set would do now, without doing it: how many of its lines would run. */
  const CHECKED = new Map();
  function recipeCheck(g) {
    if (CHECKED.has(g)) return CHECKED.get(g);
    let ok = 0, bad = 0;
    for (const line of setLines(g) || []) {
      const t = tokens(line);
      const c = t.length && byName(t[0]);
      if (!c) { bad++; continue; }
      try { c.args.forEach((a, i) => { if (t[i + 1] !== undefined) parseArg(a.type, t[i + 1]); }); ok++; } catch (e) { bad++; }
    }
    const r = { ok, bad };
    CHECKED.set(g, r);
    return r;
  }

  const LOG = [];
  /** Run something typed by the player: one line, or a script of several. */
  function run(text, source) {
    const lines = String(text).split(/\r?\n/);
    const results = [];
    for (const line of lines) {
      const r = runLine(line);
      if (r.skip) continue;
      results.push(r);
      LOG.unshift({ cmd: line.trim(), ok: r.ok, msg: r.msg });
    }
    LOG.length = Math.min(LOG.length, 200);
    A.render();
    if (results.length === 1) toast(results[0].msg, !results[0].ok);
    else if (results.length) {
      const bad = results.filter((r) => !r.ok).length;
      toast(`${fmt(results.length - bad)} commands run${bad ? `, ${fmt(bad)} failed (see the Commands page)` : ""}`, bad > 0);
    }
    void source;
    return results;
  }

  /** Every pending change, written as commands: the same file runs again on another save. */
  function planToCommands() {
    const p = S.prog, out = [];
    const items = Object.keys(S.pending).sort();
    for (const a of items) out.push(`SBSetItemCount ${a} ${S.pending[a]}`);
    if (p.chapter) { out.push(`SBGameProgressEpicQuest ${p.chapter}`); if (!p.chapterPlace) out.push("SBChapterPlaceEve false"); }
    if (p.difficulty !== null) out.push(`SBSetDifficulty ${DIFFS.find(([, v]) => v === p.difficulty)[0]}`);
    for (const [i, n] of Object.entries(p.levels)) out.push(`SBPlayerSetLevel ${lc(A.levelInfo(i).key)} ${n}`);
    if (S.pendingSp !== null) out.push(`SBPlayerSP ${S.pendingSp}`);
    for (const a of p.forget) out.push(`SBRemoveSkill ${a}`);
    for (const a of p.learn) out.push(`SBAcquireSkill ${a}`);
    for (const [slot, a] of Object.entries(p.equip)) out.push(`SBPlayerEquipItem ${A.slotInfo(slot).key} true ${a}`);
    for (const [a, n] of Object.entries(p.itemLevels)) out.push(`SBSetBodySuitLevel ${a} ${n}`);
    if (p.warp) {
      if (p.warp.kind === "camp") out.push(`SBWarpCamp ${p.warp.key}`);
      else if (p.warp.kind === "spot") out.push(`SBWarpSpot ${p.warp.key}`);
      else out.push(`SBWarpPosition ${p.warp.loc.join(" ")} false ${p.warp.map}`);
    }
    for (const c of p.camps) out.push(`SBActiveCamp ${c}`);
    for (const q of p.questsDone) out.push(`SBCompleteQuest ${q}`);
    for (const q of p.questsReset) out.push(`SBQuestReset ${q}`);
    for (const [q, i] of Object.entries(p.questSteps)) out.push(`SBQuestSetStep ${q} ${i + 1}`);
    if (p.track !== undefined) out.push(`SBQuestTrack ${p.track || "none"}`);
    for (const a of p.ach.keys()) out.push(`SBPlayerCompleteAchievement ${a}`);
    for (const [k, n] of Object.entries(p.shops)) out.push(`SBShopFriendshipLevel ${k} ${n}`);
    for (const k of p.unlocks) { const t = GAME.music.find((x) => A.needKey(x) === k); if (t) out.push(`SBTurntableUnlock ${t.key}`); }
    if (p.music !== undefined) out.push(`SBTurntablePlay ${p.music}`);
    if (p.hints) out.push("SBCompleteHint all");
    if (p.ng !== null) out.push(`SBSetNewGamePlus ${p.ng ? "true" : "false"}`);
    if (p.clearMarkers) out.push("SBClearRedDots");
    if (p.restock) out.push("SBShopRestock");
    if (p.registerItems) out.push("SBRegisterPickedUpItems");
    if (p.unstuck) out.push("SBWarpToLastCamp");
    if (p.finished) out.push("SBEndingAllSeen");
    return out;
  }

  // ------------------------------------------------------------------ the command bar (search + console in one field)
  const isCommand = (text) => /^\s*sb/i.test(text);

  function suggestionsFor(text, mode) {
    const out = [];
    if (mode === "console" || isCommand(text)) {
      const t = tokens(text);
      const typingName = t.length <= 1 && !/\s$/.test(text);
      if (typingName) {
        const q = lc(t[0] || "");
        for (const c of CMDS) if (lc(c.name).includes(q) || c.alias.some((x) => lc(x).includes(q))) out.push({ kind: "cmd", value: c.name, label: c.help, c });
        out.sort((x, y) => (lc(x.value).startsWith(q) ? 0 : 1) - (lc(y.value).startsWith(q) ? 0 : 1));
        return out.slice(0, 9);
      }
      const c = byName(t[0]);
      if (!c) return [];
      const index = /\s$/.test(text) ? t.length - 1 : t.length - 2;
      const arg = c.args[index];
      if (!arg) return [{ kind: "hint", value: usage(c), label: "Press Enter to run" }];
      const partial = /\s$/.test(text) ? "" : lc(t[t.length - 1]);
      const type = T[arg.type];
      if (!type.list) return [{ kind: "hint", value: `<${c.names[index] || arg.type}>`, label: type.hint || type.what }];
      // best matches first: the value starts with what you typed, then contains it, then its name does
      const words = partial.split(/[_\s]+/).filter((w) => w.length > 1);
      const scored = [];
      for (const [v, label] of type.list(t.slice(1, index + 1))) {
        const lv = lc(v), ll = lc(label);
        const score = !partial ? 2 : lv.startsWith(partial) ? 0 : lv.includes(partial) ? 1 : ll.includes(partial) ? 2
          : words.length > 1 && words.every((w) => lv.includes(w) || ll.includes(w)) ? 3 : -1;
        if (score >= 0) scored.push([score, { kind: "arg", value: v, label }]);
      }
      return scored.sort((x, y) => x[0] - y[0]).slice(0, 9).map(([, sug]) => sug);
    }
    const q = lc(text.trim());
    if (!q) return out;
    for (const [k, p] of Object.entries(A.PAGE)) if (lc(p.label).includes(q)) out.push({ kind: "page", value: k, label: p.label, icon: p.icon });
    for (const c of CMDS) if (lc(c.help).includes(q) && out.filter((x) => x.kind === "cmd").length < 3) out.push({ kind: "cmd", value: c.name, label: c.help, c });
    const words = q.split(/\s+/);
    for (const a of Object.keys(ITEMS)) {
      const it = ITEMS[a];
      if (!it.catalog && !A.current(a)) continue;
      const hay = lc(`${it.name} ${a} ${it.keys}`);
      if (words.every((w) => hay.includes(w))) out.push({ kind: "item", value: a, label: it.name });
      if (out.length >= 10) break;
    }
    return out;
  }

  /** Attach suggestions and command running to a text field. mode: "omni" (search or command) | "console" */
  function attach(input, list, mode) {
    let items = [], sel = -1, hist = -1;
    const history = [];
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); sel = -1; };
    function draw() {
      items = S.file ? suggestionsFor(input.value, mode) : [];
      list.textContent = "";
      if (!items.length || document.activeElement !== input) { close(); return; }
      items.forEach((s, i) => {
        const li = el("li", { role: "option", id: `${list.id}-${i}`, "aria-selected": String(i === sel), class: `omni-${s.kind}` },
          s.kind === "item" ? A.art(s.value) : icon(s.kind === "cmd" ? "terminal" : s.kind === "page" ? s.icon : s.kind === "hint" ? "info" : "chevronRight"),
          el("span", { class: "omni-main" }, el(s.kind === "cmd" || s.kind === "arg" || s.kind === "hint" ? "code" : "b", { text: s.value }),
            el("span", { class: "omni-sub", text: s.label })),
          s.kind === "cmd" ? el("span", { class: `omni-tag${s.c.dev ? "" : " c2"}`, text: s.c.dev ? "dev" : "C2" }) : null);
        li.addEventListener("mousedown", (e) => { e.preventDefault(); accept(i); });
        list.append(li);
      });
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-activedescendant", sel >= 0 ? `${list.id}-${sel}` : "");
    }
    function accept(i) {
      const s = items[i];
      if (!s || s.kind === "hint") return;
      if (s.kind === "page") { input.value = ""; close(); A.show(s.value); return; }
      if (s.kind === "item") {
        input.value = "";
        close();
        A.show(ITEMS[s.value].cat);
        const tile = document.querySelector(`#page .tile[data-alias="${CSS.escape(s.value)}"]`);
        if (tile) { tile.scrollIntoView({ block: "center" }); if (ITEMS[s.value].max !== 1) A.openInspector(s.value); else tile.focus(); }
        return;
      }
      const t = tokens(input.value);
      if (s.kind === "cmd") input.value = `${s.value} `;
      else input.value = `${(/\s$/.test(input.value) ? t : t.slice(0, -1)).join(" ")} ${s.value} `;
      sel = -1;
      input.focus();
      draw();
    }
    input.addEventListener("input", () => {
      sel = -1;
      hist = -1;
      if (mode === "omni") {
        if (!isCommand(input.value) && input.value.trim()) { A.closeInspector(); if (S.view !== "search") S.view = "search"; A.render(); }
        else if (!input.value.trim() && S.view === "search") A.show(S.lastView);
      }
      draw();
    });
    input.addEventListener("focus", draw);
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); sel = (sel + 1) % items.length; draw(); return; }
      if (e.key === "ArrowUp") {
        if (sel > 0) { e.preventDefault(); sel--; draw(); return; }
        if ((mode === "console" || isCommand(input.value) || !input.value) && history.length) {
          e.preventDefault();
          hist = Math.min(history.length - 1, hist + 1);
          input.value = history[hist];
          draw();
        }
        return;
      }
      if (e.key === "Tab" && items.length && items.some((s) => s.kind !== "hint")) { e.preventDefault(); accept(sel >= 0 ? sel : items.findIndex((s) => s.kind !== "hint")); return; }
      if (e.key === "Escape") {
        if (!list.hidden) { close(); return; }
        input.value = "";
        if (mode === "omni" && S.view === "search") A.show(S.lastView);
        return;
      }
      if (e.key === "Enter") {
        if (sel >= 0) { e.preventDefault(); accept(sel); return; }
        if (mode === "console" || isCommand(input.value)) {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          history.unshift(text);
          const [r] = run(text);
          if (r && r.ok) input.value = "";
          close();
          input.focus();
        }
      }
    });
  }

  // ------------------------------------------------------------------ the Commands page
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ------------------------------------------------------------------ the Commands page: console, catalog, developer sets
  const UI = { tab: "console", q: "", status: "all", sort: "uses", setQ: "", setCat: "", setRun: true };
  let intelLoading = null;
  function loadIntel() {
    if (window.SB_INTEL) return Promise.resolve(window.SB_INTEL);
    if (!intelLoading) {
      intelLoading = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = "intel.js?v=a2a0372085";
        tag.onload = () => resolve(window.SB_INTEL);
        tag.onerror = () => { intelLoading = null; reject(new Error("The catalog (intel.js) couldn't be loaded.")); };
        document.head.append(tag);
      });
    }
    return intelLoading;
  }

  function pageCommands(page) {
    const I = window.SB_INTEL;
    page.append(window.SBUI.seg([
      { key: "console", icon: "terminal", label: "Console", act: "tab:console" },
      { key: "catalog", icon: "book", label: "All commands", n: I ? I.commands.length : null, act: "tab:catalog" },
      { key: "sets", icon: "layers", label: "Developer sets", n: I ? I.sets.length : null, act: "tab:sets" },
    ], UI.tab, (k) => { UI.tab = k; A.render(); }, "Commands"));
    if (UI.tab === "console") { tabConsole(page); return; }
    if (!I) {
      page.append(el("div", { class: "empty-state" }, icon("book"), el("span", { text: "Loading the catalog…" })));
      loadIntel().then(() => A.render()).catch((e) => toast(e.message, true));
      return;
    }
    if (UI.tab === "catalog") tabCatalog(page, I); else tabSets(page, I);
  }

  // what each command is to C2
  const PLANNED = new Set(["sbwarpcamp", "sbwarpcamptopointname", "sbwarpcamptolocation", "sbwarpposition", "sbteleportto", "sbacquirequest",
    "sbquestacquire", "sbquestcompletetaskgroup", "sbquestcompletetask", "sbcharactersetting", "sbsetbodysuitlevel", "sbrestoreskillpoint"]);
  const STATUS = {
    rebuilt: { label: "Rebuilt", icon: "check", tip: "Rebuilt in C2: it changes your save like the developers' command did" },
    planned: { label: "Coming", icon: "clock", tip: "Being rebuilt for C2 next" },
    save: { label: "Possible", icon: "file", tip: "Changes what's stored in a save, so it could be rebuilt later" },
    runtime: { label: "Needs the game", icon: "play", tip: "Works on the running game (spawning, effects, physics), so a save file can't do it" },
    tool: { label: "Developer tool", icon: "wrench", tip: "Developer tooling: graphics, profiling, logs, interface tests" },
    online: { label: "Online", icon: "cloud", tip: "Online and platform features" },
    refused: { label: "Refused", icon: "lock", tip: "Purchases, entitlements and trophies: C2 won't do these" },
  };
  const statusOf = (name, kind) => (byName(name) ? "rebuilt" : PLANNED.has(lc(name)) ? "planned" : kind);

  function tabCatalog(page, I) {
    const all = I.commands.map(([name, params, kind, topic, uses, ex]) => ({ name, params, topic, uses, ex, st: statusOf(name, kind) }));
    const counts = {};
    for (const c of all) counts[c.st] = (counts[c.st] || 0) + 1;
    const wrap = el("div", { class: "catalog" });
    const q = el("input", { type: "search", class: "filter-input", placeholder: "Filter: name, parameter or topic", "data-act": "catalog:q", value: UI.q, autocomplete: "off", spellcheck: "false" });
    const list = el("div", { class: "cmd-list" });
    const controls = el("div", { class: "catalog-controls" });
    const drawControls = () => {
      controls.textContent = "";
      controls.append(el("label", { class: "filter" }, icon("search"), q),
        window.SBUI.seg([{ key: "all", label: "All", n: all.length }, ...Object.keys(STATUS).filter((k) => counts[k]).map((k) => ({ key: k, icon: STATUS[k].icon, label: STATUS[k].label, n: counts[k], tip: STATUS[k].tip }))],
          UI.status, (k) => { UI.status = k; drawControls(); draw(); }, "Status"),
        window.SBUI.seg([{ key: "uses", label: "Most used" }, { key: "az", label: "A–Z" }], UI.sort, (k) => { UI.sort = k; drawControls(); draw(); }, "Sort"));
    };
    function draw() {
      const words = lc(UI.q).split(/\s+/).filter(Boolean);
      const hits = all.filter((c) => (UI.status === "all" || c.st === UI.status) &&
        words.every((w) => lc(`${c.name} ${c.params.join(" ")} ${c.topic} ${STATUS[c.st].label}`).includes(w)));
      hits.sort((x, y) => (UI.sort === "uses" ? y.uses - x.uses : 0) || x.name.localeCompare(y.name));
      list.textContent = "";
      if (!hits.length) { list.append(el("div", { class: "empty-state small" }, icon("search"), el("span", { text: "No command matches" }))); return; }
      const max = Math.max(1, ...all.map((c) => c.uses));
      for (const c of hits.slice(0, 400)) {
        const st = STATUS[c.st];
        const bar = el("span", { class: "uses-bar" });
        bar.style.width = `${Math.max(c.uses ? 6 : 0, (c.uses / max) * 100)}%`;
        const body = el("div", { class: "cmd-detail" }, el("p", { class: "muted", text: st.tip }));
        if (c.ex.length) {
          body.append(el("ul", { class: "cmd-examples" }, ...c.ex.map(([line, set]) => el("li", null, el("code", { text: line }), set ? el("span", { class: "muted", text: set }) : null))));
        } else body.append(el("p", { class: "muted", text: "The developers' command sets never use it." }));
        if (c.st === "rebuilt") {
          body.append(el("button", { type: "button", class: "fill", "data-act": `try:${c.name}`, onclick: () => { UI.tab = "console"; A.render(); const f = $("console"); if (f) { f.value = `${byName(c.name).name} `; f.focus(); f.dispatchEvent(new Event("input")); } } },
            icon("terminal"), el("span", { text: "Try it" })));
        }
        list.append(el("details", { class: `cmd-entry st-${c.st}` },
          el("summary", null,
            el("span", { class: "st-dot", tip: st.tip, "aria-label": st.label }, icon(st.icon)),
            el("span", { class: "cmd-sig" }, el("code", { class: "cmd-name", text: c.name }), el("span", { class: "cmd-params", text: c.params.length ? c.params.join(", ") : "no parameters" })),
            el("span", { class: "cmd-topic", text: c.topic }),
            el("span", { class: "cmd-uses", tip: `Used ${fmt(c.uses)} times in the developers' command sets` }, bar, el("span", { text: fmt(c.uses) }))),
          body));
      }
      if (hits.length > 400) list.append(el("p", { class: "muted", text: `${fmt(hits.length - 400)} more: filter to narrow the list` }));
    }
    q.addEventListener("input", () => { UI.q = q.value; draw(); });
    drawControls();
    draw();
    wrap.append(controls, list);
    page.append(wrap);
  }

  function tabSets(page, I) {
    const wrap = el("div", { class: "catalog" });
    const q = el("input", { type: "search", class: "filter-input", placeholder: "Filter: name or command", "data-act": "sets:q", value: UI.setQ, autocomplete: "off", spellcheck: "false" });
    const catSel = el("select", { class: "filter-select", "aria-label": "Category", "data-act": "sets:cat" },
      el("option", { value: "", text: "Every category" }), ...I.cats.map((c, i) => el("option", { value: String(i), text: c })));
    catSel.value = UI.setCat;
    const runOnly = el("button", { type: "button", class: "toggle" + (UI.setRun ? " on" : ""), "aria-pressed": String(UI.setRun), "data-act": "sets:runnable", tip: "Only sets C2 can run (at least partly)" },
      icon("check"), el("span", { text: "Runnable" }));
    const list = el("div", { class: "cmd-list" });
    function draw() {
      const words = lc(UI.setQ).split(/\s+/).filter(Boolean);
      const hits = [];
      for (const x of I.sets) {
        if (UI.setCat !== "" && String(x[2]) !== UI.setCat) continue;
        if (words.length && !words.every((w) => lc(`${x[0]} ${x[1] || ""} ${I.cats[x[2]]} ${x[4].join(" ")}`).includes(w))) continue;
        if (UI.setRun && !recipeCheck(x[0]).ok) continue;
        hits.push(x);
        if (hits.length > 300) break;
      }
      list.textContent = "";
      if (!hits.length) { list.append(el("div", { class: "empty-state small" }, icon("search"), el("span", { text: "No set matches" }))); return; }
      for (const x of hits.slice(0, 300)) {
        const chk = recipeCheck(x[0]);
        const lines = x[4];
        const runBtn = chk.ok ? el("button", {
          type: "button", class: "fill small", "data-act": `set:${x[0]}`, tip: chk.bad ? `Run the ${chk.ok} of ${lines.length} lines C2 can do` : "Run it",
          onclick: (e) => {
            e.preventDefault();
            if (chk.bad && !confirm(`${chk.ok} of ${lines.length} lines of this set can run in C2 (the rest need the game, or come later). Run those ${chk.ok}?`)) return;
            run(`SBCheatGroup ${x[0]}`);
          },
        }, icon("play"), el("span", { text: chk.bad ? `${chk.ok}/${lines.length}` : String(lines.length) })) : el("span", { class: "set-off", tip: "Nothing in this set can run in a save file" }, icon("lock"));
        list.append(el("details", { class: "cmd-entry set-entry" + (chk.ok ? "" : " st-tool") },
          el("summary", null,
            el("span", { class: "cmd-sig" }, el("b", { class: "set-name", text: x[1] || x[0] }), el("code", { class: "cmd-params", text: x[1] ? x[0] : lines[0] })),
            el("span", { class: "cmd-topic", text: I.cats[x[2]] }),
            runBtn),
          el("div", { class: "cmd-detail" }, el("pre", { class: "script small" }, el("code", { text: lines.join("\n") })))));
      }
      if (hits.length > 300) list.append(el("p", { class: "muted", text: "Showing the first 300: filter to narrow the list" }));
    }
    q.addEventListener("input", () => { UI.setQ = q.value; draw(); });
    catSel.addEventListener("change", () => { UI.setCat = catSel.value; draw(); });
    runOnly.addEventListener("click", () => { UI.setRun = !UI.setRun; runOnly.classList.toggle("on", UI.setRun); runOnly.setAttribute("aria-pressed", String(UI.setRun)); draw(); });
    wrap.append(el("div", { class: "catalog-controls" }, el("label", { class: "filter" }, icon("search"), q), catSel, runOnly), list);
    draw();
    page.append(wrap);
  }

  function tabConsole(page) {
    // console
    const field = el("input", {
      id: "console", class: "console-input", type: "text", autocomplete: "off", spellcheck: "false", role: "combobox",
      "aria-expanded": "false", "aria-controls": "consoleList", "aria-label": "Command", placeholder: "SBPlayerSetLevel weapon 40",
    });
    const list = el("ul", { id: "consoleList", class: "omni-list", role: "listbox", hidden: true });
    const con = A.section("Console", el("span", { class: "console-tip", tip: "Tab completes, Enter runs, ↑ brings back earlier commands. Everything waits in the sidebar until you download.", tabindex: "0" }, icon("info")));
    con.append(el("div", { class: "console" }, el("label", { class: "console-field" }, icon("terminal"), field, list),
      el("ol", { class: "console-log", "aria-live": "polite" }, ...(LOG.length ? LOG.slice(0, 40).map((l) => el("li", { class: l.ok ? "ok" : "bad" },
        icon(l.ok ? "check" : "x"), el("code", { text: l.cmd }), el("span", { text: l.msg })))
        : [el("li", { class: "empty-log" }, icon("terminal"), el("span", { text: "Type SB to see the commands" }))]))));
    page.append(con);
    attach(field, list, "console");

    // a few of the developers' command sets (all of them are on the Developer sets tab)
    const rec = A.section("Quick sets");
    const cats = new Map();
    for (const [g, n, cat] of GAME.recipes.list) cats.set(cat, [...(cats.get(cat) || []), [g, n]]);
    for (const [cat, list2] of cats) {
      const grid = el("div", { class: "recipes" });
      for (const [g, n] of list2) {
        const chk = recipeCheck(g);
        if (!chk.ok) continue;
        const cmds = GAME.recipes.groups[g];
        grid.append(el("button", {
          type: "button", class: "recipe", "data-act": `recipe:${g}`,
          "data-tip": [n, ...cmds.slice(0, 6), cmds.length > 6 ? `… ${cmds.length - 6} more` : null, chk.bad ? `${chk.bad} line(s) C2 skips` : null].filter(Boolean).join("\n"),
          onclick: () => run(`SBCheatGroup ${g}`),
        }, el("span", { class: "recipe-name", text: n }), el("span", { class: "recipe-n" }, icon("terminal"), el("span", { text: fmt(cmds.length) }))));
      }
      if (grid.children.length) rec.append(el("h3", { class: "recipe-cat", text: cat }), grid);
    }
    page.append(rec);

    // your changes as a script
    const lines = planToCommands();
    const scr = A.section("Your changes as commands", el("div", { class: "block-acts" },
      lines.length ? el("button", { type: "button", class: "icon-btn", tip: "Copy", "data-act": "script:copy",
        onclick: async () => { try { await navigator.clipboard.writeText(lines.join("\n")); toast("Commands copied"); } catch (e) { toast("Copying isn't allowed here: use Download.", true); } } }, icon("copy")) : null,
      lines.length ? el("button", { type: "button", class: "icon-btn", tip: "Download as a .txt file", "data-act": "script:download",
        onclick: () => download("c2-commands.txt", `# Stellar Blade: C2 commands\n${lines.join("\n")}\n`) }, icon("download")) : null,
      el("button", { type: "button", class: "toggle", "data-act": "script:load", tip: "Run the commands from a .txt file", onclick: () => $("scriptInput").click() }, icon("upload"), el("span", { text: "Run a file" }))));
    scr.append(lines.length ? el("pre", { class: "script" }, el("code", { text: lines.join("\n") }))
      : el("div", { class: "empty-state small" }, icon("terminal"), el("span", { text: "Nothing changed yet" })));
    page.append(scr);

    // reference
    const ref = A.section("All commands");
    ref.append(el("div", { class: "cmd-ref" }, ...CMDS.map((c) => el("div", { class: "cmd-row" },
      el("code", { text: usage(c) }),
      el("span", { class: "cmd-help", text: c.help }),
      el("span", { class: "cmd-tags" }, c.exp ? A.expFlag() : null,
        el("span", { class: `omni-tag${c.dev ? "" : " c2"}`, tip: c.dev ? "One of the developers' own console commands" : "Added by C2", tabindex: "0", text: c.dev ? "dev" : "C2" }))))));
    page.append(ref);
  }

  // ------------------------------------------------------------------ wiring
  const omni = $("search");
  const omniList = el("ul", { id: "omniList", class: "omni-list", role: "listbox", hidden: true });
  $("searchWrap").append(omniList);
  omni.setAttribute("role", "combobox");
  omni.setAttribute("aria-controls", "omniList");
  omni.setAttribute("aria-expanded", "false");
  attach(omni, omniList, "omni");
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest && e.target.closest("input, textarea, [contenteditable]");
    if (((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
      if (!S.file) return;
      e.preventDefault();
      omni.focus();
      omni.select();
    }
  });
  const scriptInput = el("input", { type: "file", id: "scriptInput", accept: ".txt,text/plain", hidden: true });
  scriptInput.addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) run(await f.text(), "file");
  });
  document.body.append(scriptInput);

  window.SBPages.commands = pageCommands;
  window.SBCommands = { run, runLine, planToCommands, list: CMDS, usage, LOG, loadIntel, UI };
})();
