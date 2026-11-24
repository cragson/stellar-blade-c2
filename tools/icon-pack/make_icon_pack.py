#!/usr/bin/env python3
"""Make an icon pack for Stellar Blade: C2 from YOUR OWN copy of the game.

  python3 make_icon_pack.py [game folder] [-o StellarBladeIcons.json]

The game folder is the one that contains SB/Content/Paks (for example
"C:\\Program Files (x86)\\Steam\\steamapps\\common\\StellarBlade" or
"~/.local/share/Steam/steamapps/common/StellarBlade"); common Steam locations are tried automatically.

It reads the item icons, the in-game world maps (Wasteland, Great Desert, Xion and the Xion underground) and the
game's texts (dialogue lines, records, manual pages, descriptions; --lang picks the language) straight out of the
game's data files and writes one JSON file. Load that file in the C2 (Tools > Item icons and map art): it stays in
your browser. Please don't share the pack: the icons, maps and texts are the game's artwork and writing, which is
why C2 doesn't ship them.

Needs Python 3.8+ and the small `oodec` decompressor next to this script: build it once with
  cd oodec && cargo build --release
(https://rustup.rs gets you cargo). Nothing else is installed or downloaded.

Copyright (C) 2026 cragson - SPDX-License-Identifier: AGPL-3.0-or-later
"""
import argparse, base64, json, os, re, struct, subprocess, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 128  # icons are 256x256 in the game; half size keeps the pack small and still sharp on hi-dpi screens


# ---------------------------------------------------------------- IoStore container (UE 4.26 .utoc/.ucas)
class Toc:
    def __init__(self, utoc):
        self.ucas = utoc[:-5] + ".ucas"
        d = open(utoc, "rb").read()
        hs, ec, cbc, cbs, cmc, cml, cbsz, dis = struct.unpack_from("<8I", d, 0x14)
        flags = d[0x50]
        self.block_size = cbsz
        o = hs + ec * 12  # skip chunk ids
        self.offlen = []
        for i in range(ec):
            b = d[o + i * 10:o + i * 10 + 10]
            self.offlen.append((int.from_bytes(b[0:5], "big"), int.from_bytes(b[5:10], "big")))
        o += ec * 10
        self.blocks = []
        for i in range(cbc):
            b = d[o + i * 12:o + i * 12 + 12]
            self.blocks.append((int.from_bytes(b[0:5], "little"), int.from_bytes(b[5:8], "little"),
                                int.from_bytes(b[8:11], "little"), b[11]))
        o += cbc * cbs + cmc * cml
        self.files = {}
        if flags & 8:
            self._dir(d[o:o + dis])

    def _dir(self, b):
        p = 0

        def fstr():
            nonlocal p
            n = struct.unpack_from("<i", b, p)[0]; p += 4
            if n < 0:
                s = b[p:p - n * 2].decode("utf-16le"); p += -n * 2
            else:
                s = b[p:p + n].decode("utf-8", "replace"); p += n
            return s.rstrip("\0")
        mount = fstr()
        n = struct.unpack_from("<i", b, p)[0]; p += 4
        dirs = [struct.unpack_from("<4I", b, p + i * 16) for i in range(n)]; p += n * 16
        n = struct.unpack_from("<i", b, p)[0]; p += 4
        files = [struct.unpack_from("<3I", b, p + i * 12) for i in range(n)]; p += n * 12
        n = struct.unpack_from("<i", b, p)[0]; p += 4
        strs = [fstr() for _ in range(n)]
        NONE = 0xFFFFFFFF
        stack = [(0, mount)] if dirs else []
        while stack:
            di, path = stack.pop()
            name, child, _, f = dirs[di]
            if name != NONE:
                path += strs[name] + "/"
            while f != NONE:
                fn, f, user = files[f]
                self.files[path + strs[fn]] = user
            c = child
            while c != NONE:
                stack.append((c, path))
                c = dirs[c][2]

    def read_chunks(self, idxs, oodec):
        """Read many chunks with one decompressor run."""
        plan, req = [], []
        for idx in idxs:
            off, ln = self.offlen[idx]
            first, last = off // self.block_size, (off + ln - 1) // self.block_size
            blocks = self.blocks[first:last + 1]
            plan.append((sum(b[2] for b in blocks), off - first * self.block_size, ln))
            req += ["%d %d %d %d" % b for b in blocks]
        r = subprocess.run([oodec, self.ucas], input=("\n".join(req) + "\n").encode(), capture_output=True)
        if r.returncode != 0:
            sys.exit("oodec failed: " + r.stderr.decode(errors="replace"))
        out, pos, res = r.stdout, 0, []
        for total, start, ln in plan:
            res.append(out[pos + start:pos + start + ln])
            pos += total
        return res


