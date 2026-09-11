# iphone-screen-compositor: improvement proposal (6 September 2026)

**Implementation update — v1.2.0:** The hardware-consistency and UI-containment upgrade is implemented in the repository and installed skill. It adds a calibration hash lock, screen/silhouette containment checks, decoded-PNG hardware and alpha validation, shared geometry, mask-aware framing sidecars, slide placement checks, a local review page, output/staleness checks, exclusive output writes and an incomplete-run journal. Geometry, chrome, deliberate corruption, framing, stale-sidecar, locking and overwrite tests passed; synthetic light, dark and Arabic UI samples were visually reviewed. See [CHANGELOG.md](CHANGELOG.md) and [references/framing.md](references/framing.md). The remainder below is a proposal backlog: capture/de-identification automation, RTL chrome changes, resized exports, automatic resume, video and general artwork trimming are not part of v1.2.0.

Written after the Odontyn October build, where the skill produced 56 phone cutouts across ten carousels, every one with zero protected-pixel changes. The hardware lock works and should stay exactly as it is. Everything below is about the work around it: what the agents had to rediscover, measure by hand, or script themselves on top of the compositor, and what would have made review faster. Ordered by how much time each would have saved.

## 1. Publish the screen geometry the compositor actually produces

**Problem.** The preset `below-ios-chrome` paints the compositor's own status bar (249 px of the 4146 px display) and pushes the screenshot down under it. Nobody reading SKILL.md knows this. On a 440 x 956 CSS capture that is a 56 CSS px shift, and the same 56 px falls off the bottom. Two October slides were sized off the naive aperture and lost the "Appointment 2026-06-03" chip they existed to show; a builder had to measure the offset and re-tune. A separate agent worked out by trial that "a 480 px device at top 520 shows about 809 CSS px", a number that lives in a chat transcript and a chassis comment.

**Fix.** Make the manifest and a new `--geometry` command print, per output, the mapping from source pixels to cutout pixels: `sourceRow0AtCutoutY`, `visibleSourceRows [from, to]`, `sourceScale`, and, given an optional `--slide-device-width` and `--slide-device-top`, the CSS rows of the source that will be inside a 1080 x 1350 slide. The chassis then reads geometry instead of guessing. Ship the same numbers in `calibration.json` under `display` so scripts can compute without running a render.

## 2. A framing contract: say what must be visible, fail if it is not

**Problem.** Every slide has a feature the headline promises ("upcoming above past", "the x-ray with its chip"). Today that is verified by a human zooming a crop after the fact. The review caught four slides where the promised feature was outside the aperture or cut.

**Fix.** Accept a sidecar `<screenshot>.framing.json` with named anchors in source CSS px (`{"chip": [0, 620, 440, 634]}`) and an optional `mustBeVisible: ["chip"]`. With `--slide-device-width/--slide-device-top`, the compositor checks the anchors land inside the visible band and writes pass/fail per anchor into the manifest, exit code 2 on failure. The capture script already knows these rows (it scrolls to them), so writing the sidecar costs one line.

## 3. Capture-side helper, so the compositor gets what it wants

**Problem.** Four separate capture scripts were written this month (Post 2, Post 13 r5, r8, October) and they all re-derive the same things: viewport 440 x 956 at device scale 3 (or 417 x 858 for the older aperture), iPhone user agent, `locator("visible=true")`, the i18next language seed, `document.documentElement.dir` assertion for Arabic, the de-identification walker, "park this element at viewport y 105", and "how far can this page scroll at all". Each one has found a new trap (the Transfers page cannot scroll; the Family drawer mounts off-screen; the Images X-Rays filter returns empty).

**Fix.** Add `scripts/capture.py` (Playwright, Python, since that is what every Odontyn script uses) with: `new_ctx(lang)`, `park(page, selector, top_css)`, `max_scroll(page)`, `assert_rtl(page)`, `deid(page, map, regexes)`, `shoot(page, name, framing_anchors)`. It writes the PNG plus the framing sidecar from item 2. Keep it app-agnostic (selectors and the de-identification map come from a per-project JSON), and document the viewport that matches the display aspect so `cover` never crops sideways.

## 4. De-identification as a first-class, regex-capable step

**Problem.** The Post 13 map is a dict of literal strings. It missed third-party dentists and clinics on the Transfers and Find Dentist screens, `child.<uuid>@noemail.odontyn.internal` addresses, and avatar initials (a name was rewritten to "Hessa Al-Mutairi" while the bubble still printed "NA"). The reviewer flagged all of these; two needed re-shoots.

