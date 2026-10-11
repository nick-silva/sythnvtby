#!/usr/bin/env python3
"""
Analyze annotated .vbpack ZIPs for WRAM bytes stable within each stateName
and differing across stateNames. Outputs JSON + Markdown.

Usage:
  python3 analyze_vbpack_ram.py path/to/game.vbpack [--out-dir ./reports]

Requires: Python 3.10+ (stdlib only). For 3.9, replace list[str] with List[str] from typing.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

WRAM_SIZE = 0x10000
MDFNSVST_MAGIC = b"MDFNSVST"
RASTATE_SIG = b"RASTATE"  # RetroArch wraps core serialize (see task_save.c)
ANALYZER_VERSION = "2.1"  # RASTATE unwrap + case-insensitive zip paths + wramIngest summary


def _norm_zip_path(p: str) -> str:
    return p.replace("\\", "/")


def _zip_read_ci(z: zipfile.ZipFile, path: str) -> Optional[bytes]:
    """Read zip member; retry case-insensitive match (Windows / tooling quirks)."""
    path_n = _norm_zip_path(path)
    try:
        return z.read(path_n)
    except KeyError:
        pass
    want_low = path_n.lower()
    for name in z.namelist():
        if _norm_zip_path(name).lower() == want_low:
            return z.read(name)
    return None


def extract_core_payload_from_rastate1(data: bytes) -> Optional[bytes]:
    """Return raw core `retro_serialize` bytes (MDFNSVST…) from a RASTATE v1 container."""
    if len(data) < 24 or data[:7] != RASTATE_SIG:
        return None
    off = 8
    stop = len(data)
    while off + 8 <= stop:
        tag = data[off : off + 4]
        block_size = struct.unpack_from("<I", data, off + 4)[0] & 0xFFFFFFFF
        off += 8
        if tag == b"MEM ":
            end = off + block_size
            if end > stop:
                return None
            return data[off:end]
        aligned = (block_size + 7) & ~7
        off += aligned
    return None


def try_extract_wram_from_mdfnsvst(data: bytes) -> Optional[bytes]:
    """CPU WRAM (64 KiB) from Mednafen MDFNSVST save (possibly inside RetroArch RASTATE)."""
    inner = extract_core_payload_from_rastate1(data)
    if inner is not None:
        data = inner
    if len(data) < 64 or data[:8] != MDFNSVST_MAGIC:
        return None
    w = struct.unpack_from("<I", data, 24)[0]
    h = struct.unpack_from("<I", data, 28)[0]
    preview_len = w * h * 3
    off = 32 + preview_len
    if off > len(data):
        return None
    bound = len(data)
    while off + 36 <= bound:
        name_bytes = data[off : off + 32]
        off += 32
        sec_size = struct.unpack_from("<I", data, off)[0]
        off += 4
        if off + sec_size > len(data):
            return None
        sec_name = name_bytes.split(b"\x00", 1)[0].decode("ascii", errors="replace").strip()
        if sec_name == "MAIN":
            block = data[off : off + sec_size]
            got = _extract_wram_from_main_section(block)
            if got:
                return got[:WRAM_SIZE]
        off += sec_size
    return None


def _extract_wram_from_main_section(main: bytes) -> Optional[bytes]:
    o = 0
    n = len(main)
    while o < n:
        if o >= n:
            break
        slen = main[o]
        if slen == 0:
            break
        if o + 1 + slen + 4 > n:
            break
        name = main[o + 1 : o + 1 + slen].decode("ascii", errors="replace")
        o += 1 + slen
        rec_size = struct.unpack_from("<I", main, o)[0]
        o += 4
        if o + rec_size > n:
            break
        if name == "WRAM" and rec_size >= WRAM_SIZE:
            return main[o : o + WRAM_SIZE]
        o += rec_size
    return None


def load_registry(z: zipfile.ZipFile) -> Tuple[Dict[str, Any], List[dict]]:
    try:
        manifest = json.loads(z.read("manifest.json").decode("utf-8"))
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError):
        return {}, []
    reg = manifest.get("frameRegistry")
    if not isinstance(reg, list):
        return manifest, []
    return manifest, [e for e in reg if isinstance(e, dict)]


def read_wram_with_source(z: zipfile.ZipFile, entry: dict) -> Tuple[Optional[bytes], str]:
    """
    Returns (64KiB WRAM or None, source tag for diagnostics).
    """
    stem = str(entry.get("frameId") or "").strip()
    path = entry.get("ramdumpFile")
    if path and isinstance(path, str):
        data = _zip_read_ci(z, path) or b""
        if len(data) >= WRAM_SIZE:
            return data[:WRAM_SIZE], "ramdump-manifest"

    if stem:
        for cand in (f"ramdumps/{stem}.wram.bin", f"ramdumps/{stem}.bin"):
            data = _zip_read_ci(z, cand) or b""
            if len(data) >= WRAM_SIZE:
                return data[:WRAM_SIZE], "ramdump-by-stem"

    st_path = entry.get("saveStateFile")
    if st_path and isinstance(st_path, str):
        raw = _zip_read_ci(z, st_path)
        if raw:
            extracted = try_extract_wram_from_mdfnsvst(raw)
            if extracted:
                return extracted, "savestate-manifest"
    if stem:
        ss = f"savestates/{stem}.state"
        raw = _zip_read_ci(z, ss)
        if raw:
            extracted = try_extract_wram_from_mdfnsvst(raw)
            if extracted:
                return extracted, "savestate-by-stem"
    return None, "none"


def read_wram(z: zipfile.ZipFile, entry: dict) -> Optional[bytes]:
    ram, _ = read_wram_with_source(z, entry)
    return ram


def main() -> int:
    ap = argparse.ArgumentParser(description="Analyze WRAM dumps in a vbpack by stateName.")
    ap.add_argument("vbpack", type=Path, help="Path to .vbpack (zip)")
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Directory for memory-analysis-report.{json,md} (default: cwd)",
    )
    args = ap.parse_args()
    pack_path: Path = args.vbpack
    out_dir = args.out_dir or Path(".")
    if not pack_path.is_file():
        print(f"Not a file: {pack_path}", file=sys.stderr)
        return 1

    warnings: list[str] = []
    ingest: dict[str, Any] = {
        "analyzerVersion": ANALYZER_VERSION,
        "registryFrames": 0,
        "framesWithWram": 0,
        "fromRamdumpManifest": 0,
        "fromRamdumpByStem": 0,
        "fromSavestateManifest": 0,
        "fromSavestateByStem": 0,
        "missingWramFrames": 0,
    }

    with zipfile.ZipFile(pack_path, "r") as z:
        manifest, registry = load_registry(z)
        if not registry:
            print("No frameRegistry in manifest.json — cannot group by stateName.", file=sys.stderr)
            return 2

        ingest["registryFrames"] = len(registry)
        frames_by_state: dict[str, list[tuple[str, bytes]]] = defaultdict(list)
        for ent in registry:
            state = (ent.get("stateName") or "").strip() or "(unnamed)"
            fid = str(ent.get("frameId") or ent.get("vipStateFile") or "?")
            ram, src = read_wram_with_source(z, ent)
            if ram is None:
                ingest["missingWramFrames"] += 1
                warnings.append(
                    f"No usable WRAM for frame {fid} (no {WRAM_SIZE}-byte ramdump and savestate parse failed; need script v2+ with RASTATE unwrap)"
                )
                continue
            ingest["framesWithWram"] += 1
            if src == "ramdump-manifest":
                ingest["fromRamdumpManifest"] += 1
            elif src == "ramdump-by-stem":
                ingest["fromRamdumpByStem"] += 1
            elif src == "savestate-manifest":
                ingest["fromSavestateManifest"] += 1
            elif src == "savestate-by-stem":
                ingest["fromSavestateByStem"] += 1
            frames_by_state[state].append((fid, ram))

        if ingest["framesWithWram"] == 0 and registry:
            sample = []
            for name in z.namelist()[:30]:
                sample.append(name)
            warnings.insert(
                0,
                "No frames had usable WRAM — confirm this script is v2+ (RASTATE→MDFNSVST), "
                f"and .vbpack contains ramdumps/*.wram.bin or savestates/*.state. Sample zip paths: {sample!r}",
            )

        for state, rows in frames_by_state.items():
            if len(rows) < 2:
                warnings.append(
                    f"State {state!r} has only {len(rows)} frame(s); need >=2 for intra-state stability"
                )

        state_names = list(frames_by_state.keys())
        per_state_stable: dict[str, list[int | None]] = {}
        for s, rows in frames_by_state.items():
            if len(rows) < 2:
                per_state_stable[s] = [None] * WRAM_SIZE
                continue
            st: list[int | None] = []
            for i in range(WRAM_SIZE):
                v0 = rows[0][1][i]
                same = all(r[1][i] == v0 for r in rows[1:])
                st.append(int(v0) if same else None)
            per_state_stable[s] = st

        candidates: list[dict] = []
        for i in range(WRAM_SIZE):
            intra: dict[str, int] = {}
            for s in state_names:
                rows = frames_by_state[s]
                if len(rows) < 2:
                    continue
                val = per_state_stable[s][i]
                if val is None:
                    intra.clear()
                    break
                intra[s] = val
            if len(intra) < 2:
                continue
            if len(set(intra.values())) < 2:
                continue
            candidates.append(
                {
                    "offset": i,
                    "addressCpu": f"0x{0x05000000 + i:08X}",
                    "valuesByState": {s: intra[s] for s in sorted(intra.keys())},
                }
            )

        report = {
            "vbpack": str(pack_path.name),
            "gameId": manifest.get("gameId"),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "wramIngest": ingest,
            "warnings": warnings,
            "states": {
                s: {"frameIds": [r[0] for r in frames_by_state[s]], "frameCount": len(frames_by_state[s])}
                for s in state_names
            },
            "candidates": candidates[:5000],
            "candidatesTruncated": len(candidates) > 5000,
            "candidateTotal": len(candidates),
        }

    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "memory-analysis-report.json"
    md_path = out_dir / "memory-analysis-report.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    wi = report.get("wramIngest") or {}
    lines = [
        f"# Memory analysis: `{pack_path.name}`",
        "",
        f"**Analyzer:** v{wi.get('analyzerVersion', '?')}",
        f"**WRAM ingest:** {wi.get('framesWithWram', 0)}/{wi.get('registryFrames', 0)} frames "
        f"(ramdump manifest {wi.get('fromRamdumpManifest', 0)}, by stem {wi.get('fromRamdumpByStem', 0)}; "
        f"savestate parse {wi.get('fromSavestateManifest', 0) + wi.get('fromSavestateByStem', 0)})",
        f"**Game ID:** {report.get('gameId') or '—'}",
        f"**Candidate bytes:** {report['candidateTotal']}"
        + (" (truncated to 5000 in JSON)" if report["candidatesTruncated"] else ""),
        "",
        "## Warnings",
    ]
    lines += [f"- {w}" for w in warnings] if warnings else ["- (none)"]
    lines += ["", "## States", ""]
    for s, meta in report["states"].items():
        lines.append(f"- **{s}**: {meta['frameCount']} frame(s) — {', '.join(meta['frameIds'])}")
    lines += ["", "## Candidate offsets (sample up to 40)", ""]
    for c in candidates[:40]:
        vb = ", ".join(f"{k}=0x{v:02x}" for k, v in sorted(c["valuesByState"].items()))
        lines.append(f"- `{c['addressCpu']}` (off {c['offset']}): {vb}")
    if len(candidates) > 40:
        lines.append(f"- … and {len(candidates) - 40} more (see JSON).")
    md_path.write_text("\n".join(lines), encoding="utf-8")

    wi = report.get("wramIngest") or {}
    print(
        f"Wrote {json_path} and {md_path}\n"
        f"  WRAM: {wi.get('framesWithWram', 0)}/{wi.get('registryFrames', 0)} frames "
        f"(analyzer v{wi.get('analyzerVersion', '?')}). "
        f"See JSON key \"wramIngest\" and \"candidateTotal\"."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
