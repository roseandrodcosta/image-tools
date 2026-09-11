# Changelog

## 1.2.0 (2026-09-06)

- Lock calibration itself; verify the screen mask is contained by the display and silhouette, each UI layer has zero alpha outside the screen mask, and each decoded output PNG preserves the exact silhouette and protected hardware pixels.
- Shared explicit geometry drives resizing and reports source crop, rounded resize dimensions, offsets, visible source ranges and slide placement. Cover rounding may move UI sampling by a pixel relative to 1.1.3; hardware assets and geometry are unchanged.
- Add `--geometry`, framing sidecars and `--require-framing`, including source-hash validation, actual mask coverage, slide clipping and optional minimum rendered height. Required visibility failures exit 2 before publication.
- Add `--review`, `--check`, `--version`, manifest schema 2, source/output/sidecar recipe fingerprints, a directory writer lock, exclusive default output writes and an incomplete-run journal.
- Reject transparent and animated UI inputs instead of silently flattening or selecting a frame. Normalize source colour to sRGB.
- Correct the default fitting-area guidance; warn about cropping instead of assuming bottom overflow is harmless. Keep adaptive chrome, top cover, edge-filled contain and canonical dimensions as defaults.
- Add `npm test` for geometry, actual pixel placement, intentional hardware/alpha corruption, framing failures, staleness and overwrite refusal. Existing `npm run check` remains the installation self-test.
- Capture automation, RTL chrome patches, derivative exports, automatic resume and video remain later proposals; this release focuses on consistent hardware, UI containment and framing.

## 1.1.3 (2026-08-27)

- `--fit contain` no longer paints a flat letterbox. The default `--background edge` replicates the screenshot's own edge pixels into the spare display area, so phone-ratio screenshots (narrower than the fitting area) show no band beside dark headers or full-bleed maps. A hex `--background` is still accepted and now prints a warning whenever it actually fills a letterbox.
- Manifest entries record `letterbox` (left/right/top/bottom px) and `letterboxFill`.
- Self-test adds a contain regression: a narrow screenshot with a dark header must render with no light pixels inside the display beside it.
- Why: all 30 Odontyn carousel renders (2026-08-26) were made with `--fit contain --background #ffffff` and carried a ~35 px white band on both sides; it only showed where the UI edge was dark, so it slipped through review.

## 1.1.2 (2026-08-26)

- Adaptive status chrome is the default again (`--bar auto --chrome auto`); `--bar reference --chrome reference` remains available for the untouched photographed phone. SKILL.md now tells the agent when to use each.
- Glyph colour switches at relative luminance 0.35 instead of the WCAG contrast crossover (0.179), which put black glyphs on teal, orange, and mid-grey headers where iOS shows white. Self-test covers teal and orange headers.
- Changelog for 1.1.1 corrected: the colour sampler was reimplemented, not fixed; 1.1.0 already sampled the top rows.

## 1.1.1 (2026-08-26)

- Made the photographed status bar and white glyphs the default; adaptive chrome required `--bar auto --chrome auto`. (Reverted in 1.1.2.)
- Reimplemented top-row colour sampling as an in-process histogram with per-bucket averaging, giving exact bar colours (`#fafafa` instead of `#f8f8f8`).
- Replaced the luminance-186 cutoff with the WCAG black-versus-white contrast comparison. (Replaced again in 1.1.2.)
- Added regression self-tests where header and body colours deliberately disagree.
- Manifest reporting now distinguishes permitted status-patch changes from unexpected protected-pixel changes.
- Reduced retained memory by dropping unused decoded masks and creating the light-chrome baseline lazily.

## 1.1.0 (2026-08-26)

- Adaptive status chrome: the status bar takes the screenshot's top colour and the glyphs switch to black on light bars (perceived luminance above 186). New `--chrome auto|light|dark` and `--bar auto|reference|#hex` options.
- New locked asset `iphone-status-chrome-light.png` (black-glyph patch over protected pixels only), built by `image-tools/scripts/build-light-chrome-patch.py`.
- `calibration.json` now locks SHA-256 hashes for all assets, mask pixel counts, status-bar height, cutout box, and expected cutout dimensions; the compositor verifies all of them before work.
- `--self-test` (`npm run check`) proves sharp loads and renders end to end instead of only printing help.
- About 2x faster: assets decode once, intermediates stay raw, PNG compression level 6.
- Manifest lists `skippedFiles` (non-image files) and per-entry `statusChrome` / `statusBarColor`.
- Explicit inputs named like phone-render folders are processed with a warning instead of silently.
- Node floor corrected to 20.11 (`import.meta.dirname` replaced with `fileURLToPath`).
- Docs: `--background` documented, bash command example, Claude Code install path.

## 1.0.0 (2026-08-26)

- First portable package: locked reference, masks, calibration, compositor, cross-platform sharp lock.
