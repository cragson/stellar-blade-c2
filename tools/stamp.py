#!/usr/bin/env python3
"""Stamp every local file link in docs/index.html (and the lazily loaded data files) with a fingerprint of the file.

  python3 tools/stamp.py          # after changing any .js/.css/.svg file

A browser keeps files it has loaded and may reuse them without asking, so after an update it could combine the
new index.html with an old app.css or progress.js. With a fingerprint in each link (app.css?v=1a2b3c4d5e), a changed
file gets a new link and is always loaded fresh. tests/unit.test.js fails when a stamp is out of date.

Copyright (C) 2026 cragson - SPDX-License-Identifier: AGPL-3.0-or-later
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "docs"  # the web app
# files loaded later by a script tag a module adds: module -> files it loads
LAZY = {"map.js": ["world.js"], "commands.js": ["intel.js"], "codex.js": ["codex-data.js"], "planner.js": ["builds.js"], "dialogue-ui.js": ["dialogue.js"], "ai-ui.js": ["ai.js"]}
# the font is referenced from app.css without a stamp; preloading a stamped URL would download it twice
SKIP = {"fonts/saira.woff2"}


def fingerprint(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()[:10]


def stamp(check=False):
    stale = []

    def write(path, text):
        if path.read_text(encoding="utf-8") != text:
            stale.append(path.name)
            if not check:
                path.write_text(text, encoding="utf-8")

    # 1. the data files the modules load on demand (before the modules themselves get their fingerprints)
    for module, files in LAZY.items():
        path = ROOT / module
        text = path.read_text(encoding="utf-8")
        for f in files:
            text = re.sub(r'"%s(\?v=[0-9a-f]+)?"' % re.escape(f), '"%s?v=%s"' % (f, fingerprint(f)), text)
        write(path, text)
    # 2. every local script, stylesheet and image in index.html
    index = ROOT / "index.html"

    def repl(m):
        name = m.group(2)
        if name in SKIP or not (ROOT / name).is_file():
            return m.group(0)
        return '%s="%s?v=%s"' % (m.group(1), name, fingerprint(name))

    text = re.sub(r'(src|href)="([A-Za-z0-9_./-]+\.(?:js|css|svg|png|webp))(?:\?v=[0-9a-f]+)?"', repl, index.read_text(encoding="utf-8"))
    write(index, text)
    return stale


if __name__ == "__main__":
    check = "--check" in sys.argv
    stale = stamp(check)
    if check and stale:
        print("out of date: %s (run python3 tools/stamp.py)" % ", ".join(stale))
        sys.exit(1)
    print("stamped: %s" % (", ".join(stale) if stale else "nothing changed"))
