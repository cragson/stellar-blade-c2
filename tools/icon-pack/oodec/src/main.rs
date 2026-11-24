// Decompressor for the game's IoStore blocks, used by make_icon_pack.py. Uses the MIT-licensed oozextract crate.
// Copyright (C) 2026 cragson - SPDX-License-Identifier: AGPL-3.0-or-later
// Reads lines "offset csize usize method" from stdin, decompresses each block
// from the given .ucas file and writes the concatenated output to stdout.
use std::io::{BufRead, Read, Seek, SeekFrom, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut f = std::fs::File::open(&args[1]).expect("open ucas");
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    let mut ex = oozextract::Extractor::new();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let p: Vec<u64> = line.split_whitespace().map(|x| x.parse().unwrap()).collect();
        if p.len() < 4 { continue; }
        let (off, csz, usz, method) = (p[0], p[1] as usize, p[2] as usize, p[3]);
        let mut buf = vec![0u8; csz];
        f.seek(SeekFrom::Start(off)).unwrap();
        f.read_exact(&mut buf).unwrap();
        if method == 0 {
            out.write_all(&buf[..usz.min(csz)]).unwrap();
        } else {
            let mut dst = vec![0u8; usz];
            match ex.read_from_slice(&buf, &mut dst) {
                Ok(n) if n == usz => {}
                Ok(n) => eprintln!("short decompress {} != {}", n, usz),
                Err(e) => { eprintln!("decompress error: {:?}", e); std::process::exit(2); }
            }
            out.write_all(&dst).unwrap();
        }
    }
}
