/*
 * Stellar Blade: C2 - chapter select
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The game's developer tools move a save to a story point by replaying GamePlayProgressRecordTable (what
 * each quest step changes in the world) and a few story commands. The released game has those tools
 * switched off, so this does the same directly on the save:
 *   - GamePlayProgressRecordData: the game's own list of every progress record with a "done" flag
 *   - world objects (DataMap_SBEnv ... ZoneEnvStorageList) and triggers (... ZoneTriggerStorageList)
 *   - internal achievements, quests (with their task groups), story items, and where Eve stands
 * Only forward jumps are possible. Skills, upgrades and gear are left alone.
 */
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const G = node ? require("./gvas.js") : root.SBGvas;
  const PR = node ? require("./progress.js") : root.SBProgress;
  const { getProp } = G;

  const TICKS_AT_1970 = 621355968000000000n;
  const nowTicks = () => BigInt(Date.now()) * 10000n + TICKS_AT_1970;
  const setBool = (p, on) => { if (p) { p.value = on ? 1 : 0; p.extra.bool = on ? 1 : 0; } };
  const GROUP_STATE = { done: "TaskGroup_Complete", progress: "TaskGroup_Progress", none: "TaskGroup_None" };
  /** Set a field if this save's layout has it (layouts differ slightly between game versions). */
  const put = (s, name, v) => { const p = getProp(s, name); if (p) p.value = v; return p; };

  // ---------------------------------------------------------------- progress records in the save
  function recordTable(save) {
    const top = save.props.find((p) => p.name === "GamePlayProgressRecordData");
    const m = top && getProp(top.value, "ProgressRecordGroup");
    if (!m || !m.value.map) throw new G.GvasError("This save has no story progress records.");
    return m.value.map;
  }

  /** Match the save's record entries to the table's records (same group, type and name, in order). */
  function indexRecords(groups) {
    const lists = new Map();
    for (const [g, gv] of groups) {
      for (const [mt, lv] of getProp(gv, "RecordTaskGroupMap").value.map) {
        for (const e of getProp(lv, "TaskDataList").value.array) {
          const k = `${g}|${mt}|${getProp(e, "DataAlias").value}`;
          lists.set(k, [...(lists.get(k) || []), e]);
        }
      }
    }
    return lists;
  }

  function addRecordEntry(groups, g, mt, alias) {
    const anyGroup = groups[0] && groups[0][1];
    let ge = groups.find(([n]) => n === g);
    if (!ge) {
      const s = structuredClone(anyGroup);
      getProp(s, "RecordGroupName").value = g;
      getProp(s, "RecordTaskGroupMap").value.map = [];
      ge = [g, s];
      groups.push(ge);
    }
    const tmap = getProp(ge[1], "RecordTaskGroupMap").value.map;
    const anyList = groups.flatMap(([, s]) => getProp(s, "RecordTaskGroupMap").value.map.map(([, l]) => l))[0];
    let le = tmap.find(([k]) => k === mt);
    if (!le) {
      const l = structuredClone(anyList);
      getProp(l, "TaskDataList").value.array = [];
      le = [mt, l];
      tmap.push(le);
    }
    const arr = getProp(le[1], "TaskDataList").value.array;
    const anyEntry = groups.flatMap(([, s]) => getProp(s, "RecordTaskGroupMap").value.map.flatMap(([, l]) => getProp(l, "TaskDataList").value.array))[0];
    const e = structuredClone(anyEntry);
    getProp(e, "DataAlias").value = alias;
    setBool(getProp(e, "bSuccessTask"), false);
    arr.push(e);
    return e;
  }

  // ---------------------------------------------------------------- quests
  function questTemplates(P) {
    const L = P.questLists();
    for (const q of [...L.progress, ...L.done]) {
      for (const g of getProp(q, "QuestTaskGroupList").value.array) {
        const infos = getProp(g, "TaskInfoList").value.array;
        if (infos.length && getProp(infos[0], "TaskList").value.array.length) {
          return { quest: q, group: g, info: infos[0], task: getProp(infos[0], "TaskList").value.array[0] };
        }
      }
    }
    return null;
  }

  function makeTask(tpl, alias, done) {
    const t = structuredClone(tpl.task);
    put(t, "TaskAlias", alias);
    put(t, "CurrentValue", done ? 1 : 0);
    put(t, "TaskState", done ? "ESBQuestTaskState_Complete" : "ESBQuestTaskState_Progress");
    for (const n of ["CustomIntMap", "CustomFloatMap"]) { const p = getProp(t, n); if (p) p.value.map = []; }
    const c = getProp(t, "ChildTaskAliasList");
    if (c) c.value.array = [];
    return t;
  }

  /** Fill one task group of a quest entry for the given state ("done" | "progress" | "none"). */
  function setGroup(tpl, g, containers, st, path) {
    put(g, "TaskGroupState", GROUP_STATE[st]);
    const infos = getProp(g, "TaskInfoList");
    const all = getProp(g, "AllChildTaskList");
    if (st === "none") {
      if (infos) infos.value.array = [];
      if (all) all.value.map = [];
    } else {
      if (infos) {
        infos.value.array = containers.map((tasks) => {
          const info = structuredClone(tpl.info);
          getProp(info, "TaskList").value.array = tasks.map((t) => makeTask(tpl, t, st === "done"));
          return info;
        });
      }
      if (all) all.value.map = containers.flat().map((t) => [t, makeTask(tpl, t, st === "done")]);
    }
    const [pi, pn] = st === "done" ? [1, 0] : st === "progress" ? [path.path || 0, path.node || 0] : [0, 0];
    put(g, "PathIndex", pi);
    put(g, "PathNodeIndex", pn);
  }

  function buildQuest(tpl, alias, layout, stateOf, path) {
    const q = structuredClone(tpl.quest);
    getProp(q, "QuestAlias").value = alias;
    getProp(q, "QuestState").value = 1;
    getProp(q, "QuestTaskGroupList").value.array = layout.map(([g, containers], i) => {
      const e = structuredClone(tpl.group);
      getProp(e, "TaskGroupAlias").value = g;
      const tv = getProp(e, "TaskValueMap");
      if (tv) tv.value.map = [];
      setGroup(tpl, e, containers, stateOf(g, i), path);
      return e;
    });
    for (const n of ["PathIndex", "PathNodeIndex"]) { const p = getProp(q, n); if (p) p.value = 0; }
    const ts = getProp(q, "LastUpdateTimestamp");
    if (ts) ts.value = nowTicks();
    return q;
  }

  /**
   * Put a side quest or bounty request at a step (the developers' SBAcquireQuest + SBQuestCompleteTaskGroup):
   * the steps before it are done, it's in progress, and if the quest hadn't started, its "acquired" event fires.
   * layout = [[taskGroupAlias, [[taskAlias, ...], ...]], ...] in order.
   */
  function setQuestStep(save, game, alias, layout, step) {
    const P = new PR.Progress(save, game);
    const tpl = questTemplates(P);
    if (!tpl) throw new G.GvasError("This save has no quest to copy the format from yet.");
    const before = P.questStates()[alias] || "none";
    P.removeQuest(alias);
    P.questLists().progress.push(buildQuest(tpl, alias, layout, (g, i) => (i < step ? "done" : i === step ? "progress" : "none"), { path: 0, node: 0 }));
    if (before === "none") P.fireQuest(alias, false);
    return before;
  }

  // ---------------------------------------------------------------- the jump
  /**
   * Move a parsed save forward to a chapter point. Returns a report object.
   * data = SB_CHAPTERS, items = SB_ITEMS (for story items), opts = { place: true }
   */
  function applyChapter(save, key, data, game, items, opts = {}) {
    const ch = data.chapters.find((c) => c.k === key);
    if (!ch) throw new G.GvasError(`Unknown chapter ${key}`);
    const P = new PR.Progress(save, game);
    const groups = recordTable(save);
    const lists = indexRecords(groups);
    const target = data.records.findIndex((r) => r.k === ch.rec);

    // which table records are done in the save (n-th occurrence of the same group/type/name)
    const seen = new Map();
    const entries = data.records.map((r) => {
      const k = `${r.g}|${r.mt}|${r.a}`;
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      return (lists.get(k) || [])[n] || null;
    });
    const isDone = (e) => !!(e && getProp(e, "bSuccessTask").value);
    let current = -1;
    entries.forEach((e, i) => { if (isDone(e)) current = i; });
    if (target <= current) {
      throw new G.GvasError("Your save is already at or past this point of the story. Chapter select only moves forward.");
    }

    const report = { chapter: ch.k, from: current >= 0 ? data.records[current].k : null, to: ch.rec, records: 0,
      objects: 0, objectsCreated: 0, objectsSkipped: [], triggers: 0, achievements: 0, quests: [], items: 0, placed: null };
    const tpl = questTemplates(P);
    const env = P.envIndex();
    const envInfo = (a) => {
      const i = data.env[a];
      if (!i) return null;
      return { ...i, sameType: Object.keys(data.env).filter((b) => data.env[b].type === i.type && env.has(b)) };
    };
    const setObject = (a, tag, act) => {
      const had = env.has(a);
      const info = envInfo(a);
      const ok = P.setEnv(a, tag, act, info, info && data.envTags[info.type]);
      if (ok) { report.objects++; if (!had) report.objectsCreated++; if (tag) P.fireEnv(a, tag); } else report.objectsSkipped.push(a);
    };

    // triggers
    const trigIndex = new Map();
    const triggerList = (z) => { const l = getProp(z, "ZoneTriggerStorageList"); return l ? l.value.array : null; };
    for (const z of P.zones()) for (const t of triggerList(z) || []) trigIndex.set(getProp(t, "TriggerAlias").value, t);
    const fireTrigger = (a, act) => {
      let t = trigIndex.get(a);
      const info = data.triggers[a];
      if (!t && info) {
        const zone = P.zone(info.zone);
        const any = [...trigIndex.values()][0];
        if (!zone || !any || !triggerList(zone)) return;
        t = structuredClone(any);
        getProp(t, "TriggerAlias").value = a;
        getProp(t, "TriggerActivate").value = info.act;
        getProp(t, "SaveType").value = info.save;
        triggerList(zone).push(t);
        trigIndex.set(a, t);
      }
      if (!t) return;
      getProp(t, "DoingCount").value = 0; // one-shot triggers count down to 0 once they've fired
      if (act) getProp(t, "TriggerActivate").value = act;
      report.triggers++;
    };

    // quests
    const layoutOf = (q) => data.quests[q] || null;
    const questOfGroup = (g) => Object.keys(data.quests).find((q) => data.quests[q].some(([a]) => a === g));
    const lists_ = () => P.questLists();
    const findQuest = (q) => { const L = lists_(); return [...L.progress, ...L.done].find((e) => getProp(e, "QuestAlias").value === q); };
    const completeQuest = (q) => {
      const L = lists_();
      if (L.done.some((e) => getProp(e, "QuestAlias").value === q)) return;
      const layout = layoutOf(q);
      if (layout && tpl) {
        P.removeQuest(q);
        const e = buildQuest(tpl, q, layout, () => "done", {});
        getProp(e, "QuestState").value = 3;
        L.done.push(e);
        P.fireQuest(q, true);
      } else P.completeQuest(q);
      P.giveQuestReward(q, items);
      report.quests.push(`${q} done`);
    };
    const acquireQuest = (q) => {
      if (findQuest(q) || !tpl || !layoutOf(q)) return;
      lists_().progress.push(buildQuest(tpl, q, layoutOf(q), (g, i) => (i === 0 ? "progress" : "none"), {}));
      P.fireQuest(q, false);
      report.quests.push(`${q} started`);
    };
    const completeGroup = (g) => {
      const q = questOfGroup(g);
      if (!q || !tpl) return;
      acquireQuest(q);
      const e = findQuest(q);
      const layout = layoutOf(q);
      const list = getProp(e, "QuestTaskGroupList").value.array;
      const i = layout.findIndex(([a]) => a === g);
      list.forEach((ge, j) => {
        if (j <= i && getProp(ge, "TaskGroupState").value !== GROUP_STATE.done) setGroup(tpl, ge, layout[j][1], "done", {});
        if (j === i + 1 && getProp(ge, "TaskGroupState").value === GROUP_STATE.none) setGroup(tpl, ge, layout[j][1], "progress", {});
      });
    };

    // story items through the inventory model
    const M = node ? require("./model.js") : root.SBModel;
    const inv = items ? new M.Inventory(save, items) : null;
    const giveItem = (a, n) => {
      const canon = inv && Object.keys(items).find((k) => k.toLowerCase() === a.toLowerCase());
      if (!canon) return;
      inv.setCount(canon, Math.max(0, inv.count(canon) + n));
      if (n > 0) P.fireItem(canon, n);
      report.items++;
    };

    let place = null;
    for (let i = current + 1; i <= target; i++) {
      const r = data.records[i];
      let e = entries[i];
      if (!e) e = addRecordEntry(groups, r.g, r.mt, r.a);
      setBool(getProp(e, "bSuccessTask"), true);
      report.records++;
      if (r.t === "env" && (r.s || r.e)) setObject(r.a, r.s, r.e);
      else if (r.t === "ach") { P.completeAch(r.a, data.achGoal[r.a] || 1); report.achievements++; }
      else if ((r.t === "enter" || r.t === "leave") && data.triggers[r.a]) { fireTrigger(r.a, r.e); if (r.t === "enter") P.fireTrigger(r.a); }
      else if (r.t === "kill") P.fireKill(r.a);
      for (const [v, a, b] of r.c || []) {
        if (v.startsWith("sbplayercompleteachievement")) { P.completeAch(a, data.achGoal[a] || 1); report.achievements++; }
        else if (v === "sbacquirequest") acquireQuest(a);
        else if (v === "sbcompletequest") completeQuest(a);
        else if (v === "sbquestcompletetaskgroup") completeGroup(a);
        else if (v === "sbquestcompletetask") completeGroup(a.replace(/_T\d+$/, ""));
        else if (v === "sbenvstate") setObject(a, b, null);
        else if (v === "sbplayeritembucketitemadd") giveItem(a, Number(b) || 1);
        else if (v === "sbplayeritembucketitemremove") giveItem(a, -(Number(b) || 1));
        else if (v === "sbwarpcamp") place = { camp: a };
      }
      if (r.at) place = r.at;
    }

    P.checkSkillCounts();

    // main story quests: finished ones, and the one in progress at this point
    for (const q of ch.done) completeQuest(q);
    const layout = layoutOf(ch.quest);
    if (layout && tpl) {
      const targetGroup = data.records[target].g;
      const gi = Math.max(0, layout.findIndex(([a]) => a === targetGroup));
      P.removeQuest(ch.quest);
      lists_().progress.push(buildQuest(tpl, ch.quest, layout, (g, i) => (i < gi ? "done" : i === gi ? "progress" : "none"), { path: ch.path, node: ch.node }));
      P.track(ch.quest);
      report.quests.push(`${ch.quest} in progress`);
    }

    // where Eve starts
    if (opts.place !== false && place) {
      const spot = (place.spawn && data.places[place.spawn]) || (place.camp && data.places[place.camp]);
      if (spot) {
        const pl = P.player;
        const vec = (name, xyz) => {
          const p = getProp(pl, name);
          if (!p) return;
          const raw = new Uint8Array(12);
          const d = new DataView(raw.buffer);
          xyz.forEach((v, i) => d.setFloat32(i * 4, v, true));
          p.value = { st: p.value.st, props: null, raw };
        };
        vec("ActorLocation", spot.loc);
        vec("ActorRotation", spot.rot);
        const mapName = P.mapEntry("DataMap_FString", "MapName");
        if (mapName && spot.map) mapName[1] = spot.map;
        report.placed = { at: place.spawn || place.camp, map: spot.map };
      }
    }
    return report;
  }

  /** Where the save is in the story: index of the last finished record, and the chapter at or before it. */
  function currentPoint(save, data) {
    const lists = indexRecords(recordTable(save));
    const seen = new Map();
    let current = -1;
    data.records.forEach((r, i) => {
      const k = `${r.g}|${r.mt}|${r.a}`;
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      const e = (lists.get(k) || [])[n];
      if (e && getProp(e, "bSuccessTask").value) current = i;
    });
    let best = null;
    for (const c of data.chapters) if (c.i <= current && (!best || c.i >= best.i)) best = c;
    return { record: current, chapter: best ? best.k : null };
  }

  const api = { applyChapter, currentPoint, setQuestStep };
  if (node) module.exports = api;
  else root.SBChapter = api;
})(typeof window !== "undefined" ? window : globalThis);
