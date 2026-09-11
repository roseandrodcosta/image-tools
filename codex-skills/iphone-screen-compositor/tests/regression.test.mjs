import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, loadEngine, renderOne, verifyCutout, selfTest } from '../scripts/composite-iphone.mjs';
import { resolveGeometry, validateFraming, checkFraming } from '../scripts/geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'scripts/composite-iphone.mjs');
const run = promisify(execFile);
const defaults = parseArguments(['--input', 'fixture.png']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const calibration = JSON.parse(await readFile(path.join(root, 'assets/calibration.json'), 'utf8'));

test('geometry represents crop, fit, positions, device scale and slide placement', () => {
  const g = resolveGeometry({ width: 440, height: 956 }, calibration, defaults);
  assert.deepEqual(g.fitting, { x: 79, y: 314, width: 1904, height: 3897 });
  assert.ok(Math.abs(g.visibleSourceRows[1] - 900.57) < 0.2);
  assert.equal(g.transform.offsetX, 79);
  assert.equal(g.transform.offsetY, 314);
  for (const preset of ['below-ios-chrome', 'full-display']) {
    for (const fit of ['cover', 'contain']) {
      for (const position of ['top', 'center', 'bottom']) {
        for (const source of [{ width: 1320, height: 2868 }, { width: 1200, height: 600 }]) {
          const options = { ...defaults, preset, fit, position, cropTop: 6.2, cropBottom: 3 };
          const plan = resolveGeometry(source, calibration, options);
          assert.ok(plan.visibleSourceRect[0] >= 0);
          assert.ok(plan.visibleSourceRows[0] >= plan.sourceCrop[1]);
          assert.ok(plan.visibleSourceRows[1] <= plan.sourceCrop[1] + plan.sourceCrop[3] + 1e-6);
          assert.ok(plan.croppedAreaFraction >= 0 && plan.croppedAreaFraction < 1);
          if (fit === 'contain') {
            assert.equal(plan.resized.width + plan.letterbox.left + plan.letterbox.right, plan.fitting.width);
            assert.equal(plan.resized.height + plan.letterbox.top + plan.letterbox.bottom, plan.fitting.height);
          } else {
            assert.ok(plan.resized.width >= plan.fitting.width && plan.resized.height >= plan.fitting.height);
          }
        }
      }
    }
  }
  const highDpi = resolveGeometry({ width: 1320, height: 2868 }, calibration, defaults);
  const anchors = validateFraming({ schemaVersion: 1, sourceSha256: 'fixture', coordinateSpace: 'viewport-css',
    viewport: { width: 440, height: 956 }, anchors: { chip: [20, 100, 100, 20] }, mustBeVisible: ['chip'] }, 'fixture', highDpi);
  assert.deepEqual(anchors[0].rect, [60, 300, 300, 60]);
  assert.throws(() => validateFraming({ schemaVersion: 1, sourceSha256: 'old' }, 'new', g), /does not match/);
  assert.throws(() => validateFraming({ schemaVersion: 1, sourceSha256: 'x', coordinateSpace: 'source-pixels', anchors: {}, mustBeVisible: ['missing'] }, 'x', g), /unknown required/);
  assert.throws(() => parseArguments(['--input', 'x', '--slide-device-width', 'NaN']), /positive/);
});

test('existing chrome and letterbox regressions', async () => {
  await selfTest(defaults, root);
});

test('actual mask, final PNG, framing failures and batch CLI', async () => {
  const engine = await loadEngine(defaults, root);
  const { sharp } = engine;
  const work = await mkdtemp(path.join(os.tmpdir(), 'iphone-compositor-qa-'));
  const screenPath = path.join(work, 'screen.png');
  // Bright stripes reach every image edge; a coloured top marker checks actual mapping.
  const screen = await sharp({ create: { width: 440, height: 956, channels: 3, background: '#ff00ff' } })
    .composite([
      { input: { create: { width: 440, height: 120, channels: 3, background: '#173b46' } }, left: 0, top: 0 },
      { input: { create: { width: 340, height: 600, channels: 3, background: '#f6f7f9' } }, left: 50, top: 150 },
      { input: { create: { width: 340, height: 25, channels: 3, background: '#00ff00' } }, left: 50, top: 790 },
    ]).png().toBuffer();
  await writeFile(screenPath, screen);
  const rendered = await renderOne(engine, screen, defaults);
  assert.equal(rendered.validation.decodedPngVerified, true);
  assert.equal(rendered.validation.uiPixelsOutsideScreenMask, 0);
  const raw = await sharp(rendered.cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const markerY = Math.round(rendered.geometry.transform.offsetY + 800 * rendered.geometry.transform.scaleY);
  const markerX = Math.round(rendered.geometry.transform.offsetX + 200 * rendered.geometry.transform.scaleX);
  const offset = (markerY * raw.info.width + markerX) * 4;
  assert.deepEqual([...raw.data.subarray(offset, offset + 3)], [0, 255, 0]);

  const anchors = validateFraming({ schemaVersion: 1, sourceSha256: hash(screen), coordinateSpace: 'source-pixels',
    anchors: { safe: [100, 200, 100, 30], cropped: [50, 940, 100, 10], corner: [0, 895, 10, 5] },
    mustBeVisible: ['safe', 'cropped'] }, hash(screen), rendered.geometry);
  const checked = checkFraming(anchors, rendered.geometry, calibration, engine.screenMaskAlpha);
  assert.equal(checked[0].passed, true);
  assert.equal(checked[1].passed, false);
  assert.ok(checked[1].reasons.includes('source-crop'));
  assert.ok(checked[2].reasons.includes('screen-mask'));
  const slideGeometry = resolveGeometry({ width: 440, height: 956 }, calibration,
    { ...defaults, slideDeviceWidth: 480, slideDeviceTop: 1200 });
  const slideChecked = checkFraming([anchors[0]], slideGeometry, calibration, engine.screenMaskAlpha);
  assert.equal(slideChecked[0].passed, false);
  assert.ok(slideChecked[0].reasons.includes('slide-clipping'));

  // Verify the exported pixel guard itself, not just successful render metadata.
  const badAlpha = Buffer.from(raw.data);
  badAlpha[3] = 255;
  const badAlphaPng = await sharp(badAlpha, { raw: raw.info }).png().toBuffer();
  await assert.rejects(() => verifyCutout(engine, badAlphaPng, rendered.chrome), /silhouette/);
  const badHardware = Buffer.from(raw.data);
  let changed = false;
  for (let y = 0; y < raw.info.height && !changed; y += 1) {
    for (let x = 0; x < raw.info.width; x += 1) {
      const pixel = (y + calibration.cutoutBox.y) * engine.width + x + calibration.cutoutBox.x;
      if (engine.cutoutMaskAlpha[pixel] === 255 && engine.screenMaskAlpha[pixel] === 0) {
        badHardware[(y * raw.info.width + x) * 4] ^= 255;
        changed = true;
        break;
      }
    }
  }
  const badHardwarePng = await sharp(badHardware, { raw: raw.info }).png().toBuffer();
  await assert.rejects(() => verifyCutout(engine, badHardwarePng, rendered.chrome), /hardware/);
  const transparent = await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(() => renderOne(engine, transparent, defaults), /transparency/);

  // Different aspect and full-display exercise clipping around the Island and corners.
  const wide = await sharp({ create: { width: 900, height: 500, channels: 3, background: '#00ffff' } }).png().toBuffer();
  const full = await renderOne(engine, wide, { ...defaults, preset: 'full-display', position: 'bottom' });
  assert.equal(full.validation.outputProtectedPixelChanges, 0);
  assert.ok(full.geometry.visibleSourceRect[0] > 0);

  const output = path.join(work, 'output');
  const sidecar = { schemaVersion: 1, sourceSha256: hash(screen), coordinateSpace: 'source-pixels',
    anchors: { chip: [50, 790, 340, 25] }, mustBeVisible: ['chip'] };
  await writeFile(`${screenPath}.framing.json`, JSON.stringify(sidecar));
  const args = [cli, '--input', screenPath, '--output', output, '--require-framing', '--review',
    '--keep-master', '--slide-device-width', '480', '--slide-device-top', '0'];
  await run(process.execPath, args);
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.complete, true);
  assert.equal(manifest.entries[0].framing.passed, true);
  assert.equal(hash(await readFile(path.join(output, 'screen-iphone.png'))), manifest.entries[0].outputSha256);
  assert.equal(hash(await readFile(path.join(output, 'masters/screen-iphone.png'))), manifest.entries[0].masterSha256);
  assert.match(await readFile(path.join(output, 'review.html'), 'utf8'), /chip: PASS/);
  const checkedOutput = await run(process.execPath, [cli, '--check', output]);
  assert.match(checkedOutput.stdout, /hardware and alpha verified/);
  await assert.rejects(() => run(process.execPath, args), /Refusing to overwrite/);
  sidecar.anchors.chip = [50, 940, 100, 10];
  await writeFile(`${screenPath}.framing.json`, JSON.stringify(sidecar));
  await assert.rejects(() => run(process.execPath, [cli, '--check', output]), (error) => error.code === 2 && /stale framing/.test(error.stdout));
  const failOutput = path.join(work, 'should-not-publish');
  await assert.rejects(() => run(process.execPath, [cli, '--input', screenPath, '--output', failOutput]), (error) => error.code === 2 && /source-crop/.test(error.stdout));
  await assert.rejects(() => access(failOutput));
  sidecar.anchors.chip = [50, 790, 340, 25];
  await writeFile(`${screenPath}.framing.json`, JSON.stringify(sidecar));
  const geometry = await run(process.execPath, [cli, '--input', screenPath, '--geometry']);
  assert.equal(JSON.parse(geometry.stdout).entries[0].geometry.fitting.y, 314);
  const lockedOutput = path.join(work, 'locked');
  await mkdir(lockedOutput);
  await writeFile(path.join(lockedOutput, '.compositor.lock'), 'another writer');
  await assert.rejects(() => run(process.execPath, [cli, '--input', screenPath, '--output', lockedOutput]), /locked by another/);
  await assert.rejects(() => access(path.join(lockedOutput, 'screen-iphone.png')));
  const conflictingSource = path.join(work, 'screen-iphone.png');
  await writeFile(conflictingSource, screen);
  await assert.rejects(() => run(process.execPath, [cli, '--input', screenPath, '--input', conflictingSource, '--output', work, '--force']), /replace a supplied screenshot/);
  assert.equal(hash(await readFile(conflictingSource)), hash(screen));
  console.log(`QA outputs retained for inspection: ${work}`);
});
