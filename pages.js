/*
 * Stellar Blade: C2 - progress pages: wardrobe, upgrades, skills, story, quests, camps, shops, album, trophies, tools
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Each page draws the save as a picture: blue is what's in the save, gold is what the download changes,
 * dashed outlines and "+" are things you can add. Details are in tooltips (hover, keyboard focus or long-press).
 */
(function () {
  "use strict";

  const { el, svg, icon, fmt, ring, pips, seg, toast } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS, CAT } = A;
  const render = () => A.render();
  const act = (fn) => () => { fn(); render(); };
  const empty = (ic, text) => el("div", { class: "empty-state" }, icon(ic), el("span", { text }));
  const acts = (...kids) => el("div", { class: "block-acts" }, ...kids.filter(Boolean));
  const byName = (a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name);

  /** A small toggle with an icon and a short label. */
  function toggle(o) {
    return el("button", {
      type: "button", class: "toggle" + (o.on ? " on" : ""), "aria-pressed": String(!!o.on), tip: o.tip, "data-act": o.act,
      onclick: act(o.onclick),
    }, icon(o.on && o.onIcon ? o.onIcon : o.icon), el("span", { text: o.label }));
  }

  // ================================================================== wardrobe
  const WARDROBE = [["Eve", ["Eve"]], ["Companions", ["Lily", "Adam", "Drone"]], ["Combat", ["Gear"]]];
  const SLOT_CAT = { NanoSuit: "outfit", Gear: "gear", ExoSpine: "exospine" }; // the rest are cosmetics

  function wardrobe(page) {
    if (!S.cur.hasEquipment) { page.append(empty("hanger", "This save has no equipment")); return; }
    for (const [title, who] of WARDROBE) {
      const slots = A.SLOTS.filter((s) => who.includes(s.who));
      const sec = A.section(title);
      sec.append(el("div", { class: "slots" }, ...slots.map(slotCard)));
      const open = slots.find((s) => s.slot === S.prog.slot);
      if (open) sec.append(picker(open));
      page.append(sec);
    }
  }

  function slotCard(s) {
    const worn = A.wornNow(s.slot);
    const changed = s.slot in S.prog.equip;
    const open = A.slotOpen(s);
    const picked = S.prog.slot === s.slot;
    const lines = [s.n, worn ? A.nameOf(worn) : "Empty"];
    if (!open) lines.push(s.needLevel[0] === 5 ? `Needs Gear slots level ${s.needLevel[1]} (Upgrades)` : "Needs the Exospine slot upgrade (Upgrades)");
    return el("button", {
      type: "button", class: `slot${changed ? " new" : ""}${picked ? " open" : ""}${worn ? "" : " empty"}${open ? "" : " locked"}`,
      "data-slot": String(s.slot), "aria-expanded": open ? String(picked) : null, "data-tip": lines.join("\n"),
      "aria-label": `${s.n}: ${worn ? A.nameOf(worn) : "empty"}`,
      onclick: () => { if (!open) { A.show("upgrades"); return; } S.prog.slot = picked ? null : s.slot; render(); },
    }, worn && ITEMS[worn] ? A.art(worn, true) : el("span", { class: "art art-big" }, icon(s.icon, "art-glyph")),
    el("span", { class: "slot-kind" }, icon(open ? s.icon : "lock"), el("span", { text: s.n })),
    el("span", { class: "slot-item", text: worn ? A.nameOf(worn) : "Empty" }),
    open ? el("span", { class: "slot-chev" }, icon("chevronDown")) : null);
  }

  function picker(s) {
    const worn = A.wornNow(s.slot);
    const saved = S.cur.equipped[s.slot] || null;
    const grid = el("div", { class: "tiles picker-tiles" });
    for (const a of A.slotItems(s).sort(byName)) {
      const st = a === worn ? (a === saved ? "owned" : "added") : "option";
      grid.append(el("button", {
        type: "button", class: "tile pick", "data-alias": a, "data-state": st, "aria-pressed": String(a === worn),
        "data-tip": [ITEMS[a].name, a === saved ? "Wearing now" : null, ITEMS[a].gate || null].filter(Boolean).join("\n"), "aria-label": ITEMS[a].name,
        onclick: () => { if (a === saved) delete S.prog.equip[s.slot]; else S.prog.equip[s.slot] = a; render(); },
      }, A.art(a), el("span", { class: "tile-name", text: ITEMS[a].name }),
      a === worn ? el("span", { class: "tile-badge" }, icon("check")) : null,
      ITEMS[a].gate ? el("span", { class: "tile-flag" }, icon("ticket")) : null));
    }
    const cat = SLOT_CAT[s.cat] || "cosmetic";
    const more = Object.keys(ITEMS).filter((a) => (GAME.ev.itemCat[a] || [])[0] === s.cat && A.canAdd(a) && A.value(a) === 0).length;
    if (more) {
      grid.append(el("button", { type: "button", class: "tile", "data-state": "missing", tip: `${fmt(more)} more in ${CAT[cat].label}`, onclick: () => A.show(cat) },
        el("span", { class: "art" }, icon(CAT[cat].icon, "art-glyph")), el("span", { class: "tile-name", text: `${fmt(more)} more` }),
        el("span", { class: "tile-badge" }, icon("plus"))));
    }
    return el("div", { class: "picker" }, grid);
  }

  // ================================================================== upgrades & difficulty
  function upgrades(page) {
    const p = S.prog;
    const diffNow = p.difficulty !== null ? p.difficulty : S.cur.difficulty;
    const d = A.section("Difficulty");
    d.append(el("div", { class: "difficulty" }, ...A.DIFFICULTY.map(([v, name, ic]) => el("button", {
      type: "button", class: `diff-card d${v}${diffNow === v ? " on" : ""}${diffNow === v && p.difficulty !== null ? " new" : ""}`,
      "aria-pressed": String(diffNow === v), "data-act": `difficulty:${v}`,
      tip: v === 2 ? "Normally only offered when you start a new game" : null,
      onclick: act(() => { p.difficulty = v === S.cur.difficulty ? null : v; }),
    }, icon(ic), el("b", { text: name }), S.cur.difficulty === v ? el("span", { class: "now-dot", "aria-label": "in your save" }) : null))));
    page.append(d);

    const u = A.section("Upgrades", acts(
      el("button", { type: "button", class: "fill", "data-act": "levels:normal", tip: "Max for a normal playthrough",
        onclick: act(() => { for (const l of GAME.levels) A.setLevel(l.index, Math.max(A.levelNow(l.index), l.maxNormal)); }) }, icon("chevrons"), el("span", { text: "Max" })),
      el("button", { type: "button", class: "fill fill-ng", "data-act": "levels:max", tip: "Max everything, New Game+ levels included",
        onclick: act(() => { for (const l of GAME.levels) A.setLevel(l.index, l.max); }) }, icon("loop"), el("span", { text: "Max" }))));
    const list = el("div", { class: "levels" });
    for (const l of GAME.levels) {
      const n = A.levelNow(l.index), was = S.cur.levels[l.index] || 0;
      list.append(el("div", { class: "level" + (n !== was ? " new" : ""), "data-key": l.key },
        el("span", { class: "level-name", tip: l.stat, tabindex: "0" }, icon(A.LEVEL_ICON[l.index] || "chevrons"), el("b", { text: l.name })),
        pips({ n, was, max: l.max, normal: l.maxNormal, label: l.name, pick: (k) => { A.setLevel(l.index, k); render(); } }),
        el("span", { class: "level-num" }, n !== was ? el("s", { text: String(was) }) : null, el("b", { text: String(n) }), el("small", { text: `/${l.max}` }))));
    }
    u.append(list);
    page.append(u);
  }

  // ================================================================== skills: the tree as a graph
  const ROW_H = 64, NODE_H = 52;

  function spBox() {
    if (S.sp === null) return null;
    const now = S.pendingSp !== null ? S.pendingSp : S.sp;
    const set = (n) => { n = Math.max(0, Math.min(99999, n)); S.pendingSp = n === S.sp ? null : n; render(); };
    const input = el("input", {
      class: "sp-input" + (S.pendingSp !== null ? " new" : ""), inputmode: "numeric", autocomplete: "off",
      "aria-label": "Unspent skill points", "data-act": "sp-input", value: fmt(now),
    });
    input.addEventListener("change", () => {
      const n = A.parseCount(input.value);
      if (n === null) { input.classList.add("bad"); toast("Type a whole number of skill points.", true); return; }
      set(n);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    return el("div", { class: "sp" },
      el("span", { class: "sp-label", tip: "Unspent skill points", tabindex: "0" }, el("b", { text: "SP" })),
      S.pendingSp !== null ? el("s", { text: fmt(S.sp) }) : null,
      el("button", { type: "button", class: "step", "data-act": "sp:-1", tip: "−1", onclick: () => set(now - 1) }, icon("minus")),
      input,
      el("button", { type: "button", class: "step", "data-act": "sp:+1", tip: "+1", onclick: () => set(now + 1) }, icon("plus")),
      el("button", { type: "button", class: "chip-btn", "data-act": "sp:+10", onclick: () => set(now + 10) }, "+10"),
      el("button", { type: "button", class: "chip-btn", "data-act": "sp:+100", onclick: () => set(now + 100) }, "+100"));
  }

  function skills(page) {
    const all = Object.entries(GAME.skills);
    const tree = S.prog.skillTree;
    const inTree = all.filter(([, s]) => s.tree === tree);
    const learnAll = (list) => { let n = 0; for (const [a] of list) n += A.learnSkill(a); toast(n ? `Skills: +${n}` : "Nothing left to learn there"); };
    const left = (list) => list.filter(([a, s]) => !A.isLearned(a) && !A.skillLock(s)).length;
    page.append(el("div", { class: "skills-top" }, spBox(), acts(
      left(inTree) ? el("button", { type: "button", class: "fill", "data-act": "skills:tree", tip: `Learn every ${tree} skill`, onclick: act(() => learnAll(inTree)) }, icon("plus"), el("span", { text: fmt(left(inTree)) })) : null,
      left(all) ? el("button", { type: "button", class: "fill fill-ng", "data-act": "skills:all", tip: "Learn every skill in every tree", onclick: act(() => learnAll(all)) }, icon("tree"), el("span", { text: fmt(left(all)) })) : null)));
    page.append(seg(GAME.skillTrees.map((t) => ({
      key: t, label: t, act: `tree:${t}`,
      n: `${all.filter(([a, s]) => s.tree === t && A.isLearned(a)).length}/${all.filter(([, s]) => s.tree === t).length}`,
    })), tree, (t) => { S.prog.skillTree = t; render(); }, "Skill tree"));
    page.append(treeTools(tree, inTree));
    page.append(skillGraph(inTree, page.clientWidth || 900));
  }

  // story unlocks that keep skills locked, and the tree reset (the developers' SBRestoreSkillPoint)
  const LOCK_NAMES = { OpenMode_Burst: "Burst mode", OpenMode_Tachy: "Tachy mode", Ach_Drone_RailgunUpgrade: "Drone railgun",
    Ach_SkillCondition_Blink: "Blink", Ach_SkillUnlock_DashAttack: "Dash attack", Ach_SkillUnlock_DoubleJump: "Double jump", Ach_SkillUnlock_Blaze: "Blaze" };
  function treeTools(tree, inTree) {
    const row = el("div", { class: "tree-tools" });
    const locks = new Map();
    for (const [, s] of inTree) if (s.ach && !S.cur.achDone.has(s.ach)) locks.set(s.ach, (locks.get(s.ach) || 0) + 1);
    for (const [ach, n] of locks) {
      const on = S.prog.ach.has(ach);
      row.append(el("button", {
        type: "button", class: "lock-chip" + (on ? " on" : ""), "aria-pressed": String(on), "data-act": `unlock:${ach}`,
        tip: on ? "Unlocked when you download: click to undo"
          : `${GAME.skillLocks[ach] || "Unlocked later in the story"}. Click to unlock it now, so ${plural(n, "skill")} can be learned. ${A.EXP_TIP}`,
        onclick: act(() => { if (on) S.prog.ach.delete(ach); else S.prog.ach.set(ach, GAME.achGoal[ach] || 1); }),
      }, icon(on ? "check" : "lock"), el("span", { text: LOCK_NAMES[ach] || ach }), el("span", { class: "n", text: fmt(n) })));
    }
    if (locks.size) row.append(A.expFlag());
    const refund = A.treeRefund(tree);
    if (refund) {
      row.append(el("button", {
        type: "button", class: "toggle reset-tree", "data-act": "tree:reset",
        tip: `Forget the ${tree} skills you bought and get ${fmt(refund)} SP back`,
        onclick: act(() => { const r = A.resetTree(tree); toast(`${tree}: ${r.n} skills forgotten, ${fmt(r.refund)} SP back`); }),
      }, icon("reset"), el("span", { text: `${fmt(refund)} SP` })));
    }
    return row;
  }

  function skillGraph(list, avail) {
    list = list.slice().sort((x, y) => x[1].id - y[1].id);
    const here = new Set(list.map(([a]) => a));
    const reqs = (a) => GAME.skills[a].req.filter((r) => here.has(r));
    const depth = {};
    const d = (a, seen = new Set()) => {
      if (a in depth) return depth[a];
      if (seen.has(a)) return 0;
      seen.add(a);
      const r = reqs(a);
      return (depth[a] = r.length ? 1 + Math.max(...r.map((x) => d(x, seen))) : 0);
    };
    const cols = [];
    for (const [a] of list) (cols[d(a)] = cols[d(a)] || []).push(a);
    const rows = Math.max(...cols.map((c) => c.length));
    // columns share the page width; narrow screens scroll the tree sideways
    const COL_W = Math.max(150, Math.min(220, Math.floor((avail - 8 + 36) / cols.length)));
    const NODE_W = COL_W - 36;
    const pos = {};
    // each column is ordered by where its prerequisites sit, so lines cross as little as possible
    const bary = (a) => { const r = reqs(a); return r.length ? r.reduce((s, x) => s + pos[x].y, 0) / r.length : 0; };
    cols.forEach((col, ci) => {
      if (ci) col.sort((x, y) => bary(x) - bary(y) || GAME.skills[x].id - GAME.skills[y].id);
      col.forEach((a, i) => { pos[a] = { x: ci, y: i + (rows - col.length) / 2 }; });
    });
    const W = cols.length * COL_W - (COL_W - NODE_W), H = rows * ROW_H;
    const lines = svg("svg", { class: "skill-lines", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    for (const [b] of list) {
      for (const a of reqs(b)) {
        const x1 = pos[a].x * COL_W + NODE_W, y1 = pos[a].y * ROW_H + NODE_H / 2;
        const x2 = pos[b].x * COL_W, y2 = pos[b].y * ROW_H + NODE_H / 2;
        const mid = (x1 + x2) / 2;
        const on = A.isLearned(a) && A.isLearned(b);
        const fresh = on && (S.prog.learn.has(a) || S.prog.learn.has(b));
        lines.append(svg("path", {
          d: `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
          class: `edge${on ? " on" : ""}${fresh ? " new" : ""}${GAME.skills[b].or ? " or" : ""}`,
        }));
      }
    }
    const box = el("div", { class: "skill-graph" });
    box.style.width = `${W}px`;
    box.style.height = `${H}px`;
    box.append(lines);
    for (const [a, s] of list) {
      const n = skillNode(a, s);
      n.style.left = `${pos[a].x * COL_W}px`;
      n.style.top = `${pos[a].y * ROW_H}px`;
      n.style.width = `${NODE_W}px`;
      box.append(n);
    }
    return el("div", { class: "skill-scroll" }, box);
  }

  function skillNode(a, s) {
    const learned = A.isLearned(a);
    const added = S.prog.learn.has(a), removed = S.prog.forget.has(a);
    const lock = A.skillLock(s);
    const deps = learned ? A.dependents(a) : [];
    const st = added ? "added" : removed ? "removed" : learned ? "owned" : lock ? "locked" : "missing";
    const lines = [s.n, s.d];
    if (s.sp) lines.push(`${s.sp} SP`);
    if (s.ng) lines.push("New Game+ skill");
    if (lock) lines.push(`Locked: ${lock}`);
    if (deps.length && !added) lines.push(`Needed by ${GAME.skills[deps[0]].n}`);
    const node = el("button", {
      type: "button", class: "skill", "data-alias": a, "data-state": st, "data-tip": lines.filter(Boolean).join("\n"),
      "aria-label": `${s.n}: ${{ added: "learned after download", removed: "removed after download", owned: "learned", locked: "locked", missing: "not learned" }[st]}`,
      "aria-pressed": String(learned),
      onclick: () => {
        if (lock && !learned) { toast(`${s.n}: ${lock}`, true); return; }
        if (learned && deps.length && !added) { toast(`${s.n} is needed by ${GAME.skills[deps[0]].n}`, true); return; }
        if (learned) A.forgetSkill(a); else A.learnSkill(a);
        render();
      },
    }, el("span", { class: "skill-dot" }, icon({ added: "check", owned: "check", removed: "minus", locked: "lock", missing: "plus" }[st])),
    el("span", { class: "skill-name", text: s.n }),
    s.ng ? el("span", { class: "skill-ng" }, icon("loop")) : null);
    return node;
  }

  // ================================================================== story: chapter select as a timeline
  function chapters(page) {
    const p = S.prog;
    const now = S.cur.chapterNow;
    if (!now || now.record < 0) { page.append(empty("flag", "No story progress in this save")); return; }
    const list = A.CHAPTER_LIST;
    const idx = list.findIndex((c) => c.k === now.chapter);
    const target = p.chapter ? list.findIndex((c) => c.k === p.chapter) : -1;
    page.append(el("div", { class: "story-top" },
      toggle({ icon: "eyeOff", onIcon: "eye", label: "Spoilers", on: p.spoilers, act: "spoilers", tip: "Show the names of chapters you haven't reached", onclick: () => { p.spoilers = !p.spoilers; } }),
      toggle({ icon: "pin", label: "Move Eve", on: p.chapterPlace, act: "place", tip: "Put Eve at the chapter's starting point", onclick: () => { p.chapterPlace = !p.chapterPlace; } }),
      gearUp(p.chapter || now.chapter),
      A.flag("flask", `${A.EXP_TIP} Only moves forward. Skills, upgrades, gear and side quests stay as they are.`, "flag-exp")));

    const runs = [];
    list.forEach((c, i) => {
      const r = runs[runs.length - 1];
      if (r && r.quest === c.quest) r.items.push([c, i]); else runs.push({ quest: c.quest, qn: c.qn, items: [[c, i]] });
    });
    const line = el("ol", { class: "timeline" });
    const doneRuns = runs.filter((r) => r.items[r.items.length - 1][1] < idx);
    if (doneRuns.length) {
      const n = doneRuns.reduce((s, r) => s + r.items.length, 0);
      line.append(el("li", { class: "t-quest t-earlier" },
        el("button", { type: "button", class: "t-head", "aria-expanded": String(p.earlier), "data-act": "earlier", onclick: act(() => { p.earlier = !p.earlier; }) },
          el("span", { class: "t-dot done" }, icon("check")), el("b", { text: `${doneRuns.length} main quests` }), el("span", { class: "t-count", text: plural(n, "chapter") }),
          icon(p.earlier ? "chevronDown" : "chevronRight", "t-chev"))));
    }
    let qn = 0;
    for (const r of runs) {
      qn++;
      const finished = r.items[r.items.length - 1][1] < idx;
      if (finished && !p.earlier) continue;
      const first = r.items[0][1];
      const reached = first <= idx || p.spoilers;
      const li = el("li", { class: "t-quest" + (finished ? " finished" : "") },
        el("div", { class: "t-head" },
          el("span", { class: "t-dot" + (finished ? " done" : r.items.some(([, i]) => i === idx) ? " here" : "") }, icon(finished ? "check" : "flag")),
          el("b", { text: reached ? r.qn : `Main quest ${qn}` })));
      const ol = el("ol", { class: "t-chapters" });
      for (const [c, i] of r.items) {
        const st = i < idx ? "done" : i === idx ? "here" : i === target ? "target" : target > idx && i < target ? "between" : "future";
        const label = i <= idx || p.spoilers ? c.n : `Chapter ${i + 1}`;
        const clickable = i > idx;
        ol.append(el("li", { class: `t-ch ${st}` },
          el(clickable ? "button" : "span", {
            type: clickable ? "button" : null, class: "t-node", "data-key": c.k, "data-act": clickable ? "chapter" : null,
            "aria-pressed": clickable ? String(i === target) : null,
            tip: st === "here" ? "Your save is here" : st === "target" ? "Jump target: click to undo" : clickable ? "Jump here" : null,
            onclick: clickable ? act(() => { p.chapter = i === target ? null : c.k; }) : null,
          }, el("span", { class: "t-mark" }, st === "here" ? icon("pin") : st === "target" ? icon("flag") : null), el("span", { class: "t-label", text: label }))));
      }
      li.append(ol);
      line.append(li);
    }
    page.append(line);
  }
  /** The developers' strength presets for a story point (SBCharacterSetting): only ever raises what Eve has. */
  function gearUp(key) {
    if (!key) return null;
    const c = A.CHAPTER_LIST.find((x) => x.k === key);
    const box = el("span", { class: "gear-up", role: "group", "aria-label": "Gear up" }, el("span", { class: "gear-up-label", tip: "Bring upgrades, skills, items and gear up to what the developers gave Eve at this point. Only raises.", tabindex: "0" }, icon("chevrons"), el("span", { text: "Gear up" })));
    [["Min", "minimum"], ["Std", "standard"], ["Max", "maximum"]].forEach(([short, long], i) => box.append(el("button", {
      type: "button", class: "chip-btn", "data-act": `preset:${i + 1}`, tip: `The developers' ${long} for ${c ? A.chapterLabel(c) : "this point"}`,
      onclick: () => window.SBCommands.loadIntel().then(() => {
        if (!window.SB_INTEL.presets[key]) { toast("The developers made no preset for this point of the story.", true); return; }
        window.SBCommands.run(`SBCharacterSetting ${key} ${i + 1}`);
      }).catch((e) => toast(e.message, true)),
    }, short)));
    return box;
  }
  const plural = (n, one) => `${fmt(n)} ${n === 1 ? one : one + "s"}`; // also used above

  // ================================================================== quests: a board with three columns
  const QUEST_TYPES = [["main", "Main story", "flag"], ["side", "Side quests", "list"], ["request", "Bounty board", "target"]];
  const COLUMNS = [["todo", "Not started", "circle"], ["active", "Active", "clock"], ["done", "Done", "check"]];
  const questColumn = (st) => (st === "active" || st === "step-pending" ? "active" : st === "none" || st === "reset-pending" ? "todo" : "done");

  function rewardChips(q) {
    const r = GAME.questRewards && GAME.questRewards[q];
    if (!r) return null;
    return el("span", { class: "rewards" }, ...r.slice(0, 4).map(([a, n]) => {
      if (a === "SkillPoint") return el("span", { class: "reward", tip: `${fmt(n)} experience`, tabindex: "0" }, icon("star"), el("span", { text: A.short(n) }));
      const al = A.canon(a);
      return el("span", { class: "reward", tip: `${ITEMS[al] ? ITEMS[al].name : a} ${fmt(n)}`, tabindex: "0" }, ITEMS[al] ? A.art(al) : icon("crate"), el("span", { text: A.short(n) }));
    }));
  }

  function quests(page) {
    const p = S.prog;
    const tab = p.questTab;
    const all = Object.entries(GAME.quests).sort((x, y) => x[1].id - y[1].id);
    const isDone = (q) => ["done", "done-pending"].includes(A.questNow(q));
    page.append(seg(QUEST_TYPES.map(([k, label, ic]) => ({
      key: k, label, icon: ic, act: `quests:${k}`,
      n: `${all.filter(([q, v]) => v.t === k && isDone(q)).length}/${all.filter(([, v]) => v.t === k).length}`,
    })), tab, (k) => { p.questTab = k; render(); }, "Quest type"));
    if (tab === "main") {
      page.append(el("div", { class: "story-top" }, toggle({ icon: "eyeOff", onIcon: "eye", label: "Spoilers", on: p.spoilers, act: "spoilers",
        tip: "Show the names of main quests you haven't reached", onclick: () => { p.spoilers = !p.spoilers; } })));
    }
    const mine = all.filter(([, v]) => v.t === tab);
    const order = new Map(mine.map(([q], i) => [q, i + 1]));
    const tracked = A.trackedNow();
    const editable = tab !== "main";
    const open = mine.filter(([q]) => ["none", "active"].includes(A.questNow(q)));
    const board = el("div", { class: "qboard" });
    for (const [col, title, ic] of COLUMNS) {
      const inCol = mine.filter(([q]) => questColumn(A.questNow(q)) === col);
      const head = el("div", { class: "qcol-head" }, icon(ic), el("b", { text: title }), el("span", { class: "n", text: fmt(inCol.length) }));
      if (col === "done" && editable && open.length) {
        head.append(el("button", { type: "button", class: "fill", "data-act": "quests:all-done", tip: `Mark all ${open.length} open quests done, with their rewards`,
          onclick: act(() => { for (const [q] of open) p.questsDone.add(q); }) }, icon("check"), el("span", { text: fmt(open.length) })));
      }
      const colEl = el("div", { class: `qcol qcol-${col}` }, head);
      for (const [q, v] of inCol) colEl.append(questCard(q, v, tracked, editable, order.get(q)));
      if (!inCol.length) colEl.append(el("div", { class: "qcol-empty" }, icon(ic)));
      board.append(colEl);
    }
    page.append(board);
  }

  function questCard(q, v, tracked, editable, n) {
    const p = S.prog;
    const st = A.questNow(q);
    const pending = st.endsWith("pending");
    // no story spoilers: main quests you haven't reached show neither name nor description
    const hidden = v.t === "main" && st === "none" && !p.spoilers;
    const desc = v.d && !(v.t === "main" && st === "none") ? v.d : null;
    const buttons = el("span", { class: "qcard-acts" });
    if (st === "active") {
      buttons.append(el("button", {
        type: "button", class: "icon-btn" + (tracked === q ? " on" : ""), "aria-pressed": String(tracked === q), "data-act": "quest-track",
        tip: tracked === q ? "Tracked: click to stop tracking" : "Track this quest",
        onclick: act(() => { p.track = tracked === q ? null : q; if (p.track === S.cur.tracked) p.track = undefined; }),
      }, icon("target")));
    }
    if (v.t !== "main" && window.SBMap) {
      buttons.append(el("button", {
        type: "button", class: "icon-btn", "data-act": "quest-map", tip: "Show where it happens on the map",
        onclick: () => window.SBMap.showGroup(`quest:${q}`, v.n).then((ok) => { if (!ok) toast("The game's files don't place this quest on the map."); }),
      }, icon("map")));
    }
    if (editable) {
      if (GAME.questSteps && GAME.questSteps[q]) {
        buttons.append(el("button", { type: "button", class: "icon-btn" + (p.questOpen === q ? " on" : ""), "data-act": "quest-steps", "aria-expanded": String(p.questOpen === q),
          tip: "Steps: start it, or move it to any step (experimental)", onclick: act(() => { p.questOpen = p.questOpen === q ? null : q; }) }, icon("flag")));
      }
      if (st === "none" || st === "active" || st === "step-pending") buttons.append(el("button", { type: "button", class: "icon-btn do", "data-act": "quest-done", tip: "Mark done (with its reward)", onclick: act(() => { delete p.questSteps[q]; p.questsDone.add(q); }) }, icon("check")));
      if (st === "done" || st === "failed") buttons.append(el("button", { type: "button", class: "icon-btn", "data-act": "quest-reset", tip: "Reset, to do it again", onclick: act(() => p.questsReset.add(q)) }, icon("reset")));
      if (pending) buttons.append(el("button", { type: "button", class: "icon-btn undo", "data-act": "quest-undo", tip: "Undo", onclick: act(() => { p.questsDone.delete(q); p.questsReset.delete(q); delete p.questSteps[q]; }) }, icon("undo")));
    }
    return el("div", { class: `qcard${pending ? " new" : ""}${st === "failed" ? " failed" : ""}${tracked === q ? " tracked" : ""}`, "data-key": q, "data-state": st },
      el("b", { class: "qcard-name" + (hidden ? " hidden-name" : ""), "data-tip": desc, tabindex: desc ? "0" : null, text: hidden ? `Main quest ${n}` : v.n }),
      el("span", { class: "qcard-foot" }, rewardChips(q) || el("span"), buttons),
      p.questOpen === q && editable ? questSteps(q, st) : null);
  }

  /** A side quest's steps: the done ones, where it is, and a click to put it at any step. */
  function questSteps(q, st) {
    const steps = GAME.questSteps[q];
    const now = st === "done" || st === "done-pending" ? steps.length : A.questStepNow(q);
    const pendingStep = q in S.prog.questSteps;
    return el("ol", { class: "qsteps" }, ...steps.map(([g, d], i) => {
      const state = i < now ? "done" : i === now ? (pendingStep ? "target" : "here") : "future";
      return el("li", { class: `qstep ${state}` }, el("button", {
        type: "button", "data-act": `step:${q}:${i}`, "aria-pressed": String(i === now),
        tip: i === now ? (pendingStep ? "This step after download: click to undo" : "The quest is here now") : `Put the quest at this step${st === "none" ? " (starts it)" : ""}`,
        onclick: act(() => { if (i === now && pendingStep) delete S.prog.questSteps[q]; else A.setQuestStep(q, i); }),
      }, el("span", { class: "qstep-n", text: String(i + 1) }), el("span", { class: "qstep-text", text: d || g })));
    }));
  }

  // ================================================================== camps: one map per region, to activate camps or teleport Eve
  const REGION_ORDER = ["Eidos 7", "Xion", "Wasteland", "Altess Levoire", "Matrix 11", "Great Desert", "Abyss Levoire", "Eidos 9", "Spire 4", "Nest"];
  const CAMP_STATES = [["active", "Active"], ["inactive", "Visited, not active"], ["unvisited", "Not visited"], ["pending", "Active after download"]];
  let CAMP_MODE = "activate";
  const campPos = (c) => { const o = Object.values(GAME.camps[c].objs).find((x) => x.length >= 4 && /Teleport|OnlyActivation/.test(x[0])) || Object.values(GAME.camps[c].objs).find((x) => x.length >= 4); return o ? o[2] : null; };
  const campClickable = (c) => { const st = A.campNow(c); return st === "inactive" || st === "pending" || (st === "unvisited" && A.canCreateCamp(c)); };
  const toggleCamp = (c) => { if (S.prog.camps.has(c)) S.prog.camps.delete(c); else if (campClickable(c)) S.prog.camps.add(c); render(); };
  const isTarget = (kind, key) => !!S.prog.warp && S.prog.warp.kind === kind && S.prog.warp.key === key;
  function travel(kind, key) {
    if (isTarget(kind, key)) S.prog.warp = null;
    else if (kind === "camp") A.warpCamp(key);
    else A.warpSpot(key);
    render();
  }
  const eveRegion = () => (S.cur.eve && S.cur.eve.map ? A.regionOfMap(S.cur.eve.map) : null);

  function camps(page) {
    page.append(el("div", { class: "camps-top" }, seg([
      { key: "activate", icon: "tent", label: "Activate camps", act: "camps:mode:activate" },
      { key: "travel", icon: "pin", label: "Teleport Eve", act: "camps:mode:travel" },
    ], CAMP_MODE, (k) => { CAMP_MODE = k; render(); }, "What clicking a camp does")));
    if (CAMP_MODE === "travel") travelTop(page);
    else {
      const visited = A.CAMPS.filter(([c]) => A.campNow(c) === "inactive");
      const unvisited = A.CAMPS.filter(([c]) => A.campNow(c) === "unvisited" && A.canCreateCamp(c));
      page.append(el("div", { class: "camps-top" },
        el("div", { class: "legend" }, ...CAMP_STATES.map(([k, label]) => el("span", { class: "legend-item" }, el("span", { class: `cdot ${k}` }), el("span", { text: label })))),
        acts(
          visited.length ? el("button", { type: "button", class: "fill", "data-act": "camps:visited", tip: `Activate the ${visited.length} camps you've visited`, onclick: act(() => { for (const [c] of visited) S.prog.camps.add(c); }) }, icon("tent"), el("span", { text: fmt(visited.length) })) : null,
          unvisited.length ? el("button", { type: "button", class: "fill fill-exp", "data-act": "camps:unvisited", tip: `Also create the ${unvisited.length} camps in areas you haven't visited. ${A.EXP_TIP}`, onclick: act(() => { for (const [c] of unvisited) S.prog.camps.add(c); }) }, icon("flask"), el("span", { text: fmt(unvisited.length) })) : null)));
    }
    const regions = new Map(REGION_ORDER.map((r) => [r, []]));
    for (const [c, v] of A.CAMPS) regions.set(v.region, [...(regions.get(v.region) || []), c]);
    for (const [r, l] of regions) if (!l.length) regions.delete(r);
    const grid = el("div", { class: "regions" });
    // in teleport mode, Eve's region comes first
    const order = [...regions.keys()].sort((x, y) => (CAMP_MODE === "travel" ? (y === eveRegion()) - (x === eveRegion()) : 0));
    for (const region of order) grid.append(regionCard(region, regions.get(region)));
    page.append(grid);
  }

  function travelTop(page) {
    const w = S.prog.warp;
    page.append(el("div", { class: "camps-top" },
      el("div", { class: "legend" },
        el("span", { class: "legend-item" }, el("span", { class: "cdot eve" }), el("span", { text: "Eve now" })),
        el("span", { class: "legend-item" }, el("span", { class: "cdot active" }), el("span", { text: "Camp" })),
        el("span", { class: "legend-item" }, el("span", { class: "cdot spot" }), el("span", { text: "Named place" })),
        el("span", { class: "legend-item" }, el("span", { class: "cdot pending" }), el("span", { text: "Teleport target" }))),
      acts(w ? el("span", { class: "warp-target" }, icon("pin"), el("b", { text: w.label }), el("span", { class: "muted", text: A.regionOfMap(w.map) || w.map }),
        A.undoBtn("Cancel the teleport", () => { S.prog.warp = null; })) : null, A.expFlag())));
    if (w && S.prog.chapter && S.prog.chapterPlace) page.append(el("p", { class: "note" }, icon("info"), el("span", { text: "The teleport wins over the story jump's starting point." })));
  }

  function regionCard(region, list) {
    const travelMode = CAMP_MODE === "travel";
    const active = list.filter((c) => ["active", "pending"].includes(A.campNow(c))).length;
    const here = list.filter((c) => A.campNow(c) === "inactive");
    const spots = travelMode ? A.WARP.spots.filter(([, m]) => A.regionOfMap(m) === region) : [];
    const head = el("div", { class: "region-head" }, icon("map"), el("b", { text: region }),
      travelMode ? (eveRegion() === region ? el("span", { class: "n eve-here", text: "Eve is here" }) : el("span", { class: "n" }))
        : el("span", { class: "n", text: `${active}/${list.length}` }),
      !travelMode && here.length ? el("button", { type: "button", class: "fill small", tip: `Activate ${here.length} visited camps in ${region}`, onclick: act(() => { for (const c of here) S.prog.camps.add(c); }) }, icon("plus"), el("span", { text: fmt(here.length) })) : null);
    const chips = el("div", { class: "camp-chips" }, ...list.map((c) => {
      const st = A.campNow(c);
      if (travelMode) {
        const can = !!A.WARP.camps[c];
        const on = isTarget("camp", c);
        return el(can ? "button" : "span", {
          type: can ? "button" : null, class: `camp-chip ${on ? "pending" : st}`, "data-key": c, "aria-pressed": can ? String(on) : null,
          tip: can ? `${GAME.camps[c].n}\n${on ? "Teleport target: click to cancel" : "Click to teleport Eve here"}` : `${GAME.camps[c].n}\nNo position in the level files`,
          onclick: can ? () => travel("camp", c) : null, tabindex: can ? null : "0",
        }, el("span", { class: `cdot ${on ? "pending" : "active"}` }), el("span", { text: GAME.camps[c].n }));
      }
      const can = campClickable(c);
      return el(can ? "button" : "span", {
        type: can ? "button" : null, class: `camp-chip ${st}`, "data-key": c, "aria-pressed": can ? String(st === "pending") : null,
        tip: campTip(c), onclick: can ? () => toggleCamp(c) : null, tabindex: can ? null : "0",
      }, el("span", { class: `cdot ${st}` }), el("span", { text: GAME.camps[c].n }));
    }));
    const spotChips = spots.length ? el("details", { class: "spot-list" }, el("summary", null, icon("pin"), el("span", { text: `${spots.length} named places` })),
      el("div", { class: "camp-chips" }, ...spots.map(([n, , , k]) => el("button", {
        type: "button", class: `camp-chip spot${isTarget("spot", k) ? " pending" : ""}`, "data-key": k, "aria-pressed": String(isTarget("spot", k)),
        tip: `${n}\n${isTarget("spot", k) ? "Teleport target: click to cancel" : "Click to teleport Eve here"}`, onclick: () => travel("spot", k),
      }, el("span", { class: `cdot ${isTarget("spot", k) ? "pending" : "spot"}` }), el("span", { text: n }))))) : null;
    if (spotChips && spots.some(([, , , k]) => isTarget("spot", k))) spotChips.open = true;
    return el("div", { class: "region" }, head, campMap(list, region, spots), chips, spotChips);
  }

  const campTip = (c) => {
    const v = GAME.camps[c], st = A.campNow(c);
    const lines = [v.n, v.type, { active: "Active", inactive: "Visited, not active: click to activate", pending: "Active after download: click to undo",
      unvisited: A.canCreateCamp(c) ? "Not visited: click to create it (experimental)" : "Not visited" }[st]];
    return lines.join("\n");
  };

  function campMap(list, region, spots) {
    const travelMode = CAMP_MODE === "travel";
    const pts = list.map((c) => ["camp", c, campPos(c)]).filter(([, , p]) => p);
    for (const [, , loc, k] of spots) pts.push(["spot", k, loc]);
    const eve = S.cur.eve && eveRegion() === region ? S.cur.eve.loc : null;
    const all = pts.map(([, , p]) => p).concat(eve ? [eve] : []);
    const W = 320, PAD = 18;
    if (!all.length) return null;
    // top-down: the level's Y axis runs to the right, X up
    const xs = all.map((p) => p[1]), ys = all.map((p) => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const dx = maxX - minX || 1, dy = maxY - minY || 1;
    const H = Math.round(Math.max(120, Math.min(220, (W - 2 * PAD) * (dy / dx) + 2 * PAD)));
    const k = Math.min((W - 2 * PAD) / dx, (H - 2 * PAD) / dy);
    const ox = (W - dx * k) / 2, oy = (H - dy * k) / 2;
    const at = (p) => (all.length === 1 ? [W / 2, H / 2] : [ox + (p[1] - minX) * k, oy + (-p[0] - minY) * k]).map((v) => v.toFixed(1));
    const map = svg("svg", { class: "camp-map", viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `${region} map` });
    for (const [kind, key, p] of pts) {
      const [x, y] = at(p);
      if (kind === "spot") {
        const on = isTarget("spot", key);
        const name = A.WARP.spots.find((s) => s[3] === key)[0];
        map.append(svg("g", {
          class: `pin spot can${on ? " target" : ""}`, "data-key": key, tip: `${name}\n${on ? "Teleport target: click to cancel" : "Click to teleport Eve here"}`,
          role: "button", tabindex: "0", "aria-label": name, onclick: () => travel("spot", key),
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); travel("spot", key); } },
        }, svg("circle", { cx: x, cy: y, r: 10, class: "pin-hit" }),
        svg("path", { d: `M${+x} ${+y - 5}L${+x + 5} ${+y}L${+x} ${+y + 5}L${+x - 5} ${+y}Z`, class: "pin-dot" })));
        continue;
      }
      const c = key, st = A.campNow(c);
      const big = GAME.camps[c].type === "Camp";
      if (travelMode) {
        const can = !!A.WARP.camps[c], on = isTarget("camp", c);
        map.append(svg("g", {
          class: `pin ${on ? "target" : "active"}${can ? " can" : ""}`, "data-key": c, tip: `${GAME.camps[c].n}\n${on ? "Teleport target: click to cancel" : can ? "Click to teleport Eve here" : "No position in the level files"}`,
          role: can ? "button" : "img", tabindex: "0", "aria-label": GAME.camps[c].n,
          onclick: can ? () => travel("camp", c) : null,
          onkeydown: can ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); travel("camp", c); } } : null,
        }, svg("circle", { cx: x, cy: y, r: 14, class: "pin-hit" }), svg("circle", { cx: x, cy: y, r: big ? 7 : 5, class: "pin-dot" })));
        continue;
      }
      const can = campClickable(c);
      map.append(svg("g", {
        class: `pin ${st}${can ? " can" : ""}`, "data-key": c, tip: campTip(c),
        role: can ? "button" : "img", tabindex: "0", "aria-label": `${GAME.camps[c].n}: ${st}`,
        onclick: can ? () => toggleCamp(c) : null,
        onkeydown: can ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCamp(c); } } : null,
      }, svg("circle", { cx: x, cy: y, r: 14, class: "pin-hit" }), svg("circle", { cx: x, cy: y, r: big ? 7 : 5, class: "pin-dot" })));
    }
    if (eve) {
      const [x, y] = at(eve);
      map.append(svg("g", { class: "eve-marker", tip: "Eve is here now", tabindex: "0", role: "img", "aria-label": "Eve" },
        svg("circle", { cx: x, cy: y, r: 11, class: "eve-ring" }), svg("circle", { cx: x, cy: y, r: 5, class: "eve-dot" })));
    }
    return map;
  }

  // ================================================================== shops and camp music
  function shops(page) {
    const p = S.prog;
    const list = GAME.shops || [];
    const raise = list.filter((s) => A.shopNow(s.key) > 0 && A.shopNow(s.key) < s.levels.length + 1);
    const sec = A.section("Shops", acts(raise.length ? el("button", { type: "button", class: "fill", "data-act": "shops:max", tip: "Raise every shop you know to its top level",
      onclick: act(() => { for (const s of raise) p.shops[s.key] = s.levels.length + 1; }) }, icon("heart"), el("span", { text: fmt(raise.length) })) : null));
    const grid = el("div", { class: "shops" });
    for (const s of list) {
      const was = S.cur.shops[s.key] || 0;
      const n = A.shopNow(s.key);
      const max = s.levels.length + 1;
      if (!was) {
        grid.append(el("div", { class: "shop locked", tip: "Not met yet: meet them in the game first", tabindex: "0" },
          el("span", { class: "shop-ic" }, icon("lock")), el("b", { text: s.n })));
        continue;
      }
      grid.append(el("div", { class: "shop" + (n !== was ? " new" : ""), "data-key": s.key },
        el("span", { class: "shop-ic" }, icon("store")), el("b", { text: s.n }),
        pips({ n, was, max, normal: max, label: `${s.n} level`, pick: (k) => {
          if (k < was) { toast("Shop levels only go up.", true); return; }
          if (k === was) delete p.shops[s.key]; else p.shops[s.key] = k;
          render();
        } }),
        el("span", { class: "level-num" }, el("b", { text: String(n) }), el("small", { text: `/${max}` }))));
    }
    sec.append(grid);
    page.append(sec);
    page.append(music());
  }

  function hue(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
  function disc(t) {
    return svg("svg", { class: "disc", viewBox: "0 0 48 48", "aria-hidden": "true" },
      svg("circle", { cx: 24, cy: 24, r: 22, class: "disc-vinyl" }),
      svg("circle", { cx: 24, cy: 24, r: 15, class: "disc-groove" }),
      svg("circle", { cx: 24, cy: 24, r: 8, fill: `hsl(${hue(t.n)} 62% 58%)` }),
      svg("circle", { cx: 24, cy: 24, r: 1.8, class: "disc-hole" }));
  }

  function music() {
    const p = S.prog;
    const list = GAME.music || [];
    const locked = list.filter((t) => A.trackState(t) === "locked");
    const needs = [...new Set(locked.map(A.needKey))];
    const sec = A.section("Camp music", acts(needs.length ? el("button", { type: "button", class: "fill", "data-act": "music:all", tip: `Unlock ${locked.length} tracks`,
      onclick: act(() => { for (const k of needs) p.unlocks.add(k); }) }, icon("disc"), el("span", { text: fmt(locked.length) })) : null));
    const playing = A.musicNow();
    const grid = el("div", { class: "records" });
    for (const t of list) {
      const st = A.trackState(t);
      const isOn = playing === t.key;
      const nikke = t.need && /Nikke/.test(t.need[1]);
      const lines = [t.n];
      if (st === "open") lines.push(isOn ? "Playing at your camps" : "Click to play it at your camps");
      if (st === "locked") lines.push("Locked: click to unlock");
      if (st === "pending") lines.push("Unlocked after download");
      if (st === "dlc") lines.push(t.need[1] === "STELLARBLADEDLC1" ? "NieR:Automata DLC" : "NIKKE collaboration DLC");
      if (nikke && st !== "dlc") lines.push("NIKKE collaboration");
      const state = isOn ? (S.prog.music !== undefined ? "added" : "playing") : st;
      grid.append(el("button", {
        type: "button", class: "record", "data-key": t.key, "data-state": state, "aria-pressed": String(isOn), "data-tip": lines.join("\n"),
        "aria-label": `${t.n}: ${state}`, "aria-disabled": st === "dlc" ? "true" : null,
        onclick: () => {
          if (st === "dlc") return;
          if (st === "locked") p.unlocks.add(A.needKey(t));
          else if (isOn && S.prog.music !== undefined) p.music = undefined;
          else if (!isOn) p.music = t.key === S.cur.music ? undefined : t.key;
          else if (st === "pending") p.unlocks.delete(A.needKey(t));
          render();
        },
      }, disc(t), el("span", { class: "record-name", text: t.n }),
      el("span", { class: "tile-badge" }, icon({ open: "play", playing: "play", added: "play", locked: "plus", pending: "check", dlc: "ticket" }[state])),
      nikke || st === "dlc" ? el("span", { class: "tile-flag" }, icon("ticket")) : null));
    }
    sec.append(grid);
    return sec;
  }

  // ================================================================== album and boss challenge
  function album(page) {
    const p = S.prog;
    const stageOpen = (s) => s.achs.every(A.achUnlocked);
    const locked = GAME.boss.filter((s) => !stageOpen(s));
    const b = A.section("Boss Challenge", acts(locked.length ? el("button", { type: "button", class: "fill", "data-act": "boss:all", tip: `Unlock all ${locked.length} stages`,
      onclick: act(() => A.unlockAch(locked.flatMap((s) => s.achs))) }, icon("skull"), el("span", { text: fmt(locked.length) })) : null));
    b.append(el("div", { class: "bosses" }, ...GAME.boss.map((s) => {
      const pending = s.achs.some((a) => p.ach.has(a));
      const open = stageOpen(s);
      const st = pending ? "added" : open ? "owned" : "missing";
      return el("button", {
        type: "button", class: "boss", "data-key": s.key, "data-state": st, "aria-pressed": String(open),
        "data-tip": [s.n, s.region, st === "missing" ? "Locked: click to unlock" : pending ? "Unlocked after download: click to undo" : "Unlocked", s.ent ? "NIKKE collaboration" : null].filter(Boolean).join("\n"),
        onclick: () => { if (pending) s.achs.forEach((a) => p.ach.delete(a)); else if (!open) A.unlockAch(s.achs); render(); },
      }, el("span", { class: "boss-ic" }, icon("skull")), el("b", { text: s.n }), el("small", { text: s.region }),
      el("span", { class: "tile-badge" }, icon(st === "missing" ? "plus" : "check")), s.ent ? el("span", { class: "tile-flag" }, icon("ticket")) : null);
    })));
    page.append(b);

    const entries = Object.values(GAME.album);
    const missingAll = entries.filter((e) => !A.achUnlocked(e.ach));
    const a = A.section("Album", acts(missingAll.length ? el("button", { type: "button", class: "fill", "data-act": "album:all", tip: `Unlock all ${missingAll.length} missing entries`,
      onclick: act(() => A.unlockAch(missingAll.map((e) => e.ach))) }, icon("plus"), el("span", { text: fmt(missingAll.length) })) : null));
    const grid = el("div", { class: "board" });
    for (const t of GAME.albumTypes) {
      const list = entries.filter((e) => e.type === t);
      if (!list.length) continue;
      const added = list.filter((e) => p.ach.has(e.ach));
      const have = list.filter((e) => S.cur.achDone.has(e.ach));
      const missing = list.filter((e) => !A.achUnlocked(e.ach));
      const isOpen = p.albumOpen === t;
      const card = el("div", { class: `gauge${added.length ? " new" : ""}${missing.length ? "" : " full"}${isOpen ? " open" : ""}` },
        el("button", { type: "button", class: "gauge-open", "aria-expanded": String(isOpen), tip: missing.length ? "Show what's missing" : t,
          onclick: act(() => { p.albumOpen = isOpen ? null : t; }) },
        el("span", { class: "gauge-ring" }, ring(have.length, added.length, list.length),
          el("span", { class: "gauge-num" }, el("b", { text: fmt(have.length + added.length) }), el("small", { text: `/${fmt(list.length)}` }))),
        el("span", { class: "gauge-label" }, el("span", { text: t }))),
        el("div", { class: "gauge-acts" },
          added.length ? A.undoBtn(`Undo ${t}`, () => added.forEach((e) => p.ach.delete(e.ach))) : null,
          missing.length ? A.fillBtn(missing.length, `Unlock ${missing.length} missing`, () => A.unlockAch(missing.map((e) => e.ach)), `album:${t}`) : A.doneMark("Complete")));
      grid.append(card);
    }
    a.append(grid);
    const openType = p.albumOpen && entries.filter((e) => e.type === p.albumOpen && !A.achUnlocked(e.ach));
    if (openType && openType.length) {
      // records with a place on the map get a pin next to them (the map's data loads in the background)
      const MAP = window.SBMap;
      const mapKey = (e) => `record:${e.ach.replace(/^Ach_Album_Unlock_Item_/, "")}`;
      if (MAP && !MAP.ready() && ["Documents", "Memory sticks", "Passcodes"].includes(p.albumOpen)) MAP.whenReady().then(render).catch(() => {});
      a.append(el("div", { class: "missing-chips" }, ...openType.slice(0, 160).map((e) => {
        const chip = el("button", {
          type: "button", class: "chip-btn", tip: e.group ? `${e.n}\n${e.group}\nClick to unlock` : `${e.n}\nClick to unlock`,
          onclick: act(() => A.unlockAch([e.ach])),
        }, icon("plus"), e.n);
        if (!(MAP && MAP.ready() && MAP.hasGroup(mapKey(e)))) return chip;
        return el("span", { class: "chip-pair" }, chip, el("button", {
          type: "button", class: "chip-btn chip-map", "data-act": "album:map", tip: "Where to find it", "aria-label": `Where to find ${e.n}`,
          onclick: () => MAP.showGroup(mapKey(e), e.n),
        }, icon("pin")));
      })));
    }
    page.append(a);
  }

  // ================================================================== trophies (read only)
  function trophies(page) {
    const list = S.cur.trophies;
    page.append(el("div", { class: "trophy-top" },
      el("span", { class: "big-count" }, el("b", { text: fmt(list.filter((t) => t.done).length) }), el("small", { text: `/${list.length}` })),
      A.flag("eye", "Shown for reference: the editor never changes trophies", "flag-read")));
    page.append(el("div", { class: "medals" }, ...list.map((t) => {
      const v = Math.min(t.value, t.goal);
      return el("div", {
        class: `medal g-${t.grade}${t.done ? " done" : ""}`, tabindex: "0",
        "data-tip": [t.n, t.d, t.done ? "Earned" : t.goal > 1 ? `${fmt(v)} / ${fmt(t.goal)}` : "Not earned yet", t.ng ? "New Game+" : null].filter(Boolean).join("\n"),
      }, el("span", { class: "medal-ring" }, ring(t.done ? t.goal : v, 0, t.goal), icon(t.done ? "cup" : "medal", "medal-ic")),
      el("b", { text: t.n }),
      el("small", { text: t.done ? "✓" : t.goal > 1 ? `${A.short(v)}/${A.short(t.goal)}` : "" }));
    })));
  }

  // ================================================================== tools
  function tools(page) {
    const p = S.prog;
    const grid = el("div", { class: "tools" });
    const tile = (o) => grid.append(el("div", { class: `tool${o.on ? " new" : ""}${o.done ? " full" : ""}`, "data-key": o.key, "data-tip": o.tip, tabindex: "0" },
      el("span", { class: "tool-ic" }, icon(o.icon)),
      el("b", { class: "tool-title", text: o.title }),
      o.stat !== undefined ? el("span", { class: "tool-stat", text: o.stat }) : null,
      el("div", { class: "tool-foot" }, o.exp ? A.expFlag() : el("span"),
        o.done && !o.on ? A.doneMark(o.doneTip || "Nothing to do") : el("button", {
          type: "button", class: "toggle" + (o.on ? " on" : ""), "aria-pressed": String(!!o.on), "data-act": `tool:${o.key}`,
          onclick: act(() => o.set(!o.on)),
        }, icon(o.on ? "check" : o.btnIcon || "plus"), el("span", { text: o.verb })))));

    tile({ key: "markers", icon: "dotOff", title: "“New” markers", stat: fmt(S.cur.markers), verb: "Clear", btnIcon: "dotOff",
      tip: "Menu entries with a red “new” dot. Clearing marks them all as seen.", on: p.clearMarkers, done: !S.cur.markers, set: (v) => { p.clearMarkers = v; } });
    const unreg = A.unregisteredItems();
    tile({ key: "register", icon: "tag", title: "Picked-up items", stat: fmt(unreg.length), verb: "Register", btnIcon: "tag",
      tip: "Items in your inventory the game never saw you pick up (added by other tools). Cans, the Album, shop unlocks and their rewards only react to picked-up items. Items the editor adds are registered automatically.",
      on: p.registerItems, done: !unreg.length, doneTip: "Every item counts as picked up", set: (v) => { p.registerItems = v; } });
    tile({ key: "restock", icon: "cart", title: "Shop stock", stat: fmt(S.cur.bought), verb: "Restock", btnIcon: "cart",
      tip: "Shops remember what you bought. Restocking lets you buy limited items again.", on: p.restock, done: !S.cur.bought, set: (v) => { p.restock = v; } });
    if (S.cur.hints !== null) {
      const total = (GAME.hints || []).length;
      tile({ key: "hints", icon: "bubble", title: "Tutorial pop-ups", stat: `${S.cur.hints}/${total}`, verb: "Skip all", btnIcon: "bubble",
        tip: "Marks every tutorial pop-up as seen, so none of them interrupt you.", on: p.hints, done: S.cur.hints >= total, doneTip: "All seen", set: (v) => { p.hints = v; } });
    }
    if (S.cur.hasCampSpot && S.cur.campSameWorld) {
      tile({ key: "unstuck", icon: "pin", title: "Unstuck Eve", verb: "Move Eve", btnIcon: "pin", exp: true,
        tip: "Moves Eve to the spot in front of the camp where she last rested.", on: p.unstuck, set: (v) => { p.unstuck = v; } });
    }
    tile({ key: "finished", icon: "flag", title: "Endings", stat: `${S.cur.endings}/3`, verb: "All seen", btnIcon: "flag", exp: true,
      tip: "Records all three endings as seen. Finished games are what the title screen offers New Game+ for. No trophies are awarded.",
      on: p.finished, done: S.cur.endings >= 3, set: (v) => { p.finished = v; } });
    if (S.cur.ng !== null) {
      const was = S.cur.ng > 0;
      const on = p.ng !== null ? !!p.ng : was;
      grid.append(el("div", { class: `tool${p.ng !== null ? " new" : ""}`, "data-key": "ng", tabindex: "0",
        "data-tip": "Marks this playthrough as New Game+, the way the game's New Game+ checks see it. The New Game+ trophy isn't touched." },
      el("span", { class: "tool-ic" }, icon("loop")), el("b", { class: "tool-title", text: "New Game+" }),
      el("span", { class: "tool-stat", text: on ? "On" : "Off" }),
      el("div", { class: "tool-foot" }, A.expFlag(),
        el("button", { type: "button", class: "switch" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "data-act": "tool:ng", "aria-label": "New Game+",
          onclick: act(() => { p.ng = !on === was ? null : !on ? 1 : 0; }) }, el("span", { class: "switch-knob" })))));
    }
    page.append(grid);

    // item icons
    const n = A.ICONS.map ? Object.keys(A.ICONS.map).length : 0;
    const ic = A.section("Item icons and map art", acts(
      n ? el("button", { type: "button", class: "icon-btn", tip: "Remove the icons", "data-act": "icons:remove", onclick: A.removeIcons }, icon("trash")) : null,
      el("button", { type: "button", class: n ? "toggle" : "fill", "data-act": "icons:load", tip: n ? "Load a newer pack" : "Load an icon pack", onclick: A.importIcons },
        icon("image"), el("span", { text: n ? fmt(n) : "Load" }))));
    const sample = Object.keys(ITEMS).filter((a) => ITEMS[a].catalog && A.current(a) > 0).slice(0, 8);
    ic.append(el("div", { class: "icon-demo" }, ...sample.map((a) => A.art(a))));
    if (!n) {
      ic.append(el("details", { class: "howto" }, el("summary", null, icon("info"), el("span", { text: "Make a pack from your copy of the game" })),
        el("pre", { class: "cmd" }, el("code", { text: "cd tools/icon-pack/oodec && cargo build --release && cd ..\npython3 make_icon_pack.py \"<your Stellar Blade folder>\"" })),
        el("p", { class: "muted", text: "That writes StellarBladeIcons.json: item icons, and the game's own maps of the Wasteland, Great Desert and Xion for the Map page. It stays in this browser. Please don't share it: it contains the game's artwork." })));
    }
    page.append(ic);
  }

  window.SBPages = { wardrobe, upgrades, skills, chapters, quests, camps, shops, album, trophies, tools };
})();
