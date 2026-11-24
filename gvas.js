/*
 * Stellar Blade: C2 - save file reader/writer
 * Copyright (C) 2026 cragson
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Stellar Blade (PC) saves are:  "EVAS" + u32 version + <GVAS payload> + u32 CRC32(payload).
 * The GVAS payload is an Unreal Engine 4.26 SaveGame using tagged properties. This module
 * parses it into plain objects and writes it back byte for byte: nodes that are not edited
 * produce exactly the bytes they were read from.
 *
 * Works in the browser (window.SBGvas) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  class GvasError extends Error {}

  // ------------------------------------------------------------------ CRC32 (zlib)
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ------------------------------------------------------------------ reading
  const utf16 = new TextDecoder("utf-16le");

  class Reader {
    constructor(bytes, pos) {
      this.b = bytes;
      this.p = pos || 0;
      this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    need(n) {
      if (n < 0 || this.p + n > this.b.length) throw new GvasError(`read past end at 0x${this.p.toString(16)}`);
    }
    take(n) {
      this.need(n);
      const out = this.b.slice(this.p, this.p + n);
      this.p += n;
      return out;
    }
    u8() { this.need(1); return this.b[this.p++]; }
    i32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
    u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
    i64() { this.need(8); const x = this.v.getBigInt64(this.p, true); this.p += 8; return x; }
    fstr() {
      const n = this.i32();
      if (n === 0) return "";
      if (n < 0) {
        if (-n > 1 << 20) throw new GvasError(`bad string length at 0x${(this.p - 4).toString(16)}`);
        return utf16.decode(this.take(-2 * n)).replace(/\0+$/, "");
      }
      if (n > 1 << 20) throw new GvasError(`bad string length at 0x${(this.p - 4).toString(16)}`);
      const raw = this.take(n);
      let s = "";
      for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
      return s.replace(/\0+$/, "");
    }
  }

  const NATIVE_STRUCTS = {
    Guid: 16, Vector: 12, Rotator: 12, Vector2D: 8, Quat: 16, LinearColor: 16,
    Color: 4, IntPoint: 8, DateTime: 8, Timespan: 8, IntVector: 12,
  };

  const isWordish = (s) => s.length > 0 && /^[A-Za-z0-9_]+$/.test(s);

  // does a tagged property list start at p?
  function looksTagged(bytes, p) {
    try {
      const r = new Reader(bytes, p);
      const name = r.fstr();
      if (name === "None") return true;
      if (!isWordish(name)) return false;
      return r.fstr().endsWith("Property");
    } catch (e) {
      return false;
    }
  }

  const struct = (st, props, raw) => ({ st, props: props || null, raw: raw || null });
  const f32 = (raw) => ({ f32: new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true), raw });

  function readProps(r) {
    const props = [];
    for (;;) {
      const name = r.fstr();
      if (name === "None") return props;
      const type = r.fstr();
      const size = r.u32();
      const aidx = r.i32();
      const extra = {};
      if (type === "StructProperty") {
        extra.struct = r.fstr();
        extra.sguid = r.take(16);
      } else if (type === "BoolProperty") {
        extra.bool = r.u8();
      } else if (type === "ByteProperty" || type === "EnumProperty") {
        extra.enum = r.fstr();
      } else if (type === "ArrayProperty" || type === "SetProperty") {
        extra.inner = r.fstr();
      } else if (type === "MapProperty") {
        extra.inner = r.fstr();
        extra.value = r.fstr();
      }
      const guid = r.u8() ? r.take(16) : null;
      const start = r.p;
      let value;
      try {
        value = readValue(r, type, size, extra, name);
      } catch (e) {
        if (!(e instanceof GvasError) && !(e instanceof RangeError)) throw e;
        r.p = start + size + 1; // force the raw fallback below
      }
      if (r.p !== start + size) {
        r.p = start; // unknown layout: keep the bytes as they are
        value = { raw: r.take(size) };
      }
      props.push({ name, type, extra, value, aidx, guid });
    }
  }

  function readStructBody(r, st) {
    if (st && NATIVE_STRUCTS[st]) return struct(st, null, r.take(NATIVE_STRUCTS[st]));
    if (looksTagged(r.b, r.p)) return struct(st, readProps(r));
    return struct(st || "Guid?", null, r.take(16)); // untyped map key/value that isn't tagged: an FGuid
  }

  /** An ASCII FString (length, printable text, NUL) starts here: how enum names are stored in containers. */
  function looksLikeName(b, p) {
    if (p + 6 > b.length) return false;
    const n = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24);
    if (n < 2 || n > 256 || p + 4 + n > b.length || b[p + 3 + n] !== 0) return false;
    for (let i = p + 4; i < p + 3 + n; i++) if (b[i] < 0x20 || b[i] > 0x7e) return false;
    return true;
  }

  function readElem(r, type, name) {
    switch (type) {
      case "StructProperty": return readStructBody(r, null);
      case "IntProperty": return r.i32();
      case "UInt32Property": return r.u32();
      case "Int64Property": return r.i64();
      case "FloatProperty": return f32(r.take(4));
      case "NameProperty": case "StrProperty": case "EnumProperty":
      case "ObjectProperty": case "SoftObjectProperty": return r.fstr();
      // enum bytes inside arrays, sets and maps are stored as their name ("ESBMission_Achievement")
      case "ByteProperty": return looksLikeName(r.b, r.p) ? r.fstr() : r.u8();
      case "BoolProperty": return r.u8();
      default: throw new GvasError(`unsupported element type ${type} in ${name}`);
    }
  }

  function readValue(r, type, size, extra, name) {
    switch (type) {
      case "StructProperty": {
        const st = extra.struct;
        if (NATIVE_STRUCTS[st]) return struct(st, null, r.take(size));
        const start = r.p;
        if (looksTagged(r.b, r.p)) {
          const s = struct(st, readProps(r));
          if (r.p === start + size) return s;
          r.p = start;
        }
        return struct(st, null, r.take(size));
      }
      case "ArrayProperty": {
        const n = r.i32();
        if (extra.inner === "StructProperty") {
          const iname = r.fstr();
          const itype = r.fstr();
          r.u32(); r.i32(); // inner size + array index (recomputed on write)
          const istruct = r.fstr();
          const iguid = r.take(16);
          const ipguid = r.u8() ? r.take(16) : null;
          const array = [];
          for (let i = 0; i < n; i++) array.push(readStructBody(r, istruct));
          return { array, itag: { iname, itype, istruct, iguid, ipguid } };
        }
        const array = [];
        for (let i = 0; i < n; i++) array.push(readElem(r, extra.inner, name));
        return { array };
      }
      case "SetProperty": {
        const removed = [];
        for (let i = r.i32(); i > 0; i--) removed.push(readElem(r, extra.inner, name));
        const set = [];
        for (let i = r.i32(); i > 0; i--) set.push(readElem(r, extra.inner, name));
        return { set, removed };
      }
      case "MapProperty": {
        const removed = [];
        for (let i = r.i32(); i > 0; i--) removed.push(readElem(r, extra.inner, name));
        const map = [];
        for (let i = r.i32(); i > 0; i--) {
          const k = readElem(r, extra.inner, name);
          const v = readElem(r, extra.value, name);
          map.push([k, v]);
        }
        return { map, removed };
      }
      case "BoolProperty": return extra.bool;
      case "IntProperty": return r.i32();
      case "UInt32Property": return r.u32();
      case "Int64Property": return r.i64();
      case "FloatProperty": return f32(r.take(4));
      case "DoubleProperty": return { f64raw: r.take(8) };
      case "NameProperty": case "StrProperty": return r.fstr();
      case "ByteProperty": case "EnumProperty": return size === 1 ? r.u8() : r.fstr();
      default: return { raw: r.take(size) };
    }
  }

  // ------------------------------------------------------------------ writing
  class Writer {
    constructor() { this.parts = []; this.len = 0; }
    bytes(b) { this.parts.push(b); this.len += b.length; }
    u8(x) { this.bytes(Uint8Array.of(x & 0xff)); }
    num(bytesLen, set) {
      const b = new Uint8Array(bytesLen);
      set(new DataView(b.buffer));
      this.bytes(b);
    }
    i32(x) { this.num(4, (d) => d.setInt32(0, x, true)); }
    u32(x) { this.num(4, (d) => d.setUint32(0, x, true)); }
    i64(x) { this.num(8, (d) => d.setBigInt64(0, BigInt(x), true)); }
    fstr(s) {
      if (s === "") return this.i32(0);
      let ascii = true;
      for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) { ascii = false; break; }
      if (ascii) {
        const b = new Uint8Array(s.length + 1);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
        this.i32(b.length);
        return this.bytes(b);
      }
      const b = new Uint8Array((s.length + 1) * 2);
      const d = new DataView(b.buffer);
      for (let i = 0; i < s.length; i++) d.setUint16(i * 2, s.charCodeAt(i), true);
      this.i32(-(s.length + 1));
      this.bytes(b);
    }
    concat() {
      const out = new Uint8Array(this.len);
      let o = 0;
      for (const p of this.parts) { out.set(p, o); o += p.length; }
      return out;
    }
  }

  function writeProps(w, props) {
    for (const p of props) writeProp(w, p);
    w.fstr("None");
  }

  function writeProp(w, p) {
    const bw = new Writer();
    writeValue(bw, p.type, p.value, p.extra);
    const body = bw.concat();
    w.fstr(p.name);
    w.fstr(p.type);
    w.u32(p.type === "BoolProperty" ? 0 : body.length);
    w.i32(p.aidx);
    const e = p.extra;
    if (p.type === "StructProperty") { w.fstr(e.struct); w.bytes(e.sguid); }
    else if (p.type === "BoolProperty") w.u8(e.bool);
    else if (p.type === "ByteProperty" || p.type === "EnumProperty") w.fstr(e.enum);
    else if (p.type === "ArrayProperty" || p.type === "SetProperty") w.fstr(e.inner);
    else if (p.type === "MapProperty") { w.fstr(e.inner); w.fstr(e.value); }
    if (p.guid) { w.u8(1); w.bytes(p.guid); } else w.u8(0);
    w.bytes(body);
  }

  function writeStructBody(w, s) {
    if (s.raw) w.bytes(s.raw);
    else writeProps(w, s.props);
  }

  function writeElem(w, type, v) {
    switch (type) {
      case "StructProperty": return writeStructBody(w, v);
      case "IntProperty": return w.i32(v);
      case "UInt32Property": return w.u32(v);
      case "Int64Property": return w.i64(v);
      case "FloatProperty": return w.bytes(v.raw);
      case "NameProperty": case "StrProperty": case "EnumProperty":
      case "ObjectProperty": case "SoftObjectProperty": return w.fstr(v);
      case "ByteProperty": return typeof v === "string" ? w.fstr(v) : w.u8(v);
      case "BoolProperty": return w.u8(v);
      default: throw new GvasError(`cannot write element type ${type}`);
    }
  }

  function writeValue(w, type, v, extra) {
    if (v && v.raw instanceof Uint8Array && !("st" in v) && !("f32" in v)) return w.bytes(v.raw);
    switch (type) {
      case "StructProperty": return writeStructBody(w, v);
      case "ArrayProperty": {
        w.i32(v.array.length);
        if (extra.inner === "StructProperty") {
          const ew = new Writer();
          for (const s of v.array) writeStructBody(ew, s);
          const elems = ew.concat();
          const t = v.itag;
          w.fstr(t.iname); w.fstr(t.itype); w.u32(elems.length); w.i32(0); w.fstr(t.istruct); w.bytes(t.iguid);
          if (t.ipguid) { w.u8(1); w.bytes(t.ipguid); } else w.u8(0);
          return w.bytes(elems);
        }
        for (const e of v.array) writeElem(w, extra.inner, e);
        return;
      }
      case "SetProperty":
        w.i32(v.removed.length);
        for (const e of v.removed) writeElem(w, extra.inner, e);
        w.i32(v.set.length);
        for (const e of v.set) writeElem(w, extra.inner, e);
        return;
      case "MapProperty":
        w.i32(v.removed.length);
        for (const e of v.removed) writeElem(w, extra.inner, e);
        w.i32(v.map.length);
        for (const [k, val] of v.map) { writeElem(w, extra.inner, k); writeElem(w, extra.value, val); }
        return;
      case "BoolProperty": return;
      case "IntProperty": return w.i32(v);
      case "UInt32Property": return w.u32(v);
      case "Int64Property": return w.i64(v);
      case "FloatProperty": return w.bytes(v.raw);
      case "DoubleProperty": return w.bytes(v.f64raw);
      case "NameProperty": case "StrProperty": return w.fstr(v);
      case "ByteProperty": case "EnumProperty": return typeof v === "number" ? w.u8(v) : w.fstr(v);
      default: throw new GvasError(`cannot write ${type}`);
    }
  }

  // ------------------------------------------------------------------ file
  function parse(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const magic = String.fromCharCode(...bytes.slice(0, 4));
    if (magic !== "EVAS") {
      if (magic === "GVAS") throw new GvasError("This file has no Stellar Blade header. Open StellarBladeSave00.sav from the SaveGames folder.");
      throw new GvasError("This isn't a Stellar Blade save file. Open StellarBladeSave00.sav.");
    }
    if (bytes.length < 64) throw new GvasError("The file is too short to be a save.");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const evasVersion = dv.getUint32(4, true);
    const payload = bytes.slice(8, bytes.length - 4);
    const crc = dv.getUint32(bytes.length - 4, true);
    if (crc32(payload) !== crc) throw new GvasError("The save's checksum doesn't match, so the file is damaged or incomplete.");
    if (String.fromCharCode(...payload.slice(0, 4)) !== "GVAS") throw new GvasError("The save is missing its GVAS section.");
    const r = new Reader(payload, 4);
    r.i32(); r.i32();          // SaveGameFileVersion, PackageFileUE4Version
    r.take(2 + 2 + 2 + 4); r.fstr(); // engine version + branch
    r.i32();                   // custom version format
    const n = r.i32();
    r.take(n * 20);            // custom versions (guid + int)
    const className = r.fstr();
    const header = payload.slice(0, r.p);
    const props = readProps(r);
    const trailer = payload.slice(r.p);
    return { evasVersion, className, header, props, trailer };
  }

  function serialize(save) {
    const w = new Writer();
    w.bytes(save.header);
    writeProps(w, save.props);
    w.bytes(save.trailer);
    const payload = w.concat();
    const out = new Uint8Array(payload.length + 12);
    const dv = new DataView(out.buffer);
    out.set([0x45, 0x56, 0x41, 0x53], 0); // "EVAS"
    dv.setUint32(4, save.evasVersion, true);
    out.set(payload, 8);
    dv.setUint32(8 + payload.length, crc32(payload), true);
    return out;
  }

  const getProp = (s, name) => (s && s.props ? s.props.find((p) => p.name === name) || null : null);

  const api = { GvasError, crc32, parse, serialize, getProp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SBGvas = api;
})(typeof window !== "undefined" ? window : globalThis);