**Fix.** In the capture helper: a map file with literal pairs, regex pairs (email domains, MRNs, phone numbers), and an initials rule that recomputes avatar text from the replaced name. After the walk, run a leak scan over the final DOM text for anything matching the regexes or the original names and refuse to shoot if it finds one. Print the leak list. This turns privacy from a review finding into a capture-time gate.

## 5. Staleness and provenance

**Problem.** Captures were re-shot mid-build by another agent; two posts were built on stale cutouts and only a hand-written mtime check caught it. Nobody can tell from a cutout which screenshot, scroll position, language or map produced it.

**Fix.** Embed provenance in the PNG `tEXt` chunks and in the manifest: source file SHA-256, source mtime, preset, fit, chrome decision, framing sidecar SHA. Add `--check <output-dir>` that re-hashes the sources and reports which cutouts are stale. The slide chassis can then call the check before every build.

## 6. Output size and format for the slide pipeline

**Problem.** The 2062 x 4446 cutout is right as a master but every consumer immediately resizes it to 1200 wide and fights the 2 MiB base64 cap in the design canvases (quantize to 255 colours when over). That code is copied into four builders.

**Fix.** `--also-width 1200` writes a second, resized PNG next to the master with `optimize` and an optional `--max-bytes 2097152` that quantizes only when needed and reports what it did. One flag, no per-builder copies.

## 7. Video: the same lock for mp4 frames

**Problem.** Post 2 and the Home Screen slide needed per-step clips. They were built with a hand-measured native frame in a separate pipeline (`04 - Home Screen slide\build\v2\geom_v3.py`) because the compositor only takes stills, so the two phones on the same carousel come from two different methods and do not match exactly.

**Fix.** `--frames <dir>` mode: composite every frame with the identical geometry and chrome decision (sampled once from frame 1 so the bar does not flicker), write frames out, and print the ffmpeg line (or run it with `--mp4 out.mp4 --fps 30`). Same masks, same manifest, one visual language for stills and clips.

## 8. Arabic-aware status chrome

**Problem.** The status bar is always the English layout (clock left, indicators right). Arabic app captures are RTL, and the clock sits under an RTL app bar; nobody has complained, but iOS in Arabic mirrors the bar. Also the glyph colour is sampled from the top rows of the screenshot; on RTL screens with a coloured avatar on the left, the sample is occasionally biased.

**Fix.** A mirrored light and dark chrome patch (`iphone-status-chrome-*-rtl.png`) chosen by `--rtl` or by reading `dir=rtl` from the framing sidecar, plus sampling the bar colour from a centre strip rather than the full top rows.

## 9. Alpha-aware trimming and placement report for downstream art

Not strictly the compositor's job, but the same problem cost a full rebuild this week: the 3D renders carry an alpha fringe of 1 to 8 out to the canvas edge, so a raw bounding box is useless and the artwork inside the same 1254 px canvas ranged from 339 to 1101 px tall. A tiny `trim-alpha` script in this skill folder (threshold, pad, report) would let every consumer size art to one house height. The chassis now has it; it belongs here with the other image tools.

## 10. Smaller things

- `--self-test` should include one Arabic screenshot and one 440 x 956 capture, and assert the item 1 geometry numbers.
- SKILL.md: state the source aspect that maps to the display without cropping (1904 : 4146 = 0.4592; 440 x 956 = 0.4603, fine; 390 x 640 is not, and the library captures at that size crop 25 per cent), and say plainly that the display is not the aperture a slide shows.
- Windows: quote the example paths (spaces in every AAW path) and mention `PYTHONIOENCODING=utf-8` for the Python helper.
- `--input` accepts a folder but skips folders that "look like" renders by name; print the rule, because `rphone-*` and `cutouts-*` were skipped silently once.
- Manifest: add a one-line human summary per entry (`OK  p07b en  chrome light  bar #ffffff  letterbox 0  anchors 3/3`), so a reviewer can read it without jq.
- Version the SKILL.md contract line by line in the changelog; three agents this week quoted rules from memory that had changed in 1.1.2 and 1.1.3.

## What not to change

The immutable reference, the two masks, the SHA locks, the protected-pixel assertion, and the refusal to overwrite outputs. Those are why 56 cutouts passed review with no hardware defects. Everything above sits around that core.

## Review and additional recommendations (6 September 2026)

Reviewed against the repository's v1.1.3 `SKILL.md`, `assets/calibration.json`, and `scripts/composite-iphone.mjs`. The production incidents above are retained as reported; this review checks the implementation and proposal, without independently reproducing those builds. All commands and fields suggested below are proposals, not available features.

