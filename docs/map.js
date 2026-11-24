/*
 * Stellar Blade: C2 - the world map: loot, collectables, enemies, people, quests and passcodes in every world
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A pannable, zoomable map per world, drawn from the positions in the game's level files (world.js, loaded
 * when the map opens). Each object shows whether your save still has it (a supply box still closed, a record
 * not yet in the Album), what's inside it, and can be a teleport target. The search finds loot ("Beta Core"
 * lights up every container that holds one), enemies, side quests, passcodes, areas and places.
 * With an icon pack that has maps (make_icon_pack.py), the game's own map art is drawn underneath.
 */
(function () {
  "use strict";

  const { el, icon, fmt, toast, PATHS } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS } = A;

  // layer order = how the chips are listed: what you collect, then the world, then who's in it
  const KIND = {
    supply: { n: "Supply box", icon: "crate", color: "#f2b84b" },
    item: { n: "Item", icon: "sparkle", color: "#4fc8f0" },
    core: { n: "Body or Beta Core", icon: "core", color: "#ff7eb6" },
    record: { n: "Record", icon: "book", color: "#86b4ff" },
    can: { n: "Can", icon: "can", color: "#6fdc9a" },
    passcode: { n: "Passcode lock", icon: "lock", color: "#c7a3ff" },
    corpse: { n: "Fallen soldier", icon: "person", color: "#b9bde3" },
    quest: { n: "Side quest step", icon: "flag", color: "#ffb86b" },
    photo: { n: "Photo challenge", icon: "photos", color: "#ffa3d1" },
    tear: { n: "Stellar Tear (NieR)", icon: "sparkle", color: "#e8e3c8" },
    lostitem: { n: "NIKKE lost item", icon: "star", color: "#7ee0ff" },
    camp: { n: "Camp", icon: "tent", color: "#4fc8f0" },
    place: { n: "Named place", icon: "pin", color: "#a6a8d6" },
    poi: { n: "Landmark", icon: "star", color: "#ffffff" },
    ammo: { n: "Ammo charger", icon: "bullet", color: "#ffd27f" },
    fusion: { n: "Fusion cell", icon: "bolt", color: "#ffe27a" },
    lift: { n: "Lift", icon: "chevrons", color: "#8c97ff" },
    door: { n: "Door", icon: "lock", color: "#8f93bd" },
    npc: { n: "Person", icon: "bubble", color: "#9fe0c9" },
    boss: { n: "Boss", icon: "crown", color: "#ff4d6d" },
    enemy: { n: "Enemy", icon: "skull", color: "#ff8a8a" },
  };
  const DEFAULT_LAYERS = ["supply", "item", "core", "record", "can", "passcode", "corpse", "quest", "photo", "tear", "lostitem", "camp", "poi", "ammo", "fusion", "npc", "boss"];
  const ORDER = ["F02", "E04", "E03_WasteLand_P", "AltesLab_P", "Matrix_XI", "E05_GreatDesert_P", "AbyssLab_P", "F01", "B07", "C05"];
  const V = {
    world: null, cx: 0, cy: 0, k: 0, layers: new Set(DEFAULT_LAYERS), left: false, sel: null, hl: null, hlLabel: "", q: "",
    floor: 0, reveal: new Set(), revealAll: false, codesOpen: true, story: false,
  };
  let M = null; // prepared markers and search index
  let ART = null; // the game's map images from the icon pack: {level: [{name, img, bg, x0, x1, y0, y1, z, image, back}]}
  let artLoad = null;

  let loading = null;
  function loadWorld() {
    if (window.SB_WORLD) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = "world.js?v=ddf5c9b1fc";
        tag.onload = resolve;
        tag.onerror = () => { loading = null; reject(new Error("The map data (world.js) couldn't be loaded.")); };
        document.head.append(tag);
      });
    }
    return loading;
  }

  /** The game's own map art, kept in this browser when an icon pack with maps was loaded (Tools > Item icons and map art). */
  function loadArt() {
    if (artLoad) return artLoad;
    artLoad = A.dbStore("kv", "readonly", (s) => s.get("worldmaps")).then((maps) => {
      ART = {};
      for (const [level, list] of Object.entries(maps || {})) {
        ART[level] = list.map((m) => {
          const image = new Image(), back = new Image();
          const redraw = () => draw(document.querySelector("#page .map-canvas"));
          image.onload = redraw;
          back.onload = redraw;
          image.src = m.img;
          if (m.bg) back.src = m.bg;
          return Object.assign({}, m, { image, back: m.bg ? back : null });
        });
      }
      if (Object.keys(ART).length) A.render();
    }).catch(() => { ART = {}; });
    return artLoad;
  }
  /** Map layers of a world (Xion has a surface and an underground); the one a position belongs to. */
  const floors = (world) => (ART && ART[world]) || [];
  const floorOf = (world, z) => {
    const f = floors(world);
    if (f.length < 2) return 0;
    let best = 0;
    f.forEach((m, i) => { if (Math.abs(z - m.z) < Math.abs(z - f[best].z)) best = i; });
    return best;
  };
  window.addEventListener("sb-worldmaps", () => { artLoad = null; ART = null; loadArt(); });

  const regionOf = (m) => A.regionOfMap(m) || m;
  const itemName = (a) => { const c = A.canon(a); return ITEMS[c] ? ITEMS[c].name : a; };
  const counts = (min, max) => (min === max ? (min > 1 ? `×${fmt(min)}` : "") : `×${fmt(min)}–${fmt(max)}`);

  /** Markers for every world: objects, enemies and people from world.js, camps, named places, quest steps. */
  function prepare() {
    const W = window.SB_WORLD;
    const all = [];
    const PC = {};
    for (const [key, code, desc, name, au, ad, used, found] of W.passcodes || []) {
      const al = GAME.album[key];
      PC[key] = { key, code, desc: desc && desc !== "No Data" ? desc : "", name, au, ad, used, found, group: al ? al.group : null };
    }
    for (const [map, v] of Object.entries(W.maps)) {
      for (const [alias, ki, x, y, z, init, li, ti, title, links] of v.objs) {
        const kind = W.kinds[ki];
        const loot = li >= 0 ? W.loot[li] : [];
        const m = { id: all.length, kind, map, alias, loc: [x, y, z], wx: y, wy: -x, init, loot, type: W.types[ti], lootText: loot.map(([a]) => itemName(a)) };
        for (const l of links || []) {
          const [t, a, b] = l.split(":");
          if (t === "r" && (GAME.album[a] || PC[a])) (m.records = m.records || []).push(a);
          if (t === "u" && PC[a]) (m.uses = m.uses || []).push(a);
          if (t === "c") { m.can = a; m.canAch = b || null; }
          if (t === "a") m.ach = a;
          if (t === "q") m.quest = a;
          if (t === "s") m.spawnId = Number(a);
        }
        const rec = m.records && m.records[0];
        m.name = title
          || (rec && PC[rec] ? `Passcode ${PC[rec].name ? PC[rec].name.replace(/^Passcode:\s*/, "") : PC[rec].desc || ""}`.trim()
            : rec && GAME.album[rec] ? GAME.album[rec].n : "")
          || (m.can && ITEMS[m.can] ? ITEMS[m.can].name : "")
          || ((kind === "item" || kind === "core") && loot.length ? itemName(loot[0][0]) : KIND[kind].n);
        all.push(m);
      }
    }
    // objects the game spawns itself (no place in the level files): where the save has them, if it does
    for (const [alias, ki, map, init, li, ti, title, links] of W.unplaced || []) {
      const at = S.cur.envPlaces && S.cur.envPlaces[alias];
      if (!at || (!at[0] && !at[1])) continue;
      const kind = W.kinds[ki];
      const loot = li >= 0 ? W.loot[li] : [];
      const m = { id: all.length, kind, map, alias, loc: at.slice(0, 3), wx: at[1], wy: -at[0], init, loot, type: W.types[ti], lootText: loot.map(([x]) => itemName(x)), fromSave: true };
      for (const l of links || []) {
        const [t, x, y] = l.split(":");
        if (t === "r" && (GAME.album[x] || W.passcodes)) (m.records = m.records || []).push(x);
        if (t === "c") { m.can = x; m.canAch = y || null; }
        if (t === "a") m.ach = x;
      }
      m.name = title || (m.can && ITEMS[m.can] ? ITEMS[m.can].name : "") || (kind === "core" && loot.length ? itemName(loot[0][0]) : KIND[kind].n);
      all.push(m);
    }
    // camps: one whose position is only approximate is left out when a placed camp of the same name is right
    // there (the Safehouse and its phone booth)
    const campList = Object.entries(A.WARP.camps);
    for (const [c, w] of campList) {
      const v = GAME.camps[c];
      if (w[3] && campList.some(([c2, w2]) => c2 !== c && !w2[3] && w2[0] === w[0] && GAME.camps[c2].n === v.n && Math.hypot(w2[1][0] - w[1][0], w2[1][1] - w[1][1]) < 3000)) continue;
      all.push({ id: all.length, kind: "camp", map: w[0], key: c, loc: w[1], wx: w[1][1], wy: -w[1][0], name: v.n, sub: v.type, lootText: [] });
    }
    // people move with the story, so they come from the save: the characters it keeps per zone, where it has them
    // now, if they're there (alive, not hidden, not moved on to another zone, their zone not retired by the story)
    const PEOPLE = W.people || { names: {}, zones: {}, transit: {}, drops: {} };
    const retired = (z) => (PEOPLE.transit[z] || []).some((a) => A.achUnlocked(a));
    const byAlias = new Map(all.filter((m) => m.alias).map((m) => [m.alias, m]));
    for (const n of S.cur.npcs || []) {
      const map = PEOPLE.zones[n.zone];
      if (!map) continue;
      const drop = PEOPLE.drops[String(n.spawnId)];
      if (drop) {
        // a data drone with a record: wherever the save has it now
        const known = byAlias.get(drop[0]);
        if (known) { known.loc = n.loc; known.wx = n.loc[1]; known.wy = -n.loc[0]; known.map = map; continue; }
        if (n.hidden) continue;
        all.push({ id: all.length, kind: "record", map, alias: drop[0], loc: n.loc, wx: n.loc[1], wy: -n.loc[0], name: "Data drone", records: drop[1], loot: [], lootText: [] });
        continue;
      }
      const name = PEOPLE.names[n.alias];
      const here = n.life === 1 && !n.hidden && n.active && n.enabled && (n.stay === "None" || n.stay === n.zone) && !retired(n.zone) && storyAllows(n.spawnId);
      if (!name || !here) continue;
      if (all.some((m) => m.kind === "npc" && m.name === name && m.map === map && Math.hypot(m.loc[0] - n.loc[0], m.loc[1] - n.loc[1]) < 500)) continue;
      all.push({ id: all.length, kind: "npc", map, alias: n.alias, loc: n.loc, wx: n.loc[1], wy: -n.loc[0], name, live: true, lootText: [] });
    }
    for (const [n, map, loc, key] of A.WARP.spots) all.push({ id: all.length, kind: "place", map, key, loc, wx: loc[1], wy: -loc[0], name: n, lootText: [] });
    for (const [q, step, map, x, y, z] of W.quests || []) {
      const info = GAME.quests[q];
      if (!info) continue;
      const steps = (GAME.questSteps && GAME.questSteps[q]) || [];
      all.push({ id: all.length, kind: "quest", map, q, step, loc: [x, y, z], wx: y, wy: -x, name: info.n, steps: steps.length,
        sub: steps[step] ? steps[step][1] : "", lootText: [] });
    }
    const byWorld = {};
    for (const m of all) (byWorld[m.map] = byWorld[m.map] || []).push(m);
    const worlds = ORDER.filter((w) => byWorld[w]).concat(Object.keys(byWorld).filter((w) => !ORDER.includes(w) && A.regionOfMap(w)));
    // search groups: item -> markers holding it; enemy and person names -> their spawns; quest -> its steps
    const loot = new Map(), groups = new Map();
    const add = (map, k, id) => map.set(k, [...(map.get(k) || []), id]);
    for (const m of all) {
      for (const [a] of m.loot || []) add(loot, A.canon(a), m.id);
      if (m.kind === "enemy" || m.kind === "boss" || m.kind === "npc") add(groups, `${m.kind}:${m.name}`, m.id);
      if (m.kind === "quest") add(groups, `quest:${m.q}`, m.id);
      for (const k of m.records || []) add(groups, `record:${k}`, m.id);
      if (m.kind === "tear" || m.kind === "lostitem" || m.kind === "photo") add(groups, `kind:${m.kind}`, m.id);
    }
    // where each passcode is entered: the lock that takes it, else the place the data names
    for (const pc of Object.values(PC)) {
      pc.locks = all.filter((m) => m.uses && m.uses.includes(pc.key)).map((m) => m.id);
      pc.sources = all.filter((m) => m.records && m.records.includes(pc.key)).map((m) => m.id);
    }
    M = { cur: S.cur, all, byWorld, worlds, loot, groups, PC, areas: W.areas || {}, spawnState: new Map((S.cur.npcs || []).map((n) => [n.spawnId, n])),
      dots: Object.fromEntries(Object.entries(W.maps).map(([k, v]) => [k, v.dots.map(([x, y]) => [y, -x])])),
      shapes: Object.fromEntries(Object.entries(W.maps).filter(([, v]) => v.shape).map(([k, v]) => [k, v.shape])) };
  }

  // the story's own rules for a spawn: achievements that must (not) be done, and the quest steps that spawn and
  // remove the character; the last of those your save has passed decides (a step "starts" once the quest is at it)
  const passed = (q, step, when) => {
    const st = A.questNow(q);
    if (st === "done" || st === "done-pending") return true;
    if (st !== "active" && st !== "step-pending") return false;
    const now = A.questStepNow(q);
    return when === "start" ? now >= step : now > step;
  };
  /** Whether the story has this spawn there now (people and enemies), by its rules in world.js. */
  function storyAllows(id) {
    const rule = ((window.SB_WORLD.people || {}).rules || {})[String(id)];
    if (!rule) return true;
    const [checks, events] = rule;
    if (checks.some(([a, mustNot]) => A.achUnlocked(a) === mustNot)) return false;
    if (!events.length) return true;
    let last = null;
    for (const [q, step, when, kind] of events) if (passed(q, step, when)) last = kind;
    return last === "spawn";
  }

  /** A passcode in your save: "used" (entered), "known" (in the Album), or "unknown". */
  function pcState(pc) {
    if (pc.ad && A.achUnlocked(pc.ad)) return "used";
    if (pc.au && A.achUnlocked(pc.au)) return "known";
    return "unknown";
  }

  /** "done" (collected, opened, active), "current" (a quest's step you're on), "left", or null if the save can't tell. */
  function statusOf(m) {
    switch (m.kind) {
      case "camp": return ["active", "pending"].includes(A.campNow(m.key)) ? "done" : "left";
      case "quest": {
        const st = A.questNow(m.q);
        if (st === "done" || st === "done-pending") return "done";
        const now = A.questStepNow(m.q);
        return now === m.step ? "current" : now > m.step ? "done" : "left";
      }
      case "enemy": case "boss": {
        // the save keeps the enemies it has met per zone: 5 = killed (until a camp rest brings them back)
        const n = m.spawnId && M.spawnState.get(m.spawnId);
        return n ? (n.life === 5 ? "done" : "left") : null;
      }
      case "photo": return m.quest ? (["done", "done-pending"].includes(A.questNow(m.quest)) ? "done" : "left") : null;
      case "place": case "item": case "npc": return null;
      default: break;
    }
    if (m.ach) return A.achUnlocked(m.ach) ? "done" : "left";
    if (m.records) {
      const k = m.records[0];
      const ach = M.PC[k] ? M.PC[k].au : GAME.album[k] && GAME.album[k].ach;
      if (ach) return A.achUnlocked(ach) ? "done" : "left";
    }
    if (m.uses) { const pc = M.PC[m.uses[0]]; if (pc.ad) return A.achUnlocked(pc.ad) ? "done" : "left"; }
    if (m.canAch) return A.achUnlocked(m.canAch) ? "done" : "left";
    if (!m.init) return null;
    const tag = S.cur.envTags[m.alias];
    if (!tag) return "left";
    if (m.kind === "door" || m.kind === "lift") return null;
    return tag.toLowerCase() !== String(m.init).toLowerCase() ? "done" : "left";
  }
  const onFloor = (m) => floors(m.map).length < 2 || floorOf(m.map, m.loc[2]) === V.floor;
  /** "As in my save": spawns the story hasn't put there (yet, or any more) and objects not active yet are left out. */
  function inStory(m) {
    if (m.spawnId) return storyAllows(m.spawnId);
    const at = m.alias && S.cur.envPlaces && S.cur.envPlaces[m.alias];
    return !(at && at[3] === false);
  }
  const visible = (m) => onFloor(m) && ((V.layers.has(m.kind) && !(V.left && statusOf(m) === "done") && !(V.story && !inStory(m))) || (V.hl && V.hl.has(m.id)) || (V.sel && V.sel.id === m.id));

  // ------------------------------------------------------------------ view
  function fit(list, canvas) {
    const pts = list.length ? list.map((m) => [m.wx, m.wy]) : (M.dots[V.world] || []);
    if (!pts.length || !canvas) return;
    // ignore the farthest 4 % on each side, so one stray point doesn't shrink the whole world
    const q = (arr, f) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * f)))]; };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const lo = pts.length > 20 ? 0.04 : 0, hi = 1 - lo;
    const minX = q(xs, lo), maxX = q(xs, hi), minY = q(ys, lo), maxY = q(ys, hi);
    V.cx = (minX + maxX) / 2;
    V.cy = (minY + maxY) / 2;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    V.k = Math.min(w / Math.max(4000, maxX - minX), h / Math.max(4000, maxY - minY)) * 0.86;
  }
  const worldMarks = () => (M.byWorld[V.world] || []).filter((m) => m.kind !== "place" && m.kind !== "enemy" && onFloor(m));
  function eveOn(world) { return S.cur.eve && S.cur.eve.map === world ? S.cur.eve.loc : null; }
  function setWorld(w, canvas) {
    V.world = w;
    V.sel = null;
    const eve = eveOn(w);
    V.floor = eve ? floorOf(w, eve[2]) : 0;
    const marks = worldMarks();
    fit(V.hl ? marks.filter((m) => V.hl.has(m.id)) : marks, canvas);
  }
  function focus(m, zoom) {
    V.world = m.map;
    V.floor = floorOf(m.map, m.loc[2]);
    V.sel = m.id !== undefined ? m : null;
    if (m.kind) V.layers.add(m.kind);
    A.render();
    V.cx = m.wx;
    V.cy = m.wy;
    V.k = Math.max(V.k || 0, zoom || 0.02);
    draw(document.querySelector("#page .map-canvas"));
  }

  // ------------------------------------------------------------------ drawing
  const PATH_CACHE = {};
  const path2d = (name) => PATH_CACHE[name] || (PATH_CACHE[name] = new Path2D(PATHS[name] || PATHS.dot));
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"; }
  const SHAPE_CACHE = {};
  /**
   * A world's shape (gen_shapes.py, from the game's navigation mesh and level geometry): a PNG whose alpha is the
   * walkable ground (strong) and the buildings and terrain around it (faint), tinted here in the theme's ink colour.
   */
  function shapeImage(world) {
    const s = M.shapes[world];
    if (!s || !s.img) return null;
    const ink = css("--ink");
    const key = `${world}|${ink}`;
    if (!SHAPE_CACHE[key]) {
      const entry = { canvas: null };
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas");
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0);
        x.globalCompositeOperation = "source-in";
        x.fillStyle = ink;
        x.fillRect(0, 0, c.width, c.height);
        entry.canvas = c;
        draw(document.querySelector("#page .map-canvas"));
      };
      im.src = s.img;
      SHAPE_CACHE[key] = entry;
    }
    return SHAPE_CACHE[key];
  }

  function draw(canvas) {
    if (!canvas || !canvas.isConnected || !M) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--bg-2");
    ctx.fillRect(0, 0, w, h);
    const sx = (x) => (x - V.cx) * V.k + w / 2, sy = (y) => (y - V.cy) * V.k + h / 2;
    // grid: lines every 50 m, 100 m, ... whatever keeps them 60-160 px apart
    let step = 5000;
    while (step * V.k < 60) step *= 2;
    while (step * V.k > 160 && step > 500) step /= 2;
    ctx.strokeStyle = css("--grid");
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor((V.cx - w / 2 / V.k) / step) * step; sx(x) < w; x += step) { ctx.moveTo(Math.round(sx(x)) + 0.5, 0); ctx.lineTo(Math.round(sx(x)) + 0.5, h); }
    for (let y = Math.floor((V.cy - h / 2 / V.k) / step) * step; sy(y) < h; y += step) { ctx.moveTo(0, Math.round(sy(y)) + 0.5); ctx.lineTo(w, Math.round(sy(y)) + 0.5); }
    ctx.stroke();
    // the ground: the game's own map art if the icon pack has it, else the shape from the level geometry,
    // else every known position as a soft blob
    const art = floors(V.world)[V.floor];
    const shape = !art && shapeImage(V.world);
    ctx.imageSmoothingQuality = "high";
    if (art && art.image.complete && art.image.naturalWidth) {
      // the box: world X runs x0..x1 (image bottom to top), world Y y0..y1 (left to right)
      const bx = sx(art.y0), by = sy(-art.x1), bw = (art.y1 - art.y0) * V.k, bh = (art.x1 - art.x0) * V.k;
      if (art.back && art.back.complete && art.back.naturalWidth) { ctx.globalAlpha = 0.55; ctx.drawImage(art.back, bx, by, bw, bh); }
      ctx.globalAlpha = 0.95;
      ctx.drawImage(art.image, bx, by, bw, bh);
      ctx.globalAlpha = 1;
    } else if (shape && shape.canvas) {
      const s = M.shapes[V.world];
      ctx.globalAlpha = 0.42;
      ctx.drawImage(shape.canvas, sx(s.y0), sy(-s.x1), (s.y1 - s.y0) * V.k, (s.x1 - s.x0) * V.k);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = css("--line-2");
      ctx.globalAlpha = 0.16;
      const r0 = Math.max(4, Math.min(90, 2200 * V.k));
      for (const [x, y] of M.dots[V.world] || []) { ctx.beginPath(); ctx.arc(sx(x), sy(y), r0, 0, 6.2832); ctx.fill(); }
      for (const m of M.byWorld[V.world] || []) { ctx.beginPath(); ctx.arc(sx(m.wx), sy(m.wy), r0 * 0.8, 0, 6.2832); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // labels never overlap: each one claims its box, and later ones that would collide are skipped
    const placed = [];
    const halo = css("--bg-2");
    const label = (text, x, y, color) => {
      const tw = ctx.measureText(text).width;
      const r = [x - tw / 2 - 3, y - 12, tw + 6, 16];
      if (placed.some((p) => r[0] < p[0] + p[2] && p[0] < r[0] + r[2] && r[1] < p[1] + p[3] && p[1] < r[1] + r[3])) return;
      placed.push(r);
      ctx.lineWidth = 3.5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = halo;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    ctx.textAlign = "center";
    // area names, quiet, under everything else
    const areaLabels = [];
    if (V.k > 0.0035 && !(floors(V.world).length > 1 && V.floor !== 0)) {
      for (const [n, x, y] of M.areas[V.world] || []) areaLabels.push([n.toUpperCase().split("").join(String.fromCharCode(8202)), sx(y), sy(-x)]);
    }
    // markers: enemies first (small), everything else on top
    const big = V.k > 0.012;
    const list = (M.byWorld[V.world] || []).filter(visible).sort((a, b) => (a.kind === "enemy") - (b.kind === "enemy")).reverse();
    V.drawn = [];
    for (const m of list) {
      const x = sx(m.wx), y = sy(m.wy);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      V.drawn.push([m, x, y]);
      const small = m.kind === "enemy" && !(V.hl && V.hl.has(m.id));
      const R = small ? (big ? 6 : 3.5) : big ? 11 : 6.5;
      const st = statusOf(m);
      const col = KIND[m.kind].color;
      const hl = V.hl && V.hl.has(m.id);
      ctx.globalAlpha = V.hl && !hl ? 0.25 : 1; // a search dims everything else
      if (hl) { ctx.beginPath(); ctx.arc(x, y, R + 6, 0, 6.2832); ctx.strokeStyle = css("--burst-fill"); ctx.lineWidth = 2.5; ctx.stroke(); }
      if (st === "current") { ctx.beginPath(); ctx.arc(x, y, R + 5, 0, 6.2832); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath();
      if (m.kind === "place") { ctx.moveTo(x, y - R + 1); ctx.lineTo(x + R - 1, y); ctx.lineTo(x, y + R - 1); ctx.lineTo(x - R + 1, y); ctx.closePath(); }
      else ctx.arc(x, y, R, 0, 6.2832);
      if (st === "done") { ctx.fillStyle = css("--panel"); ctx.fill(); ctx.strokeStyle = col; ctx.globalAlpha *= 0.5; ctx.lineWidth = 1.5; ctx.stroke(); }
      else { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = css("--bg-2"); ctx.lineWidth = small ? 1 : 1.5; ctx.stroke(); }
      if (big && !small) {
        ctx.save();
        ctx.translate(x - 7, y - 7);
        ctx.scale(14 / 24, 14 / 24);
        ctx.strokeStyle = st === "done" ? col : "#14152b";
        ctx.globalAlpha = (V.hl && !hl ? 0.25 : 1) * (st === "done" ? 0.6 : 0.9);
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(path2d(KIND[m.kind].icon));
        ctx.restore();
      }
      if (V.sel && V.sel.id === m.id) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, R + 5, 0, 6.2832); ctx.strokeStyle = css("--tachy"); ctx.lineWidth = 3; ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    // names: camps and landmarks first, then bosses, areas, people (only close up), as long as they fit
    ctx.font = "600 12px Saira, sans-serif";
    const ink = css("--ink");
    if (V.k > 0.02) for (const [m, x, y] of V.drawn) if (m.kind === "camp" || m.kind === "poi") label(m.name, x, y - 17, ink);
    if (V.k > 0.01) for (const [m, x, y] of V.drawn) if (m.kind === "boss") label(m.name, x, y - 17, KIND.boss.color);
    ctx.font = `600 ${V.k > 0.012 ? 13 : 11}px Saira, sans-serif`;
    const muted = css("--muted");
    for (const [n, x, y] of areaLabels) label(n, x, y, muted);
    ctx.font = "600 12px Saira, sans-serif";
    if (V.k > 0.045) for (const [m, x, y] of V.drawn) if (m.kind === "npc") label(m.name, x, y - 17, KIND.npc.color);
    // the teleport target and Eve
    const t = S.prog.warp;
    if (t && t.map === V.world && (floors(V.world).length < 2 || floorOf(V.world, t.loc[2]) === V.floor)) {
      const x = sx(t.loc[1]), y = sy(-t.loc[0]);
      ctx.fillStyle = css("--burst-fill");
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8, y - 14); ctx.arc(x, y - 16, 8, Math.PI * 0.85, Math.PI * 2.15); ctx.closePath(); ctx.fill();
    }
    const eve = eveOn(V.world);
    if (eve && (floors(V.world).length < 2 || floorOf(V.world, eve[2]) === V.floor)) {
      const x = sx(eve[1]), y = sy(-eve[0]);
      ctx.beginPath(); ctx.arc(x, y, 12, 0, 6.2832); ctx.fillStyle = css("--tachy-soft"); ctx.fill(); ctx.strokeStyle = css("--tachy"); ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.fillStyle = css("--tachy"); ctx.fill();
    }
  }

  function hit(px, py) {
    let best = null, bd = 16 * 16;
    for (const [m, x, y] of V.drawn || []) { const d = (x - px) ** 2 + (y - py) ** 2; if (d < bd || (d === bd && m.kind !== "enemy")) { bd = d; best = m; } }
    return best;
  }

  // ------------------------------------------------------------------ the page
  function pageMap(page) {
    if (!window.SB_WORLD) {
      page.append(el("div", { class: "empty-state" }, icon("map"), el("span", { text: "Loading the map…" })));
      loadWorld().then(() => A.render()).catch((e) => toast(e.message, true));
      return;
    }
    if (!M || M.cur !== S.cur) prepare(); // a different save (or the same one reopened) moves people and drones
    loadArt();
    if (!V.world || !M.byWorld[V.world]) {
      V.world = (S.cur.eve && M.byWorld[S.cur.eve.map] && S.cur.eve.map) || M.worlds[0];
      if (S.cur.eve && S.cur.eve.map === V.world) V.floor = floorOf(V.world, S.cur.eve.loc[2]);
    }

    page.append(searchBox());
    if (V.hl) {
      const inWorld = (M.byWorld[V.world] || []).filter((m) => V.hl.has(m.id));
      const tracked = inWorld.filter((m) => statusOf(m) !== null);
      const left = tracked.filter((m) => statusOf(m) !== "done").length;
      page.append(el("div", { class: "map-hl" }, icon("search"), el("b", { text: V.hlLabel }),
        el("span", { class: "muted", text: `${fmt(V.hl.size)} places, ${fmt(inWorld.length)} in ${regionOf(V.world)}${tracked.length ? `, ${fmt(left)} ${inWorld.some((m) => m.kind === "quest") ? "to do" : "still there"}` : ""}` }),
        el("button", { type: "button", class: "icon-btn", tip: "Clear the search", "data-act": "map:clear", onclick: () => { V.hl = null; V.hlLabel = ""; A.render(); } }, icon("x"))));
    }
    page.append(window.SBUI.seg(M.worlds.map((w) => {
      const list = M.byWorld[w].filter((m) => statusOf(m) !== null && !["camp", "quest"].includes(m.kind));
      const hlN = V.hl ? M.byWorld[w].filter((m) => V.hl.has(m.id)).length : 0;
      const left = list.filter((m) => statusOf(m) === "left").length;
      return { key: w, label: regionOf(w), n: V.hl ? (hlN || null) : `${left}`, act: `map:world:${w}`,
        tip: V.hl ? `${hlN} matches` : `${left} of ${list.length} collectables still there` };
    }), V.world, (w) => { setWorld(w, document.querySelector("#page .map-canvas")); A.render(); }, "World"));

    const canvas = el("canvas", { class: "map-canvas", "aria-label": `Map of ${regionOf(V.world)}`, role: "img" });
    const tip = el("div", { class: "map-tip", hidden: true });
    const fl = floors(V.world);
    const wrap = el("div", { class: "map-wrap" }, canvas, tip,
      fl.length > 1 ? el("div", { class: "map-floors" }, ...fl.map((f, i) => el("button", {
        type: "button", class: "floor" + (i === V.floor ? " on" : ""), "aria-pressed": String(i === V.floor), "data-act": `map:floor:${i}`,
        onclick: () => { V.floor = i; V.sel = null; A.render(); requestAnimationFrame(() => { const c = document.querySelector("#page .map-canvas"); fit(worldMarks(), c); draw(c); }); },
      }, el("span", { text: /under/i.test(f.name) ? "Underground" : "Surface" })))) : null,
      el("div", { class: "map-zoom" },
        el("button", { type: "button", class: "icon-btn", tip: "Zoom in", "data-act": "map:in", onclick: () => { V.k *= 1.5; draw(canvas); } }, icon("plus")),
        el("button", { type: "button", class: "icon-btn", tip: "Zoom out", "data-act": "map:out", onclick: () => { V.k /= 1.5; draw(canvas); } }, icon("minus")),
        el("button", { type: "button", class: "icon-btn", tip: "Show the whole world", "data-act": "map:fit", onclick: () => { fit(worldMarks(), canvas); draw(canvas); } }, icon("grid")),
        eveOn(V.world) ? el("button", { type: "button", class: "icon-btn", tip: "Where Eve is", "data-act": "map:eve", onclick: () => {
          const e = eveOn(V.world);
          const f = floorOf(V.world, e[2]);
          if (f !== V.floor) { V.floor = f; A.render(); }
          V.cx = e[1]; V.cy = -e[0]; V.k = Math.max(V.k, 0.02);
          draw(document.querySelector("#page .map-canvas"));
        } }, icon("person")) : null,
        ART && !Object.keys(ART).length ? el("button", { type: "button", class: "icon-btn", tip: "Add the game's own map art: load an icon pack made with make_icon_pack.py", "data-act": "map:art", onclick: () => A.importIcons() }, icon("image")) : null),
      V.sel ? details(V.sel) : null);
    page.append(wrap, layerBar(), passcodeBoard());
    requestAnimationFrame(() => {
      if (!V.k) fit(worldMarks(), canvas);
      draw(canvas);
    });
    interact(canvas, tip);
  }

  function layerBar() {
    const list = (M.byWorld[V.world] || []).filter(onFloor);
    return el("div", { class: "map-layers" },
      el("button", { type: "button", class: "toggle" + (V.left ? " on" : ""), "aria-pressed": String(V.left), "data-act": "map:left",
        tip: "Only what your save hasn't collected or opened yet", onclick: () => { V.left = !V.left; A.render(); } }, icon("eyeOff"), el("span", { text: "Left only" })),
      el("button", { type: "button", class: "toggle" + (V.story ? " on" : ""), "aria-pressed": String(V.story), "data-act": "map:story",
        tip: "The world as it is in your save right now: enemies and people where the story has them, objects that aren't active yet left out",
        onclick: () => { V.story = !V.story; A.render(); } }, icon("clock"), el("span", { text: "As in my save" })),
      ...Object.entries(KIND).filter(([k]) => list.some((m) => m.kind === k)).map(([k, d]) => {
        const of = list.filter((m) => m.kind === k);
        const done = of.filter((m) => statusOf(m) === "done").length;
        const tracked = of.some((m) => statusOf(m) !== null);
        const on = V.layers.has(k);
        const chip = el("button", {
          type: "button", class: "layer" + (on ? " on" : ""), "aria-pressed": String(on), "data-act": `layer:${k}`,
          tip: `${d.n}: ${fmt(of.length)} here${tracked ? `, ${fmt(done)} ${k === "quest" ? "done" : "collected"}` : ""}`,
          onclick: () => { if (on) V.layers.delete(k); else V.layers.add(k); A.render(); },
        }, el("span", { class: "layer-dot" }, icon(d.icon)), el("span", { text: d.n }), el("span", { class: "n", text: tracked ? `${done}/${of.length}` : fmt(of.length) }));
        chip.querySelector(".layer-dot").style.background = d.color;
        return chip;
      }));
  }

  // ------------------------------------------------------------------ passcodes
  function codeChip(pc) {
    const st = pcState(pc);
    const shown = st !== "unknown" || V.revealAll || V.reveal.has(pc.key);
    return el("button", {
      type: "button", class: `pc-code ${shown ? "" : "masked"}`, "data-act": `pc:reveal:${pc.key}`,
      tip: shown ? "The code" : "Not found in your save yet: click to show it",
      onclick: (e) => { e.stopPropagation(); if (!shown) { V.reveal.add(pc.key); A.render(); } },
    }, el("span", { text: shown ? pc.code : "•".repeat(pc.code.length) }));
  }
  function pcPlace(pc) {
    if (pc.locks.length) return M.all[pc.locks[0]];
    const p = pc.used[0] || pc.found[0];
    return p ? { map: p[0], loc: [p[1], p[2], p[3]], wx: p[2], wy: -p[1] } : null;
  }
  const PREFIX_REGION = [[/^Records_DED/, "Eidos 7"], [/^Records_ME/, "Matrix 11"], [/^Records_SE/, "Spire 4"], [/^Records_WLA/, "Wasteland"],
    [/^Records_WLB/, "Great Desert"], [/^Records_ATL/, "Altess Levoire"], [/^Records_Xion/, "Xion"]];
  /** Where a passcode belongs (for grouping) and what to call it. */
  function pcRegion(pc) {
    if (pc.group) return pc.group;
    const place = pcPlace(pc);
    if (place) return regionOf(place.map);
    if (/^Records_Quest_/.test(pc.key)) return "Side quests and requests";
    const hit = PREFIX_REGION.find(([rx]) => rx.test(pc.key));
    return hit ? hit[1] : "Other";
  }
  function pcTitle(pc) {
    if (pc.name) return pc.name.replace(/^Passcode:\s*/, "");
    const region = pcRegion(pc);
    if (pc.desc) return pc.desc.startsWith(`${region}, `) ? pc.desc.slice(region.length + 2) : pc.desc;
    const q = pc.key.match(/^Records_(Quest_(?:Request|Sub)_\d+)/);
    if (q && GAME.quests[q[1]]) return GAME.quests[q[1]].n;
    return "Place unknown";
  }
  function passcodeBoard() {
    const list = Object.values(M.PC);
    if (!list.length) return null;
    const stats = { used: 0, known: 0, unknown: 0 };
    for (const pc of list) stats[pcState(pc)]++;
    const here = regionOf(V.world);
    const order = M.worlds.map(regionOf);
    const rank = (r) => (r === here ? -1 : order.includes(r) ? order.indexOf(r) : 99);
    const byRegion = new Map();
    for (const pc of list.slice().sort((a, b) => a.key.localeCompare(b.key))) {
      const r = pcRegion(pc);
      byRegion.set(r, [...(byRegion.get(r) || []), pc]);
    }
    const head = el("div", { class: "pc-head" },
      el("button", { type: "button", class: "pc-fold", "aria-expanded": String(V.codesOpen), "data-act": "pc:fold", onclick: () => { V.codesOpen = !V.codesOpen; A.render(); } },
        icon(V.codesOpen ? "chevronDown" : "chevronRight"), icon("key"), el("b", { text: "Passcodes" }),
        el("span", { class: "muted", text: `${fmt(list.length)} · ${fmt(stats.used)} entered · ${fmt(stats.known)} found · ${fmt(stats.unknown)} not found yet` })),
      V.codesOpen && stats.unknown ? el("button", { type: "button", class: "toggle" + (V.revealAll ? " on" : ""), "aria-pressed": String(V.revealAll), "data-act": "pc:all",
        onclick: () => { V.revealAll = !V.revealAll; A.render(); } }, icon(V.revealAll ? "eye" : "eyeOff"), el("span", { text: "Show all codes" })) : null);
    if (!V.codesOpen) return el("section", { class: "pc-board" }, head);
    return el("section", { class: "pc-board" }, head,
      ...[...byRegion.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([region, pcs]) =>
        el("div", { class: "pc-region" },
          el("h3", { class: "pc-region-name", text: region }),
          el("div", { class: "pc-grid" }, ...pcs.map((pc) => {
            const st = pcState(pc);
            const place = pcPlace(pc);
            return el("div", { class: `pc-card ${st}`, "data-pc": pc.key },
              codeChip(pc),
              el("span", { class: `pc-state ${st}`, text: st === "used" ? "Entered" : st === "known" ? "Found" : "Not found" }),
              place ? el("button", { type: "button", class: "icon-btn", tip: "Show it on the map", "data-act": `pc:show:${pc.key}`, onclick: () => focus(place, 0.03) }, icon("pin")) : el("span"),
              el("div", { class: "pc-info" }, el("b", { text: pcTitle(pc), title: pcTitle(pc) }),
                pc.name && pc.desc ? el("small", { text: pc.desc, title: pc.desc }) : null));
          })))));
  }

  // ------------------------------------------------------------------ details card
  function details(m) {
    const st = statusOf(m);
    const d = KIND[m.kind];
    const teleport = () => {
      if (m.kind === "camp") A.warpCamp(m.key);
      else if (m.kind === "place") A.warpSpot(m.key);
      else { A.warpPosition(m.map, [m.loc[0], m.loc[1], m.loc[2] + 100]); S.prog.warp.label = `${m.name} (${regionOf(m.map)})`; }
      toast(`Eve will be at ${S.prog.warp.label}`);
      A.render();
    };
    const dot = el("span", { class: "map-card-ic" }, icon(d.icon));
    dot.style.background = d.color;
    const statusText = {
      camp: ["Active", "Not active"], quest: ["Done", "Not reached yet"], record: ["In your Album", "Not in your Album yet"],
      passcode: ["Opened", "Still locked"], can: ["In your collection", "Not collected yet"],
      enemy: ["Killed (back after a camp rest)", "Alive in your save"], boss: ["Defeated", "Alive in your save"],
      photo: ["Photographed", "Not photographed yet"], lostitem: ["Found", "Not found yet"], tear: ["Found", "Not found yet"],
    }[m.records ? "record" : m.kind] || ["Collected in your save", "Still there in your save"];
    const sub = m.kind === "camp" ? m.sub : m.kind === "quest" ? `Step ${m.step + 1} of ${m.steps || "?"}` : d.n;
    const same = (m.kind === "enemy" || m.kind === "npc" || m.kind === "boss") ? (M.groups.get(`${m.kind}:${m.name}`) || []) : [];
    return el("div", { class: "map-card" },
      el("div", { class: "map-card-head" }, dot,
        el("div", { class: "map-card-title" }, el("b", { text: m.name }), el("small", { text: `${sub}, ${regionOf(m.map)}` })),
        el("button", { type: "button", class: "icon-btn", tip: "Close", "data-act": "map:close", onclick: () => { V.sel = null; A.render(); } }, icon("x"))),
      st ? el("span", { class: `map-status ${st === "current" ? "current" : st}` }, icon(st === "done" ? "check" : "dot"),
        el("span", { text: st === "current" ? "Your current step" : st === "done" ? statusText[0] : statusText[1] })) : null,
      m.kind === "quest" && m.sub ? el("p", { class: "map-card-text", text: m.sub }) : null,
      m.live ? el("span", { class: "map-status current" }, icon("person"), el("span", { text: "Here now in your save" })) : null,
      ...(m.uses || []).map((k) => el("div", { class: "map-pc" }, icon("key"), el("span", { text: "Takes" }), codeChip(M.PC[k]))),
      ...(m.records || []).filter((k) => M.PC[k]).map((k) => el("div", { class: "map-pc" }, icon("book"), el("span", { text: "Gives" }), codeChip(M.PC[k]))),
      m.loot && m.loot.length && m.kind !== "item" ? el("ul", { class: "map-loot" }, ...m.loot.map(([a, min, max, p]) => {
        const c = A.canon(a);
        return el("li", null, ITEMS[c] ? A.art(c) : icon("crate"), el("span", { text: itemName(a) }),
          p !== undefined && p < 1 ? el("small", { class: "chance", tip: "Chance to get it", text: `${p < 0.1 ? Math.round(p * 1000) / 10 : Math.round(p * 100)} %` }) : null,
          el("b", { text: counts(min, max) }));
      })) : null,
      m.fromSave ? el("small", { class: "muted", text: "Placed where your save has it (the game spawns it)" }) : null,
      m.kind !== "item" && V.story === false && m.spawnId && !storyAllows(m.spawnId) ? el("small", { class: "muted", text: "Not there at this point of your story" }) : null,
      m.kind === "item" && m.loot.length ? el("div", { class: "map-pc" }, ITEMS[A.canon(m.loot[0][0])] ? A.art(A.canon(m.loot[0][0])) : icon("sparkle"), el("span", { text: `${itemName(m.loot[0][0])} ${counts(m.loot[0][1], m.loot[0][2])}` })) : null,
      same.length > 1 ? el("button", { type: "button", class: "link-btn", "data-act": "map:same", onclick: () => pick({ type: "group", key: `${m.kind}:${m.name}`, label: m.name, ids: same }) },
        el("span", { text: `Show all ${fmt(same.length)} ${m.kind === "npc" ? "places" : "spawns"}` })) : null,
      el("code", { class: "map-coords", text: `${m.loc.map((v) => Math.round(v)).join(", ")}${m.alias ? `  ${m.alias}` : ""}` }),
      el("div", { class: "map-card-acts" },
        el("button", { type: "button", class: "fill", "data-act": "map:teleport", tip: "Teleport Eve here when you download (experimental)", onclick: teleport }, icon("pin"), el("span", { text: "Teleport Eve here" }))));
  }

  function interact(canvas, tip) {
    const pts = new Map();
    let drag = null, moved = false, pinch = null;
    const rel = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      moved = false;
      if (pts.size === 1) drag = { p: rel(e), cx: V.cx, cy: V.cy };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: V.k }; }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = rel(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        V.k = pinch.k * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d);
        moved = true;
        draw(canvas);
        return;
      }
      if (drag && pts.size === 1) {
        const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        V.cx = drag.cx - dx / V.k;
        V.cy = drag.cy - dy / V.k;
        draw(canvas);
        tip.hidden = true;
        return;
      }
      const m = hit(p[0], p[1]);
      canvas.style.cursor = m ? "pointer" : "grab";
      if (m) {
        tip.hidden = false;
        const extra = m.kind === "quest" ? `: step ${m.step + 1}` : m.lootText.length && m.kind !== "item" && m.kind !== "core" ? `: ${m.lootText.slice(0, 3).join(", ")}${m.lootText.length > 3 ? "…" : ""}` : "";
        tip.textContent = `${m.name}${extra}`;
        tip.style.left = `${Math.min(p[0] + 14, canvas.clientWidth - 200)}px`;
        tip.style.top = `${p[1] + 12}px`;
      } else tip.hidden = true;
    });
    const end = (e) => {
      const p = rel(e);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (drag && !moved && pts.size === 0) {
        const m = hit(p[0], p[1]);
        V.sel = m || null;
        A.render();
      }
      if (pts.size === 0) drag = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { tip.hidden = true; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [px, py] = rel(e);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const wx = V.cx + (px - w / 2) / V.k, wy = V.cy + (py - h / 2) / V.k;
      V.k *= Math.exp(-e.deltaY * 0.0015);
      V.k = Math.max(0.0005, Math.min(0.5, V.k));
      V.cx = wx - (px - w / 2) / V.k;
      V.cy = wy - (py - h / 2) / V.k;
      draw(canvas);
    }, { passive: false });
    canvas.addEventListener("dblclick", (e) => {
      const [px, py] = rel(e);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      V.cx += (px - w / 2) / V.k;
      V.cy += (py - h / 2) / V.k;
      V.k *= 2;
      draw(canvas);
    });
    if (window.ResizeObserver) new ResizeObserver(() => draw(canvas)).observe(canvas);
  }

  // ------------------------------------------------------------------ search
  function results(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    const match = (text) => words.every((w) => text.toLowerCase().includes(w));
    const starts = (n) => (n.toLowerCase().startsWith(words[0]) ? 0 : 1);
    // loot first: "where do I find X"
    for (const [a, ids] of M.loot) {
      const n = ITEMS[a] ? ITEMS[a].name : a;
      if (match(`${n} ${a}`)) out.push({ type: "loot", a, label: n, sub: `in ${fmt(ids.length)} places`, ids, score: starts(n) });
    }
    // enemies, bosses and people by name; side quests by title
    for (const [key, ids] of M.groups) {
      const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      if (kind === "record") continue; // records are found by their marker names below
      if (kind === "kind") {
        if (match(KIND[rest].n)) out.push({ type: "group", key, kind: rest, label: KIND[rest].n, sub: `${fmt(ids.length)} places`, ids, score: 1 });
        continue;
      }
      const label = kind === "quest" ? (GAME.quests[rest] ? GAME.quests[rest].n : rest) : rest;
      if (!match(`${label} ${KIND[kind].n}`)) continue;
      const sub = kind === "quest" ? `Side quest, ${fmt(ids.length)} ${ids.length === 1 ? "place" : "places"}` : kind === "enemy" ? `Enemy, ${fmt(ids.length)} spawns` : `${KIND[kind].n}, ${fmt(ids.length)} ${ids.length === 1 ? "place" : "places"}`;
      out.push({ type: "group", key, kind, label, sub, ids, score: 1 + starts(label) });
    }
    // passcodes by code, name or place
    for (const pc of Object.values(M.PC)) {
      if (match(`passcode code ${pc.code} ${pc.name} ${pc.desc} ${pc.group || ""}`)) {
        out.push({ type: "passcode", pc, label: pc.name ? pc.name.replace(/^Passcode:\s*/, "Passcode: ") : `Passcode: ${pc.desc || pc.key}`, sub: pc.desc || "", score: 2 });
      }
    }
    for (const [map, list] of Object.entries(M.areas)) {
      for (const [n, x, y] of list) if (match(`${n} ${regionOf(map)}`)) out.push({ type: "area", label: n, sub: `Area, ${regionOf(map)}`, at: { map, loc: [x, y, 0], wx: y, wy: -x }, score: 2 + starts(n) });
    }
    for (const m of M.all) {
      if (["item", "enemy", "boss", "npc", "quest"].includes(m.kind)) continue;
      if (match(`${m.name} ${KIND[m.kind].n} ${regionOf(m.map)} ${m.alias || ""} ${m.key || ""}`)) {
        out.push({ type: "marker", m, label: m.name, sub: `${KIND[m.kind].n}, ${regionOf(m.map)}`, score: m.kind === "camp" || m.kind === "place" || m.kind === "poi" ? 3 : 4 });
      }
    }
    return out.sort((x, y) => x.score - y.score || x.label.localeCompare(y.label)).slice(0, 16);
  }

  function pick(r) {
    const canvas = () => document.querySelector("#page .map-canvas");
    if (r.type === "loot" || r.type === "group") {
      V.hl = new Set(r.ids);
      V.hlLabel = r.label;
      if (r.kind) V.layers.add(r.kind);
      const per = {};
      for (const id of r.ids) per[M.all[id].map] = (per[M.all[id].map] || 0) + 1;
      // a quest opens where your current step is; anything else where most of it is (ties: the world you're in)
      const cur = r.kind === "quest" && r.ids.map((id) => M.all[id]).find((m) => statusOf(m) === "current");
      const best = cur ? cur.map : Object.entries(per).sort((x, y) => y[1] - x[1] || (y[0] === V.world) - (x[0] === V.world))[0][0];
      V.world = best;
      const inWorld = (M.byWorld[best] || []).filter((m) => V.hl.has(m.id));
      if (floors(best).length > 1 && inWorld.length) {
        const per2 = {};
        for (const m of inWorld) per2[floorOf(best, m.loc[2])] = (per2[floorOf(best, m.loc[2])] || 0) + 1;
        V.floor = Number(Object.entries(per2).sort((x, y) => y[1] - x[1])[0][0]);
      }
      V.sel = null;
      V.k = 0;
      A.render();
      const c = canvas();
      if (c) { fit(inWorld.filter(onFloor), c); V.k = Math.min(V.k, 0.03); draw(c); }
      return;
    }
    if (r.type === "passcode") {
      V.reveal.add(r.pc.key);
      V.codesOpen = true;
      const place = pcPlace(r.pc);
      if (place) focus(place, 0.03);
      else A.render();
      const card = document.querySelector(`#page [data-pc="${r.pc.key}"]`);
      if (card) { card.scrollIntoView({ block: "nearest", behavior: "smooth" }); card.classList.add("flash"); }
      return;
    }
    if (r.type === "area") { V.sel = null; focus(r.at, 0.008); return; }
    focus(r.m, 0.02);
  }

  function searchBox() {
    const input = el("input", { type: "search", class: "map-search-input", placeholder: "Search: Beta Core, Creeper, a side quest, a passcode, a camp…", "aria-label": "Search the map",
      "data-act": "map:q", value: V.q, autocomplete: "off", spellcheck: "false", role: "combobox", "aria-controls": "mapResults", "aria-expanded": "false" });
    const list = el("ul", { id: "mapResults", class: "omni-list map-results", role: "listbox", hidden: true });
    let items = [], sel = -1;
    const drawList = () => {
      items = results(input.value);
      list.textContent = "";
      items.forEach((r, i) => {
        const ic = r.type === "loot" ? (ITEMS[r.a] ? A.art(r.a) : icon("crate"))
          : r.type === "group" ? icon(KIND[r.kind].icon) : r.type === "passcode" ? icon("key") : r.type === "area" ? icon("map") : icon(KIND[r.m.kind].icon);
        const li = el("li", { role: "option", "aria-selected": String(i === sel), class: `omni-${r.type}` }, ic,
          el("span", { class: "omni-main" }, el("b", { text: r.label }), el("span", { class: "omni-sub", text: r.sub })));
        li.addEventListener("mousedown", (e) => { e.preventDefault(); V.q = input.value; list.hidden = true; pick(r); });
        list.append(li);
      });
      list.hidden = !items.length || document.activeElement !== input;
      input.setAttribute("aria-expanded", String(!list.hidden));
    };
    input.addEventListener("input", () => { sel = -1; V.q = input.value; drawList(); });
    input.addEventListener("focus", drawList);
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); sel = (sel + 1) % items.length; drawList(); }
      else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; drawList(); }
      else if (e.key === "Enter" && items.length) { e.preventDefault(); list.hidden = true; pick(items[Math.max(0, sel)]); }
      else if (e.key === "Escape") { list.hidden = true; }
    });
    return el("label", { class: "map-search" }, icon("search"), input, list);
  }

  /** Open the map with a group lit up (a side quest's steps, an enemy's spawns): false if the map has none. */
  async function showGroup(key, label) {
    await loadWorld();
    if (!M) prepare();
    const ids = M.groups.get(key);
    if (!ids || !ids.length) return false;
    A.show("map");
    pick({ type: "group", key, kind: key.slice(0, key.indexOf(":")), label: label || key, ids });
    return true;
  }

  window.SBPages.map = pageMap;
  window.SBMap = {
    V, loadWorld, loadArt, showGroup,
    ready: () => !!M,
    /** Character aliases of the enemies and bosses placed in the world. */
    spawnTypes: () => new Set(M ? M.all.filter((m) => m.kind === "enemy" || m.kind === "boss").map((m) => m.type) : []),
    /** Open the map centred on a position in a world (from the People page). */
    focusAt: (map, loc) => { if (!M) prepare(); focus({ map, loc, wx: loc[1], wy: -loc[0] }, 0.03); }, whenReady: () => loadWorld().then(() => { if (!M) prepare(); }), hasGroup: (key) => !!(M && M.groups.get(key)),
    statusOf: (id) => M && statusOf(M.all[id]), results: (q) => (M ? results(q) : []), pick: (i, q) => pick(results(q)[i]),
    passcodes: () => (M ? Object.values(M.PC).map((pc) => ({ key: pc.key, code: pc.code, state: pcState(pc), locks: pc.locks.length })) : []),
    count: (kind) => (M ? M.all.filter((m) => m.kind === kind).length : 0),
  };
})();
