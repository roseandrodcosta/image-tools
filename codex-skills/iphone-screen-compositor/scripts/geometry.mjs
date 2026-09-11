// Coordinates use half-open rectangles: [x, y, width, height]. Source pixels are
// orientation-normalized, before the user's crop. The renderer consumes this plan.
export function resolveGeometry(source, calibration, options) {
  const screen = calibration.screen;
  const box = calibration.cutoutBox;
  const inset = options.preset === 'below-ios-chrome' ? calibration.statusBar.height : 0;
  const fitting = { x: screen.x - box.x, y: screen.y + inset - box.y,
    width: screen.width, height: screen.height - inset };
  const top = Math.round(source.height * options.cropTop / 100);
  const bottom = Math.round(source.height * options.cropBottom / 100);
  const croppedHeight = source.height - top - bottom;
  if (croppedHeight < 1) throw new Error('Source crop removed the entire image.');
  const contain = options.fit === 'contain';
  const scale = (contain ? Math.min : Math.max)(fitting.width / source.width, fitting.height / croppedHeight);
  const resized = { width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(croppedHeight * scale)) };
  const dx = fitting.width - resized.width;
  const dy = fitting.height - resized.height;
  const offsetX = Math.floor(dx / 2);
  const offsetY = options.position === 'top' ? 0 : options.position === 'bottom' ? dy : Math.floor(dy / 2);
  const scaleX = resized.width / source.width;
  const scaleY = resized.height / croppedHeight;
  const transform = { scaleX, scaleY, offsetX: fitting.x + offsetX,
    offsetY: fitting.y + offsetY - top * scaleY };
  const visibleSourceRect = [Math.max(0, -offsetX / scaleX), top + Math.max(0, -offsetY / scaleY),
    Math.min(resized.width, fitting.width) / scaleX, Math.min(resized.height, fitting.height) / scaleY];
  const letterbox = { left: Math.max(0, offsetX), right: Math.max(0, dx - offsetX),
    top: Math.max(0, offsetY), bottom: Math.max(0, dy - offsetY) };
  const retainedArea = visibleSourceRect[2] * visibleSourceRect[3];
  const slide = options.slideDeviceWidth == null ? null : {
    width: options.slideWidth, height: options.slideHeight,
    deviceWidth: options.slideDeviceWidth,
    deviceLeft: options.slideDeviceLeft ?? (options.slideWidth - options.slideDeviceWidth) / 2,
    deviceTop: options.slideDeviceTop,
    scale: options.slideDeviceWidth / box.width,
  };
  return { schemaVersion: 1, source: { width: source.width, height: source.height },
    sourceCrop: [0, top, source.width, croppedHeight], fitting, resized,
    resizeCrop: [Math.max(0, -offsetX), Math.max(0, -offsetY), fitting.width, fitting.height],
    transform, sourceRow0AtCutoutY: transform.offsetY,
    visibleSourceRect, visibleSourceRows: [visibleSourceRect[1], visibleSourceRect[1] + visibleSourceRect[3]],
    croppedAreaFraction: 1 - retainedArea / (source.width * source.height),
    letterbox, slide, visibilityNote: 'Rectangular fit only; framing additionally checks the actual screen mask.' };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Framing sidecar: ${message}`);
}

export function validateFraming(sidecar, sourceSha256, geometry) {
  assert(sidecar && sidecar.schemaVersion === 1, 'schemaVersion must be 1.');
  assert(sidecar.sourceSha256 === sourceSha256, 'sourceSha256 does not match this screenshot.');
  assert(['source-pixels', 'viewport-css'].includes(sidecar.coordinateSpace), 'declare source-pixels or viewport-css.');
  let ratioX = 1, ratioY = 1;
  if (sidecar.coordinateSpace === 'viewport-css') {
    const viewport = sidecar.viewport;
    assert(viewport && Number.isFinite(viewport.width) && viewport.width > 0 &&
      Number.isFinite(viewport.height) && viewport.height > 0, 'viewport dimensions must be positive.');
    ratioX = geometry.source.width / viewport.width;
    ratioY = geometry.source.height / viewport.height;
    assert(Math.abs(ratioX - ratioY) < 0.01, 'viewport must describe the entire screenshot, at uniform device scale.');
  }
  assert(sidecar.anchors && typeof sidecar.anchors === 'object' && !Array.isArray(sidecar.anchors), 'anchors must be an object.');
  assert(Array.isArray(sidecar.mustBeVisible ?? []), 'mustBeVisible must be an array.');
  const anchors = Object.entries(sidecar.anchors).map(([name, value]) => {
    const spec = Array.isArray(value) ? { rect: value } : value;
    assert(spec && Array.isArray(spec.rect) && spec.rect.length === 4 && spec.rect.every(Number.isFinite), `${name}: use [x, y, width, height].`);
    const [x, y, w, h] = spec.rect;
    assert(x >= 0 && y >= 0 && w > 0 && h > 0 &&
      (x + w) * ratioX <= geometry.source.width + 0.01 &&
      (y + h) * ratioY <= geometry.source.height + 0.01, `${name}: rectangle is outside the source.`);
    const fraction = spec.minVisibleFraction ?? 1;
    assert(Number.isFinite(fraction) && fraction > 0 && fraction <= 1, `${name}: minVisibleFraction must be in (0, 1].`);
    assert(spec.minRenderedHeightPx == null || (Number.isFinite(spec.minRenderedHeightPx) && spec.minRenderedHeightPx > 0), `${name}: invalid minRenderedHeightPx.`);
    assert(spec.minRenderedHeightPx == null || geometry.slide, `${name}: minRenderedHeightPx requires slide placement.`);
    return { name, rect: [x * ratioX, y * ratioY, w * ratioX, h * ratioY],
      minVisibleFraction: fraction, minRenderedHeightPx: spec.minRenderedHeightPx ?? null,
      required: (sidecar.mustBeVisible ?? []).includes(name) };
  });
  for (const name of sidecar.mustBeVisible ?? []) {
    assert(anchors.some((anchor) => anchor.name === name), `unknown required anchor ${name}.`);
  }
  return anchors;
}

// Integrate fractional pixel areas rather than checking only rectangle corners.
export function checkFraming(anchors, geometry, calibration, maskAlpha) {
  const { transform: t, fitting: f, slide } = geometry;
  const box = calibration.cutoutBox;
  const canvasWidth = calibration.canvas.width;
  return anchors.map((anchor) => {
    const [x, y, w, h] = anchor.rect;
    const rect = [x * t.scaleX + t.offsetX, y * t.scaleY + t.offsetY, w * t.scaleX, h * t.scaleY];
    const [rx, ry, rw, rh] = rect;
    const left = Math.max(rx, f.x), top = Math.max(ry, f.y);
    const right = Math.min(rx + rw, f.x + f.width), bottom = Math.min(ry + rh, f.y + f.height);
    const fitArea = Math.max(0, right - left) * Math.max(0, bottom - top);
    let screenArea = 0, visibleArea = 0;
    const slideLeft = slide ? -slide.deviceLeft / slide.scale : -Infinity;
    const slideTop = slide ? -slide.deviceTop / slide.scale : -Infinity;
    const slideRight = slide ? (slide.width - slide.deviceLeft) / slide.scale : Infinity;
    const slideBottom = slide ? (slide.height - slide.deviceTop) / slide.scale : Infinity;
    for (let py = Math.floor(top); py < Math.ceil(bottom); py += 1) {
      for (let px = Math.floor(left); px < Math.ceil(right); px += 1) {
        if (maskAlpha[(py + box.y) * canvasWidth + px + box.x] !== 255) continue;
        const l = Math.max(left, px), r = Math.min(right, px + 1);
        const u = Math.max(top, py), b = Math.min(bottom, py + 1);
        screenArea += (r - l) * (b - u);
        visibleArea += Math.max(0, Math.min(r, slideRight) - Math.max(l, slideLeft)) *
          Math.max(0, Math.min(b, slideBottom) - Math.max(u, slideTop));
      }
    }
    const area = rw * rh;
    const visibleFraction = Math.min(1, visibleArea / area);
    const renderedHeightPx = slide ? rh * slide.scale : null;
    const reasons = [];
    if (fitArea < area - 0.001) reasons.push('source-crop');
    if (screenArea < fitArea - 0.001) reasons.push('screen-mask');
    if (visibleArea < screenArea - 0.001) reasons.push('slide-clipping');
    const tooSmall = anchor.minRenderedHeightPx != null && renderedHeightPx < anchor.minRenderedHeightPx;
    if (tooSmall) reasons.push('too-small');
    return { ...anchor, cutoutRect: rect, visibleFraction, renderedHeightPx, reasons,
      passed: visibleFraction + 1e-9 >= anchor.minVisibleFraction && !tooSmall };
  });
}
