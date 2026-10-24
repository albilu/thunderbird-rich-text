#!/usr/bin/env python3
"""Build a reproducible, dependency-free Thunderbird XPI from extension/ only."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(output=None):
    source = ROOT / "extension"
    manifest = json.loads((source / "manifest.json").read_text())
    output = Path(output) if output else ROOT / "dist" / f"thunderbird-rich-text-{manifest['version']}.xpi"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Symlinks are not allowed in the package: {path}")
            if not path.is_file():
                continue
            if path.suffix not in {".json", ".js", ".html", ".css", ".svg"}:
                raise ValueError(f"Unexpected extension file: {path}")
            info = zipfile.ZipInfo(path.relative_to(source).as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compresslevel=9)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".xpi.sha256").write_text(f"{digest}  {output.name}\n")
    print(f"Built {output} ({output.stat().st_size:,} bytes)")
    print(f"SHA-256: {digest}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Override the output XPI path")
    package(parser.parse_args().output)
