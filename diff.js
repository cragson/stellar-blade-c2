/*
 * Stellar Blade: C2 - compare two saves
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Flattens a parsed save (gvas.js) into "path -> value" and compares two of them. List entries are matched by
 * what they are (an item's alias, an achievement's name, a quest, a world object...), not by their position,
 * so a new item in the middle of the inventory shows as one added item, not as hundreds of shifted values.
 */
(function (root) {
  "use strict";

  // the field that names a list entry, most specific first
  const KEYS = ["AchievementAlias", "QuestAlias", "EnvAlias", "ZoneAlias", "TaskGroupAlias", "TaskAlias", "DotAlias",
    "AcquisitionSkillAlias", "DataAlias", "RecordGroupName", "StateTagName", "ZoneTriggerAlias", "TriggerAlias", "GiftAlias",
    "StageAlias", "HintAlias", "ActorAlias"];

  function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }

  /** A value as text: numbers stay numbers, vectors become "x, y, z", GUIDs hex. */
  function leaf(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    if (v instanceof Uint8Array) return hex(v);
    if (typeof v === "object" && "f32" in v) return Math.round(v.f32 * 1000) / 1000;
    if (typeof v === "object" && v.raw instanceof Uint8Array && !v.props) {
      const r = v.raw;
      if (r.length === 12 || r.length === 24) {
        const d = new DataView(r.buffer, r.byteOffset, r.length);
        const n = r.length / 4;
        return Array.from({ length: n }, (_, i) => Math.round(d.getFloat32(i * 4, true) * 10) / 10).join(", ");
      }
      return hex(r);
    }
    return null;
  }

  function entryKey(struct, seen) {
    let k = null;
    const props = (struct && struct.props) || [];
    const inst = props.find((p) => p.name === "ItemInstance");
    if (inst && inst.value && inst.value.props) {
      const a = inst.value.props.find((p) => p.name === "ItemAlias");
      if (a) k = String(a.value);
    }
    if (!k) {
      for (const name of KEYS) {
        const p = props.find((q) => q.name === name);
        if (p && typeof p.value === "string") { k = p.value; break; }
      }
    }
    if (!k) {
      const p = props.find((q) => /Alias$/.test(q.name) && typeof q.value === "string" && q.value !== "None");
      if (p) k = p.value;
    }
    if (!k) return null;
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return n ? `${k}#${n + 1}` : k;
  }

  function walkValue(v, path, out) {
    if (v && typeof v === "object" && Array.isArray(v.props)) { walkProps(v.props, path, out); return; }
    if (v && typeof v === "object" && Array.isArray(v.array)) {
      const seen = new Map();
      v.array.forEach((e, i) => {
        if (e && typeof e === "object" && Array.isArray(e.props)) walkValue(e, `${path}[${entryKey(e, seen) || i}]`, out);
        else if (typeof e === "string") out.set(`${path}{${e}}`, true); // lists of names behave like sets
        else out.set(`${path}[${i}]`, leaf(e)); // lists of numbers: by position
      });
      return;
    }
    if (v && typeof v === "object" && Array.isArray(v.set)) { for (const e of v.set) out.set(`${path}{${leaf(e)}}`, true); return; }
    if (v && typeof v === "object" && Array.isArray(v.map)) {
      for (const [k, x] of v.map) walkValue(x, `${path}[${leaf(k)}]`, out);
      return;
    }
    const l = leaf(v);
    if (l !== null) out.set(path, l);
  }

  function walkProps(props, path, out) {
    for (const p of props) walkValue(p.value, path ? `${path}.${p.name}${p.aidx ? `(${p.aidx})` : ""}` : p.name, out);
  }

  /** path -> value for a parsed save */
  function flatten(save) {
    const out = new Map();
    walkProps(save.props, "", out);
    return out;
  }

  /**
   * Compare two parsed saves. Returns [{ path, kind: "added" | "removed" | "changed", before, after }],
   * ordered by path. Set-like entries ("{...}" paths) are reported as added or removed.
   */
  function diffSaves(a, b) {
    const A = a instanceof Map ? a : flatten(a);
    const B = b instanceof Map ? b : flatten(b);
    const out = [];
    for (const [k, v] of A) {
      if (!B.has(k)) out.push({ path: k, kind: "removed", before: v, after: null });
      else if (B.get(k) !== v) out.push({ path: k, kind: "changed", before: v, after: B.get(k) });
    }
    for (const [k, v] of B) if (!A.has(k)) out.push({ path: k, kind: "added", before: null, after: v });
    return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  }

  const api = { flatten, diffSaves, leaf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SBDiff = api;
})(typeof window !== "undefined" ? window : globalThis);
