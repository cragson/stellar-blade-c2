/*
 * Stellar Blade: C2 - progress model: difficulty, upgrades, skills, camps, quests, album,
 * Boss Challenge, trophies and a few repair tools.
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Where things live in the save:
 *   DataMap_int32  GameDifficulty (Normal 0, Story 1, Hard 2), NewGamePlusPlayCount, PlayTime
 *   DataMap_int64  DateTime, EndingTimeStamp_KillElder / _KillLily / _SaveLily (FDateTime ticks)
 *   DataMap_SBActor["PlayerActor"]  LevelArray (index = ESBCharacterLevelType), ActorLocation, Camp*Location
 *   DataMap_SBAcquisitionSkill["AcquisitionSkill"].AcquisitionSkillList[].AcquisitionSkillAlias
 *   DataMap_SBEnv["Env"].ZoneContainerList[].ZoneEnvStorageList[]  one entry per world object (camps too)
 *   DataMap_SBQuest["Quest"]  ProgressQuestList / CompleteQuestList / FailedQuestList, TrackingQuestAliases
 *   SBAchievement.AchievementList[]  {AchievementAlias, ProgressValue, bCompleted, bRecievedReward}
 *   UIStorage.RedDotArray[].DotState  ("New" = a red dot is shown)
 *   SBShopHistory.Purchase  per-shop purchase counts for limited stock
 */
