/*
 * Stellar Blade: C2 - the dialogue browser: every NPC conversation, its branches, and which way your save goes
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * From dialogue.js (the game's interaction graphs: structure, conditions, actions and string keys, loaded when the
 * page opens). The lines themselves are the game's writing: they come from the player's own pack.
 */
(function () {
  "use strict";

  const { el, icon, fmt, toast } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS } = A;
  const CX = window.SBCodex;
  const DATA = { ready: () => !!window.SB_DIALOGUE, load: () => CX.loadScript("dialogue.js?v=5bb658c19b", () => !!window.SB_DIALOGUE) };
  const WORLD = { ready: () => !!(window.SBMap && window.SBMap.ready()), load: () => window.SBMap.whenReady() };
  const st = { pick: null, q: "" };
  // WorldTable aliases the conditions use -> the world (persistent level) Eve's save names
  const WORLDS = { Xion: "E04", WasteLandA: "E03_WasteLand_P", WasteLandB: "E05_GreatDesert_P", DrownedEidosDistrict: "F02", DEDA: "F01",
    SpaceElevator: "B07", Matrix: "Matrix_XI", AltessLevoire: "AltesLab_P", AbyssLevoire: "AbyssLab_P", Nest: "C05" };

  // ------------------------------------------------------------------ evaluating against the save: true, false or null (can't tell)
  const D = () => window.SB_DIALOGUE;
  const notEq = (eq) => /^(NOT|Not|NotEqual|ESBEQ_NotEqual|Not_Equal)$/.test(String(eq || ""));
  const flip = (v, eq) => (v === null ? null : notEq(eq) ? !v : v);
  const questDone = (q) => ["done", "done-pending"].includes(A.questNow(q));
  function spawnPresent(key) {
    const ids = window.SB_WORLD && window.SB_WORLD.people && window.SB_WORLD.people.ids;
    const id = ids && ids[key];
    if (!id) return null;
    const n = (S.cur.npcs || []).find((x) => x.spawnId === id);
    return n ? n.life === 1 && !n.hidden : false;
  }
  function condition(alias, depth = 0) {
    if (depth > 8) return null;
    const c = D().conds[alias];
    if (c) {
      const [type, eq, s1] = c;
      let v = null;
      if (/Achievement$/.test(type)) v = A.achUnlocked(s1 || c[5]);
      else if (type === "QuestState") v = /Complete/i.test(c[3] || c[5] || "Complete") ? questDone(s1) : A.questNow(s1) === "active";
      else if (type === "IsInWorld") v = WORLDS[s1] ? !!S.cur.eve && S.cur.eve.map === WORLDS[s1] : null;
      else if (type === "IsValidActor" || type === "IsAliveSpawnActor") v = spawnPresent(s1);
      else if (type === "IsNewGamePlus") v = !!S.cur.ng;
      else if (type === "Entitlement" || type === "NetworkEnable") v = true;
      return flip(v, eq);
    }
    const g = D().groups[alias];
    if (g) return combine(g[0] === "OR" ? "any" : "all", g[1].map((m) => condition(m, depth + 1)));
    return A.achUnlocked(alias); // switches list achievements (Xion_Phase_5…) directly
  }
  function combine(how, vals) {
    if (how === "any") return vals.some((v) => v === true) ? true : vals.every((v) => v === false) ? false : null;
    return vals.some((v) => v === false) ? false : vals.every((v) => v === true) ? true : null;
  }
  function flagsOf(d) {
    const f = Object.create(null);
    for (const n of S.cur.npcs || []) if (d.npc.includes(n.alias)) Object.assign(f, n.flags || {});
    return f;
  }
  function stepDone(q, g) {
    if (questDone(q)) return true;
    const steps = (GAME.questSteps && GAME.questSteps[q]) || [];
    const i = steps.findIndex((s) => s[0] === g);
    return i < 0 ? null : A.questStepNow(q) > i;
  }
  /** The value a check node has in the save (true/false/null), and for a switch the pin it takes. */
  function evaluate(kind, x, d) {
    switch (kind) {
      case "ach": return A.achUnlocked(x.a);
      case "quest": return /Complete/i.test(x.state || "") ? questDone(x.q) : /Progress/i.test(x.state || "") ? A.questNow(x.q) === "active" : null;
      case "step": return flip(stepDone(x.q, x.g), x.eq);
      case "task": return questDone(x.q) ? true : null;
      case "item": { const c = A.canon(x.i); return ITEMS[c] ? A.current(c) >= (x.n || 1) : null; }
      case "env": { const t = S.cur.envTags[x.e]; return t ? String(t).toLowerCase() === String(x.s).toLowerCase() : null; }
      case "all": return combine("all", x.c.map((c) => condition(c)));
      case "any": return combine("any", x.c.map((c) => condition(c)));
      case "cond": return combine("all", x.c.map((c) => condition(c)));
      case "flagis": { const f = flagsOf(d); if (!(x.k in f)) return x.v === 0 || x.v === "0" ? !notEq(x.eq) : notEq(x.eq) ? true : null; return flip(String(f[x.k]) === String(x.v), x.eq); }
      default: return null;
    }
  }
  function takenPin(kind, x, d, pins) {
    if (kind === "switch") {
      for (let i = 0; i < x.c.length; i++) {
        const v = condition(x.c[i]);
        if (v === null) return null;
        if (v) return i === 0 ? "Condition" : `Condition${i + 1}`;
      }
      return "Default";
    }
    const v = evaluate(kind, x, d);
    if (v === null) return null;
    const yes = pins.find((p) => /^(True|Success)$/.test(p)), no = pins.find((p) => /^(False|Fail|Failed)$/.test(p));
    return v ? yes || null : no || null;
  }

  // ------------------------------------------------------------------ describing nodes
  const qn = (q) => (GAME.quests[q] ? GAME.quests[q].n : q);
  const itn = (i) => { const c = A.canon(i); return ITEMS[c] ? ITEMS[c].name : String(i).replace(/_/g, " "); };
  const condText = (alias) => {
    const c = D().conds[alias];
    if (!c) return D().groups[alias] ? alias.replace(/_/g, " ") : alias.replace(/^Ach_/, "").replace(/_/g, " ");
    const [type, eq, s1] = c;
    const not = notEq(eq) ? "not " : "";
    if (/Achievement$/.test(type)) return `${not}${String(s1 || c[5]).replace(/^Ach_/, "").replace(/_/g, " ")}`;
    if (type === "QuestState") return `${qn(s1)} ${not}${/Complete/i.test(c[3] || "") ? "done" : "active"}`;
    if (type === "IsInWorld") return `${not}in ${A.regionOfMap(WORLDS[s1]) || s1}`;
    if (type === "IsValidActor" || type === "IsAliveSpawnActor") return `${not}${s1} is there`;
    return `${type} ${[s1, c[3], c[5]].filter((x) => x && x !== "None").join(" ")}`.trim();
  };
  function describe(kind, x) {
    switch (kind) {
      case "root": return ["play", "Conversation starts"];
      case "prompt": return ["bubble", `Prompt: ${A.gameText(x.text) || x.text}`];
      case "ach": return ["check", `If ${String(x.a).replace(/^Ach_/, "").replace(/_/g, " ")}`];
      case "quest": return ["list", `If ${qn(x.q)} is ${/Complete/i.test(x.state || "") ? "done" : "active"}`];
      case "step": { const steps = (GAME.questSteps && GAME.questSteps[x.q]) || []; const i = steps.findIndex((s) => s[0] === x.g); return ["list", `If ${qn(x.q)} step ${i >= 0 ? i + 1 : x.g} is done`]; }
      case "task": return ["list", `If a task of ${qn(x.q)} is done`];
      case "item": return ["crate", `If you have ${x.n > 1 ? `${x.n}× ` : ""}${itn(x.i)}`];
      case "env": return ["pin", `If ${x.e} is ${x.s}`];
      case "all": case "cond": return ["check", `If ${x.c.map(condText).join(" and ")}`];
      case "any": return ["check", `If ${x.c.map(condText).join(" or ")}`];
      case "switch": return ["list", "Depending on the story"];
      case "getflag": return ["tag", `Reads flag ${x.k}`];
      case "flagis": return ["tag", `If flag ${x.k} ${notEq(x.eq) ? "≠" : "="} ${x.v}`];
      case "setflag": return ["tag", `Sets flag ${x.k} ${x.add ? `+= ${x.v}` : `= ${x.v}`}`];
      case "random": return ["loop", "One at random"];
      case "pick": return ["loop", "One of these"];
      case "choiceseen": return ["eye", "Depending on choices already seen"];
      case "questtask": return ["flag", `Progresses ${x.t}`];
      case "startquest": return ["flag", `Starts ${qn(x.q)}`];
      case "takeitem": return ["crate", `Takes ${x.n > 1 ? `${x.n}× ` : ""}${itn(x.i)}`];
      case "giveitem": return ["crate", `Gives ${x.n > 1 ? `${x.n}× ` : ""}${itn(x.i)}`];
      case "setenv": return ["pin", `Sets ${x.e} to ${x.s}`];
      case "zoneevent": return ["sparkle", `Event ${x.e}`];
      case "shop": return ["store", `Opens ${x.shop || x.type || "the shop"}`];
      case "ui": return ["grid", `Opens ${String(x.type || "a menu").replace(/([a-z])([A-Z])/g, "$1 $2")}`];
      case "do": return (x.acts || []).length ? ["sparkle", (x.acts || []).map((a) => [a.do, a.a || a.asset || a.k || ""].filter(Boolean).join(" ")).join(", ")] : null;
      case "puzzle": return ["lock", "Starts a puzzle"];
      case "save": return ["download", "Saves the game"];
      case "failmsg": return ["x", "Shows a message"];
      default: return null; // control flow and debug nodes are left out
    }
  }

  // ------------------------------------------------------------------ rendering
  function lines(asset) {
    const takes = D().theaters[asset] || [];
    const out = [];
    for (const [, , , ls] of takes) for (const [spk, key] of ls) out.push([D().speakers[spk] || "", key]);
    return out;
  }
  function theaterNode(x) {
    const ls = lines(x.asset);
    const box = el("div", { class: "dlg-lines" }, ...ls.map(([who, key]) => el("p", { class: "dlg-line" },
      who ? el("b", { text: who }) : null, el("span", { text: A.gameText(key) || (A.hasTexts() ? key : "…") }))));
    return box;
  }
  function renderBlock(d, start, seen, depth) {
    const out = el("div", { class: "dlg-block" });
    let i = start, guard = 0;
    while (i !== null && i !== undefined && guard++ < 400) {
      if (seen.has(i)) { out.append(el("p", { class: "dlg-node muted", text: "↺ back to an earlier point" })); break; }
      seen.add(i);
      const [kind, x, children] = d.nodes[i];
      const pins = [...new Set(children.map((c) => c[0]))];
      if (kind === "call" || kind === "goto") {
        out.append(el("p", { class: "dlg-node dlg-jump" }, icon("arrowRight"), el("a", { href: `#dlg-${x.name}`, text: (x.name || "").replace(/_/g, " ") })));
      } else if (kind === "theater") {
        out.append(theaterNode(x));
        if (x.choices && x.choices.length) {
          out.append(el("div", { class: "dlg-branches" }, ...x.choices.map(([key, , pin]) => {
            const sub = children.filter((c) => c[0] === pin).map((c) => c[1]);
            return el("div", { class: "dlg-branch" }, el("p", { class: "dlg-choice" }, icon("chevronRight"), el("span", { text: A.gameText(key) || (A.hasTexts() ? key : "A choice") })),
              ...sub.map((s) => renderBlock(d, s, new Set(seen), depth + 1)));
          })));
          break;
        }
      } else {
        const desc = describe(kind, x);
        if (desc) out.append(el("p", { class: "dlg-node" }, icon(desc[0]), el("span", { text: desc[1] })));
      }
      if (kind === "theater" && x.choices && x.choices.length) break;
      if (pins.length > 1 || (pins.length === 1 && pins[0] !== "Exec" && kind !== "theater")) {
        const taken = takenPin(kind, x, d, pins);
        out.append(el("div", { class: "dlg-branches" }, ...pins.map((p) => {
          const label = kind === "switch" ? (p === "Default" ? "Otherwise" : condText(x.c[p === "Condition" ? 0 : Number(p.replace("Condition", "")) - 1] || p)) : /^(True|Success)$/.test(p) ? "Yes" : /^(False|Fail|Failed)$/.test(p) ? "No" : p;
          return el("div", { class: `dlg-branch${taken === p ? " taken" : taken ? " not" : ""}` },
            el("p", { class: "dlg-pin" }, el("span", { text: label }), taken === p ? el("small", { class: "pstate here", text: "now" }) : null),
            ...children.filter((c) => c[0] === p).map((c) => renderBlock(d, c[1], new Set(seen), depth + 1)));
        })));
        break;
      }
      const next = children.filter((c) => c[0] === "Exec").map((c) => c[1]);
      if (next.length > 1) { for (const n of next.slice(1)) out.append(renderBlock(d, n, seen, depth)); }
      i = next.length ? next[0] : null;
    }
    return out;
  }

  function dialogues(page) {
    if (CX.needs(page, DATA, WORLD)) return;
    CX.texts();
    const all = Object.entries(D().dialogues).filter(([k]) => !/SysTest|Test_/.test(k));
    const who = (d) => (d.who.length ? d.who.join(", ") : d.npc.join(", ") || "?");
    if (!st.pick || !D().dialogues[st.pick]) st.pick = all[0][0];
    const list = el("nav", { class: "dlg-list" });
    const fill = () => {
      list.textContent = "";
      for (const [k, d] of all.filter(([k, d]) => CX.matches(`${who(d)} ${k}`)).sort((a, b) => who(a[1]).localeCompare(who(b[1])) || a[0].localeCompare(b[0]))) {
        list.append(el("button", { type: "button", class: "dlg-pick" + (k === st.pick ? " on" : ""), "data-act": `dlg:${k}`, onclick: () => { st.pick = k; A.render(); } },
          el("b", { text: who(d) }), el("small", { text: k.replace(/_/g, " ") })));
      }
    };
    fill();
    const d = D().dialogues[st.pick];
    const detail = el("article", { class: "dlg-detail" },
      el("h3", { text: who(d) }), el("small", { class: "muted", text: st.pick }),
      !A.hasTexts() ? CX.packNote("The lines") : null,
      el("section", null, renderBlock(d, d.root, new Set(), 0)),
      ...Object.entries(d.labels).map(([name, idx]) => el("section", { id: `dlg-${name}`, class: "dlg-section" },
        el("h4", { text: name.replace(/_/g, " ") }), renderBlock(d, idx, new Set(), 0))));
    page.append(el("div", { class: "codex-top" }, CX.search("Find a person or conversation", fill)),
      el("div", { class: "dlg" }, list, detail));
  }

  window.SBDialogues = dialogues;
})();
