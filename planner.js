/*
 * Stellar Blade: C2 - the move list and the build planner
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * From builds.js (the game's skill, input, gear, Exospine and stat tables, loaded when the page opens).
 * Eve's stats are computed the way the game's own stat viewer does: base + core levels + learned passives + gear +
 * Exospine perks, each stat X = (base X + sum X + sum XValue) x (1 + sum XRate).
 */
(function () {
  "use strict";

  const { el, icon, fmt, seg, toast } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS } = A;
  const CX = window.SBCodex;
  const DATA = { ready: () => !!window.SB_BUILDS, load: () => CX.loadScript("builds.js?v=98863051f8", () => !!window.SB_BUILDS) };
  const st = { tree: "all", pc: false, q: "", tryOn: false, tr: {} };

  // ================================================================== moves
  /** Learned: skill tree moves by their acquisition; base moves when what they build on is learned. */
  function moveState(m) {
    if (m.ach && !A.achUnlocked(m.ach)) return "locked";
    if (m.tree !== "Base" && m.k && GAME.skills && Object.prototype.hasOwnProperty.call(GAME.skills, m.k)) return A.isLearned(m.k) ? "learned" : "open";
    const req = m.req || [];
    const ok = m.reqAny ? req.some((r) => A.isLearned(r)) : req.every((r) => A.isLearned(r));
    return !req.length || ok ? "learned" : "open";
  }
  const keycaps = (text) => el("span", { class: "keys" }, ...String(text).split(/(\s\+\s|,\s|\s→\s)/).map((part) =>
    /^\s\+\s$|^,\s$|^\s→\s$/.test(part) ? el("span", { class: "key-sep", text: part.trim() }) : el("kbd", { text: part })));

  function moves(page) {
    if (CX.needs(page, DATA)) return;
    const all = window.SB_BUILDS.moves;
    const trees = [...new Set(all.map((m) => m.tree))];
    const list = all.filter((m) => (st.tree === "all" || m.tree === st.tree) && CX.matches(`${m.n} ${m.tree} ${m.ps} ${m.pc || ""} ${(m.tags || []).join(" ")}`));
    const grid = el("div", { class: "moves" });
    const fill = () => {
      grid.textContent = "";
      for (const m of all.filter((x) => (st.tree === "all" || x.tree === st.tree) && CX.matches(`${x.n} ${x.tree} ${x.ps} ${x.pc || ""} ${(x.tags || []).join(" ")}`))) grid.append(moveRow(m));
    };
    page.append(el("div", { class: "codex-top" },
      CX.search("Find a move, a button or a tag (counter, air, beta chain…)", fill),
      seg([{ key: "all", label: "All", n: `${all.length}` }, ...trees.map((t) => ({ key: t, label: t, n: `${all.filter((m) => m.tree === t).length}` }))],
        st.tree, (k) => { st.tree = k; A.render(); }, "Skill tree"),
      el("div", { class: "map-layers" }, el("button", {
        type: "button", class: "toggle" + (st.pc ? " on" : ""), "aria-pressed": String(st.pc), "data-act": "moves:pc",
        tip: "Show the default keyboard and mouse keys instead of the controller", onclick: () => { st.pc = !st.pc; A.render(); },
      }, icon("terminal"), el("span", { text: "Keyboard keys" })))));
    for (const m of list) grid.append(moveRow(m));
    page.append(grid);
  }
  function moveRow(m) {
    const state = moveState(m);
    const dmg = Math.max(0, ...(m.skills || []).map((s) => s.dmg || 0));
    const energy = (m.skills || []).map((s) => s.energy).find(Boolean);
    return el("article", { class: `move ${state}` },
      el("div", { class: "move-name" }, el("b", { text: m.n }), el("small", { text: [m.tree, ...(m.tags || [])].join(" · ") })),
      keycaps(st.pc && m.pc ? m.pc : m.ps),
      el("div", { class: "move-nums" },
        dmg ? el("span", { tip: "Damage: times Eve's attack power (highest hit)" }, el("small", { text: "Damage" }), el("b", { text: `×${Math.round(dmg * 100) / 100}` })) : null,
        energy ? el("span", { tip: "Gauge it uses" }, el("small", { text: energy[0][0].toUpperCase() + energy[0].slice(1) }), el("b", { text: fmt(energy[1]) })) : null,
        m.sp ? el("span", { tip: "Skill points to learn" }, el("small", { text: "SP" }), el("b", { text: fmt(m.sp) })) : null),
      el("span", { class: `pstate ${state === "learned" ? "here" : "gone"}`, text: state === "learned" ? "Learned" : state === "locked" ? "Story" : "Not learned" }));
  }

  // ================================================================== builds
  const G = () => window.SB_BUILDS.gear;
  const GEAR_SLOTS = [1, 2, 3, 4];
  const SPINE_SLOTS = [6, 7];
  /** The save's loadout (with the editor's pending changes): gear, Exospines with levels, core levels, learned passives. */
  function currentLoadout() {
    const lo = { gear: {}, spines: {}, levels: {} };
    for (const s of GEAR_SLOTS) lo.gear[s] = A.wornNow(s) || null;
    for (const s of SPINE_SLOTS) { const a = A.wornNow(s); lo.spines[s] = a ? [a, A.itemLevelNow(a) || 1] : null; }
    for (const l of GAME.levels) lo.levels[l.key] = A.levelNow(l.index);
    return lo;
  }
  function totals(lo) {
    const g = G();
    const sum = Object.create(null);
    const add = (fx) => { for (const [stat, calc, v] of fx || []) if (calc === "s") sum[stat] = (sum[stat] || 0) + Number(v); };
    for (const [type, level] of Object.entries(lo.levels)) if (level > 0 && g.growth[type] && g.growth[type][level]) add(g.growth[type][level].map(([k, v]) => [k, "s", v]));
    for (const [a, fx] of Object.entries(g.passives)) if (A.isLearned(a)) add(fx);
    for (const s of GEAR_SLOTS) { const a = lo.gear[s]; if (a && g.items[a]) add(g.items[a].fx); }
    for (const s of SPINE_SLOTS) {
      const x = lo.spines[s];
      const sp = x && g.spines[x[0]];
      const lv = sp && sp.levels[String(Math.min(3, x[1] || 1))];
      if (lv) for (const perk of lv.perks) add(perk.fx);
    }
    const value = (X) => ((g.base[X] || 0) + (sum[X] || 0) + (sum[`${X}Value`] || 0)) * (1 + (sum[`${X}Rate`] || 0));
    const out = Object.create(null);
    for (const row of g.viewer) out[row.k] = row.k === "MaxDamageReduction" ? value("ShieldBlock") * (g.base.DamageReductionPerShieldBock || 0) : value(row.k);
    return out;
  }
  const show = (row, v) => (row.dec ? `${Math.round(v * 1000) / 10} %` : fmt(Math.round(v)));
  const ng = () => !!(S.cur && S.cur.ng);

  function builds(page) {
    if (CX.needs(page, DATA)) return;
    const g = G();
    const now = currentLoadout();
    if (!st.tryOn) st.tr = JSON.parse(JSON.stringify(now));
    const tryLo = st.tr;
    const a = totals(now), b = totals(tryLo);
    const owned = (x) => !!x && A.current(x) > 0;
    const gearOptions = Object.entries(g.items).sort((x, y) => x[1].n.localeCompare(y[1].n) || x[1].r - y[1].r);
    const slot = (s) => A.slotInfo(s) || { n: `Slot ${s}` };
    const pick = (s, isSpine) => {
      const cur = isSpine ? (tryLo.spines[s] || [null, 1]) : [tryLo.gear[s]];
      const select = el("select", { class: "pick", "aria-label": slot(s).n, "data-act": `build:slot:${s}` },
        el("option", { value: "", text: "— empty —" }),
        ...(isSpine ? Object.entries(g.spines).sort((x, y) => x[1].n.localeCompare(y[1].n)) : gearOptions).map(([k, v]) =>
          el("option", { value: k, text: `${v.n}${v.mk2 && !/Mk ?2/i.test(v.n) ? " Mk2" : ""}${isSpine ? "" : ` (${["", "Common", "Uncommon", "Rare"][v.r] || v.r})`}${owned(k) ? "  ✓" : ""}`, selected: k === cur[0] || undefined })));
      select.addEventListener("change", () => {
        st.tryOn = true;
        if (isSpine) tryLo.spines[s] = select.value ? [select.value, (tryLo.spines[s] && tryLo.spines[s][1]) || 3] : null;
        else tryLo.gear[s] = select.value || null;
        A.render();
      });
      const lv = isSpine && cur[0] ? el("span", { class: "lv-pick" }, ...[1, 2, 3].map((n) => el("button", {
        type: "button", class: "lv" + (cur[1] === n ? " on" : ""), "aria-pressed": String(cur[1] === n), "data-act": `build:lv:${s}:${n}`, tip: `Level ${n}`,
        onclick: () => { st.tryOn = true; tryLo.spines[s] = [cur[0], n]; A.render(); },
      }, el("span", { text: String(n) })))) : null;
      const locked = !A.slotOpen(slot(s));
      const it = isSpine ? cur[0] : cur[0];
      const detail = it && (isSpine ? g.spines[it] : g.items[it]);
      return el("div", { class: `build-slot${locked ? " locked" : ""}` },
        el("div", { class: "build-slot-head" }, it && ITEMS[it] ? A.art(it) : el("span", { class: "fish-ic" }, icon(isSpine ? "spine" : "chip")),
          el("div", null, el("small", { text: `${slot(s).n}${locked ? " (not unlocked)" : ""}` }), select), lv),
        detail ? el("small", { class: "muted build-fx", text: isSpine ? (detail.levels[String(Math.min(3, cur[1]))] || { perks: [] }).perks.map((p) => p.d).join(" ") : detail.label || "" }) : null);
    };
    const changed = GEAR_SLOTS.some((s) => (tryLo.gear[s] || null) !== (now.gear[s] || null)) ||
      SPINE_SLOTS.some((s) => JSON.stringify(tryLo.spines[s] || null) !== JSON.stringify(now.spines[s] || null));
    const canEquip = changed && GEAR_SLOTS.every((s) => !tryLo.gear[s] || tryLo.gear[s] === now.gear[s] || owned(tryLo.gear[s])) &&
      SPINE_SLOTS.every((s) => !tryLo.spines[s] || (now.spines[s] && tryLo.spines[s][0] === now.spines[s][0]) || owned(tryLo.spines[s][0]));
    page.append(el("div", { class: "build" },
      el("section", { class: "build-slots" },
        el("h3", { text: changed ? "Trying" : "Your loadout" }),
        ...GEAR_SLOTS.map((s) => pick(s, false)), ...SPINE_SLOTS.map((s) => pick(s, true)),
        el("div", { class: "map-card-acts" },
          changed ? el("button", { type: "button", class: "toggle", "data-act": "build:reset", onclick: () => { st.tryOn = false; A.render(); } }, icon("undo"), el("span", { text: "Back to my loadout" })) : null,
          changed ? el("button", {
            type: "button", class: "fill", "data-act": "build:equip", disabled: !canEquip, tip: canEquip ? "Equip this when you download" : "You don't own everything in this build",
            onclick: () => {
              for (const s of GEAR_SLOTS) if ((tryLo.gear[s] || null) !== (now.gear[s] || null)) S.prog.equip[s] = tryLo.gear[s] || "";
              for (const s of SPINE_SLOTS) if (tryLo.spines[s] && (!now.spines[s] || tryLo.spines[s][0] !== now.spines[s][0])) S.prog.equip[s] = tryLo.spines[s][0];
              st.tryOn = false;
              toast("Build equipped: it's in your changes");
              A.render();
            },
          }, icon("check"), el("span", { text: "Equip this" })) : null)),
      el("section", { class: "build-stats" },
        el("h3", { text: "Stats" }),
        el("div", { class: "stat-rows" }, ...g.viewer.filter((row) => (!row.ach || A.achUnlocked(row.ach)) && (row.always || a[row.k] || b[row.k])).map((row) => {
          const max = ng() && row.maxNG ? row.maxNG : row.max;
          const span = Math.max(1e-9, max - row.min);
          const wa = Math.max(0, Math.min(1, (a[row.k] - row.min) / span)), wb = Math.max(0, Math.min(1, (b[row.k] - row.min) / span));
          const diff = b[row.k] - a[row.k];
          const bar = el("span", { class: "stat-bar" }, el("span", { class: "stat-fill" }), changed ? el("span", { class: `stat-try ${diff >= 0 ? "up" : "down"}` }) : null);
          bar.firstChild.style.width = `${wa * 100}%`;
          if (changed) { bar.lastChild.style.left = `${Math.min(wa, wb) * 100}%`; bar.lastChild.style.width = `${Math.abs(wb - wa) * 100}%`; }
          return el("div", { class: "stat-row" },
            el("span", { class: "stat-n", text: row.n }), bar,
            el("b", { class: "stat-v", text: show(row, changed ? b[row.k] : a[row.k]) }),
            changed && Math.abs(diff) > 1e-9 ? el("small", { class: `stat-d ${diff > 0 ? "up" : "down"}`, text: `${diff > 0 ? "+" : "−"}${show(row, Math.abs(diff))}` }) : el("small", { class: "stat-d" }));
        })))));
  }

  window.SBMoves = moves;
  window.SBBuilds = builds;
})();
