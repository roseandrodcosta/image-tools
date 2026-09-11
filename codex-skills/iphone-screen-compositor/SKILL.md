---
name: iphone-screen-compositor
description: Place supplied UI screenshots into the locked iPhone 16 Pro Max desert-titanium reference and return carousel-ready transparent PNG phone cutouts. Use when the user asks to put UI/screenshots into an iPhone, make phone mockups or composites, replace old phone renders, or dumps a folder of screens for batch processing. Do not use for phones photographed in hands or perspective scene mockups.
---

# iPhone Screen Compositor

Use the bundled calibrated reference and masks. The phone hardware, size, corners, Dynamic Island, and home indicator must never be regenerated, resized, or altered. The status bar is the one piece of chrome that adapts: by default it takes the screenshot's own top colour with black or white glyphs chosen to match, so the phone looks like it is really running the app.

Version 1.2.0. Run `npm run check` in the skill folder once after install; it verifies sharp, locked calibration and assets, reference/adaptive chrome, and decoded PNG hardware and silhouette. `npm test` runs the expanded geometry, framing, corruption and batch regression suite. Use `--version` to confirm which installed copy is running.

## Default contract

- Return tightly trimmed transparent PNG cutouts for carousel placement.
- Keep every cutout at the locked `2062x4446` dimensions (asserted from `calibration.json`).
- Adaptive status chrome is the default (`--bar auto --chrome auto`): the bar takes the dominant colour of the screenshot's top rows and the glyphs turn black only on genuinely light bars (relative luminance >= 0.35; saturated brand colours such as teal, orange, or Intersport blue keep white glyphs). Use `--bar reference --chrome reference` only when the brief explicitly asks for the untouched photographed phone. `--chrome dark|light` forces white or black glyphs; `--bar #hex` sets a specific bar colour.
- Treat the `5000x5000` fixed canvas as an optional master for QA or an explicit user request.
- Use only clean UI screenshots as inputs. Ignore existing phone renders, composites, mockups, and phone-in-hand images.
- Preserve source filenames and folder structure where practical; append `-iphone.png`.
- Never overwrite the supplied screenshots.

## Process a drop folder

1. Inventory the user-named file or folder with a targeted file listing. Do not broadly scan unrelated directories.
2. Visually inspect at least one screenshot from each distinct UI layout or capture style. Decide whether it already includes an iOS status bar and whether `cover` would crop important content.
3. Decide the chrome per drop: app and web UI screenshots take the adaptive default; add `--bar reference --chrome reference` only when the brief asks for the untouched photographed phone. Use `below-ios-chrome` for ordinary app/web screenshots. If a screenshot already includes iOS status chrome, crop that source chrome first, or use `full-display` only when it will not create doubled status elements.
4. Run the bundled script. It loads `sharp` from the skill's own package, so it does not depend on the original `image-tools` project:

```powershell
# Windows
node "<skill-dir>\scripts\composite-iphone.mjs" --input "<screens-or-folder>" --output "<output-dir>"
```

```bash
# macOS / Linux
node "<skill-dir>/scripts/composite-iphone.mjs" --input "<screens-or-folder>" --output "<output-dir>"
```

5. Keep the default top-aligned `cover` when filling the display is appropriate, but check the reported crop: bottom overflow can remove important UI even when the phone bleeds off a slide. The default fitting area is `1904x3897`, starting at `(79,314)` in the cutout. A `440x956` screenshot loses about 55 CSS rows at the bottom; `440x901` approximately matches this fitting area. `full-display` instead fits into `1904x4146`. Use `--geometry` to inspect the actual transform before rendering. `--fit contain` preserves the source rectangle and fills spare space with copied edge pixels (`--background edge`); inspect whether extended edges look natural. Avoid a flat `--background` colour unless the entire UI edge actually matches it.
6. Add `--crop-top 6.2` or `--crop-bottom 3` only after inspecting the source and measuring the unwanted source chrome as a percentage.
7. Add `--keep-master` only for fixed-canvas masters. Add `--recursive` only when nested clean-screen folders are intentionally in scope.
8. Add `--review` for a local review page. When particular content must be visible, supply framing sidecars and use `--require-framing`; see [references/framing.md](references/framing.md). Supply the actual slide placement when the phone will extend beyond a slide. Required anchors fail before PNG publication if clipped by fitting, the screen mask or the slide. Inspect the preview for natural chrome, legibility and any doubled native status elements; geometry alone cannot establish those qualities.
9. Review the completed `manifest.json`, confirm counts and `2062x4446` outputs, and check the per-entry `validation`, `geometry`, `framing`, `letterbox`, `statusGlyphColor` and `statusBarColor`. `run-status.json` without a completed manifest means an incomplete batch. Run `--check "<output-dir>"` before using existing cutouts to verify source/sidecar freshness and decoded hardware/alpha integrity. Visually inspect representative English, Arabic, light, dark, short and tall screens when present.
10. Hand off the transparent-cutout directory, not the masters directory. Report `skippedDirectories` and `skippedFiles` from the manifest and any unavailable underlying UI screens.

