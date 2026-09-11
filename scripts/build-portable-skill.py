"""Package codex-skills/iphone-screen-compositor into a portable ZIP under image-tools/dist.

Excludes node_modules and local junk, reads the version from package.json, and refuses to
build if the compositor self-test fails. Run from image-tools/:

    python scripts/build-portable-skill.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL_NAME = "iphone-screen-compositor"
SKILL = ROOT / "codex-skills" / SKILL_NAME
DIST = ROOT / "dist"
EXCLUDED_DIRS = {"node_modules", ".git", "__pycache__"}
EXCLUDED_FILES = {".DS_Store", "Thumbs.db"}


def main() -> int:
    version = json.loads((SKILL / "package.json").read_text())["version"]
    print(f"self-test {SKILL_NAME} {version} ...")
    check = subprocess.run(["npm", "run", "check", "--silent"], cwd=SKILL, shell=sys.platform == "win32")
    if check.returncode != 0:
        print("self-test failed; not packaging", file=sys.stderr)
        return check.returncode

    DIST.mkdir(exist_ok=True)
    target = DIST / f"{SKILL_NAME}-portable-v{version}.zip"
    files = sorted(
        p for p in SKILL.rglob("*")
        if p.is_file()
        and not (set(p.relative_to(SKILL).parts) & EXCLUDED_DIRS)
        and p.name not in EXCLUDED_FILES
    )
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in files:
            zf.write(p, f"{SKILL_NAME}/{p.relative_to(SKILL).as_posix()}")
    print(f"wrote {target} ({target.stat().st_size / 1024:.1f} KB, {len(files)} files)")
    for p in files:
        print(f"  {p.relative_to(SKILL).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
