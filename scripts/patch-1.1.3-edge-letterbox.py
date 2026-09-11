"""One-off patch for iphone-screen-compositor 1.1.3: edge-replicated letterbox for --fit contain.

Root cause found 2026-08-27 on the Odontyn carousels: every phone render made with
`--fit contain --background #ffffff` carried a ~35 px pure-white band inside the display on both
sides, because iPhone screenshots (1170x2532) are narrower than the fitting area (1904x3897) and the
letterbox colour showed. `cover` never had the problem. This patch makes the letterbox replicate the
screenshot's own edge pixels by default, records the letterbox size in the manifest, and adds a
self-test that fails if a light band appears beside a dark header.
"""
from __future__ import annotations
import io, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "codex-skills" / "iphone-screen-compositor"
SCRIPT = ROOT / "scripts" / "composite-iphone.mjs"
t = SCRIPT.read_text(encoding="utf-8")


def rep(old: str, new: str, count: int = 1) -> None:
    global t
    assert t.count(old) == count, (old[:70], t.count(old))
    t = t.replace(old, new)


rep("const VERSION = '1.1.2';", "const VERSION = '1.1.3';")
rep("  --background <hex>         Letterbox colour for --fit contain (default #181619)\n",
    "  --background <value>       Letterbox for --fit contain: edge (default, replicates the\n"
    "                             screenshot's own edge pixels) or a six-digit hex colour\n")
rep("    background: '#181619',\n    cropTop: 0,", "    background: 'edge',\n    cropTop: 0,")
rep("  if (!isHexColor(options.background)) {\n    throw new Error('--background must be a six-digit hex color such as #181619.');",
    "  if (options.background !== 'edge' && !isHexColor(options.background)) {\n"
    "    throw new Error('--background must be edge or a six-digit hex colour such as #181619.');")

# renderOne: replace the single resize with a letterbox-aware fit.
old_resize = """  const prepared = await sharp(normalized.data, { raw: normalized.info })
    .extract({ left: 0, top: cropTopPixels, width: normalized.info.width, height: cropHeight })
    .resize(screen.width, fittingHeight, {
      fit: options.fit,
      position: options.position,
      background: parseColor(options.background),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
"""
new_resize = """  const cropped = sharp(normalized.data, { raw: normalized.info })
    .extract({ left: 0, top: cropTopPixels, width: normalized.info.width, height: cropHeight });
  const letterbox = { left: 0, right: 0, top: 0, bottom: 0 };
  let prepared;
  if (options.fit === 'contain') {
    // Phone screenshots are usually narrower than the fitting area, so contain letterboxes at the
    // sides. A flat colour there reads as a band inside the display (the 2026-08-27 white-band bug),
    // so by default the letterbox replicates the screenshot's own edge pixels instead.
    const scale = Math.min(screen.width / normalized.info.width, fittingHeight / cropHeight);
    const scaledWidth = Math.max(1, Math.round(normalized.info.width * scale));
    const scaledHeight = Math.max(1, Math.round(cropHeight * scale));
    const spareWidth = screen.width - scaledWidth;
    const spareHeight = fittingHeight - scaledHeight;
    letterbox.left = Math.floor(spareWidth / 2);
    letterbox.right = spareWidth - letterbox.left;
    letterbox.top =
      options.position === 'top' ? 0 : options.position === 'bottom' ? spareHeight : Math.floor(spareHeight / 2);
    letterbox.bottom = spareHeight - letterbox.top;
    const extendOptions =
      options.background === 'edge'
        ? { ...letterbox, extendWith: 'copy' }
        : { ...letterbox, background: parseColor(options.background) };
    prepared = await cropped
      .resize(scaledWidth, scaledHeight, { fit: 'fill' })
      .extend(extendOptions)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } else {
    prepared = await cropped
      .resize(screen.width, fittingHeight, { fit: 'cover', position: options.position })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  }
  if (prepared.info.width !== screen.width || prepared.info.height !== fittingHeight) {
    throw new Error(`Prepared screenshot is ${prepared.info.width}x${prepared.info.height}, expected ${screen.width}x${fittingHeight}.`);
  }
"""
rep(old_resize, new_resize)

rep("""    sourceDimensions: `${normalized.info.width}x${normalized.info.height}`,
  };
}
""", """    sourceDimensions: `${normalized.info.width}x${normalized.info.height}`,
    letterbox,
  };
}
""")

# manifest entry + warning
rep("""      protectedPixelsChangedOutsidePermittedRegions: 0,
    });
    console.log(""", """      protectedPixelsChangedOutsidePermittedRegions: 0,
      letterbox: result.letterbox,
      letterboxFill: options.fit === 'contain' ? options.background : null,
    });
    const boxed = Object.values(result.letterbox).some((px) => px > 0);
    if (boxed && options.background !== 'edge') {
      console.warn(
        `warning: ${relativeOutput} has a ${options.background} letterbox ` +
          `(L${result.letterbox.left} R${result.letterbox.right} T${result.letterbox.top} B${result.letterbox.bottom} px) ` +
          'inside the display; it will show as a band beside any non-matching UI edge. ' +
          'Prefer the default --background edge, or --fit cover.',
      );
    }
    console.log(""")

# self-test: contain must not leave a light band beside a dark header
old_tail = """  console.log(`self-test passed in ${((Date.now() - started) / 1000).toFixed(1)}s (expected cutout ${calibration.expectedCutoutDimensions})`);"""
new_tail = """  // Regression: --fit contain on a phone-ratio screenshot must not leave a flat band beside the UI.
  {
    const narrow = await sharp({ create: { width: 1170, height: 2532, channels: 3, background: '#fafafa' } })
      .composite([{ input: { create: { width: 1170, height: 300, channels: 3, background: '#1d1e1b' } }, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const result = await renderOne(engine, narrow, {
      ...options, preset: 'below-ios-chrome', fit: 'contain', position: 'top', background: 'edge',
      cropTop: 0, cropBottom: 0, keepMaster: false, chrome: 'auto', bar: 'auto',
    });
    expect(result.letterbox.left > 0 && result.letterbox.right > 0, 'contain regression: expected a side letterbox.');
    const raw = await sharp(result.cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const box = calibration.cutoutBox;
    const y = Math.round(calibration.screen.y + calibration.statusBar.height + 120 - box.y);
    for (const x of [calibration.screen.x - box.x + 12, calibration.screen.x + calibration.screen.width - box.x - 12]) {
      const offset = (y * raw.info.width + x) * raw.info.channels;
      const brightness = (raw.data[offset] + raw.data[offset + 1] + raw.data[offset + 2]) / 3;
      expect(brightness < 80, `contain regression: light band inside the display at x=${x} (brightness ${brightness.toFixed(0)}).`);
    }
    console.log(`contain + edge letterbox: no band beside a dark header (letterbox L${result.letterbox.left} R${result.letterbox.right} px)`);
  }
  console.log(`self-test passed in ${((Date.now() - started) / 1000).toFixed(1)}s (expected cutout ${calibration.expectedCutoutDimensions})`);"""
rep(old_tail, new_tail)

SCRIPT.write_text(t, encoding="utf-8", newline="\n")

pkg = ROOT / "package.json"
pkg.write_text(pkg.read_text(encoding="utf-8").replace('"version": "1.1.2"', '"version": "1.1.3"'), encoding="utf-8", newline="\n")
print("patched", SCRIPT.name, "and package.json to 1.1.3")
