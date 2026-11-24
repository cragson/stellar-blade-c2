/*
 * Stellar Blade: C2 - enemy AI and attacks, shown in the bestiary
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * From ai.js (the game's behaviour trees and enemy skills, loaded when you open an enemy's AI): each attack with its
 * damage and how to answer it (parry, perfect parry, block, dodge), and the behaviour tree in plain phrases.
 */
(function () {
  "use strict";

  const { el, icon, fmt, toast } = window.SBUI;
  const A = window.SBApp;
  const CX = window.SBCodex;
  const st = { open: new Set() };
  const HOW = { p: ["Parry", "parry"], P: ["Perfect parry", "pparry"], g: ["Block", "block"], d: ["Perfect dodge", "dodge"], r: ["Projectile", "proj"] };
  const FLAG = { w: ["Warning attack", "warn"], b: ["Blink check (blue)", "blink"], R: ["Rage", "rage"] };
  const load = () => CX.loadScript("ai.js?v=3f536e5065", () => !!window.SB_AI);

  /** How Eve can answer one hit: the letters, as chips. Neither parry nor block means it can't be guarded. */
  function answers(how) {
    const chips = [...how].filter((c) => HOW[c]).map((c) => el("span", { class: `how ${HOW[c][1]}`, text: HOW[c][0] }));
    if (!/[pg]/.test(how)) chips.unshift(el("span", { class: "how noguard", text: "Can't guard" }));
    return chips;
  }
  function attacks(X, tree, phys, range) {
    const list = (X.attacks[tree] || []).map((k) => [k, X.skills[k]]).filter(([, s]) => s);
    if (!list.length) return null;
    return el("table", { class: "beast-table ai-attacks" },
      el("thead", null, el("tr", null, ...["Attack", "Damage per hit", "Answer", "Cooldown"].map((h) => el("th", { text: h })))),
      el("tbody", null, ...list.map(([k, [n, kind, cd, hits, flags]]) => {
        const power = kind === "ranged" ? range : phys;
        const dmg = hits.map(([r]) => Math.round(r * power)).filter((v) => v > 0);
        const hows = [...new Set(hits.map(([, h]) => h))];
        return el("tr", null,
          el("td", null, el("b", { text: n }), ...[...(flags || "")].filter((f) => FLAG[f]).map((f) => el("span", { class: `how ${FLAG[f][1]}`, text: FLAG[f][0] })),
            el("small", { class: "muted", text: ` ${kind}` })),
          el("td", { text: dmg.length ? dmg.map(fmt).join(" + ") : "–" }),
          el("td", null, el("span", { class: "hows" }, ...(hows.length === 1 ? answers(hows[0]) : hows.map((h, i) => el("span", { class: "how-hit" }, el("small", { text: `hit ${i + 1}` }), ...answers(h)))))),
          el("td", { text: cd ? `${cd} s` : "" }));
      })));
  }
  function treeNode(X, node, depth) {
    const [kind, phrase, decos, kids] = node;
    const cond = (decos || []).filter((d) => d >= 0).map((d) => X.phrases[d][0]).join(" & ");
    const label = kind === "T" ? X.phrases[phrase][0] : kind === "S" ? "first that works:" : "in order:";
    const line = el("span", { class: `ai-line ${kind}` }, cond ? el("span", { class: "ai-cond", text: `[${cond}]` }) : null, el("span", { text: ` ${label}` }));
    if (!kids || !kids.length) return el("li", null, line);
    if (depth > 12) return el("li", null, line, el("span", { class: "muted", text: " …" }));
    const det = el("details", { open: depth < 2 || undefined }, el("summary", null, line), el("ul", null, ...kids.map((k) => treeNode(X, k, depth + 1))));
    return el("li", null, det);
  }

  /** The AI part of a bestiary entry (window.SBCodexAI, called by codex.js). */
  window.SBCodexAI = function (b) {
    const box = el("div", { class: "ai" }, el("h4", { text: "Attacks and AI" }));
    if (!window.SB_AI) {
      box.append(el("button", { type: "button", class: "toggle", "data-act": "ai:load", onclick: () => load().then(() => A.render()).catch((e) => toast(e.message, true)) },
        icon("skull"), el("span", { text: "Show their attacks and behaviour" })));
      return box;
    }
    const X = window.SB_AI;
    const variants = b.v.map((v) => v[0]).filter((a) => X.chars[a]);
    if (!variants.length) { box.append(el("p", { class: "muted", text: "No behaviour data for this one." })); return box; }
    // variants usually share a tree: one block per distinct tree
    const trees = new Map();
    for (const a of variants) { const [t, phys, range] = X.chars[a]; if (!trees.has(t)) trees.set(t, { t, phys, range, who: [] }); trees.get(t).who.push(a); }
    for (const { t, phys, range, who } of [...trees.values()].slice(0, 4)) {
      const key = `${b.n}|${t}`;
      box.append(el("div", { class: "ai-tree" },
        trees.size > 1 ? el("small", { class: "muted", text: who.join(", ") }) : null,
        attacks(X, t, phys, range),
        el("button", { type: "button", class: "link-btn", "data-act": "ai:tree", onclick: () => { if (st.open.has(key)) st.open.delete(key); else st.open.add(key); A.render(); } },
          el("span", { text: st.open.has(key) ? "Hide the behaviour tree" : "Show the behaviour tree" })),
        st.open.has(key) && X.trees[t] ? el("ul", { class: "ai-nodes" }, treeNode(X, X.trees[t], 0)) : null));
    }
    return box;
  };
})();
