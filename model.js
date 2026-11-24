/*
 * Stellar Blade: C2 - inventory model
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Where things live in the save:
 *   DataMap_SBItem["Item"].Inventory[]    one FSBItemInstance per item (ItemAlias, ItemCount, ...)
 *   DataMap_SBItem["Item"].ItemOtaineSet  names of every item the player has ever obtained
 *   DataMap_SBActor["PlayerActor"].SP     unspent skill points
 */
(function (root) {
  "use strict";

  const G = typeof module !== "undefined" && module.exports ? require("./gvas.js") : root.SBGvas;
  const { getProp } = G;

  function randomGuid() {
    const b = new Uint8Array(16);
    (globalThis.crypto || root.crypto).getRandomValues(b);
    return b;
  }

  function setBool(p, on) {
    if (!p) return;
    p.value = on ? 1 : 0;
    p.extra.bool = on ? 1 : 0;
  }

  class Inventory {
    /**
     * @param save  result of SBGvas.parse
     * @param items catalog: alias -> { name, cat, max, charge, catalog }
     */
    constructor(save, items) {
      this.save = save;
      this.items = items;
      this.canon = Object.create(null); // names come from the save: no built-in properties
      for (const a of Object.keys(items)) this.canon[a.toLowerCase()] = a;
      const itemMap = save.props.find((p) => p.name === "DataMap_SBItem");
      const actors = save.props.find((p) => p.name === "DataMap_SBActor");
      if (!itemMap || !itemMap.value.map || !actors || !actors.value.map) {
        throw new G.GvasError("This save doesn't contain an inventory. Is it a Stellar Blade game save (not StellarBladeSetting.sav)?");
      }
      this.root = itemMap.value.map[0][1];
      const invProp = getProp(this.root, "Inventory");
      if (!invProp || !invProp.value.array) throw new G.GvasError("The inventory in this save couldn't be read.");
      this.inv = invProp.value.array;
      this.obtained = getProp(this.root, "ItemOtaineSet");
      const pl = actors.value.map.find(([k]) => k === "PlayerActor");
      this.player = pl ? pl[1] : null;
    }

    instance(entry) { return getProp(entry, "ItemInstance").value; }
    aliasOf(entry) { return getProp(this.instance(entry), "ItemAlias").value; }

    /** Unreal names are case-insensitive: "betacore" is the same item as "BetaCore". */
    entries(alias) {
      const al = alias.toLowerCase();
      return this.inv.filter((e) => this.aliasOf(e).toLowerCase() === al);
    }

    count(alias) {
      return this.entries(alias).reduce((n, e) => n + getProp(this.instance(e), "ItemCount").value, 0);
    }

    /** alias (catalog spelling) -> total count */
    totals() {
      const t = Object.create(null);
      for (const e of this.inv) {
        const raw = this.aliasOf(e);
        const a = this.canon[raw.toLowerCase()] || raw;
        t[a] = (t[a] || 0) + getProp(this.instance(e), "ItemCount").value;
      }
      return t;
    }

    template(alias) {
      const cat = (this.items[alias] || {}).cat;
      const same = this.inv.find((e) => (this.items[this.canon[this.aliasOf(e).toLowerCase()]] || {}).cat === cat);
      return structuredClone(same || this.inv[0]);
    }

    /** Set the total count of an item. Returns [before, after]. */
    setCount(alias, target) {
      const info = this.items[alias];
      if (!info) throw new G.GvasError(`Unknown item ${alias}`);
      target = Math.max(0, Math.floor(target));
      if (info.max && target > info.max) target = info.max;
      const entries = this.entries(alias);
      const before = this.count(alias);
      if (target === before) return [before, before];

      if (!entries.length) {
        if (target === 0) return [0, 0];
        const e = this.template(alias);
        const ii = this.instance(e);
        getProp(ii, "SavedGuid").value = { st: "Guid", props: null, raw: randomGuid() };
        getProp(ii, "PocketGuid").value = { st: "Guid", props: null, raw: randomGuid() };
        getProp(ii, "ItemAlias").value = alias;
        getProp(ii, "ItemVisualAlias").value = "None";
        getProp(ii, "StatLevel").value = 1;
        for (const flag of ["Equiped", "bWithResetZone", "bFavorites", "bMustAcquisition"]) setBool(getProp(ii, flag), false);
        getProp(ii, "ItemCount").value = target;
        getProp(ii, "ItemChargeCount").value = info.charge ? Math.min(target, info.charge) : target;
        this.inv.push(e);
        if (this.obtained && this.obtained.value.set &&
            !this.obtained.value.set.some((x) => x.toLowerCase() === alias.toLowerCase())) {
          this.obtained.value.set.push(alias);
        }
        return [before, target];
      }

      // everything goes on the first entry; extra entries of the same item are removed
      const first = this.instance(entries[0]);
      const cnt = getProp(first, "ItemCount");
      const chg = getProp(first, "ItemChargeCount");
      const chargeTracksCount = chg.value === cnt.value || !info.charge;
      if (target === 0) {
        for (const e of entries) this.inv.splice(this.inv.indexOf(e), 1);
        return [before, 0];
      }
      for (const e of entries.slice(1)) this.inv.splice(this.inv.indexOf(e), 1);
      cnt.value = target;
      chg.value = chargeTracksCount ? target : Math.min(chg.value, target);
      return [before, target];
    }

    get sp() {
      const p = this.player && getProp(this.player, "SP");
      return p ? p.value : null;
    }

    set sp(v) {
      const p = this.player && getProp(this.player, "SP");
      if (p) p.value = Math.max(0, Math.floor(v));
    }

    get hp() {
      const p = this.player && getProp(this.player, "HP");
      return p && p.value && "f32" in p.value ? p.value.f32 : null;
    }
  }

  const TICKS_AT_1970 = 621355968000000000n; // FDateTime ticks (100 ns since year 1) at the Unix epoch
  const DIFFICULTY = { 0: "Normal Mode", 1: "Story Mode", 2: "Hard Mode" }; // ESBGameDifficultyType

  /**
   * Read-only facts about a save for the overview. Every field is null when the save doesn't have it.
   *   playTime (seconds), difficulty, playthrough (1 = first), startedAt / savedAt (ms since 1970, wall clock),
   *   level, hp, shield, questsDone, questsActive, skills, enemies, camps, records, endings {seen,total}, outfit
   */
  function summary(save, items) {
    const top = (n) => save.props.find((p) => p.name === n);
    const fromMap = (n, key) => {
      const p = top(n);
      const e = p && p.value && p.value.map && p.value.map.find(([k]) => k === key);
      return e ? e[1] : null;
    };
    const num = (v) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v
      : v && typeof v === "object" && "f32" in v ? v.f32 : null);
    const date = (t) => (typeof t === "bigint" && t > TICKS_AT_1970 ? Number((t - TICKS_AT_1970) / 10000n) : null);
    const root = (n) => { const p = top(n); return p && p.value && p.value.map && p.value.map[0] ? p.value.map[0][1] : null; };
    const prop = (struct, n) => (struct && struct.props ? getProp(struct, n) : null);
    const count = (struct, n) => { const p = prop(struct, n); return p && p.value && p.value.array ? p.value.array.length : null; };

    const actors = top("DataMap_SBActor");
    const pl = actors && actors.value.map && actors.value.map.find(([k]) => k === "PlayerActor");
    const player = pl ? pl[1] : null;
    const stat = (n) => { const p = prop(player, n); return p ? num(p.value) : null; };

    const trophies = Object.create(null);
    const ach = prop(top("SBAchievement") && top("SBAchievement").value, "AchievementList");
    for (const e of (ach && ach.value.array) || []) {
      const a = prop(e, "AchievementAlias");
      const v = prop(e, "ProgressValue");
      if (a && v) trophies[a.value] = num(v.value);
    }
    const trophy = (n) => (n in trophies ? trophies[n] : null);

    const endingKeys = ["EndingTimeStamp_KillElder", "EndingTimeStamp_KillLily", "EndingTimeStamp_SaveLily"]
      .filter((k) => fromMap("DataMap_int64", k) !== null);
    const endings = endingKeys.length
      ? { seen: endingKeys.filter((k) => fromMap("DataMap_int64", k) > 0n).length, total: endingKeys.length } : null;

    let outfit = null;
    const eq = prop(player, "Equipment");
    for (const [, it] of (eq && eq.value.map) || []) {
      const a = prop(it, "ItemAlias");
      const info = a && items[a.value];
      if (info && info.cat === "outfit") outfit = a.value;
    }

    const quests = root("DataMap_SBQuest");
    const diff = num(fromMap("DataMap_int32", "GameDifficulty"));
    const ng = num(fromMap("DataMap_int32", "NewGamePlusPlayCount"));
    const created = top("NewGameCreateTime");
    return {
      playTime: num(fromMap("DataMap_int32", "PlayTime")),
      difficulty: diff === null ? null : DIFFICULTY[diff] || `Difficulty ${diff}`,
      playthrough: ng === null ? null : ng + 1,
      startedAt: created ? date(created.value) : null,
      savedAt: date(fromMap("DataMap_int64", "DateTime")),
      level: stat("SPLevel"),
      hp: stat("HP"),
      shield: stat("Shield"),
      questsDone: count(quests, "CompleteQuestList"),
      questsActive: count(quests, "ProgressQuestList"),
      skills: count(root("DataMap_SBAcquisitionSkill"), "AcquisitionSkillList"),
      enemies: trophy("Trophy_KillCharacter"),
      camps: trophy("Trophy_Activate_AllCamp"),
      records: trophy("Trophy_Acquire_AllRecords"),
      endings,
      outfit,
    };
  }

  /**
   * Parse bytes and apply a set of changes. Returns { bytes, report } with the new file.
   * changes: { chapter: {key, place}, items: {alias: n}, sp, progress }
   *   progress needs `game` (gamedata.js, see progress.js), chapter also needs chapters.js (see chapter.js)
   */
  function applyChanges(bytes, items, changes, game, chapters) {
    const save = G.parse(bytes);
    const node = typeof module !== "undefined" && module.exports;
    const report = [];
    if (changes.chapter) {
      // the story jump goes first, so item and progress edits are applied on top of it
      const CH = node ? require("./chapter.js") : root.SBChapter;
      const r = CH.applyChapter(save, changes.chapter.key, chapters, game, items, { place: changes.chapter.place !== false });
      report.push({ alias: "@chapter", name: "Chapter", before: r.from, after: r.to, detail: r });
    }
    // progress (with quest rewards) before item edits: an amount you typed is the amount you get
    const PR = node ? require("./progress.js") : root.SBProgress;
    if (changes.progress) report.push(...PR.applyProgress(save, game, { ...changes.progress, items }));
    const steps = (changes.progress && changes.progress.questSteps) || {};
    if (Object.keys(steps).length) {
      // side quests at a chosen step: built like the story jump builds main quests
      const CH = node ? require("./chapter.js") : root.SBChapter;
      for (const [q, i] of Object.entries(steps)) {
        const layout = (game.questSteps[q] || []).map(([g, , c]) => [g, c]);
        if (!layout.length) continue;
        const before = CH.setQuestStep(save, game, q, layout, Math.max(0, Math.min(layout.length - 1, i)));
        report.push({ alias: "@quest", name: q, before, after: `step ${i + 1}` });
      }
    }
    const equip = (changes.progress && changes.progress.equip) || {};
    const itemLevels = (changes.progress && changes.progress.itemLevels) || {};
    const inv = new Inventory(save, items);
    const itemReport = [];
    for (const [alias, n] of Object.entries(changes.items || {})) {
      const [before, after] = inv.setCount(alias, n);
      itemReport.push({ alias, name: items[alias].name, before, after });
    }
    report.push(...itemReport);
    if (game && game.ev) {
      // items gained fire the game's "picked up" events (collections, shop unlocks, Album, reward skills)
      const P = new PR.Progress(save, game);
      for (const r of itemReport) if (r.after > r.before) P.fireItem(r.alias, r.after - r.before);
      P.checkSkillCounts();
    }
    if (Object.keys(equip).length) {
      // after the item edits, so Eve can wear something added in the same download
      const P = new PR.Progress(save, game);
      for (const [slot, alias] of Object.entries(equip)) P.equip(Number(slot), alias, items);
      report.push({ alias: "@equip", name: "Wardrobe", before: null, after: Object.keys(equip).length });
    }
    if (Object.keys(itemLevels).length) {
      // after the item edits too: a new Exospine can be levelled in the same download
      const P = new PR.Progress(save, game);
      for (const [alias, level] of Object.entries(itemLevels)) {
        if (inv.count(alias) > 0) report.push({ alias, name: `${items[alias].name} level`, before: P.setItemLevel(alias, level, items), after: level });
      }
    }
    if (changes.sp !== undefined && changes.sp !== null && inv.sp !== null) {
      const before = inv.sp;
      inv.sp = changes.sp;
      report.push({ alias: "@SP", name: "Skill points", before, after: inv.sp });
    }
    const out = G.serialize(save);
    G.parse(out); // re-read the result (checksum included) before handing it out
    return { bytes: out, report };
  }

  const api = { Inventory, applyChanges, summary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SBModel = api;
})(typeof window !== "undefined" ? window : globalThis);