## Install or transfer

For another computer, read [INSTALL.md](INSTALL.md). The portable archive includes the calibrated visual assets and runtime manifest; it does not require the original carousel folders or `image-tools` project.

## Safe reruns

The script skips folders that look like existing phone renders, composites, mockups, or previous cutout outputs. It refuses to replace output files unless `--force` is explicitly supplied. Prefer a new output directory over `--force` when earlier results may be needed.

A directory lock prevents two compositor runs from publishing together. An interrupted process may leave `.compositor.lock`; use a new output directory. Completed entries in `run-status.json` are diagnostic only; automatic resume is not implemented. Inputs with actual transparency or multiple animation frames are rejected; supply an opaque still UI screenshot.

## Assets and invariants

- `assets/iphone-16-pro-max-desert-titanium.jpg` is the immutable `5000x5000` hardware source.
- `assets/iphone-screen-mask.png` is the only area where UI pixels may replace the reference.
- `assets/iphone-cutout-mask.png` creates the transparent phone silhouette.
- `assets/iphone-status-chrome-light.png` is the optional light-mode status glyph patch (black glyphs); it covers only calibrated protected status pixels and is applied only when the chosen chrome is light.
- `assets/calibration.json` locks SHA-256 hashes for all four assets, mask pixel counts, the status-bar height, the cutout box, and the expected cutout dimensions.

Before any work the compositor verifies every asset hash, that the masks are hard-edged with the calibrated pixel counts, and that the light patch never touches a replaceable pixel. Every result is compared byte-for-byte against its permitted baseline over all protected pixels. The manifest separately reports permitted status-patch changes from the original reference and asserts zero protected changes outside permitted regions. Any unexpected protected pixel, dimension mismatch, or missing alpha channel fails the run.

The calibration file itself is hash-locked in the runtime. The screen mask must stay inside both the calibrated display and the phone silhouette. Every UI layer is checked for alpha outside the screen mask; every final PNG is decoded and checked against the exact cutout alpha and opaque protected hardware pixels. Do not edit the reference, masks or calibration to make a test pass. These guarantees apply to the canonical lossless PNG; later resizing or lossy encoding changes pixels and needs separate review.

## Command options

```text
--input <path>             Required file or folder; may be repeated
--output <directory>       Optional for one input; defaults to iphone-cutouts
--engine-root <directory>  Optional legacy fallback that provides sharp
--preset <name>            below-ios-chrome (default) or full-display
--fit <mode>               cover (default) or contain
--position <value>         top (default), center, or bottom
--chrome <mode>            auto (default), reference, light (black), or dark (white)
--bar <value>              auto (default), reference, or #hex status-bar colour
--background <value>       Letterbox for --fit contain: edge (default, replicates the
                           screenshot's edge pixels) or a six-digit hex colour
--crop-top <percent>       Remove a percentage from the source top
--crop-bottom <percent>    Remove a percentage from the source bottom
--recursive                Include nested clean-screen folders
--keep-master              Also write 5000x5000 fixed-canvas masters
--force                    Replace files in the selected output directory
--self-test                Verify sharp, assets, and an in-memory render, then exit
--geometry                 Print JSON geometry/framing without writing images
--review                   Write local review.html beside the PNGs
--require-framing          Require <screenshot>.framing.json for every input
--slide-device-width <px>   Device width on slide; enables slide checks/preview
--slide-device-top <px>     Device top on slide (default 0)
--slide-device-left <px>    Device left on slide (default centred)
--slide-width <px>          Slide width (default 1080)
--slide-height <px>         Slide height (default 1350)
--check <directory>        Check a completed v1.2 batch for stale/altered files
--version                 Show runtime version and invoked skill path
```