(function (root) {
  "use strict";

  const G = typeof module !== "undefined" && module.exports ? require("./gvas.js") : root.SBGvas;
  const { getProp } = G;

  const TICKS_AT_1970 = 621355968000000000n;
  const ENDINGS = ["EndingTimeStamp_KillElder", "EndingTimeStamp_KillLily", "EndingTimeStamp_SaveLily"];
  const ACTIVE_TAGS = new Set(["on", "notfirst"]);

  const nowTicks = () => BigInt(Date.now()) * 10000n + TICKS_AT_1970;
  /** A FloatProperty value as the parser keeps it: the number plus its four bytes. */
  const f32 = (x) => { const raw = new Uint8Array(4); new DataView(raw.buffer).setFloat32(0, x, true); return { f32: x, raw }; };
  /** Steam trophies: the editor never progresses or completes them. */
  const isTrophy = (a) => a.startsWith("Trophy_") || a.endsWith("_forPlatform");

  function setBool(p, on) {
    if (!p) return;
    p.value = on ? 1 : 0;
    p.extra.bool = on ? 1 : 0;
  }

  class Progress {
    /** @param save result of SBGvas.parse, @param game SB_GAME (gamedata.js) */
    constructor(save, game) {
      this.save = save;
      this.game = game;
    }

    top(name) { return this.save.props.find((p) => p.name === name) || null; }
    root(name) { const p = this.top(name); return p && p.value.map && p.value.map[0] ? p.value.map[0][1] : null; }
    mapEntry(name, key) {
      const p = this.top(name);
      return p && p.value.map ? p.value.map.find(([k]) => k === key) || null : null;
    }
    get player() {
      const p = this.top("DataMap_SBActor");
      const e = p && p.value.map && p.value.map.find(([k]) => k === "PlayerActor");
      return e ? e[1] : null;
    }

    // ---------------------------------------------------------------- difficulty and endings
    get difficulty() { const e = this.mapEntry("DataMap_int32", "GameDifficulty"); return e ? e[1] : null; }
    set difficulty(v) {
      const e = this.mapEntry("DataMap_int32", "GameDifficulty");
      if (!e) throw new G.GvasError("This save has no difficulty setting.");
      e[1] = v;
    }

    endingsSeen() { return ENDINGS.filter((k) => { const e = this.mapEntry("DataMap_int64", k); return e && e[1] > 0n; }).length; }

    /** Experimental: record all endings as seen, which is what a finished game looks like. */
    markFinished() {
      const when = (this.mapEntry("DataMap_int64", "DateTime") || [null, nowTicks()])[1];
      let n = 0;
      for (const k of ENDINGS) {
        const e = this.mapEntry("DataMap_int64", k);
        if (e && !(e[1] > 0n)) { e[1] = when; n++; }
        // the game also completes Ach_Ending_KillElder / _KillLily / _SaveLily
        this.completeAch(k.replace("EndingTimeStamp_", "Ach_Ending_"));
      }
      return n;
    }

    // ---------------------------------------------------------------- upgrade levels
    levelArray() { const p = this.player && getProp(this.player, "LevelArray"); return p ? p.value.array : null; }
    level(index) { const a = this.levelArray(); return a && index < a.length ? a[index] : null; }
    setLevel(index, n) {
      const a = this.levelArray();
      if (!a || index >= a.length) throw new G.GvasError("This save has no upgrade levels.");
      a[index] = Math.max(0, Math.floor(n));
    }

    // ---------------------------------------------------------------- skills
    skillList() { const r = this.root("DataMap_SBAcquisitionSkill"); const p = r && getProp(r, "AcquisitionSkillList"); return p ? p.value.array : null; }
    learned() { return new Set((this.skillList() || []).map((e) => getProp(e, "AcquisitionSkillAlias").value)); }
    /** Layout of one skill entry, remembered before anything is removed. */
    skillTemplate() {
      const list = this.skillList();
      if (!this._skillTpl && list && list.length) this._skillTpl = structuredClone(list[0]);
      return this._skillTpl || null;
    }
    learn(alias) {
      const list = this.skillList();
      const tpl = this.skillTemplate();
      if (!list || !tpl) throw new G.GvasError("This save has no skill list.");
      if (this.learned().has(alias)) return false;
      const e = structuredClone(tpl);
      getProp(e, "AcquisitionSkillAlias").value = alias;
      list.push(e);
      return true;
    }
    forget(alias) {
      const list = this.skillList();
      this.skillTemplate();
      const i = list ? list.findIndex((e) => getProp(e, "AcquisitionSkillAlias").value === alias) : -1;
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    }

    // ---------------------------------------------------------------- achievements (internal ones: album, boss challenge, unlocks)
    achList() { const p = this.top("SBAchievement"); const l = p && getProp(p.value, "AchievementList"); return l ? l.value.array : null; }
    achievements() {
      const m = new Map();
      for (const e of this.achList() || []) {
        m.set(getProp(e, "AchievementAlias").value, { value: getProp(e, "ProgressValue").value, done: !!getProp(e, "bCompleted").value, entry: e });
      }
      return m;
    }
    /** The save entry of an achievement, created (not completed) when asked to. */
    achEntry(alias, create) {
      if (!this._achIdx) {
        this._achIdx = new Map();
        for (const e of this.achList() || []) this._achIdx.set(getProp(e, "AchievementAlias").value, e);
      }
      let e = this._achIdx.get(alias);
      if (!e && create) {
        const list = this.achList();
        if (!list || !list.length) throw new G.GvasError("This save has no achievement list.");
        e = structuredClone(list[0]);
        getProp(e, "AchievementAlias").value = alias;
        getProp(e, "ProgressValue").value = 0;
        setBool(getProp(e, "bCompleted"), false);
        setBool(getProp(e, "bRecievedReward"), false);
        list.push(e);
        this._achIdx.set(alias, e);
      }
      return e || null;
    }
    achDone(alias) { const e = this.achEntry(alias, false); return !!(e && getProp(e, "bCompleted").value); }

    /**
     * Complete an achievement the way the game does: grant its reward skills, progress the achievements it
     * feeds, and fire "achievement completed" for the ones that wait on it. Steam trophies are never touched.
     */
    completeAch(alias, goal) {
      if (isTrophy(alias)) return false;
      const e = this.achEntry(alias, true);
      const pv = getProp(e, "ProgressValue");
      pv.value = Math.max(pv.value, goal || this.achGoal(alias));
      if (getProp(e, "bCompleted").value) return false;
      setBool(getProp(e, "bCompleted"), true);
      if ((this._depth = (this._depth || 0) + 1) > 40) { this._depth--; return true; }
      const fx = this.ev().fx[alias];
      if (fx) {
        const [skills, next, multiMap] = fx;
        for (const s of skills) if (this.learn(s)) this.fireSkill(s);
        for (const [a, v] of next) this.progressAch(a, v);
        if (multiMap && this.player) { const p = getProp(this.player, "MultiMapLevel"); if (p) p.value += multiMap; }
      }
      this.fire("Complete/Achievement", { AchievementAlias: alias });
      for (const [a, list] of this.evIndex().checksBy.get(alias) || []) {
        if (list.every((x) => this.achDone(x))) this.completeAch(a);
      }
      this._depth--;
      return true;
    }

    /** Undo an achievement (only used when a quest is reset, so it can be done again). */
    resetAch(alias) {
      const e = this.achEntry(alias, false);
      if (!e) return;
      getProp(e, "ProgressValue").value = 0;
      setBool(getProp(e, "bCompleted"), false);
    }

    // ---------------------------------------------------------------- game events
    ev() { return this.game.ev || { rules: {}, fx: {}, goal: {}, checks: [], itemCat: {}, skillTag: {} }; }
    achGoal(alias) { return this.ev().goal[alias] || 1; }
    evIndex() {
      if (this._evIdx) return this._evIdx;
      const ev = this.ev();
      const byEvent = {};
      for (const [name, rules] of Object.entries(ev.rules)) {
        const m = new Map();
        for (const r of rules) {
          const [, ps, or] = r;
          const key = !or && ps.length && ps[0][2] === "EQ" ? `${ps[0][0]}=${ps[0][1].toLowerCase()}` : "*";
          if (!m.has(key)) m.set(key, []);
          m.get(key).push(r);
        }
        byEvent[name] = m;
      }
      const checksBy = new Map();
      for (const [a, list] of ev.checks) for (const x of list) { if (!checksBy.has(x)) checksBy.set(x, []); checksBy.get(x).push([a, list]); }
      return (this._evIdx = { byEvent, checksBy });
    }

    /** Fire a game event: every achievement whose parameters match progresses by `amount`. */
    fire(event, params, amount = 1) {
      const m = this.evIndex().byEvent[event];
      if (!m) return 0;
      const cands = [...(m.get("*") || [])];
      for (const [k, v] of Object.entries(params)) cands.push(...(m.get(`${k}=${String(v).toLowerCase()}`) || []));
      const test = ([type, want, op]) => {
        const have = params[type];
        if (have === undefined || have === null) return false;
        return op === "GE" ? Number(have) >= Number(want) : String(have).toLowerCase() === want.toLowerCase();
      };
      let n = 0;
      for (const [a, ps, or] of new Set(cands)) {
        if (ps.length && !(or ? ps.some(test) : ps.every(test))) continue;
        this.progressAch(a, amount);
        n++;
      }
      return n;
    }

    progressAch(alias, amount = 1) {
      if (isTrophy(alias) || this.achDone(alias)) return;
      const goal = this.achGoal(alias);
      const pv = getProp(this.achEntry(alias, true), "ProgressValue");
      pv.value = Math.min(goal, pv.value + amount);
      if (pv.value >= goal) this.completeAch(alias, goal);
    }

    fireItem(alias, amount = 1) {
      const [cat, tag] = this.ev().itemCat[alias] || ["None", "None"];
      const params = { ItemAlias: alias, ItemCategory: cat, ItemCategoryTag: tag };
      this.fire("Acquire/Item", params, amount);
      if (cat === "Fish") this.fire("Fishing/Item", params, amount);
    }
    /** Item pickup achievements for this item that aren't complete yet (an item added by another tool). */
    missingPickups(alias) {
      const out = [];
      for (const ev of ["Acquire/Item", "Fishing/Item"]) {
        const m = this.evIndex().byEvent[ev];
        const rules = (m && m.get(`ItemAlias=${alias.toLowerCase()}`)) || [];
        out.push(...rules.filter(([a, ps]) => ps.length === 1 && !this.achDone(a)).map(([a]) => a));
      }
      return out;
    }
    fireLevel(levelType, from, to) {
      for (let l = from + 1; l <= to; l++) this.fire("LevelUp/Character", { LevelType: levelType, LevelValue: l });
    }
    fireSkill(alias) { this.fire("Acquire/Skill", { SkillAlias: alias }); }
    fireEnv(alias, state) { this.fire("ChangeState/ZoneEnv", { ZoneEnvSpawnAlias: alias, EnvState: state }); }
    fireQuest(alias, done) { this.fire(done ? "Complete/Quest" : "Acquire/Quest", { QuestAlias: alias }); }
    fireKill(alias) { this.fire("Kill/Character", { CharacterAlias: alias, ZoneEnvSpawnAlias: alias }); }
    fireTrigger(alias) { this.fire("Enter/ZoneTrigger", { ZoneTriggerAlias: alias }); }

    /** "Learned N skills with tag X" achievements (e.g. 20 drone upgrades unlock a shop item). */
    checkSkillCounts() {
      const tags = this.ev().skillTag;
      const count = {};
      for (const s of this.learned()) { const t = Object.hasOwn(tags, s) && tags[s]; if (t) count[t] = (count[t] || 0) + 1; }
      for (const [a, ps] of this.ev().rules["CheckAmount/Skill"] || []) {
        const tag = ps.find((p) => p[0] === "AcquisitionSkillAchievementTag");
        const n = ps.find((p) => p[0] === "AcquiredSkillCount");
        if (tag && n && (count[tag[1]] || 0) >= Number(n[1])) this.completeAch(a);
      }
    }

    // ---------------------------------------------------------------- camps
    zones() { const r = this.root("DataMap_SBEnv"); const p = r && getProp(r, "ZoneContainerList"); return p ? p.value.array : []; }
    envIndex() {
      if (this._env) return this._env;
      const m = new Map();
      for (const z of this.zones()) for (const e of getProp(z, "ZoneEnvStorageList").value.array) m.set(getProp(e, "EnvAlias").value, e);
      return (this._env = m);
    }
    zone(alias) { return this.zones().find((z) => getProp(z, "ZoneAlias").value === alias) || null; }

    /**
     * Change a character the save keeps (ZoneNpcStorageList), found by zone and EventSpawnId.
     * change: { here } (there: alive, shown, active, not moved on), { gone } (LifeState 5), { loc: [x,y,z] },
     * { forget } (drop the entry: the game spawns them again by its own rules when the zone loads)
     */
    setNpc(zone, spawnId, change) {
      const z = this.zone(zone);
      const list = z && getProp(z, "ZoneNpcStorageList");
      if (!list || !list.value.array) return false;
      const arr = list.value.array;
      const i = arr.findIndex((e) => Number(getProp(e, "EventSpawnId").value) === Number(spawnId));
      if (i < 0) return false;
      const e = arr[i];
      if (change.forget) { arr.splice(i, 1); return true; }
      const set = (name, v) => {
        const prop = getProp(e, name);
        if (!prop) return;
        if (typeof prop.value === "boolean") prop.value = !!v;
        else if (typeof prop.value === "number") prop.value = typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
        else prop.value = v;
      };
      if (change.here) {
        set("LifeState", 1);
        set("bHiddenGame", false);
        set("bActiveActor", true);
        set("ObjectState", "ESBObject_Enable");
        set("StayZoneAlias", "None");
      }
      if (change.gone) set("LifeState", 5);
      if (change.loc) {
        const at = getProp(e, "ActorLocation");
        if (at && at.value && at.value.raw && at.value.raw.length >= 12) {
          const raw = new Uint8Array(at.value.raw);
          const d = new DataView(raw.buffer, 0, 12);
          change.loc.forEach((v, k) => d.setFloat32(k * 4, v, true));
          at.value = Object.assign({}, at.value, { raw });
        }
      }
      return true;
    }
    /** Bring the enemies the save has killed back to life in these zones (what resting at a camp does). */
    reviveEnemies(zones) {
      let n = 0;
      for (const z of this.zones()) {
        if (!zones.includes(String(getProp(z, "ZoneAlias").value))) continue;
        const list = getProp(z, "ZoneNpcStorageList");
        for (const e of (list && list.value.array) || []) {
          const life = getProp(e, "LifeState");
          if (String(getProp(e, "CharacterDataAlias").value).startsWith("N_") || !life || Number(life.value) !== 5) continue;
          life.value = 1;
          n++;
        }
      }
      return n;
    }

    /** Where the save has each world object and whether it's active: { alias: [x, y, z, active] } (0,0,0 = not placed). */
    envPlaces() {
      const out = Object.create(null);
      for (const [alias, e] of this.envIndex()) {
        const at = getProp(e, "ActorLocation");
        const act = getProp(e, "EnvActivate");
        let loc = [0, 0, 0];
        if (at && at.value && at.value.raw && at.value.raw.length >= 12) {
          const d = new DataView(at.value.raw.buffer, at.value.raw.byteOffset, 12);
          loc = [0, 1, 2].map((i) => Math.round(d.getFloat32(i * 4, true)));
        }
        out[alias] = [loc[0], loc[1], loc[2], !act || String(act.value) !== "ESBObject_Disable"];
      }
      return out;
    }

    /**
     * Characters the save keeps per zone (ZoneNpcStorageList): who, where they are now and whether they're there.
     * [{ zone, alias, spawnId, loc: [x,y,z], life, hidden, active, enabled, stay }]
     * life 1 = there, 5 = gone (a story moment that has ended); stay = the zone they moved on to ("None" if none).
     */
    npcStorage() {
      const out = [];
      const val = (e, n) => { const p = getProp(e, n); return p ? p.value : null; };
      for (const z of this.zones()) {
        const list = getProp(z, "ZoneNpcStorageList");
        if (!list || !list.value.array) continue;
        const zone = String(getProp(z, "ZoneAlias").value);
        for (const e of list.value.array) {
          const at = val(e, "ActorLocation");
          if (!at || !at.raw || at.raw.length < 12) continue;
          const d = new DataView(at.raw.buffer, at.raw.byteOffset, 12);
          // dialogue flags the character keeps (InteractData.CustomDataMap: "ShopOpen_1st" -> 1)
          const flags = Object.create(null);
          const inter = val(e, "InteractData");
          const cdm = inter && inter.props && getProp(inter, "CustomDataMap");
          for (const [k, v] of (cdm && cdm.value && cdm.value.map) || []) {
            const x = v && typeof v === "object" && "f32" in v ? v.f32 : v;
            flags[String(k)] = typeof x === "bigint" ? Number(x) : x;
          }
          out.push({
            flags,
            zone, alias: String(val(e, "CharacterDataAlias")), spawnId: Number(val(e, "EventSpawnId")),
            loc: [0, 1, 2].map((i) => d.getFloat32(i * 4, true)), life: Number(val(e, "LifeState")),
            hidden: !!val(e, "bHiddenGame"), active: !!val(e, "bActiveActor"),
            enabled: String(val(e, "ObjectState")) === "ESBObject_Enable", stay: String(val(e, "StayZoneAlias")),
          });
        }
      }
      return out;
    }

    /**
     * Create the save entry for a world object the game hasn't stored yet (its area was never visited).
     * info: { type, zone, loc: [x,y,z], rot: [3 floats in save order], save }  tags: the type's state names
     * The layout is copied from a stored object of the same type when there is one.
     */
    createEnv(alias, info, tags, tagNow, activate) {
      if (this.envIndex().has(alias)) return this.envIndex().get(alias);
      const zone = this.zone(info.zone);
      if (!zone) return null;
      // Logic objects (state switches) aren't placed in any level; the game itself stores them at 0,0,0.
      const loc = info.loc || [0, 0, 0];
      const rot = info.rot || [0, 0, 0];
      const list = getProp(zone, "ZoneEnvStorageList").value.array;
      const sameType = info.sameType && info.sameType.map((a) => this.envIndex().get(a)).find(Boolean);
      const any = sameType || [...this.envIndex().values()][0];
      if (!any) return null;
      const e = structuredClone(any);
      getProp(e, "EnvAlias").value = alias;
      getProp(e, "EnvStateSlotTag").value = tagNow || info.init || "None";
      getProp(e, "EnvActivate").value = activate || info.act || "ESBObject_Enable";
      getProp(e, "EnvActiveState").value = "ESBENV_State_None";
      const st = getProp(e, "SaveType");
      if (st && info.save) st.value = info.save;
      const states = getProp(e, "StateInfoList");
      if (states && !sameType && states.value.array.length) {
        const tpl = states.value.array[0];
        states.value.array = (tags || []).map((t) => {
          const s = structuredClone(tpl);
          getProp(s, "StateTagName").value = t;
          setBool(getProp(s, "bDropedReward"), false);
          getProp(s, "CurrentProgressValue").value = 0;
          return s;
        });
      }
      for (const n of ["EnvProgressInfo"]) { const p = getProp(e, n); if (p && !sameType) p.value.array = []; }
      for (const n of ["CurrentTriggerCount"]) { const p = getProp(e, n); if (p) p.value = 0; }
      const inter = getProp(e, "InteractData");
      if (inter) setBool(getProp(inter.value, "bInteracted"), false);
      const vec = (name, xyz) => {
        const p = getProp(e, name);
        if (!p) return;
        const raw = new Uint8Array(12);
        const d = new DataView(raw.buffer);
        xyz.forEach((v, i) => d.setFloat32(i * 4, v, true));
        p.value = { st: p.value.st, props: null, raw };
      };
      vec("ActorLocation", loc);
      vec("ActorRotation", rot);
      vec("QuestMarkerLocation", loc);
      list.push(e);
      this.envIndex().set(alias, e);
      return e;
    }

    /** Set an object's state ("On", "Open", "B", ...) and/or enabled flag, creating it if needed. */
    setEnv(alias, tag, activate, info, tags) {
      let e = this.envIndex().get(alias);
      if (!e && info) e = this.createEnv(alias, info, tags, tag, activate);
      if (!e) return false;
      if (tag) getProp(e, "EnvStateSlotTag").value = tag;
      if (activate) getProp(e, "EnvActivate").value = activate;
      return true;
    }

    /** "active" | "inactive" | "unvisited" (the game hasn't created the camp's objects yet) */
    campState(alias) {
      const camp = this.game.camps[alias];
      const env = this.envIndex();
      const present = Object.keys(camp.objs).map((a) => env.get(a)).filter(Boolean);
      if (!present.length) return "unvisited";
      return present.some((e) => ACTIVE_TAGS.has(String(getProp(e, "EnvStateSlotTag").value).toLowerCase())) ? "active" : "inactive";
    }
    /** Camps in unvisited areas can be created when the level files told us where each object stands. */
    canCreateCamp(alias) {
      return Object.values(this.game.camps[alias].objs).every((o) => o.length >= 4);
    }

    /** Switch on the camp's objects (teleporter, chair, shop, ...) the same way the game does when you activate it. */
    activateCamp(alias) {
      const camp = this.game.camps[alias];
      const env = this.envIndex();
      let n = 0;
      for (const [a, [type, zone, loc, rot]] of Object.entries(camp.objs)) {
        let e = env.get(a);
        if (!e && loc && rot) {
          const sameType = Object.values(this.game.camps).flatMap((c) => Object.keys(c.objs).filter((b) => c.objs[b][0] === type));
          e = this.createEnv(a, { type, zone, loc, rot, save: "ESBZoneObjSaveType_Save", sameType },
            (this.game.campTags || {})[type], "On", "ESBObject_Enable");
          if (e) { n++; this.fireEnv(a, "On"); }
        }
        if (!e) continue;
        const tag = getProp(e, "EnvStateSlotTag");
        if (!ACTIVE_TAGS.has(String(tag.value).toLowerCase())) { tag.value = "On"; n++; this.fireEnv(a, "On"); }
        getProp(e, "EnvActivate").value = "ESBObject_Enable";
        const st = getProp(e, "EnvActiveState");
        if (st.value === "ESBENV_State_Deactive") st.value = "ESBENV_State_Active";
      }
      return n;
    }

    // ---------------------------------------------------------------- quests
    questRoot() { return this.root("DataMap_SBQuest"); }
    questLists() {
      const r = this.questRoot();
      const get = (n) => { const p = r && getProp(r, n); return p ? p.value.array : []; };
      return { progress: get("ProgressQuestList"), done: get("CompleteQuestList"), failed: get("FailedQuestList") };
    }
    /** alias -> "active" | "done" | "failed" (absent = not started) */
    questStates() {
      const s = {};
      const L = this.questLists();
      for (const [k, list] of [["active", L.progress], ["done", L.done], ["failed", L.failed]]) {
        for (const e of list) s[getProp(e, "QuestAlias").value] = k;
      }
      return s;
    }
    tracked() {
      const r = this.questRoot();
      const p = r && getProp(r, "TrackingQuestAliases");
      return p && p.value.array ? p.value.array.slice() : [];
    }
    track(alias) {
      const r = this.questRoot();
      const p = r && getProp(r, "TrackingQuestAliases");
      if (!p) throw new G.GvasError("This save has no quest tracking.");
      p.value.array = alias ? [alias] : [];
    }
    removeQuest(alias) {
      for (const list of Object.values(this.questLists())) {
        for (let i = list.length - 1; i >= 0; i--) if (getProp(list[i], "QuestAlias").value === alias) list.splice(i, 1);
      }
    }
    /** Mark a quest as finished (no rewards are handed out). */
    completeQuest(alias) {
      const L = this.questLists();
      let e = L.progress.find((x) => getProp(x, "QuestAlias").value === alias);
      if (!e && L.done.some((x) => getProp(x, "QuestAlias").value === alias)) return false;
      if (!e) {
        const tpl = L.done[0] || L.progress[0];
        if (!tpl) throw new G.GvasError("This save has no quest to copy the layout from.");
        e = structuredClone(tpl);
        getProp(e, "QuestAlias").value = alias;
        getProp(e, "QuestTaskGroupList").value.array = [];
      }
      this.removeQuest(alias);
      getProp(e, "QuestState").value = 3; // ESBState_Complete
      for (const g of getProp(e, "QuestTaskGroupList").value.array) {
        getProp(g, "TaskGroupState").value = "TaskGroup_Complete";
        for (const info of getProp(g, "TaskInfoList").value.array) {
          for (const t of getProp(info, "TaskList").value.array) getProp(t, "TaskState").value = "ESBQuestTaskState_Complete";
        }
      }
      const ts = getProp(e, "LastUpdateTimestamp");
      if (ts) ts.value = nowTicks();
      L.done.push(e);
      if (this.tracked().includes(alias)) this.track(null);
      this.fireQuest(alias, true);
      return true;
    }
    /** Forget a quest so it can be taken (and its reward earned) again. */
    resetQuest(alias) {
      this.removeQuest(alias);
      if (this.tracked().includes(alias)) this.track(null);
      // and its own "quest taken / quest done" achievements, so doing it again counts again
      const idx = this.evIndex().byEvent;
      for (const ev of ["Complete/Quest", "Acquire/Quest"]) {
        for (const [a] of (idx[ev] && idx[ev].get(`QuestAlias=${alias.toLowerCase()}`)) || []) this.resetAch(a);
      }
    }

    // ---------------------------------------------------------------- trophies (read only)
    trophyProgress() {
      const ach = this.achievements();
      return this.game.trophies.map((t) => {
        const a = ach.get(t.ach);
        return { ...t, value: a ? a.value : 0, done: a ? a.done : false };
      });
    }

    // ---------------------------------------------------------------- repair tools
    clearNewMarkers() {
      const p = this.top("UIStorage");
      const arr = p && getProp(p.value, "RedDotArray");
      let n = 0;
      for (const d of (arr && arr.value.array) || []) {
        const s = getProp(d, "DotState");
        if (s.value === "ESBUIRedDotState_New") { s.value = "ESBUIRedDotState_Dirty"; n++; }
      }
      return n;
    }
    newMarkers() {
      const p = this.top("UIStorage");
      const arr = p && getProp(p.value, "RedDotArray");
      return ((arr && arr.value.array) || []).filter((d) => getProp(d, "DotState").value === "ESBUIRedDotState_New").length;
    }
    /** Experience toward Eve's level ("SkillPoint" rewards): every level gained gives one skill point. */
    addExp(n) {
      const pl = this.player;
      const exp = pl && getProp(pl, "SPExp"), lvl = pl && getProp(pl, "SPLevel"), sp = pl && getProp(pl, "SP");
      if (!exp || !lvl || !sp) return 0;
      const table = this.game.spExp || [];
      exp.value += n;
      let ups = 0;
      while (lvl.value < table.length && exp.value >= table[lvl.value]) { exp.value -= table[lvl.value]; lvl.value++; sp.value++; ups++; }
      return ups;
    }

    /** Hand out a quest's reward the way finishing it does. */
    giveQuestReward(quest, items) {
      const rew = (this.game.questRewards || {})[quest];
      if (!rew || !items) return 0;
      const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.SBModel;
      const inv = new M.Inventory(this.save, items);
      for (const [a, n] of rew) {
        if (a === "SkillPoint") { this.addExp(n); continue; }
        const canon = Object.keys(items).find((k) => k.toLowerCase() === a.toLowerCase());
        if (!canon) continue;
        inv.setCount(canon, inv.count(canon) + n);
        this.fireItem(canon, n);
      }
      return rew.length;
    }

    /** The step (task group index) a quest in progress is at, or -1. */
    questStep(alias) {
      const q = this.questLists().progress.find((e) => getProp(e, "QuestAlias").value === alias);
      if (!q) return -1;
      return getProp(q, "QuestTaskGroupList").value.array.findIndex((g) => /Progress/.test(String(getProp(g, "TaskGroupState").value)));
    }

    // ---------------------------------------------------------------- wardrobe (PlayerActor.Equipment, slot = ESBEquipType)
    equipmentMap() { const p = this.player && getProp(this.player, "Equipment"); return p ? p.value.map : null; }
    /** slot -> item alias */
    equipped() {
      const out = {};
      for (const [slot, v] of this.equipmentMap() || []) out[Number(slot)] = getProp(v, "ItemAlias").value;
      return out;
    }
    /** Wear an owned item in a slot: the slot gets a copy of the item's instance, like the game does. */
    equip(slot, alias, items) {
      const map = this.equipmentMap();
      if (!map) throw new G.GvasError("This save has no equipment.");
      const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.SBModel;
      const inv = new M.Inventory(this.save, items);
      const entry = inv.entries(alias)[0];
      if (!entry) throw new G.GvasError(`${(items[alias] || {}).name || alias} isn't in the inventory.`);
      const at = map.findIndex(([k]) => Number(k) === Number(slot));
      if (at >= 0) {
        const old = getProp(map[at][1], "ItemAlias").value;
        const stillWorn = map.some(([k, v], i) => i !== at && getProp(v, "ItemAlias").value.toLowerCase() === old.toLowerCase());
        if (!stillWorn) for (const e of inv.entries(old)) setBool(getProp(inv.instance(e), "Equiped"), false);
      }
      const inst = inv.instance(entry);
      setBool(getProp(inst, "Equiped"), true);
      const copy = structuredClone(inst);
      if (at >= 0) map[at][1] = copy; else map.push([Number(slot), copy]);
    }

    // ---------------------------------------------------------------- item levels (Exospines go 1 to 3: SBSetBodySuitLevel)
    itemLevel(alias, items) {
      const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.SBModel;
      const inv = new M.Inventory(this.save, items);
      const e = inv.entries(alias)[0];
      return e ? getProp(inv.instance(e), "StatLevel").value : 0;
    }
    /** Set an item's level everywhere it's stored (inventory and what Eve wears), firing the level-up events. */
    setItemLevel(alias, level, items) {
      const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.SBModel;
      const inv = new M.Inventory(this.save, items);
      const entries = inv.entries(alias);
      if (!entries.length) throw new G.GvasError(`${(items[alias] || {}).name || alias} isn't in the inventory.`);
      const before = getProp(inv.instance(entries[0]), "StatLevel").value;
      for (const e of entries) getProp(inv.instance(e), "StatLevel").value = level;
      for (const [, v] of this.equipmentMap() || []) {
        if (getProp(v, "ItemAlias").value.toLowerCase() === alias.toLowerCase()) getProp(v, "StatLevel").value = level;
      }
      for (let l = before + 1; l <= level; l++) this.fire("LevelUp/Item", { ItemAlias: alias, LevelValue: l });
      return before;
    }

    // ---------------------------------------------------------------- shop relationship levels (SBShopHistory.FriendShip)
    friendshipMap() { const p = this.top("SBShopHistory"); const m = p && getProp(p.value, "FriendShip"); return m ? m.value.map : null; }
    shopLevel(key) {
      const e = (this.friendshipMap() || []).find(([k]) => k === key);
      return e ? getProp(e[1], "FriendShipLevel").value : 0;
    }
    /** Raise a shop's level: its total friendship reaches the level's threshold and the level-up events fire. */
    setShopLevel(shop, level) {
      const map = this.friendshipMap();
      if (!map || !map.length) throw new G.GvasError("This save has no shop history yet.");
      let e = map.find(([k]) => k === shop.key);
      if (!e) {
        const s = structuredClone(map[0][1]);
        getProp(s, "TotalFriendShip").value = f32(0);
        getProp(s, "FriendShipLevel").value = 1;
        e = [shop.key, s];
        map.push(e);
      }
      const lv = getProp(e[1], "FriendShipLevel");
      const total = getProp(e[1], "TotalFriendShip");
      const before = lv.value;
      if (level <= before) return;
      total.value = f32(Math.max(total.value.f32 || 0, shop.levels.slice(0, level - 1).reduce((a, b) => a + b, 0)));
      lv.value = level;
      for (let l = before + 1; l <= level; l++) this.fire("LevelUp/FriendShip", { ShopTag: shop.tag, LevelValue: l });
    }

    // ---------------------------------------------------------------- camp turntable music
    music() { const e = this.mapEntry("DataMap_FString", "TurntableSoundAlias"); return e ? e[1] : null; }
    setMusic(key) { const e = this.mapEntry("DataMap_FString", "TurntableSoundAlias"); if (e) e[1] = key; }
    /** Unlock a track the way the game does: its music bundle item, or the event achievement it waits for. */
    unlockTrack(track, items) {
      if (!track.need) return;
      const [kind, value] = track.need;
      if (kind === "event") this.completeAch(value);
      else if (kind === "item") {
        const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.SBModel;
        const inv = new M.Inventory(this.save, items);
        if (!inv.count(value)) { inv.setCount(value, 1); this.fireItem(value, 1); }
      }
    }

    // ---------------------------------------------------------------- tutorial hints (SBHint.CompleteHintList)
    hintList() { const p = this.top("SBHint"); const l = p && getProp(p.value, "CompleteHintList"); return l ? l.value.array : null; }
    completeHints(all) {
      const l = this.hintList();
      if (!l) return 0;
      const have = new Set(l);
      let n = 0;
      for (const h of all) if (!have.has(h)) { l.push(h); n++; }
      return n;
    }

    // ---------------------------------------------------------------- New Game+ flag (experimental)
    get newGamePlus() { const e = this.mapEntry("DataMap_int32", "NewGamePlusPlayCount"); return e ? e[1] : 0; }
    setNewGamePlus(on) {
      const e = this.mapEntry("DataMap_int32", "NewGamePlusPlayCount");
      if (!e) throw new G.GvasError("This save has no New Game+ counter.");
      // only the counter: the game's IsNewGamePlus conditions read it. (The "IsNewGamePlus" achievement means a
      // finished New Game+ run and feeds a trophy, so it's left alone.)
      e[1] = on ? Math.max(1, e[1]) : 0;
    }

    /** Fire the pickup events the game missed for items that are in the inventory (added by another tool). */
    registerOwnedItems(items) {
      const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.SBModel;
      const inv = new M.Inventory(this.save, items);
      let n = 0;
      for (const [alias, count] of Object.entries(inv.totals())) {
        if (count > 0 && this.missingPickups(alias).length) { this.fireItem(alias, count); n++; }
      }
      return n;
    }
    shopHistory() { const p = this.top("SBShopHistory"); const m = p && getProp(p.value, "Purchase"); return m ? m.value.map : null; }
    restockShops() { const m = this.shopHistory(); const n = m ? m.length : 0; if (m) m.length = 0; return n; }
    /** Experimental: put Eve back at the camp she last rested at. */
    unstuck() {
      const pl = this.player;
      const from = pl && getProp(pl, "CampInteractActorLocation");
      const to = pl && getProp(pl, "ActorLocation");
      if (!from || !to) throw new G.GvasError("This save doesn't remember a camp to go back to.");
      to.value = { st: to.value.st, props: null, raw: new Uint8Array(from.value.raw) };
      const r1 = getProp(pl, "CampInteractActorRotation");
      const r2 = getProp(pl, "ActorRotation");
      if (r1 && r2) r2.value = { st: r2.value.st, props: null, raw: new Uint8Array(r1.value.raw) };
    }

    /** Where Eve is: { map, loc: [x, y, z] } (map = the world's persistent level, e.g. "E04" = Xion). */
    evePosition() {
      const p = this.player && getProp(this.player, "ActorLocation");
      const m = this.mapEntry("DataMap_FString", "MapName");
      if (!p || !p.value.raw) return null;
      const d = new DataView(p.value.raw.buffer, p.value.raw.byteOffset, 12);
      return { map: m ? m[1] : null, loc: [0, 1, 2].map((i) => d.getFloat32(i * 4, true)) };
    }
    /** Teleport Eve (the developers' SBWarpCamp / SBWarpPosition): position, facing and world. */
    warp(map, loc, yaw) {
      const pl = this.player;
      const set = (name, xyz) => {
        const p = pl && getProp(pl, name);
        if (!p) throw new G.GvasError("This save has no position for Eve.");
        const raw = new Uint8Array(12);
        const d = new DataView(raw.buffer);
        xyz.forEach((v, i) => d.setFloat32(i * 4, v, true));
        p.value = { st: p.value.st, props: null, raw };
      };
      set("ActorLocation", loc);
      if (yaw !== undefined && yaw !== null) set("ActorRotation", [0, yaw, 0]);
      const m = this.mapEntry("DataMap_FString", "MapName");
      if (m && map) m[1] = map;
    }
  }

  /**
   * Apply progress changes to a parsed save. Returns report lines.
   * changes: { difficulty, levels: {index: n}, learn: [], forget: [], camps: [], questsDone: [], questsReset: [],
   *            track, achievements: {alias: goal}, clearMarkers, restock, unstuck, finished }
   */
  function applyProgress(save, game, c) {
    const P = new Progress(save, game);
    const report = [];
    if (c.difficulty !== undefined && c.difficulty !== null) {
      const before = P.difficulty;
      P.difficulty = c.difficulty;
      report.push({ name: "Difficulty", before, after: c.difficulty });
    }
    for (const [i, n] of Object.entries(c.levels || {})) {
      const before = P.level(Number(i));
      P.setLevel(Number(i), n);
      const info = (game.levels || []).find((l) => l.index === Number(i));
      if (info && n > before) P.fireLevel(info.key, before, n);
      report.push({ name: `Upgrade level ${i}`, before, after: n });
    }
    for (const a of c.forget || []) P.forget(a);
    for (const a of c.learn || []) if (P.learn(a)) P.fireSkill(a);
    if ((c.learn || []).length || (c.forget || []).length) report.push({ name: "Skills", before: null, after: `+${(c.learn || []).length} −${(c.forget || []).length}` });
    let camps = 0;
    for (const a of c.camps || []) camps += P.activateCamp(a) ? 1 : 0;
    if ((c.camps || []).length) report.push({ name: "Camps activated", before: null, after: (c.camps || []).length });
    for (const a of c.questsReset || []) P.resetQuest(a);
    for (const a of c.questsDone || []) if (P.completeQuest(a)) P.giveQuestReward(a, c.items);
    if (c.track !== undefined && c.track !== null) P.track(c.track || null);
    for (const [a, goal] of Object.entries(c.achievements || {})) P.completeAch(a, goal);
    if (Object.keys(c.achievements || {}).length) report.push({ name: "Unlocked", before: null, after: Object.keys(c.achievements).length });
    if (c.clearMarkers) report.push({ name: "New markers cleared", before: null, after: P.clearNewMarkers() });
    if (c.restock) report.push({ name: "Shops restocked", before: null, after: P.restockShops() });
    if (c.unstuck) { P.unstuck(); report.push({ name: "Eve moved to her camp", before: null, after: 1 }); }
    if (c.warp) { P.warp(c.warp.map, c.warp.loc, c.warp.yaw); report.push({ name: "Eve teleported", before: null, after: c.warp.label || 1 }); }
    for (const x of c.people || []) {
      if (P.setNpc(x.zone, x.id, x.change)) report.push({ name: `${x.label || "Character"}: ${x.change.forget ? "forgotten" : x.change.here ? "brought back" : x.change.gone ? "sent away" : "moved"}`, before: null, after: 1 });
    }
    if (c.reviveZones && c.reviveZones.length) report.push({ name: "Enemies revived", before: null, after: P.reviveEnemies(c.reviveZones) });
    if (c.finished) report.push({ name: "Endings marked as seen", before: null, after: P.markFinished() });
    if (c.registerItems) report.push({ name: "Items registered", before: null, after: P.registerOwnedItems(c.items) });
    for (const [key, level] of Object.entries(c.shops || {})) {
      const shop = (game.shops || []).find((x) => x.key === key);
      if (shop) P.setShopLevel(shop, level);
    }
    for (const key of c.unlockTracks || []) {
      const t = (game.music || []).find((x) => x.key === key);
      if (t) P.unlockTrack(t, c.items);
    }
    if (c.music) P.setMusic(c.music);
    if (c.hints) report.push({ name: "Tutorial hints skipped", before: null, after: P.completeHints(game.hints || []) });
    if (c.newGamePlus !== undefined && c.newGamePlus !== null) P.setNewGamePlus(!!c.newGamePlus);
    P.checkSkillCounts();
    return report;
  }

  const api = { Progress, applyProgress, ENDINGS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SBProgress = api;
})(typeof window !== "undefined" ? window : globalThis);
