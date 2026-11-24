/*
 * Stellar Blade: C2 - saves: the game's save folder, snapshots, and comparing saves
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * In Chrome and Edge the page can be given the game's save folder (File System Access API): C2 lists every
 * slot and the game's own Backup copies, writes changes straight back (after keeping a snapshot of the file
 * as it was), and can watch the folder: each time the game saves, C2 shows what changed. Snapshots live in
 * this browser (IndexedDB). Nothing ever leaves the computer.
 */
(function () {
  "use strict";

  const { el, icon, fmt, toast } = window.SBUI;
  const A = window.SBApp;
  const { S, GAME, ITEMS } = A;
  const G = window.SBGvas;
  const M = window.SBModel;
  const D = window.SBDiff;
  const $ = (id) => document.getElementById(id);
  const FS = typeof window.showDirectoryPicker === "function";
  const UI = { folder: null, stored: null, files: [], watch: false, timer: 0, watchStamp: 0, watchBytes: null, live: [],
    snaps: null, a: "open", b: "after", diff: null, q: "", noise: true, busy: false };

  const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  const hours = (s) => (s === null || s === undefined ? "" : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`);

  // ------------------------------------------------------------------ the save folder
  async function storedFolder() {
    try { return (await A.dbStore("kv", "readonly", (s) => s.get("folder"))) || null; } catch (e) { return null; }
  }
  async function connect() {
    try {
      const h = await window.showDirectoryPicker({ id: "sb-saves", mode: "readwrite" });
      UI.folder = h;
      try { await A.dbStore("kv", "readwrite", (s) => s.put(h, "folder")); } catch (e) { /* this browser won't keep it */ }
      await scan();
      toast(`Connected: ${h.name}`);
    } catch (e) {
      if (e.name !== "AbortError") toast(`The folder couldn't be opened: ${e.message}`, true);
    }
    A.render();
  }
  async function reconnect() {
    const h = UI.stored || (await storedFolder());
    if (!h) return connect();
    try {
      if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") { toast("C2 needs permission to read that folder.", true); return; }
      UI.folder = h;
      await scan();
    } catch (e) { toast(`The folder couldn't be opened: ${e.message}`, true); }
    A.render();
  }
  function disconnect() {
    UI.folder = null;
    UI.files = [];
    stopWatch();
    A.dbStore("kv", "readwrite", (s) => s.delete("folder")).catch(() => {});
    UI.stored = null;
    A.render();
  }

  /** The .sav files in the folder: the numbered profile folders inside it, and the game's Backup folders. */
  async function scan() {
    const files = [];
    async function add(dir, prefix, kind, depth) {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === "file" && /\.sav$/i.test(name)) {
          const f = await h.getFile();
          files.push({ name, path: prefix + name, handle: h, size: f.size, modified: f.lastModified, kind: /setting/i.test(name) ? "settings" : kind });
        } else if (h.kind === "directory" && depth < 2 && (name === "Backup" || /^\d+$/.test(name) || name === "SaveGames")) {
          await add(h, `${prefix}${name}/`, name === "Backup" ? "backup" : kind, depth + 1);
        }
      }
    }
    await add(UI.folder, "", "save", 0);
    const order = { save: 0, backup: 1, settings: 2 };
    UI.files = files.sort((x, y) => order[x.kind] - order[y.kind] || x.path.localeCompare(y.path));
  }

  async function openFromFolder(f) {
    const file = await f.handle.getFile();
    await A.openFile(file, { handle: f.kind === "save" ? f.handle : null, folder: UI.folder.name, path: f.path });
    if (S.file && S.file.handle && UI.watch) armWatch();
  }

  // writes into the folder instead of downloading (app.js calls this from the Save button)
  A.WRITE.fn = async (bytes) => {
    const h = S.file.handle;
    if (!confirm(`Write the edited save to ${S.file.path}?\n\nQuit Stellar Blade first. C2 keeps a snapshot of the file as it is now, so you can go back.`)) return false;
    try {
      if ((await h.queryPermission({ mode: "readwrite" })) !== "granted" && (await h.requestPermission({ mode: "readwrite" })) !== "granted") {
        toast("C2 may not write to that folder.", true);
        return false;
      }
      const before = new Uint8Array(await (await h.getFile()).arrayBuffer());
      await snapshot(S.file.name, before, "Before C2 wrote changes");
      const w = await h.createWritable();
      await w.write(bytes);
      await w.close();
      const f = await h.getFile();
      UI.watchStamp = f.lastModified; // our own write isn't a game save
      UI.watchBytes = bytes;
      await A.openFile(f, { handle: h, folder: S.file.folder, path: S.file.path, force: true });
      toast(`Saved to ${S.file.path}. The old version is in your snapshots.`);
      return true;
    } catch (e) {
      toast(`The save couldn't be written: ${e.message}`, true);
      return false;
    }
  };

  // ------------------------------------------------------------------ watching the game save
  function armWatch() {
    stopWatch();
    const h = S.file && S.file.handle;
    if (!h) return;
    UI.watch = true;
    h.getFile().then((f) => { UI.watchStamp = f.lastModified; UI.watchBytes = S.file.bytes; });
    UI.timer = setInterval(async () => {
      try {
        const f = await h.getFile();
        if (f.lastModified <= UI.watchStamp) return;
        UI.watchStamp = f.lastModified;
        const bytes = new Uint8Array(await f.arrayBuffer());
        const d = UI.watchBytes ? D.diffSaves(G.parse(UI.watchBytes), G.parse(bytes)) : [];
        UI.live.unshift({ time: f.lastModified, n: d.length, sections: sectionCounts(d), before: UI.watchBytes, after: bytes });
        UI.live.length = Math.min(UI.live.length, 20);
        UI.watchBytes = bytes;
        await snapshot(f.name, bytes, "The game saved", true);
        toast(`The game saved: ${fmt(d.length)} changes (Saves page)`);
        if (S.view === "saves") A.render();
      } catch (e) { /* the game may be writing right now: next tick */ }
    }, 2500);
  }
  function stopWatch() { clearInterval(UI.timer); UI.timer = 0; UI.watch = false; }

  // ------------------------------------------------------------------ snapshots (IndexedDB, this browser only)
  const AUTO_KEEP = 30;
  async function snapshot(name, bytes, label, auto) {
    let playTime = null;
    try { playTime = M.summary(G.parse(bytes), ITEMS).playTime; } catch (e) { /* not a game save */ }
    const id = await A.dbStore("snapshots", "readwrite", (s) => s.add({ name, label, time: Date.now(), size: bytes.length, playTime, auto: !!auto }));
    await A.dbStore("snapbytes", "readwrite", (s) => s.put(bytes, id));
    UI.snaps = null;
    if (auto) {
      const all = await listSnaps();
      for (const x of all.filter((s) => s.auto).slice(AUTO_KEEP)) await removeSnap(x.id);
    }
    return id;
  }
  async function listSnaps() {
    if (!UI.snaps) {
      try { UI.snaps = ((await A.dbStore("snapshots", "readonly", (s) => s.getAll())) || []).sort((x, y) => y.time - x.time); }
      catch (e) { UI.snaps = []; }
    }
    return UI.snaps;
  }
  const snapBytes = (id) => A.dbStore("snapbytes", "readonly", (s) => s.get(id));
  async function removeSnap(id) {
    await A.dbStore("snapshots", "readwrite", (s) => s.delete(id));
    await A.dbStore("snapbytes", "readwrite", (s) => s.delete(id));
    UI.snaps = null;
  }
  function download(name, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ------------------------------------------------------------------ comparing
  const SECTION = {
    DataMap_SBItem: ["Items", "crate"], SBAchievement: ["Achievements", "star"], DataMap_SBQuest: ["Quests", "list"],
    DataMap_SBEnv: ["World objects", "map"], GamePlayProgressRecordData: ["Story records", "flag"], DataMap_SBActor: ["Eve", "person"],
    DataMap_SBAcquisitionSkill: ["Skills", "tree"], UIStorage: ["Menus", "dotOff"], SBShopHistory: ["Shops", "store"],
    DataMap_int32: ["Values", "sliders"], DataMap_int64: ["Values", "sliders"], DataMap_float: ["Values", "sliders"], DataMap_FString: ["Values", "sliders"],
    TheaterStorage: ["Cutscenes", "play"], SBHint: ["Tutorials", "bubble"], EventGiftInfo: ["Gifts", "star"], LevelActorStorage: ["Level actors", "map"],
    TrainingRoomData: ["Training room", "sword"], NikkeStageInfo: ["NIKKE", "ticket"], DataMap_SBEffect: ["Effects", "bolt"],
  };
  const NOISE = /Timestamp|DateTime|PlayTime|SaveTime|LastUpdate|Location|Rotation|Guid|CreateTime|Seed|Version|OnlineAccount/i;
  const sectionOf = (path) => SECTION[path.split(/[.[{(]/)[0]] || ["Other", "file"];
  function sectionCounts(d) {
    const c = {};
    for (const x of d) { const s = sectionOf(x.path)[0]; c[s] = (c[s] || 0) + 1; }
    return c;
  }
  const ALBUM = Object.create(null);
  for (const e of Object.values(GAME.album)) ALBUM[e.ach] = e.n;
  /** A name a person knows for a key from the save: item, quest, skill, Album entry, camp, else the key itself. */
  function nameOf(k) {
    const a = A.canon(k);
    if (ITEMS[a]) return ITEMS[a].name;
    if (GAME.quests[k]) return GAME.quests[k].n;
    if (GAME.skills[k]) return GAME.skills[k].n;
    if (ALBUM[k]) return `Album: ${ALBUM[k]}`;
    if (GAME.camps[k]) return GAME.camps[k].n;
    return k;
  }
  function pretty(path) {
    const [section] = sectionOf(path);
    const parts = path.split(/\.(?![^[]*\])/).slice(1).map((seg) => seg.replace(/\[([^\]]+)\]|\{([^}]+)\}/g, (m, a, b) => ` ${nameOf(a || b)}`));
    return { section, text: parts.join(" › ").replace(/^\s+/, "") || path };
  }

  async function sourceBytes(key) {
    if (key === "open") return S.file && S.file.bytes;
    if (key === "after") return S.file && A.buildSave().bytes;
    if (key.startsWith("file:")) { const f = UI.files.find((x) => x.path === key.slice(5)); return f && new Uint8Array(await (await f.handle.getFile()).arrayBuffer()); }
    if (key.startsWith("snap:")) return snapBytes(Number(key.slice(5)));
    if (key.startsWith("live:")) { const [i, side] = key.slice(5).split(":"); const x = UI.live[Number(i)]; return x && x[side]; }
    return null;
  }
  function sources(snaps) {
    const out = [];
    if (S.file) {
      out.push(["open", `${S.file.name} (as opened)`]);
      out.push(["after", `${S.file.name} with your changes`]);
    }
    for (const f of UI.files.filter((x) => x.kind !== "settings")) out.push([`file:${f.path}`, `Folder: ${f.path}`]);
    for (const x of snaps) out.push([`snap:${x.id}`, `Snapshot: ${x.label}, ${when(x.time)}`]);
    return out;
  }
  async function compare(a, b, la, lb) {
    UI.busy = true;
    A.render();
    try {
      const [x, y] = await Promise.all([sourceBytes(a), sourceBytes(b)]);
      if (!x || !y) throw new Error("pick two saves");
      UI.diff = { a: la, b: lb, entries: D.diffSaves(G.parse(x), G.parse(y)) };
    } catch (e) {
      toast(`Couldn't compare: ${e.message}`, true);
    }
    UI.busy = false;
    A.render();
    const box = document.querySelector("#page .diff-view");
    if (box) box.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ------------------------------------------------------------------ the page
  function pageSaves(page) {
    if (!UI.snaps) { listSnaps().then(() => { if (S.view === "saves") A.render(); }); }
    const snaps = UI.snaps || [];
    page.append(folderSection(), snapSection(snaps), compareSection(snaps));
  }

  function folderSection() {
    const sec = A.section("Save folder", el("div", { class: "block-acts" },
      UI.folder ? el("button", { type: "button", class: "toggle" + (UI.watch ? " on" : ""), "aria-pressed": String(UI.watch), "data-act": "saves:watch",
        disabled: !(S.file && S.file.handle) ? true : null,
        tip: S.file && S.file.handle ? "Watch the open save: each time the game saves, C2 keeps a snapshot and shows what changed" : "Open a save from the folder first",
        onclick: () => { if (UI.watch) stopWatch(); else armWatch(); A.render(); } }, icon(UI.watch ? "eye" : "eyeOff"), el("span", { text: "Watch" })) : null,
      UI.folder ? el("button", { type: "button", class: "icon-btn", tip: "Read the folder again", "data-act": "saves:rescan", onclick: async () => { await scan(); A.render(); } }, icon("reset")) : null,
      UI.folder ? el("button", { type: "button", class: "icon-btn", tip: "Forget this folder", "data-act": "saves:disconnect", onclick: disconnect }, icon("x")) : null));
    if (!FS) {
      sec.append(el("div", { class: "empty-state small" }, icon("info"), el("span", { text: "Connecting the save folder works in Chrome and Edge. Here, open saves with the button at the top and download them." })));
      return sec;
    }
    if (!UI.folder) {
      sec.append(connectCard());
      return sec;
    }
    sec.append(fileList(true));
    if (UI.live.length) {
      sec.append(el("ol", { class: "live-log" }, ...UI.live.map((x, i) => el("li", null, icon("bolt"),
        el("span", { text: `The game saved at ${new Date(x.time).toLocaleTimeString()}` }),
        el("b", { text: `${fmt(x.n)} changes` }),
        el("span", { class: "muted", text: Object.entries(x.sections).map(([k, n]) => `${k} ${n}`).join(", ") }),
        el("button", { type: "button", class: "chip-btn", "data-act": `live:${i}`, onclick: () => compare(`live:${i}:before`, `live:${i}:after`, "Before the game saved", "After") }, icon("sliders"), "Show")))));
    }
    return sec;
  }

  function connectCard() {
    return el("div", { class: "connect" },
      el("span", { class: "connect-ic" }, icon("file")),
      el("div", { class: "connect-text" }, el("b", { text: "Connect your SaveGames folder" }),
        el("span", { class: "muted", text: "See every slot and the game's backups, save changes straight back (with a snapshot first), and watch what the game changes." })),
      UI.stored ? el("button", { type: "button", class: "fill", "data-act": "saves:reconnect", onclick: reconnect }, icon("reset"), el("span", { text: UI.stored.name })) : null,
      el("button", { type: "button", class: UI.stored ? "toggle" : "fill", "data-act": "saves:connect", onclick: connect }, icon("upload"), el("span", { text: UI.stored ? "Another" : "Connect" })));
  }

  function fileList(withCompare) {
    if (!UI.files.length) return el("div", { class: "empty-state small" }, icon("file"), el("span", { text: "No .sav files here: pick the SaveGames folder or the numbered folder inside it" }));
    return el("div", { class: "file-rows" }, ...UI.files.map((f) => {
      const open = S.file && S.file.path === f.path && S.file.folder === UI.folder.name;
      return el("div", { class: `file-row ${f.kind}${open ? " open" : ""}` },
        icon(f.kind === "backup" ? "copy" : f.kind === "settings" ? "sliders" : "file"),
        el("span", { class: "file-row-name" }, el("b", { text: f.name }), el("small", { text: f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : f.kind === "backup" ? "game backup" : "" })),
        el("span", { class: "file-row-meta", text: `${when(f.modified)}, ${mb(f.size)}` }),
        el("span", { class: "file-row-acts" },
          f.kind === "settings" ? el("span", { class: "muted", text: "game settings" }) : null,
          f.kind !== "settings" && withCompare && S.file ? el("button", { type: "button", class: "icon-btn", tip: "Compare with the open save", "data-act": `cmp:${f.path}`,
            onclick: () => compare("open", `file:${f.path}`, `${S.file.name} (open)`, f.path) }, icon("sliders")) : null,
          f.kind !== "settings" ? el("button", { type: "button", class: open ? "toggle on" : "fill small", "data-act": `open:${f.path}`, tip: f.kind === "backup" ? "Open the game's backup (read only)" : "Open it",
            onclick: () => openFromFolder(f) }, icon(open ? "check" : "upload"), el("span", { text: open ? "Opened" : "Open" })) : null));
    }));
  }

  function snapSection(snaps) {
    const sec = A.section("Snapshots", el("div", { class: "block-acts" },
      S.file ? el("button", { type: "button", class: "fill", "data-act": "snap:take", tip: "Keep the open save as it is now, in this browser",
        onclick: async () => { await snapshot(S.file.name, S.file.bytes, "Taken by you"); toast("Snapshot kept"); A.render(); } }, icon("plus"), el("span", { text: "Snapshot" })) : null));
    if (!snaps.length) { sec.append(el("div", { class: "empty-state small" }, icon("copy"), el("span", { text: "No snapshots yet" }))); return sec; }
    sec.append(el("div", { class: "file-rows" }, ...snaps.map((x) => el("div", { class: "file-row" + (x.auto ? " auto" : "") },
      icon(x.auto ? "bolt" : "copy"),
      el("span", { class: "file-row-name" }, el("b", { text: x.label }), el("small", { text: x.name })),
      el("span", { class: "file-row-meta", text: `${when(x.time)}, ${x.playTime !== null ? `${hours(x.playTime)} played, ` : ""}${mb(x.size)}` }),
      el("span", { class: "file-row-acts" },
        S.file ? el("button", { type: "button", class: "icon-btn", tip: "Compare with the open save", "data-act": `snapcmp:${x.id}`,
          onclick: () => compare(`snap:${x.id}`, "open", `Snapshot: ${x.label}`, `${S.file.name} (open)`) }, icon("sliders")) : null,
        el("button", { type: "button", class: "icon-btn", tip: "Download it", "data-act": `snapdl:${x.id}`, onclick: async () => download(x.name, await snapBytes(x.id)) }, icon("download")),
        el("button", { type: "button", class: "icon-btn", tip: "Open it in C2", "data-act": `snapopen:${x.id}`,
          onclick: async () => A.openFile(new File([await snapBytes(x.id)], x.name)) }, icon("upload")),
        el("button", { type: "button", class: "icon-btn", tip: "Delete it", "data-act": `snapdel:${x.id}`,
          onclick: async () => { if (confirm("Delete this snapshot?")) { await removeSnap(x.id); A.render(); } } }, icon("trash")))))));
    return sec;
  }

  function compareSection(snaps) {
    const list = sources(snaps);
    const sec = A.section("Compare");
    if (list.length < 2) { sec.append(el("div", { class: "empty-state small" }, icon("sliders"), el("span", { text: "Open a save to compare it" }))); return sec; }
    if (!list.some(([k]) => k === UI.a)) UI.a = list[0][0];
    if (!list.some(([k]) => k === UI.b)) UI.b = list[1][0];
    const pick = (which) => {
      const s = el("select", { class: "filter-select", "aria-label": which === "a" ? "Before" : "After", "data-act": `cmp:${which}` }, ...list.map(([k, l]) => el("option", { value: k, text: l })));
      s.value = UI[which];
      s.addEventListener("change", () => { UI[which] = s.value; });
      return s;
    };
    const label = (k) => (list.find(([x]) => x === k) || [k, k])[1];
    sec.append(el("div", { class: "compare-bar" }, pick("a"), icon("arrowRight"), pick("b"),
      el("button", { type: "button", class: "fill", "data-act": "cmp:run", disabled: UI.busy ? true : null, onclick: () => compare(UI.a, UI.b, label(UI.a), label(UI.b)) },
        icon("sliders"), el("span", { text: UI.busy ? "Comparing…" : "Compare" }))));
    if (UI.diff) sec.append(diffView(UI.diff));
    return sec;
  }

  function diffView(d) {
    const box = el("div", { class: "diff-view" });
    const q = el("input", { type: "search", class: "filter-input", placeholder: "Filter: item, quest, value…", "data-act": "diff:q", value: UI.q, autocomplete: "off" });
    const noise = el("button", { type: "button", class: "toggle" + (UI.noise ? " on" : ""), "aria-pressed": String(UI.noise), "data-act": "diff:noise",
      tip: "Hide timestamps, positions and IDs that change on every save" }, icon("eyeOff"), el("span", { text: "Hide noise" }));
    const summary = el("div", { class: "diff-sections" });
    const rows = el("div", { class: "diff-rows" });
    function draw() {
      const words = UI.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = d.entries.filter((x) => !(UI.noise && NOISE.test(x.path))).map((x) => ({ ...x, p: pretty(x.path) }))
        .filter((x) => words.every((w) => `${x.p.section} ${x.p.text} ${x.path} ${x.before} ${x.after}`.toLowerCase().includes(w)));
      const counts = {};
      for (const x of shown) counts[x.p.section] = (counts[x.p.section] || 0) + 1;
      summary.textContent = "";
      summary.append(el("b", { text: `${fmt(shown.length)} differences` }),
        ...Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => el("button", { type: "button", class: "chip-btn", onclick: () => { q.value = UI.q = k; draw(); } }, `${k} ${fmt(n)}`)));
      rows.textContent = "";
      if (!shown.length) { rows.append(el("div", { class: "empty-state small" }, icon("check"), el("span", { text: d.entries.length ? "Only noise differs" : "The two saves are the same" }))); return; }
      for (const x of shown.slice(0, 600)) {
        rows.append(el("div", { class: `diff-row ${x.kind}`, "data-tip": x.path },
          el("span", { class: "diff-kind", text: { added: "+", removed: "−", changed: "~" }[x.kind] }),
          el("span", { class: "diff-sec", text: x.p.section }),
          el("span", { class: "diff-path", text: x.p.text }),
          el("span", { class: "diff-vals" },
            x.before !== null ? el("s", { text: String(x.before) }) : null,
            x.before !== null && x.after !== null ? icon("chevronRight", "diff-arrow") : null,
            x.after !== null ? el("b", { text: String(x.after) }) : null)));
      }
      if (shown.length > 600) rows.append(el("p", { class: "muted", text: `${fmt(shown.length - 600)} more: filter to narrow the list` }));
    }
    q.addEventListener("input", () => { UI.q = q.value; draw(); });
    noise.addEventListener("click", () => { UI.noise = !UI.noise; noise.classList.toggle("on", UI.noise); noise.setAttribute("aria-pressed", String(UI.noise)); draw(); });
    box.append(el("div", { class: "diff-head" }, el("span", { class: "diff-ab" }, el("span", { text: d.a }), icon("arrowRight"), el("span", { text: d.b }))),
      el("div", { class: "catalog-controls" }, el("label", { class: "filter" }, icon("search"), q), noise), summary, rows);
    draw();
    return box;
  }

  // ------------------------------------------------------------------ the start page: open a save from the folder
  function renderStart(box) {
    if (!box) return;
    box.textContent = "";
    if (!FS) return;
    if (UI.folder && UI.files.length) {
      box.append(el("div", { class: "start-folder" }, el("div", { class: "block-head" }, el("h2", { text: UI.folder.name }),
        el("div", { class: "block-acts" }, el("button", { type: "button", class: "icon-btn", tip: "Forget this folder", onclick: disconnect }, icon("x")))), fileList(false)));
    } else box.append(connectCard());
  }

  storedFolder().then((h) => { UI.stored = h; if (!S.file) A.render(); });
  window.SBPages.saves = pageSaves;
  window.SBSaves = { renderStart, snapshot, listSnaps, compare, UI };
})();