def export_data(data):
    """First export of a zen package (a texture package has exactly one)."""
    hdr = struct.unpack_from("<QQIIiiiiiiiiii", data, 0)
    exo, ebo, gdo, gds = hdr[9], hdr[10], hdr[11], hdr[12]
    exports = [struct.unpack_from("<QQ", data, exo + i * 72) for i in range((ebo - exo) // 72)]
    pos = gdo + gds
    for k in sorted(range(len(exports)), key=lambda k: exports[k][0]):
        if k == 0:
            return data[pos:pos + exports[k][1]]
        pos += exports[k][1]


BYTES_PER_PIXEL = {"PF_B8G8R8A8": 4, "PF_DXT1": 0.5, "PF_DXT5": 1}


def texture_rgba(data):
    """(width, height, RGBA bytes) of a cooked UTexture2D's first mip, if it's stored inline as uncompressed
    B8G8R8A8 or as DXT1/DXT5 (BC1/BC3), else None."""
    d = export_data(data)
    i = d.find(b"PF_") if d else -1
    if i < 0:
        return None
    n = struct.unpack_from("<i", d, i - 4)[0]  # the pixel format is an FString: length, then the characters
    fmt = d[i:i + n - 1].decode("ascii", "replace")
    if fmt not in BYTES_PER_PIXEL:
        return None
    w, h = struct.unpack_from("<ii", d, i - 16)
    p = i + n + 32  # FirstMip, NumMips, cooked flag, bulk flags, element count, size on disk, offset (int64)
    size = int(max(w, 4) * max(h, 4) * BYTES_PER_PIXEL[fmt])
    px = d[p:p + size]
    if len(px) != size:
        return None  # the mip isn't inline (it's in a .ubulk): not needed so far
    if fmt != "PF_B8G8R8A8":
        return w, h, bc_decode(w, h, px, fmt == "PF_DXT5")
    rgba = bytearray(px)
    rgba[0::4], rgba[2::4] = px[2::4], px[0::4]
    return w, h, bytes(rgba)


def _565(c):
    r, g, b = (c >> 11) & 31, (c >> 5) & 63, c & 31
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def bc_decode(w, h, data, bc3):
    """DXT1 (BC1) or DXT5 (BC3) blocks to RGBA bytes."""
    out = bytearray(w * h * 4)
    bw, step = max(1, (w + 3) // 4), 16 if bc3 else 8
    for k in range(len(data) // step):
        o = k * step
        if bc3:
            a0, a1 = data[o], data[o + 1]
            if a0 > a1:
                al = [a0, a1] + [((7 - j) * a0 + j * a1 + 3) // 7 for j in range(1, 7)]
            else:
                al = [a0, a1] + [((5 - j) * a0 + j * a1 + 2) // 5 for j in range(1, 5)] + [0, 255]
            abits = int.from_bytes(data[o + 2:o + 8], "little")
            o += 8
        c0, c1, bits = struct.unpack_from("<HHI", data, o)
        p0, p1 = _565(c0), _565(c1)
        if bc3 or c0 > c1:
            pal = [p0 + (255,), p1 + (255,), tuple((2 * x + y + 1) // 3 for x, y in zip(p0, p1)) + (255,),
                   tuple((x + 2 * y + 1) // 3 for x, y in zip(p0, p1)) + (255,)]
        else:
            pal = [p0 + (255,), p1 + (255,), tuple((x + y) // 2 for x, y in zip(p0, p1)) + (255,), (0, 0, 0, 0)]
        bx, by = (k % bw) * 4, (k // bw) * 4
        for j in range(16):
            x, y = bx + (j & 3), by + (j >> 2)
            if x >= w or y >= h:
                continue
            px = pal[(bits >> (2 * j)) & 3]
            q = (y * w + x) * 4
            out[q:q + 3] = bytes(px[:3])
            out[q + 3] = al[(abits >> (3 * j)) & 7] if bc3 else px[3]
    return bytes(out)


def half(w, h, rgba):
    """Average 2x2 blocks."""
    out = bytearray((w // 2) * (h // 2) * 4)
    row = w * 4
    o = 0
    for y in range(0, h - 1, 2):
        a, b = rgba[y * row:(y + 1) * row], rgba[(y + 1) * row:(y + 2) * row]
        for x in range(0, row - 7, 8):
            for c in range(4):
                out[o + c] = (a[x + c] + a[x + 4 + c] + b[x + c] + b[x + 4 + c] + 2) >> 2
            o += 4
    return w // 2, h // 2, bytes(out)


def png(w, h, rgba, alpha=True):
    if not alpha:  # opaque: drop the alpha channel (smaller file)
        rgb = bytearray(w * h * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = rgba[0::4], rgba[1::4], rgba[2::4]
        rgba = bytes(rgb)
    n = 4 if alpha else 3
    raw = b"".join(b"\0" + rgba[y * w * n:(y + 1) * w * n] for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6 if alpha else 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


# ---------------------------------------------------------------- the in-game world maps
# WorldMapTable gives each map's textures: the map itself (Map_*, the walkable ground, drawn over a transparent
# background by the M_Map_* material, no UV changes) and a dark terrain backdrop (WorldMap_*_RT_Tex_BG). Both
# cover exactly the box of the level's SBWorldMapVolume actor (in the *_LD_Respawn sublevels): a +-100 cube brush,
# not rotated, at the location and scale below. So for a world position X, Y (Unreal units):
#   image x = (Y - y0) / (y1 - y0) * width      image y = (x1 - X) / (x1 - x0) * height
# i.e. +Y is right and +X is up, the same as C2's map. Where a level has two maps (Xion and its underground,
# whose boxes overlap), a position belongs to the one whose box holds it with the nearest z (the box centre's Z).
#   (map, level, map texture, backdrop texture, box centre X, Y, Z, box half size (scale x 100))
WORLD_MAPS = [
    ("Wasteland", "E03_WasteLand_P", "Map_WasteLand", "WorldMap_WasteLand_RT_Tex_BG", -5000.0, 4789.0, 7385.130859375, 84375.0),
    ("Great Desert", "E05_GreatDesert_P", "Map_GreatDesert", "WorldMap_GreatDesert_RT_Tex_BG", 30169.96875, -12661.0, 11835.130859375, 128620.42236328125),
    ("Xion", "E04", "Map_XION", "WorldMap_XION_RT_Tex_BG_2048", -5020.0, 5200.0, 500.0, 30585.9375),
    ("Xion underground", "E04", "Map_XIONUUNDERGROUND", "WorldMap_XIONUNDERGROUND_RT_Tex_BG_2048", 34283.9140625, -1326.1783447265625, -34843.203125, 19293.063354492188),
]
MAP_SIZE, BACKDROP_SIZE = 2048, 1024


def world_maps(toc, oodec):
    """{level: [{name, img, bg, w, h, x0, x1, y0, y1, z}, ...]} for the maps the game has."""
    folder = "../../../SB/Content/Art/UI/Texture/Map/%s.uasset"
    names = sorted({n for m in WORLD_MAPS for n in m[2:4]})
    have = [n for n in names if folder % n in toc.files]
    tex = dict(zip(have, toc.read_chunks([toc.files[folder % n] for n in have], oodec)))
    out = {}
    for name, level, fg, bg, cx, cy, cz, half_size in WORLD_MAPS:
        imgs = {}
        for key, tname, size, alpha in (("img", fg, MAP_SIZE, True), ("bg", bg, BACKDROP_SIZE, False)):
            t = tname in tex and texture_rgba(tex[tname])
            if not t:
                continue
            w, h, rgba = t
            while w > size:
                w, h, rgba = half(w, h, rgba)
            imgs[key] = "data:image/png;base64," + base64.b64encode(png(w, h, rgba, alpha)).decode()
            imgs.setdefault("w", w)
            imgs.setdefault("h", h)
        if "img" not in imgs:
            print("  no map image for %s" % name)
            continue
        out.setdefault(level, []).append(dict(imgs, name=name, x0=cx - half_size, x1=cx + half_size,
                                              y0=cy - half_size, y1=cy + half_size, z=cz))
        print("  map: %s" % name)
    return out


# ---------------------------------------------------------------- the game's texts (legacy .pak, Game.locres)
class LegacyPak:
    """The UE 4.26 .pak next to the IoStore containers (v11, index not encrypted): it holds the Localization folder."""

    def __init__(self, path):
        self.path = path
        self.f = open(path, "rb")
        self.f.seek(0, 2)
        self.f.seek(self.f.tell() - 221)
        ft = self.f.read(221)
        if ft[16]:
            raise RuntimeError("encrypted pak index")
        magic, _ver, ioff, isz = struct.unpack_from("<IIqq", ft, 17)
        if magic != 0x5A6F12E1:
            raise RuntimeError("not a pak file")
        self.methods = [""] + [ft[61 + 32 * i:61 + 32 * (i + 1)].rstrip(b"\0").decode() for i in range(5)]
        self.f.seek(ioff)
        b = self.f.read(isz)
        p = 0

        def i32():
            nonlocal p
            p += 4
            return struct.unpack_from("<i", b, p - 4)[0]

        def i64():
            nonlocal p
            p += 8
            return struct.unpack_from("<q", b, p - 8)[0]

        def fstr(buf, q):
            n = struct.unpack_from("<i", buf, q)[0]
            q += 4
            if n < 0:
                return buf[q:q - 2 * n].decode("utf-16le").rstrip("\0"), q - 2 * n
            return buf[q:q + n].decode("utf-8", "replace").rstrip("\0"), q + n

        mount, p = fstr(b, p)
        i32()
        p += 8  # path hash seed
        if i32():
            p += 16 + 20
        has_full = i32()
        full_off = full_sz = 0
        if has_full:
            full_off, full_sz = i64(), i64()
            p += 20
        n = i32()
        self.encoded = b[p:p + n]
        self.files = {}
        if has_full:
            self.f.seek(full_off)
            d = self.f.read(full_sz)
            q = 4
            for _ in range(struct.unpack_from("<i", d, 0)[0]):
                dname, q = fstr(d, q)
                files = struct.unpack_from("<i", d, q)[0]
                q += 4
                for _ in range(files):
                    fname, q = fstr(d, q)
                    self.files[(mount + dname + fname).replace("//", "/")] = struct.unpack_from("<i", d, q)[0]
                    q += 4

    def read(self, path, oodec):
        e, q = self.files[path], 0
        b = self.encoded
        v = struct.unpack_from("<I", b, e)[0]
        q = e + 4
        if (v & 0x3f) == 0x3f:
            bsize = struct.unpack_from("<I", b, q)[0]
            q += 4
        else:
            bsize = (v & 0x3f) << 11
        method = (v >> 23) & 0x3f

        def num(small):
            nonlocal q
            if small:
                q += 4
                return struct.unpack_from("<I", b, q - 4)[0]
            q += 8
            return struct.unpack_from("<q", b, q - 8)[0]

        off = num(v & (1 << 31))
        usize = num(v & (1 << 30))
        size = num(v & (1 << 29)) if method else usize
        if v & (1 << 22):
            raise RuntimeError("encrypted pak entry")
        nblocks = (v >> 6) & 0xffff
        hdr = 8 + 8 + 8 + 20 + 4 + 1 + 4 + ((4 + 16 * nblocks) if method else 0)
        if not method:
            self.f.seek(off + hdr)
            return self.f.read(usize)
        blocks = []
        if nblocks == 1:
            blocks.append((hdr, hdr + size))
        else:
            cur = hdr
            for _ in range(nblocks):
                n = struct.unpack_from("<I", b, q)[0]
                q += 4
                blocks.append((cur, cur + n))
                cur += n
        reqs, remaining = [], usize
        for s0, t0 in blocks:
            u = min(bsize, remaining)
            remaining -= u
            reqs.append((off + s0, t0 - s0, u))
        name = self.methods[method]
        if name == "Zlib":
            out = b""
            for o, c, _u in reqs:
                self.f.seek(o)
                out += zlib.decompress(self.f.read(c))
            return out
        if name != "Oodle":
            raise RuntimeError("unknown compression " + name)
        r = subprocess.run([oodec, self.path], input="".join("%d %d %d 1\n" % x for x in reqs).encode(), capture_output=True)
        if r.returncode != 0:
            sys.exit("oodec failed: " + r.stderr.decode(errors="replace"))
        return r.stdout


def parse_locres(b):
    """A .locres file: {namespace: {key: text}}. The game's string tables are its namespaces."""
    if b[:16] != bytes.fromhex("0e147475674a03fc4a15909dc3377f1b"):
        raise RuntimeError("not a .locres file")
    p = 16

    def u(fmt):
        nonlocal p
        v = struct.unpack_from(fmt, b, p)[0]
        p += struct.calcsize(fmt)
        return v

    def fstr():
        nonlocal p
        n = u("<i")
        if n < 0:
            s = b[p:p - 2 * n].decode("utf-16le", "replace")
            p += -2 * n
        else:
            s = b[p:p + n].decode("utf-8", "replace")
            p += n
        return s.rstrip("\0")

    ver = u("<B")
    strings = None
    if ver >= 1:
        soff = u("<q")
        save, p = p, soff
        strings = []
        for _ in range(u("<i")):
            strings.append(fstr())
            if ver >= 2:
                u("<i")  # reference count
        p = save
    if ver >= 2:
        u("<I")  # entries count
    out = {}
    for _ in range(u("<I")):
        if ver >= 2:
            u("<I")  # namespace hash
        d = out.setdefault(fstr(), {})
        for _ in range(u("<I")):
            if ver >= 2:
                u("<I")  # key hash
            key = fstr()
            u("<I")  # source string hash
            d[key] = strings[u("<i")] if ver >= 1 else fstr()
            if ver >= 4:
                u("<I")  # one more field per key in this game's locres version
    return out


def game_texts(utoc, lang, oodec):
    """The game's string tables in one language, from the legacy .pak's Localization/Game/<lang>/Game.locres."""
    pak = LegacyPak(utoc[:-5] + ".pak")
    langs = sorted(p.split("/")[-2] for p in pak.files if p.endswith("/Localization/Game/%s/Game.locres" % p.split("/")[-2]))
    path = next((p for p in pak.files if p.endswith("/Localization/Game/%s/Game.locres" % lang)), None)
    if not path:
        sys.exit("No texts for language %r. The game has: %s" % (lang, ", ".join(langs)))
    tables = parse_locres(pak.read(path, oodec))
    return {"lang": lang, "tables": {k: v for k, v in tables.items() if k}}


def find_game(arg):
    cands = [arg] if arg else [
        os.path.expanduser("~/.local/share/Steam/steamapps/common/StellarBlade"),
        os.path.expanduser("~/.steam/steam/steamapps/common/StellarBlade"),
        r"C:\Program Files (x86)\Steam\steamapps\common\StellarBlade",
        r"C:\Program Files\Steam\steamapps\common\StellarBlade",
    ]
    for c in cands:
        utoc = os.path.join(c, "SB", "Content", "Paks", "pakchunk0-WindowsNoEditor.utoc")
        if c and os.path.exists(utoc):
            return utoc
    sys.exit("Couldn't find the game. Pass the game folder (the one that contains SB/Content/Paks).")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("game", nargs="?", help="game folder (contains SB/Content/Paks)")
    ap.add_argument("-o", "--out", default="StellarBladeIcons.json")
    ap.add_argument("--no-maps", action="store_true", help="leave out the world maps (a much smaller file)")
    ap.add_argument("--no-texts", action="store_true", help="leave out the game's texts")
    ap.add_argument("--lang", default="en", help="language of the texts: en (default), de, fr, ja, ... as the game has them")
    ap.add_argument("--oodec", default=os.environ.get("OODEC") or os.path.join(
        HERE, "oodec", "target", "release", "oodec.exe" if os.name == "nt" else "oodec"))
    a = ap.parse_args()
    if not os.path.exists(a.oodec):
        sys.exit("The decompressor isn't built yet: cd oodec && cargo build --release")
    src = open(os.path.join(HERE, "..", "..", "items.js"), encoding="utf-8").read()
    items = json.loads(re.search(r"const ITEMS = (\{.*\});", src).group(1))
    toc = Toc(find_game(a.game))
    want = {}
    for alias, it in items.items():
        path = it.get("icon") and "../../../SB/Content/%s.uasset" % it["icon"]
        if path in toc.files:
            want.setdefault(toc.files[path], []).append(alias)
    print("reading %d icons for %d items..." % (len(want), sum(len(v) for v in want.values())))
    idxs = list(want)
    icons, skipped = {}, 0
    for k in range(0, len(idxs), 64):
        batch = idxs[k:k + 64]
        for idx, data in zip(batch, toc.read_chunks(batch, a.oodec)):
            t = texture_rgba(data)
            if not t:
                skipped += 1
                continue
            w, h, rgba = t
            while w > SIZE:
                w, h, rgba = half(w, h, rgba)
            url = "data:image/png;base64," + base64.b64encode(png(w, h, rgba)).decode()
            for alias in want[idx]:
                icons[alias] = url
        print("  %d / %d" % (min(k + 64, len(idxs)), len(idxs)), end="\r")
    pack = {"format": "sb-icons", "version": 3, "size": SIZE, "icons": icons}
    if not a.no_maps:
        print("\nreading the world maps...")
        pack["maps"] = world_maps(toc, a.oodec)
    if not a.no_texts:
        print("reading the texts (%s)..." % a.lang)
        pack["texts"] = game_texts(find_game(a.game), a.lang, a.oodec)
    json.dump(pack, open(a.out, "w"), separators=(",", ":"))
    print("\nwrote %s: %d icons%s, %d world maps, %d texts (%.1f MB). Load it in C2: Tools > Item icons and map art." % (
        a.out, len(icons), ", %d skipped" % skipped if skipped else "",
        sum(len(v) for v in pack.get("maps", {}).values()),
        sum(len(t) for t in pack.get("texts", {}).get("tables", {}).values()), os.path.getsize(a.out) / 1048576))


if __name__ == "__main__":
    main()
