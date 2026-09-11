"""Docs half of the 1.1.3 change: SKILL.md guidance, CHANGELOG, image-tools README, web UI default."""
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "codex-skills" / "iphone-screen-compositor"


def patch(path: Path, pairs: list[tuple[str, str]]) -> None:
    t = path.read_text(encoding="utf-8")
    for old, new in pairs:
        assert t.count(old) == 1, (path.name, old[:60], t.count(old))
        t = t.replace(old, new)
    path.write_text(t, encoding="utf-8", newline="\n")
    print("patched", path.relative_to(ROOT))


patch(SKILL / "SKILL.md", [
    ("Version 1.1.2. Run `npm run check`", "Version 1.1.3. Run `npm run check`"),
    ("5. Add `--fit contain` when the entire UI must remain visible. The default `cover` fills the display and anchors at the top.\n",
     "5. Keep the default `cover` for app screenshots: it fills the display edge to edge and anchors at the top; a bottom overflow is harmless on carousels because the phone bleeds off the slide. "
     "`--fit contain` letterboxes phone-ratio screenshots (1170x2532 is narrower than the 1904x3897 fitting area, about 52 px each side). "
     "Since 1.1.3 that letterbox replicates the screenshot's own edge pixels (`--background edge`, the default), so it stays invisible. "
     "Never pass a flat `--background` colour unless the UI edge really is that colour: on 2026-08-27 every Odontyn render made with `--background #ffffff` shipped with a white band inside the display beside dark headers and maps.\n"),
    ("8. Review `manifest.json`, confirm the input/output counts, check that every output is `2062x4446` with alpha, and review each entry's `statusGlyphColor`, `statusBarColor`, `statusChromePatchApplied`, and protected-pixel counts.",
     "8. Review `manifest.json`, confirm the input/output counts, check that every output is `2062x4446` with alpha, and review each entry's `statusGlyphColor`, `statusBarColor`, `statusChromePatchApplied`, `letterbox` (all zero under `cover`; under `contain` the side values must be filled with `edge`, and any `letterboxFill` hex is a warning to act on) and protected-pixel counts."),
    ("--background <hex>         Letterbox colour for --fit contain (default #181619)",
     "--background <value>       Letterbox for --fit contain: edge (default, replicates the\n                           screenshot's edge pixels) or a six-digit hex colour"),
])

changelog = SKILL / "CHANGELOG.md"
changelog.write_text(changelog.read_text(encoding="utf-8").replace("# Changelog\n", """# Changelog

## 1.1.3 (2026-08-27)

- `--fit contain` no longer paints a flat letterbox. The default `--background edge` replicates the screenshot's own edge pixels into the spare display area, so phone-ratio screenshots (narrower than the fitting area) show no band beside dark headers or full-bleed maps. A hex `--background` is still accepted and now prints a warning whenever it actually fills a letterbox.
- Manifest entries record `letterbox` (left/right/top/bottom px) and `letterboxFill`.
- Self-test adds a contain regression: a narrow screenshot with a dark header must render with no light pixels inside the display beside it.
- Why: all 30 Odontyn carousel renders (2026-08-26) were made with `--fit contain --background #ffffff` and carried a ~35 px white band on both sides; it only showed where the UI edge was dark, so it slipped through review.
""", 1), encoding="utf-8", newline="\n")
print("patched codex-skills/iphone-screen-compositor/CHANGELOG.md")

patch(ROOT / "README.md", [
    ("- `Fit entire UI` preserves the complete screenshot without distortion; `Fill & crop` fills the screen and crops overflow.\n",
     "- `Fill & crop` (default) fills the screen edge to edge and crops overflow; `Fit entire UI` preserves the complete screenshot and letterboxes it. "
     "Phone-ratio screenshots are narrower than the display's fitting area, so `Fit` leaves a strip each side in the screen fill colour; keep that colour matched to the UI edge or use `Fill`. "
     "The portable skill (1.1.3+) replicates the screenshot edge into that strip automatically.\n"),
])

patch(ROOT / "lib" / "iphone-compositor.ts", [
    ("export const DEFAULT_COMPOSITE_SETTINGS: CompositeSettings = {\n  fitMode: 'contain',",
     "export const DEFAULT_COMPOSITE_SETTINGS: CompositeSettings = {\n  // cover: phone-ratio screenshots are narrower than the display, contain would letterbox them.\n  fitMode: 'cover',"),
])