### A. Correct a few assumptions before implementation

- **Use the fitting area's aspect ratio.** `below-ios-chrome` fits into `1904 x 3897`, not `1904 x 4146`. At width 440, a capture about 901 CSS px high matches that area; `440 x 956` under top-aligned `cover` shows about 900.57 source CSS rows before mask occlusion, losing about 55.43 rows at the bottom. Its near-match to the full display does not mean it avoids cropping with the default preset. The 249 px inset corresponds to about 57.54 source CSS px at this scale; the inset and lost rows are different quantities. Revise items 1, 3 and 10 accordingly, and compute other crop percentages per preset rather than documenting one universal percentage.
- **Extend existing provenance.** The manifest already includes source SHA-256, compositor version, reference hash, preset, fit, position and crop percentages. Item 5 should add missing dependencies and verification instead of duplicating those fields. The current settings omit the letterbox background; include it in a complete resolved recipe.
- **Confirm the skip incident separately.** The current directory predicate does not match `rphone-*` or `cutouts-*` merely by those prefixes. It does skip the selected output directory and several descriptive render-folder names. Explicitly supplied render-named roots produce a warning and are processed. Record the actual skipped path and reason before expanding the rule.
- **Treat RTL chrome as a reference-validation task.** App `dir=rtl` is not proof of the operating system's language or status layout. Verify the intended layout against an actual target-device reference before adding patches; record app direction and system locale separately. A new patch needs its own locked hash and explicit permitted-pixel baseline. Centre-only colour sampling also needs examples: a centred logo can bias it just as an avatar can bias another region.

### B. Make geometry one shared calculation

Have rendering, `--geometry`, framing checks and previews consume the same resolved geometry function. Store fixed calibration facts once; derive input-dependent values instead of copying them into `calibration.json` where they can drift.

Define the coordinate contract explicitly: orientation-normalized source pixels, viewport CSS pixels, full-canvas pixels, cutout pixels and slide pixels. Sidecars need a schema version, screenshot hash, viewport dimensions, screenshot pixel dimensions, capture region and coordinate space. Device scale alone is insufficient for element or full-page captures. Specify whether anchor arrays mean `[x, y, width, height]` or `[left, top, right, bottom]`, and use one documented convention.

Return the actual crop rectangle, resized dimensions and X/Y offsets, including rounding. At default top alignment, without source cropping, the screenshot starts at cutout `(79, 314)`; this is different from full-canvas `(1548, 668)`. Add configurable slide width, height and device X position so checks work beyond one 1080 x 1350 layout.

**Acceptance:** a synthetic screenshot with numbered rows and edge markers lands at the reported coordinates under both presets, both fits, every position and nonzero source cropping. Include a device-scale-3 capture and a horizontally cropped source.

### C. Check visibility, occlusion and readability separately

A vertical band alone can pass an anchor that is clipped sideways or covered by a protected shape. Intersect each transformed anchor with the actual replaceable mask and slide bounds. Let the slide builder supply any foreground occlusion regions, such as a caption card overlapping the phone. Report distinct failure reasons: source crop, screen mask, slide clipping and foreground overlap.

Use `minVisibleFraction` with a default of 1 for required anchors, plus an optional inset margin. Add `minRenderedHeightPx` for text chips: an anchor can be completely visible but too small to read after placement. This is a measurable warning, not a substitute for visual review. Reject a sidecar whose screenshot hash no longer matches, and reject unknown required anchor names.

**Acceptance:** a chip below the slide, one crossing a rounded corner and a fully visible but undersized chip produce distinct results. Framing failures still write a diagnostic report before returning the proposed exit code 2.

### D. Make capture repeatable and keep privacy evidence limited

Keep the Python capture helper optional so still-image users retain the current Node-only installation. Put app-specific selectors, language seeding and anonymization rules in project adapters. Before capture, wait for explicit page-ready conditions, fonts and relevant images; disable animations, hide the caret and assert the intended route, language, drawer state and target visibility. Record the achieved scroll/anchor positions after layout settles, rather than the requested positions. Check again after any anonymization that changes text wrapping.

Prefer synthetic fixture data where the app supports it. A DOM text scan cannot establish that an image, canvas, input value, CSS-generated label or embedded frame contains no identifying information. Give each supported surface an explicit check and flag uninspected surfaces for review. Do not advertise a general privacy guarantee from regex matching.

