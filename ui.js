/*
 * Stellar Blade: C2 - interface building blocks: icons, tooltips, gauges
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Everything is built with DOM calls (no innerHTML), so nothing read from a save is ever parsed as markup.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ icons: one 24x24 stroke path each (original artwork)
  const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const PATHS = {
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    hanger: "M12 8.6V8c0-1 2-1.6 2-3.2a2 2 0 0 0-4-.2M12 8.6l-8.4 6.8c-.8.7-.3 1.9.7 1.9h15.4c1 0 1.5-1.2.7-1.9z",
    chevrons: "M6 12.5l6-6 6 6M6 18.5l6-6 6 6",
    tree: C(12, 5, 2) + C(6, 19, 2) + C(18, 19, 2) + "M12 7v6M6 17v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2",
    flag: "M5 21V4M5 4h12l-2.5 4L17 12H5",
    list: "M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4.5 18h2",
    tent: "M2.5 20h19M12 4 4 20M12 4l8 16M12 13l-3 7M12 13l3 7",
    store: "M4 11v9h16v-9M3 8l2-4h14l2 4c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3S3 9.7 3 8zM10 20v-5h4v5",
    disc: C(12, 12, 9) + C(12, 12, 2.5),
    photos: "M8 4h12v12H8zM4 8v12h12M8 13l3-3 3 3 2-2 4 4",
    cup: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4.5M16 6h3a3 3 0 0 1-3 4.5M12 13v4M8 20.5h8M10 17h4v3.5h-4z",
    wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
    search: C(11, 11, 6.5) + "M16 16l4.5 4.5",
    coin: C(12, 12, 8.5) + C(12, 12, 4.5),
    nut: "M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" + C(12, 12, 3),
    layers: "M12 3.5l9 4.5-9 4.5-9-4.5zM3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5",
    core: "M12 3l7 9-7 9-7-9zM12 15.5v-7M9.5 11 12 8.5l2.5 2.5",
    potion: "M10 3h4M10.5 3v4.6a6.5 6.5 0 1 0 3 0V3M6.5 14.5h11",
    bullet: "M9 21V10c0-3 1.4-5.8 3-7 1.6 1.2 3 4 3 7v11zM9 17h6",
    hook: C(15, 4.5, 1.5) + "M15 6v8a5 5 0 0 1-10 0v-3l3 2.5",
    chip: "M7 7h10v10H7zM10 10h4v4h-4zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4",
    spine: "M12 2.5v19M8.5 5h7M7 9.5h10M7.5 14h9M9 18.5h6",
    suit: "M9 3l3 2 3-2 5.5 3.3-2 4.2L16 9.4V21H8V9.4l-2.5 1.1-2-4.2z",
    pattern: "M4 4h16v16H4zM4 12l8-8M4 20 20 4M12 20l8-8",
    sparkle: "M11 3l1.9 5.6 5.6 1.9-5.6 1.9L11 18l-1.9-5.6-5.6-1.9 5.6-1.9zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
    fish: "M2 7.5l3 4.5-3 4.5M5 12c2.8-3.8 6-5.5 9.5-5.5 3 0 5.2 2.7 6.5 5.5-1.3 2.8-3.5 5.5-6.5 5.5-3.5 0-6.7-1.7-9.5-5.5z" + C(16, 11, 0.9),
    can: "M7 5.5C7 4.1 9.2 3 12 3s5 1.1 5 2.5v13c0 1.4-2.2 2.5-5 2.5s-5-1.1-5-2.5zM7 5.5C7 6.9 9.2 8 12 8s5-1.1 5-2.5M7 10.5h10M7 15.5h10",
    book: "M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5zM5 19.5A2.5 2.5 0 0 0 7.5 22H19v-5",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    check: "M5 12.5l4.5 4.5L19 7.5",
    x: "M6.5 6.5l11 11M17.5 6.5l-11 11",
    undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
    lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    ticket: "M3 6.5h18V10a2 2 0 0 0 0 4v3.5H3V14a2 2 0 0 0 0-4zM14.5 6.5v2M14.5 11v2M14.5 15.5v2",
    flask: "M9 3h6M10 3v6.2l-5.4 9.2A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.2V3M7.2 15h9.6",
    download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
    upload: "M12 16V5M7 9.5l5-5 5 5M5 20h14",
    file: "M6 3h8.5L19 7.5V21H6zM14 3v5h5",
    eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" + C(12, 12, 3),
    eyeOff: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" + C(12, 12, 3) + "M4 4l16 16",
    pin: "M12 21.5s-6.5-6-6.5-11.5a6.5 6.5 0 0 1 13 0c0 5.5-6.5 11.5-6.5 11.5z" + C(12, 10, 2.3),
    target: C(12, 12, 7.5) + C(12, 12, 3) + "M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3",
    reset: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9",
    play: "M8 5v14l11-7z",
    dotOff: C(12, 12, 4) + "M4 4l16 16",
    cart: "M2.5 4H5l2.4 11h11.1L21 7.5H6" + C(9, 19.5, 1.4) + C(17, 19.5, 1.4),
    tag: "M3 12.5V4h8.5l9.5 9.5-8.5 8.5z" + C(7.5, 8.5, 1.4),
    loop: "M8 8.5a3.5 3.5 0 1 0 0 7c2.6 0 5.4-7 8-7a3.5 3.5 0 1 1 0 7c-2.6 0-5.4-7-8-7z",
    bubble: "M4 5h16v11H9.5L4 20.5zM8.5 10.5l2.3 2.3 4.7-4.6",
    image: "M4 5h16v14H4zM4 15.5 8.5 11l4 4 2.5-2.5 5 5" + C(15.5, 9.5, 1.5),
    trash: "M4 7h16M9.5 7V4h5v3M6 7l1 13.5h10L18 7",
    menu: "M4 7h16M4 12h16M4 17h16",
    feather: "M20 4C13 4 7.5 8 6.5 16.5L4 20M6.5 16.5c5.5 0 9.5-3.5 11.5-9M9 12.5h5.5",
    sword: "M20.5 3.5 10 14M20.5 3.5H16M20.5 3.5V8M7.5 13.5l3 3M8.5 15.5l-5 5",
    skull: "M12 3a7.5 7.5 0 0 0-4.5 13.5V20h9v-3.5A7.5 7.5 0 0 0 12 3zM10.5 20v-2.5M13.5 20v-2.5" + C(9, 11, 1.5) + C(15, 11, 1.5),
    heart: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z",
    bolt: "M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5z",
    star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1-4.4-4.3 6.1-.9z",
    map: "M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20",
    person: C(12, 7.5, 4) + "M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5",
    crown: "M3.5 8l4.5 4 4-7 4 7 4.5-4-2 11h-13zM5.5 19h13",
    key: C(8, 15, 4) + "M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2",
    layersMap: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
    hair: "M6.5 20C4.5 16 4.5 10 7.5 7c3-3 8-2.5 10 .5 2.2 3.2 1.5 8.5-.8 12.5M8.5 9c2.5 1.2 5.5 1 7.5-1",
    earring: "M8 3v4.5M16 3v4.5M8 7.5l-2.6 4.3a2.6 2.6 0 1 0 5.2 0zM16 7.5l-2.6 4.3a2.6 2.6 0 1 0 5.2 0z",
    glasses: C(6.5, 14, 3.5) + C(17.5, 14, 3.5) + "M10 14h4M3 14l-.5-5.5M21 14l.5-5.5",
    drone: "M3.5 7h6M14.5 7h6M6.5 7v2.5M17.5 7v2.5M6.5 9.5h11l-1.5 5h-8zM10 14.5l-1 3M14 14.5l1 3",
    power: "M12 3v8M7 5.6a8 8 0 1 0 10 0",
    copy: "M8 8h12v12H8zM16 8V4H4v12h4",
    cloud: "M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6 3.8 3.8 0 0 1-.3 7.4z",
    sliders: "M4 7h9M17 7h3M4 17h3M11 17h9" + C(15, 7, 2) + C(9, 17, 2),
    chevronDown: "M6 9l6 6 6-6",
    chevronRight: "M9 6l6 6-6 6",
    arrowRight: "M5 12h14M13 6l6 6-6 6",
    medal: C(12, 14.5, 6) + "M8.5 3h7l-2 5h-3z",
    dot: C(12, 12, 3.5),
    crate: "M4 8l8-4.5L20 8v8.5L12 21l-8-4.5zM4 8l8 4.5L20 8M12 12.5V21",
    circle: C(12, 12, 8),
    terminal: "M3.5 5h17v14h-17zM7 9.5l3 2.5-3 2.5M12.5 15H17",
    info: C(12, 12, 9) + "M12 11v5.5M12 7.6v.4",
    clock: C(12, 12, 8.5) + "M12 7.5V12l3 2",
  };
  const FILLED = new Set(["play", "dot"]);
  const NS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") e.textContent = v;
      else if (k === "tip") e.setAttribute("data-tip", v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) e.append(kid);
    return e;
  }

  function icon(name, cls) {
    return svg("svg", {
      viewBox: "0 0 24 24", class: `ic${FILLED.has(name) ? " ic-fill" : ""}${cls ? " " + cls : ""}`, "aria-hidden": "true", focusable: "false",
    }, svg("path", { d: PATHS[name] || PATHS.dot }));
  }

  /** el("button", {class, text, tip, onclick, ...}, ...children). `tip` is the tooltip; icon-only controls also get it as their label. */
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    const a = attrs || {};
    for (const [k, v] of Object.entries(a)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "tip") { e.setAttribute("data-tip", v); if (!a["aria-label"]) e.setAttribute("aria-label", v); }
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
    return e;
  }

  const fmt = (n) => Number(n).toLocaleString("en-US");

  // ------------------------------------------------------------------ tooltips: hover with a mouse, focus with a keyboard, long-press on touch
  let tipEl = null, tipFor = null, tipTimer = 0, pressTimer = 0, swallowClick = 0;
  function tipBox() {
    if (!tipEl) { tipEl = el("div", { class: "tip", id: "tip", role: "tooltip" }); document.body.append(tipEl); }
    return tipEl;
  }
  function showTip(t) {
    const text = t.getAttribute("data-tip");
    if (!text || !t.isConnected) return;
    const box = tipBox();
    box.textContent = text;
    box.classList.add("show");
    const r = t.getBoundingClientRect();
    const w = box.offsetWidth, h = box.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    tipFor = t;
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (tipEl) tipEl.classList.remove("show");
    tipFor = null;
  }
  const tipTarget = (n) => (n && n.closest ? n.closest("[data-tip]") : null);
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const t = tipTarget(e.target);
    if (t === tipFor) return;
    hideTip();
    if (t) tipTimer = setTimeout(() => showTip(t), 260);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    const t = tipTarget(e.target);
    if (t && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = tipTarget(e.target);
    if (t && t.matches(":focus-visible")) showTip(t);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") { hideTip(); return; }
    clearTimeout(pressTimer);
    const t = tipTarget(e.target);
    if (!t) { hideTip(); return; }
    pressTimer = setTimeout(() => { showTip(t); swallowClick = Date.now(); }, 430);
  });
  for (const ev of ["pointerup", "pointercancel"]) document.addEventListener(ev, () => clearTimeout(pressTimer));
  // a long-press only shows the tip: it doesn't also press the button
  document.addEventListener("click", (e) => {
    if (swallowClick && Date.now() - swallowClick < 800) { e.preventDefault(); e.stopPropagation(); }
    swallowClick = 0;
  }, true);
  document.addEventListener("contextmenu", (e) => { if (tipTarget(e.target) && swallowClick) e.preventDefault(); });
  window.addEventListener("scroll", () => { clearTimeout(pressTimer); hideTip(); }, true);

  // ------------------------------------------------------------------ gauges
  /** Ring gauge: blue for what's in the save, gold for what the download adds. */
  function ring(have, added, total) {
    const r = 26, c = 2 * Math.PI * r;
    const s = svg("svg", { viewBox: "0 0 64 64", class: "ring", "aria-hidden": "true" },
      svg("circle", { cx: 32, cy: 32, r, class: "ring-track" }));
    const a = total ? Math.min(1, have / total) : 0;
    const b = total ? Math.min(1 - a, added / total) : 0;
    const arc = (frac, off, cls) => svg("circle", {
      cx: 32, cy: 32, r, class: cls, transform: "rotate(-90 32 32)",
      "stroke-dasharray": `${(frac * c).toFixed(2)} ${c.toFixed(2)}`, "stroke-dashoffset": (-off * c).toFixed(2),
    });
    if (a > 0) s.append(arc(a, 0, "ring-own"));
    if (b > 0) s.append(arc(b, a, "ring-new"));
    return s;
  }

  /** Thin bar version of the ring. */
  function meter(have, added, total) {
    const own = el("span", { class: "meter-own" });
    const add = el("span", { class: "meter-new" });
    const pct = (n) => `${total ? Math.max(0, Math.min(100, (n / total) * 100)) : 0}%`;
    own.style.width = pct(have);
    add.style.width = pct(added);
    return el("span", { class: "meter", "aria-hidden": "true" }, own, add);
  }

  /**
   * Level pips. Clicking a pip sets that level; clicking the highest lit pip takes one level off.
   * o: { n, was, max, normal, label, pick(level) }
   */
  function pips(o) {
    const box = el("div", { class: "pips", role: "group", "aria-label": o.label });
    for (let k = 1; k <= o.max; k++) {
      const on = k <= o.n, saved = k <= o.was;
      const cls = ["pip", k > o.normal ? "ng" : "", on ? "on" : "", on !== saved ? "new" : ""].filter(Boolean).join(" ");
      box.append(el("button", {
        type: "button", class: cls, "aria-pressed": String(on),
        tip: `${o.label} ${k}${k > o.normal ? " · New Game+" : ""}`,
        onclick: () => o.pick(k === o.n ? k - 1 : k),
      }));
      if (k === o.normal && o.max > o.normal) box.append(el("span", { class: "pip-gap", "aria-hidden": "true" }, icon("loop")));
    }
    return box;
  }

  /** Segmented control. items: [{ key, icon, label, n, tip, act }] */
  function seg(items, current, onPick, label) {
    return el("div", { class: "seg", role: "group", "aria-label": label }, ...items.map((it) => el("button", {
      type: "button", "aria-pressed": String(current === it.key), tip: it.tip, "data-act": it.act, onclick: () => onPick(it.key),
    }, it.icon ? icon(it.icon) : null, it.label ? el("span", { text: it.label }) : null,
    it.n !== undefined && it.n !== null ? el("span", { class: "n", text: String(it.n) }) : null)));
  }

  // ------------------------------------------------------------------ toast
  let toastTimer;
  function toast(msg, error) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle("error", !!error);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), error ? 6500 : 3200);
  }

  root.SBUI = { el, svg, icon, fmt, ring, meter, pips, seg, toast, hideTip, PATHS };
})(window);
