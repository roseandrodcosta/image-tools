# Geometry and framing (v1.2)

Use a sidecar when a particular UI element must remain visible. For `screen.png`, name it `screen.png.framing.json`. The hash is SHA-256 of the exact screenshot bytes; obtain it with `Get-FileHash "screen.png" -Algorithm SHA256` or the capture script. Use lowercase hex in the sidecar.

```json
{
  "schemaVersion": 1,
  "sourceSha256": "replace-with-the-screenshot-sha256",
  "coordinateSpace": "viewport-css",
  "viewport": { "width": 440, "height": 956 },
  "anchors": {
    "appointmentChip": {
      "rect": [20, 620, 380, 28],
      "minVisibleFraction": 1,
      "minRenderedHeightPx": 12
    }
  },
  "mustBeVisible": ["appointmentChip"]
}
```

Rectangles are `[x, y, width, height]`, with exclusive right/bottom edges. Coordinates refer to the orientation-normalized source before `--crop-top` or `--crop-bottom`. `viewport-css` requires a screenshot of the entire declared viewport at uniform device scale; for element or full-page captures, use `source-pixels` and omit `viewport`. A short anchor value such as `[20,620,380,28]` means full visibility with no minimum rendered height. Unknown required names, stale screenshot hashes and invalid/out-of-source rectangles fail validation.

`minRenderedHeightPx` requires slide placement. It is a size threshold, not a guarantee of readable typography. Anchors outside `mustBeVisible` are reported but do not block output.

```powershell
node "<skill-dir>\scripts\composite-iphone.mjs" --input "<screens>" --geometry --require-framing --slide-device-width 480 --slide-device-top 520
node "<skill-dir>\scripts\composite-iphone.mjs" --input "<screens>" --output "<new-cutouts>" --require-framing --review --slide-device-width 480 --slide-device-top 520
node "<skill-dir>\scripts\composite-iphone.mjs" --check "<new-cutouts>"
```

Slide defaults are `1080x1350`, horizontally centred. Override with `--slide-width`, `--slide-height` and `--slide-device-left`. Placement assumes an unrotated, uniformly scaled phone. Foreground artwork, extra CSS clipping and perspective transforms are not modeled; review the final assembled slide too.

`--geometry` emits JSON without PNG publication. The same resolved plan drives rendering: source crop, resized dimensions, crop/letterbox offsets, source-to-cutout X/Y scales and offsets, visible source rectangle and slide placement. The rectangular visible range does not account for rounded corners, Dynamic Island or the home indicator; anchor results additionally integrate the actual replaceable screen mask and slide bounds.

Required visibility failures emit diagnostic JSON and exit 2 before creating output files. `source-crop`, `screen-mask`, `slide-clipping` and `too-small` identify causes. Invalid files/settings exit 1. Successful processing exits 0.

The completed manifest uses schema 2. Each entry records its screenshot hash, output hash, framing-sidecar hash, resolved geometry, validation results and recipe fingerprint. `--check` verifies canonical PNGs against their checksums and locked hardware/alpha, and checks source/sidecar freshness and renderer versions. It cannot establish whether an unchanged screenshot represents the latest state of the app. Missing sources are reported as unverifiable. Older manifests need a new render to obtain these checks.

The optional `review.html` loads only local output PNGs. Its anchor outlines do not modify the PNGs. Open full-size images to examine text and chrome, then review at final slide placement size. No anchor sidecar means important-content visibility has not been automatically checked.