Replace item 4's raw leak list with rule IDs, counts and safe element locations; printing matched names or emails would copy them into logs. Avoid embedding original names, replacement maps, credentials, query strings or absolute personal paths in PNG metadata. Resolve initials through an explicit avatar-to-person association, rather than guessing from neighbouring text.

### E. Add preflight, safe publication and resumable batches

The current script checks output collisions before rendering, but writes each PNG immediately and writes the manifest only after the whole batch succeeds. A late failure can therefore leave valid-looking outputs with no batch manifest.

Add a preflight that resolves all inputs, settings, sidecars, output names and skip reasons before rendering. Publish each validated file through a temporary sibling and an exclusive final-file operation; persist a run journal with `pending`, `passed` and `failed` entries. A completed manifest should be an explicit completion marker. Prevent concurrent runs from publishing into the same output directory without relying only on an early existence check.

An optional `--resume` should reuse an entry only when its recipe, dependencies and output checksum match. Its recipe fingerprint should include source and sidecar hashes, calibration and asset hashes, compositor version, resolved options and relevant renderer versions. Missing sources should report `unverifiable`; changed inputs should report `stale`. Modification time can help diagnostics but must not determine validity.

**Acceptance:** interrupt a batch after two outputs, resume it without replacing those verified outputs, and rebuild only entries whose dependencies changed. A second writer must fail clearly before it can replace the first writer's files.

### F. Distinguish locked outputs from delivery derivatives

Keep the canonical `2062 x 4446` cutout lossless and unquantized. Resized or quantized exports necessarily change hardware pixels; link them to the verified canonical file and describe them as derivatives rather than claiming the original zero-pixel-change guarantee. Record output dimensions, checksum, byte count and all export settings. Reserve “fixed-canvas master” for the existing optional `5000 x 5000` output to avoid ambiguity.

Clarify whether a delivery cap applies to raw file bytes or encoded payload bytes. Base64 alone takes `4 * ceil(fileBytes / 3)` bytes; a 2 MiB encoded cap allows at most 1,572,864 raw bytes before a data-URL prefix or wrapper. Try lossless optimization first, then only explicitly enabled quantization or resizing. If the requested budget cannot be met within those settings, report failure rather than silently degrading further. Inspect fine UI text and transparent edges against both light and dark backgrounds.

### G. Generate a review sheet at final placement size

Add an optional static contact sheet or HTML report with source thumbnail, cutout, slide-placement preview and enlarged required anchors. Overlay visible bounds and anchor pass/fail states in the report, keeping exported phone PNGs clean. Sort failures first and identify entries by stable source ID, language and recipe fingerprint.

This should shorten the review loop more directly than another manifest field: reviewers need to see whether the headline's promised feature is legible at the actual slide size. Allow a slide image or a supplied headline for context; the compositor should not attempt to infer the marketing promise from UI pixels.

### H. Keep video and general artwork utilities as later extensions

For frame batches, require numeric frame ordering, consistent dimensions, a declared frame rate and explicit handling of gaps. Pin chrome through a chosen representative frame or explicit override; frame 1 may be a splash screen. Define whether theme changes require separate segments. Verify protected pixels on every lossless composited frame.

An MP4 delivery needs a specified background because the normal slide-video delivery path does not preserve the transparent cutout. Lossy encoded video also cannot inherit a byte-for-byte protected-pixel guarantee. If audio is in scope, define source audio, duration and synchronization rather than implying a directory of frames preserves them.

Place `trim-alpha` in a sibling general-image utility, with threshold, padding and original-to-trimmed offset reporting. Never apply it to the calibrated phone cutout: content-dependent trimming would break the fixed dimensions and geometry contract.

### Suggested delivery order

| Stage | Scope | Completion evidence |
| --- | --- | --- |
| 1 | Correct docs; shared geometry; versioned sidecars; framing checks | Synthetic coordinate cases and actionable anchor failures |
| 2 | Complete recipe fingerprints; preflight; recoverable publication; staleness check | Interrupted-batch recovery and dependency-change cases |
| 3 | Placement review sheet; bounded derivative exports | Review at slide size and verified delivery-byte budgets |
| 4 | Optional capture helper and project adapters | Repeatable captures with explicit privacy-check coverage |
| 5 | Reference-validated RTL patches; video adapter; sibling artwork utilities | New patch baselines and separate frame/export validation |

For each release, document changed defaults, sidecar/manifest schema compatibility and migration examples. Add a lightweight version command that reports the invoked skill path and runtime version: the repository, installed skill and portable archive can otherwise diverge even when each is individually valid. Keep existing invocations compatible, and label new commands as planned until implementation and validation are complete.
