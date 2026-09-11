import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolveGeometry, validateFraming, checkFraming } from './geometry.mjs';

const VERSION = '1.2.0';
const CALIBRATION_SHA256 = 'b4687f7b9b7c297e575fc988cde34796a75a598539b3b06105498fcbdf19acf5';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TOP_SAMPLE_FRACTION = 0.01; // Rows sampled at the top of a screenshot for the bar colour.
// Relative (linear) luminance above which the status bar takes black glyphs. The WCAG
// black-vs-white crossover (0.179, about #767676) is too low for UI chrome: it puts black
// glyphs on teal, orange and mid-grey headers where iOS shows white. 0.35 (about #a0a0a0)
// matches iOS behaviour and APCA on real brand colours.
const LIGHT_CHROME_LUMINANCE = 0.35;
const PNG_COMPRESSION = 6; // Level 9 is ~3x slower for ~2% smaller files at this canvas size.
const HELP = `
iPhone Screen Compositor ${VERSION}
Create fixed-reference iPhone composites from clean UI screenshots.

Usage:
  node composite-iphone.mjs --input <file-or-folder> [options]
  node composite-iphone.mjs --self-test

Options:
  --input <path>             Input file or directory; may be repeated
  --output <directory>       Output directory
  --engine-root <directory>  Optional legacy fallback that provides sharp
  --preset <name>            below-ios-chrome (default) or full-display
  --fit <mode>               cover (default) or contain
  --position <value>         top (default), center, or bottom
  --chrome <mode>            auto (default), reference, light (black), or dark (white)
  --bar <value>              auto (default), reference, or a hex colour for the status bar
  --background <value>       Letterbox for --fit contain: edge (default, replicates the
                             screenshot's own edge pixels) or a six-digit hex colour
  --crop-top <percent>       Crop percentage from source top
  --crop-bottom <percent>    Crop percentage from source bottom
  --recursive                Include subdirectories
  --keep-master              Also save fixed 5000x5000 masters
  --force                    Replace existing output files
  --self-test                Verify sharp, assets, and a full in-memory render, then exit
  --geometry                 Print resolved source-to-cutout geometry without writing images
  --review                   Write a local review.html with cutouts and framing overlays
  --require-framing          Require <screenshot>.framing.json for every input
  --slide-device-width <px>   Check/preview placement at this width on the slide
  --slide-device-top <px>     Device top on slide (default 0)
  --slide-device-left <px>    Device left on slide (default centred)
  --slide-width <px>          Slide width (default 1080)
  --slide-height <px>         Slide height (default 1350)
  --check <directory>        Check saved output integrity and source staleness
  --version                 Print version and invoked skill path
  --help                     Show this help
`;

function parseArguments(argv) {
  const options = {
    inputs: [],
    output: null,
    engineRoot: null,
    preset: 'below-ios-chrome',
    fit: 'cover',
    position: 'top',
    chrome: 'auto',
    bar: 'auto',
    background: 'edge',
    cropTop: 0,
    cropBottom: 0,
    recursive: false,
    keepMaster: false,
    force: false,
    selfTest: false,
    help: false,
    geometry: false,
    review: false,
    requireFraming: false,
    slideDeviceWidth: null,
    slideDeviceTop: 0,
    slideDeviceLeft: null,
    slideWidth: 1080,
    slideHeight: 1350,
    check: null,
    version: false,
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || (value.startsWith('--') && value.length > 2)) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--geometry': options.geometry = true; break;
      case '--review': options.review = true; break;
      case '--require-framing': options.requireFraming = true; break;
      case '--version': options.version = true; break;
      case '--check': options.check = takeValue(index++, argument); break;
      case '--slide-device-width': options.slideDeviceWidth = Number(takeValue(index++, argument)); break;
      case '--slide-device-top': options.slideDeviceTop = Number(takeValue(index++, argument)); break;
      case '--slide-device-left': options.slideDeviceLeft = Number(takeValue(index++, argument)); break;
      case '--slide-width': options.slideWidth = Number(takeValue(index++, argument)); break;
      case '--slide-height': options.slideHeight = Number(takeValue(index++, argument)); break;
      case '--input':
        options.inputs.push(takeValue(index, argument));
        index += 1;
        break;
      case '--output':
        options.output = takeValue(index, argument);
        index += 1;
        break;
      case '--engine-root':
        options.engineRoot = takeValue(index, argument);
        index += 1;
        break;
      case '--preset':
        options.preset = takeValue(index, argument);
        index += 1;
        break;
      case '--fit':
        options.fit = takeValue(index, argument);
        index += 1;
        break;
      case '--position':
        options.position = takeValue(index, argument);
        index += 1;
        break;
      case '--chrome':
        options.chrome = takeValue(index, argument).toLowerCase();
        index += 1;
        break;
      case '--bar':
        options.bar = takeValue(index, argument).toLowerCase();
        index += 1;
        break;
      case '--background':
        options.background = takeValue(index, argument);
        index += 1;
        break;
      case '--crop-top':
        options.cropTop = Number(takeValue(index, argument));
        index += 1;
        break;
      case '--crop-bottom':
        options.cropBottom = Number(takeValue(index, argument));
        index += 1;
        break;
      case '--recursive':
        options.recursive = true;
        break;
      case '--keep-master':
        options.keepMaster = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--self-test':
        options.selfTest = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.help || options.selfTest || options.version || options.check) return options;
  for (const key of ['slideWidth', 'slideHeight', 'slideDeviceWidth']) {
    if (options[key] != null && (!Number.isFinite(options[key]) || options[key] <= 0)) throw new Error(`${key} must be positive.`);
  }
  for (const key of ['slideDeviceTop', 'slideDeviceLeft']) {
    if (options[key] != null && !Number.isFinite(options[key])) throw new Error(`${key} must be finite.`);
  }
  if (options.slideDeviceWidth == null && (options.slideDeviceTop !== 0 || options.slideDeviceLeft != null)) {
    throw new Error('Slide placement requires --slide-device-width.');
  }
  if (options.inputs.length === 0) throw new Error('At least one --input is required.');
  if (options.inputs.length > 1 && !options.output) {
    throw new Error('--output is required when using more than one --input.');
  }
  if (!['below-ios-chrome', 'full-display'].includes(options.preset)) {
    throw new Error('--preset must be below-ios-chrome or full-display.');
  }
  if (!['cover', 'contain'].includes(options.fit)) {
    throw new Error('--fit must be cover or contain.');
  }
  if (!['top', 'center', 'bottom'].includes(options.position)) {
    throw new Error('--position must be top, center, or bottom.');
  }
  if (!['reference', 'auto', 'light', 'dark'].includes(options.chrome)) {
    throw new Error('--chrome must be reference, auto, light, or dark.');
  }
  if (!['auto', 'reference'].includes(options.bar) && !isHexColor(options.bar)) {
    throw new Error('--bar must be auto, reference, or a six-digit hex colour such as #f5f5f5.');
  }
  for (const [name, value] of [
    ['--crop-top', options.cropTop],
    ['--crop-bottom', options.cropBottom],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value >= 100) {
      throw new Error(`${name} must be between 0 and 99.99.`);
    }
  }
  if (options.cropTop + options.cropBottom >= 100) {
    throw new Error('Combined source cropping must remain below 100%.');
  }
  if (options.background !== 'edge' && !isHexColor(options.background)) {
    throw new Error('--background must be edge or a six-digit hex colour such as #181619.');
  }
  return options;
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function parseColor(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function linearizeSrgb(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
  return (
    0.2126 * linearizeSrgb(r) +
    0.7152 * linearizeSrgb(g) +
    0.0722 * linearizeSrgb(b)
  );
}

function chromeModeForBackground(color) {
  return relativeLuminance(color) >= LIGHT_CHROME_LUMINANCE ? 'light' : 'dark';
}

function dominantTopColor(screenshotRaw) {
  const { width, height, channels } = screenshotRaw.info;
  const sampleRows = Math.min(height, Math.max(4, Math.round(height * TOP_SAMPLE_FRACTION)));
  const bucketCounts = new Uint32Array(4096);
  const redSums = new Uint32Array(4096);
  const greenSums = new Uint32Array(4096);
  const blueSums = new Uint32Array(4096);
  let winningBucket = 0;

  for (let y = 0; y < sampleRows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      if (channels === 4 && screenshotRaw.data[offset + 3] === 0) continue;
      const r = screenshotRaw.data[offset];
      const g = screenshotRaw.data[offset + 1];
      const b = screenshotRaw.data[offset + 2];
      const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      bucketCounts[bucket] += 1;
      redSums[bucket] += r;
      greenSums[bucket] += g;
      blueSums[bucket] += b;
      if (bucketCounts[bucket] > bucketCounts[winningBucket]) winningBucket = bucket;
    }
  }

  const count = bucketCounts[winningBucket];
  expect(count > 0, 'Could not sample an opaque status-bar colour from the screenshot.');
  return {
    r: Math.round(redSums[winningBucket] / count),
    g: Math.round(greenSums[winningBucket] / count),
    b: Math.round(blueSums[winningBucket] / count),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function looksLikeRenderedPhoneDirectory(name) {
  const normalized = name.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
  return (
    normalized.includes('phone render') ||
    normalized.includes('iphone render') ||
    normalized.includes('phone composite') ||
    normalized.includes('iphone composite') ||
    normalized.includes('phone mockup') ||
    normalized.includes('iphone mockup') ||
    normalized.includes('iphone cutout') ||
    normalized === 'fixed 5000 canvas' ||
    normalized === 'masters'
  );
}

async function collectDirectoryFiles(root, recursive, outputRoot, skipped) {
  const collected = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          path.resolve(absolute) === path.resolve(outputRoot) ||
          looksLikeRenderedPhoneDirectory(entry.name)
        ) {
          skipped.directories.push(absolute);
          continue;
        }
        if (recursive) await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        collected.push({ absolute, relative: path.relative(root, absolute) });
      } else {
        skipped.files.push(absolute);
      }
    }
  }
  await visit(root);
  return collected;
}

async function collectInputs(inputPaths, recursive, outputRoot) {
  const sources = [];
  const skipped = { directories: [], files: [] };
  for (const inputPath of inputPaths) {
    const absoluteInput = path.resolve(inputPath);
    const inputStat = await stat(absoluteInput);
    if (inputStat.isFile()) {
      if (!IMAGE_EXTENSIONS.has(path.extname(absoluteInput).toLowerCase())) {
        throw new Error(`Unsupported input type: ${absoluteInput}`);
      }
      sources.push({ absolute: absoluteInput, relative: path.basename(absoluteInput) });
      continue;
    }
    if (!inputStat.isDirectory()) {
      throw new Error(`Input is not a file or directory: ${absoluteInput}`);
    }
    if (looksLikeRenderedPhoneDirectory(path.basename(absoluteInput))) {
      console.warn(
        `Warning: "${absoluteInput}" is named like an existing phone-render folder. Processing it because it was passed explicitly; make sure it holds clean UI screenshots.`,
      );
    }
    const found = await collectDirectoryFiles(absoluteInput, recursive, outputRoot, skipped);
    if (inputPaths.length > 1) {
      for (const item of found) {
        item.relative = path.join(path.basename(absoluteInput), item.relative);
      }
    }
    sources.push(...found);
  }
  sources.sort((left, right) => left.absolute.localeCompare(right.absolute));
  return { sources, skipped };
}

async function findOutputRoot(options) {
  if (options.output) return path.resolve(options.output);
  const onlyInput = path.resolve(options.inputs[0]);
  const inputStat = await stat(onlyInput);
  return inputStat.isDirectory()
    ? path.join(onlyInput, 'iphone-cutouts')
    : path.join(path.dirname(onlyInput), 'iphone-cutouts');
}

async function loadSharp(engineRootOption, skillRoot) {
  const candidates = [skillRoot];
  if (engineRootOption) candidates.push(path.resolve(engineRootOption));
  candidates.push(process.cwd(), path.join(process.cwd(), 'image-tools'));

  const tried = [];
  for (const candidate of [...new Set(candidates)]) {
    const packagePath = path.join(candidate, 'package.json');
    if (!(await exists(packagePath))) continue;
    tried.push(candidate);
    try {
      const requireFromProject = createRequire(packagePath);
      return { sharp: requireFromProject('sharp'), engineRoot: candidate };
    } catch {
      // Try the next narrowly scoped candidate.
    }
  }
  throw new Error(
    `Could not load sharp. Run "npm ci --omit=dev" in the skill folder. Tried: ${tried.join(', ') || 'no package roots found'}`,
  );
}

function outputRelativePath(sourceRelative) {
  const extension = path.extname(sourceRelative);
  const withoutExtension = sourceRelative.slice(0, -extension.length);
  return `${withoutExtension}-iphone.png`;
}

async function assertWritableTargets(targets, force) {
  if (force) return;
  const collisions = [];
  for (const target of targets) {
    if (await exists(target)) collisions.push(target);
  }
  if (collisions.length > 0) {
    throw new Error(
      `Refusing to overwrite ${collisions.length} existing output file(s). Choose a new --output directory or explicitly add --force. First collision: ${collisions[0]}`,
    );
  }
}

/**
 * Byte ranges (into an RGB raw buffer) of every pixel the screen mask marks as protected
 * hardware. The masks are hard-edged (verified in loadEngine), so the comparison can be exact.
 */
function makeProtectedRanges(maskAlpha, pixelCount) {
  const ranges = [];
  let startPixel = -1;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const protectedPixel = maskAlpha[pixel] === 0;
    if (protectedPixel && startPixel < 0) startPixel = pixel;
    if (!protectedPixel && startPixel >= 0) {
      ranges.push([startPixel * 3, pixel * 3]);
      startPixel = -1;
    }
  }
  if (startPixel >= 0) ranges.push([startPixel * 3, pixelCount * 3]);
  return ranges;
}

function countProtectedPixelDifferences(left, right, protectedRanges) {
  let changedPixels = 0;
  for (const [start, end] of protectedRanges) {
    for (let offset = start; offset < end; offset += 3) {
      if (
        left[offset] !== right[offset] ||
        left[offset + 1] !== right[offset + 1] ||
        left[offset + 2] !== right[offset + 2]
      ) {
        changedPixels += 1;
      }
    }
  }
  return changedPixels;
}

function countAlpha(alpha) {
  let opaque = 0;
  let transparent = 0;
  for (const value of alpha) {
    if (value === 255) opaque += 1;
    else if (value === 0) transparent += 1;
  }
  return { opaque, transparent, partial: alpha.length - opaque - transparent };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function rawInput(buffer, info) {
  return {
    input: buffer,
    raw: { width: info.width, height: info.height, channels: info.channels },
  };
}

/**
 * Load sharp plus every calibrated asset, verifying each one against calibration.json:
 * SHA-256 of every file, hard-edged masks, pixel counts, cutout box, and that the light
 * chrome patch only touches protected pixels. Decodes everything to raw buffers once.
 */
async function loadEngine(options, skillRoot) {
  const { sharp, engineRoot } = await loadSharp(options.engineRoot, skillRoot);
  const assetRoot = path.join(skillRoot, 'assets');
  const calibrationBytes = await readFile(path.join(assetRoot, 'calibration.json'));
  expect(sha256(calibrationBytes) === CALIBRATION_SHA256, 'Calibration changed: the hardware geometry and asset locks are immutable.');
  const calibration = JSON.parse(calibrationBytes.toString('utf8'));
  const readAsset = (name) => readFile(path.join(assetRoot, name));
  const [referenceBytes, screenMaskBytes, cutoutMaskBytes, lightPatchBytes] = await Promise.all([
    readAsset(calibration.referenceFile),
    readAsset(calibration.maskFile),
    readAsset(calibration.cutoutMaskFile),
    readAsset(calibration.lightChromePatchFile),
  ]);

  const referenceHash = sha256(referenceBytes);
  expect(
    referenceHash === calibration.referenceSha256,
    'The bundled iPhone reference does not match its locked calibration hash.',
  );
  expect(
    sha256(screenMaskBytes) === calibration.screenMaskSha256,
    'The bundled screen mask does not match its locked calibration hash.',
  );
  expect(
    sha256(cutoutMaskBytes) === calibration.cutoutMaskSha256,
    'The bundled cutout mask does not match its locked calibration hash.',
  );
  expect(
    sha256(lightPatchBytes) === calibration.lightChromePatchSha256,
    'The bundled light status-chrome patch does not match its locked calibration hash.',
  );

  const { width, height } = calibration.canvas;
  const pixelCount = width * height;
  const [reference, screenMaskAlpha, cutoutMaskAlpha, lightPatch] = await Promise.all([
    sharp(referenceBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(screenMaskBytes).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true }),
    sharp(cutoutMaskBytes).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true }),
    sharp(lightPatchBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  expect(
    reference.info.width === width && reference.info.height === height && reference.info.channels === 3,
    `The iPhone reference must decode to ${width}x${height} RGB.`,
  );
  for (const [name, mask] of [['screen', screenMaskAlpha], ['cutout', cutoutMaskAlpha]]) {
    expect(
      mask.info.width === width && mask.info.height === height,
      `The ${name} mask must be ${width}x${height}.`,
    );
  }

  const screenCounts = countAlpha(screenMaskAlpha.data);
  const cutoutCounts = countAlpha(cutoutMaskAlpha.data);
  expect(screenCounts.partial === 0 && cutoutCounts.partial === 0, 'Masks must be hard-edged (no partial alpha).');
  expect(
    screenCounts.opaque === calibration.replaceablePixelCount &&
      screenCounts.transparent === calibration.protectedPixelCount,
    'Screen mask pixel counts do not match calibration.',
  );
  expect(cutoutCounts.opaque === calibration.opaqueCutoutPixelCount, 'Cutout mask pixel count does not match calibration.');

  const box = calibration.cutoutBox;
  expect(
    `${box.width}x${box.height}` === calibration.expectedCutoutDimensions,
    'Calibration cutout box disagrees with expectedCutoutDimensions.',
  );
  let outsideBox = 0;
  for (let y = 0; y < height; y += 1) {
    const insideRows = y >= box.y && y < box.y + box.height;
    for (let x = 0; x < width; x += 1) {
      if (screenMaskAlpha.data[y * width + x] === 255) {
        expect(cutoutMaskAlpha.data[y * width + x] === 255, 'Screen mask leaks outside the phone silhouette.');
        const s = calibration.screen;
        expect(x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height,
          'Screen mask leaks outside the calibrated display.');
      }
      if (cutoutMaskAlpha.data[y * width + x] !== 255) continue;
      if (!insideRows || x < box.x || x >= box.x + box.width) outsideBox += 1;
    }
  }
  expect(outsideBox === 0, 'Cutout mask has opaque pixels outside the calibrated cutout box.');

  const patchBox = calibration.lightChromePatch;
  expect(
    lightPatch.info.width === patchBox.width && lightPatch.info.height === patchBox.height,
    'The light status-chrome patch has unexpected dimensions.',
  );
  let patchOpaque = 0;
  let patchOverReplaceable = 0;
  for (let y = 0; y < patchBox.height; y += 1) {
    for (let x = 0; x < patchBox.width; x += 1) {
      const alpha = lightPatch.data[(y * patchBox.width + x) * 4 + 3];
      if (alpha === 0) continue;
      expect(alpha === 255, 'The light status-chrome patch must be hard-edged.');
      patchOpaque += 1;
      if (screenMaskAlpha.data[(patchBox.y + y) * width + patchBox.x + x] === 255) patchOverReplaceable += 1;
    }
  }
  expect(patchOpaque === calibration.lightChromePatchOpaquePixelCount, 'Light chrome patch pixel count does not match calibration.');
  expect(patchOverReplaceable === 0, 'Light chrome patch would overwrite replaceable screen pixels.');

  const protectedRanges = makeProtectedRanges(screenMaskAlpha.data, pixelCount);

  // The photographed reference is the dark baseline. Build the permitted light-chrome
  // baseline lazily, only when a render actually selects light glyphs.
  const darkBaseline = reference.data;
  let lightBaselinePromise = null;
  const getBaseline = async (chrome) => {
    if (chrome === 'dark') {
      return { data: darkBaseline, protectedPixelsChangedFromOriginalReference: 0 };
    }
    lightBaselinePromise ??= (async () => {
      const data = await sharp(reference.data, { raw: { width, height, channels: 3 } })
        .composite([{ ...rawInput(lightPatch.data, lightPatch.info), left: patchBox.x, top: patchBox.y }])
        .removeAlpha()
        .raw()
        .toBuffer();
      expect(data.length === darkBaseline.length, 'Light baseline has an unexpected size.');
      const changed = countProtectedPixelDifferences(darkBaseline, data, protectedRanges);
      expect(
        changed === calibration.lightChromeProtectedPixelChangesFromReference,
        'Light chrome protected-pixel changes do not match calibration.',
      );
      return { data, protectedPixelsChangedFromOriginalReference: changed };
    })();
    return lightBaselinePromise;
  };

  return {
    sharp,
    engineRoot,
    calibration,
    referenceHash,
    width,
    height,
    // The RGBA PNGs are the dest-in overlays: a 1-channel raw buffer carries no alpha for blending.
    screenMaskBytes,
    cutoutMaskBytes,
    screenMaskAlpha: screenMaskAlpha.data,
    cutoutMaskAlpha: cutoutMaskAlpha.data,
    protectedRanges,
    getBaseline,
  };
}

/**
 * Decide the status-bar colour and glyph mode for one prepared screenshot. Adaptive mode
 * samples the top rows directly and picks black glyphs only on genuinely light bars.
 */
function decideChrome(screenshotRaw, options, calibration) {
  const topColor = dominantTopColor(screenshotRaw);

  let barColor;
  if (options.bar === 'auto') barColor = topColor;
  else if (options.bar === 'reference') {
    const { red, green, blue } = calibration.sampledScreenColor;
    barColor = { r: red, g: green, b: blue };
  } else barColor = parseColor(options.bar);

  let chrome;
  if (options.chrome === 'reference') chrome = 'dark';
  else if (options.chrome === 'auto') {
    chrome = chromeModeForBackground(
      options.preset === 'full-display' ? topColor : barColor,
    );
  } else chrome = options.chrome;
  return {
    chrome,
    statusGlyphColor: chrome === 'light' ? 'black' : 'white',
    barColor: { ...barColor, alpha: 1 },
  };
}

/** Render one screenshot. Returns the cutout PNG, the fixed-canvas PNG (if requested), and metadata. */
async function renderOne(engine, sourceBytes, options) {
  const { sharp, calibration, width, height } = engine;
  const screen = calibration.screen;
  const topInset = options.preset === 'below-ios-chrome' ? calibration.statusBar.height : 0;
  const fittingHeight = screen.height - topInset;

  const normalized = await normalizeSource(sharp, sourceBytes);
  const geometry = resolveGeometry(normalized.info, calibration, options);
  const [, cropTopPixels, , cropHeight] = geometry.sourceCrop;

  const cropped = sharp(normalized.data, { raw: normalized.info })
    .extract({ left: 0, top: cropTopPixels, width: normalized.info.width, height: cropHeight });
  const letterbox = geometry.letterbox;
  let prepared;
  if (options.fit === 'contain') {
    // Phone screenshots are usually narrower than the fitting area, so contain letterboxes at the
    // sides. A flat colour there reads as a band inside the display (the 2026-08-27 white-band bug),
    // so by default the letterbox replicates the screenshot's own edge pixels instead.
    const { width: scaledWidth, height: scaledHeight } = geometry.resized;
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
    const [left, top, cropWidth, cropOutputHeight] = geometry.resizeCrop;
    prepared = await cropped
      .resize(geometry.resized.width, geometry.resized.height, { fit: 'fill' })
      .extract({ left, top, width: cropWidth, height: cropOutputHeight })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  }
  if (prepared.info.width !== screen.width || prepared.info.height !== fittingHeight) {
    throw new Error(`Prepared screenshot is ${prepared.info.width}x${prepared.info.height}, expected ${screen.width}x${fittingHeight}.`);
  }

  const { chrome, statusGlyphColor, barColor } = decideChrome(
    prepared,
    options,
    calibration,
  );
  const baselineResult = await engine.getBaseline(chrome);
  const baseline = baselineResult.data;

  // Screen layer: status bar fill (if the screenshot sits below the chrome), then the
  // screenshot, then clip everything to the replaceable screen pixels in a single pass.
  const layers = [];
  if (topInset > 0) {
    layers.push({
      input: { create: { width: screen.width, height: topInset, channels: 4, background: barColor } },
      left: screen.x,
      top: screen.y,
    });
  }
  layers.push({ ...rawInput(prepared.data, prepared.info), left: screen.x, top: screen.y + topInset });
  layers.push({ input: engine.screenMaskBytes, blend: 'dest-in' });
  const screenLayer = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (engine.screenMaskAlpha[pixel] === 0 && screenLayer.data[pixel * 4 + 3] !== 0) {
      throw new Error('UI layer leaks outside the replaceable screen mask.');
    }
  }

  const fixed = await sharp(baseline, { raw: { width, height, channels: 3 } })
    .composite([{ ...rawInput(screenLayer.data, screenLayer.info), left: 0, top: 0 }])
    .removeAlpha()
    .raw()
    .toBuffer();
  for (const [start, end] of engine.protectedRanges) {
    if (!baseline.subarray(start, end).equals(fixed.subarray(start, end))) {
      throw new Error('Protected iPhone hardware pixels changed.');
    }
  }

  // Two pipelines on purpose: sharp applies extract() before composite() within one chain.
  const box = calibration.cutoutBox;
  const transparentCanvas = await sharp(fixed, { raw: { width, height, channels: 3 } })
    .ensureAlpha()
    .composite([{ input: engine.cutoutMaskBytes, blend: 'dest-in' }])
    .raw()
    .toBuffer();
  const cutout = await sharp(transparentCanvas, { raw: { width, height, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .png({ compressionLevel: PNG_COMPRESSION })
    .toBuffer();
  const cutoutMetadata = await sharp(cutout).metadata();
  const cutoutSize = `${cutoutMetadata.width}x${cutoutMetadata.height}`;
  if (!cutoutMetadata.hasAlpha || cutoutSize !== calibration.expectedCutoutDimensions) {
    throw new Error(
      `Transparent cutout invariant failed: got ${cutoutSize}${cutoutMetadata.hasAlpha ? '' : ' without alpha'}, expected ${calibration.expectedCutoutDimensions}.`,
    );
  }
  await verifyCutout(engine, cutout, chrome);

  const master = options.keepMaster
    ? await sharp(fixed, { raw: { width, height, channels: 3 } }).png({ compressionLevel: PNG_COMPRESSION }).toBuffer()
    : null;

  return {
    cutout,
    master,
    cutoutSize,
    chrome,
    statusGlyphColor,
    statusChromePatchApplied: chrome === 'light',
    barColor: toHex(barColor),
    protectedPixelsChangedFromOriginalReference:
      baselineResult.protectedPixelsChangedFromOriginalReference,
    sourceDimensions: `${normalized.info.width}x${normalized.info.height}`,
    letterbox,
    geometry,
    validation: { protectedPixelsChangedOutsidePermittedRegions: 0, uiPixelsOutsideScreenMask: 0,
      outputAlphaMismatches: 0, outputProtectedPixelChanges: 0, decodedPngVerified: true },
  };
}

async function verifyCutout(engine, bytes, chrome) {
  const decoded = await engine.sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = engine.calibration.cutoutBox;
  expect(decoded.info.width === box.width && decoded.info.height === box.height && decoded.info.channels === 4,
    'Decoded PNG dimensions do not match the locked cutout.');
  const baseline = (await engine.getBaseline(chrome)).data;
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const pixel = (y + box.y) * engine.width + x + box.x;
      const offset = (y * box.width + x) * 4;
      const alpha = engine.cutoutMaskAlpha[pixel];
      if (decoded.data[offset + 3] !== alpha) throw new Error(`Exported PNG silhouette changed at ${x},${y}.`);
      if (alpha === 255 && engine.screenMaskAlpha[pixel] === 0) {
        const original = pixel * 3;
        if (decoded.data[offset] !== baseline[original] || decoded.data[offset + 1] !== baseline[original + 1] ||
          decoded.data[offset + 2] !== baseline[original + 2]) throw new Error(`Exported PNG hardware changed at ${x},${y}.`);
      }
    }
  }
}

async function normalizeSource(sharp, bytes) {
  const metadata = await sharp(bytes).metadata();
  expect((metadata.pages ?? 1) === 1, 'Use a single still screenshot; animated inputs are not supported.');
  if (metadata.hasAlpha) {
    const alpha = await sharp(bytes).extractChannel('alpha').raw().toBuffer();
    expect(alpha.every((value) => value === 255), 'UI screenshot contains transparency. Supply an opaque screenshot to avoid unnatural fills.');
  }
  return sharp(bytes).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function sourceFraming(source, sourceHash, geometry, engine, required) {
  const sidecarPath = `${source.absolute}.framing.json`;
  if (!(await exists(sidecarPath))) {
    expect(!required, `Missing required framing sidecar: ${sidecarPath}`);
    return { sidecarSha256: null, anchors: [], passed: true };
  }
  const bytes = await readFile(sidecarPath);
  const anchors = validateFraming(JSON.parse(bytes.toString('utf8')), sourceHash, geometry);
  const results = checkFraming(anchors, geometry, engine.calibration, engine.screenMaskAlpha);
  return { sidecarSha256: sha256(bytes), anchors: results, passed: results.every((anchor) => !anchor.required || anchor.passed) };
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function reviewHtml(entries, calibration) {
  const box = calibration.cutoutBox;
  const cards = [...entries].sort((a, b) => Number(a.framing.passed) - Number(b.framing.passed)).map((entry) => {
    const g = entry.geometry, slide = g.slide;
    const sw = slide?.width ?? box.width, sh = slide?.height ?? box.height;
    const scale = slide?.scale ?? 1, left = slide?.deviceLeft ?? 0, top = slide?.deviceTop ?? 0;
    const uri = entry.transparentCutout.split(/[\\/]/).map(encodeURIComponent).join('/');
    const overlays = entry.framing.anchors.map((anchor) => {
      const [x, y, w, h] = anchor.cutoutRect;
      return `<rect x="${left + x * scale}" y="${top + y * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="${anchor.passed ? '#008c55' : '#db1736'}" stroke-width="3" vector-effect="non-scaling-stroke"><title>${escapeHtml(anchor.name)}: ${(anchor.visibleFraction * 100).toFixed(1)}% visible</title></rect>`;
    }).join('');
    return `<article><h2>${escapeHtml(entry.transparentCutout)}</h2><p>${escapeHtml(entry.summary)}</p>
      <svg viewBox="0 0 ${sw} ${sh}" role="img" aria-label="Phone placement and anchor outlines">
      <image href="${uri}" x="${left}" y="${top}" width="${box.width * scale}" height="${box.height * scale}"/>${overlays}</svg>
      <p>${entry.framing.anchors.map((a) => `${escapeHtml(a.name)}: ${a.passed ? 'PASS' : 'FAIL'} (${(a.visibleFraction * 100).toFixed(1)}%; ${escapeHtml(a.reasons.join(', ') || 'fully visible')})`).join('<br>') || 'No framing anchors supplied; inspect important content visually.'}</p>
      <a href="${uri}">Open full-size PNG</a></article>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>iPhone cutout review</title><style>body{font:15px system-ui;margin:24px;background:#eee;color:#222}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,440px));gap:24px}article{padding:16px;background:white;border-radius:12px}h2{font-size:16px;overflow-wrap:anywhere}svg{display:block;width:100%;background:repeating-conic-gradient(#ddd 0% 25%,#fafafa 0% 50%) 0/20px 20px}a{color:#155bb5}</style>
    <h1>iPhone cutout review</h1><p>All published PNGs passed exact hardware and silhouette checks. Anchor outlines appear only here. Preview scales to your window; open the PNG for fine detail. Slide checks do not include foreground artwork.</p><main>${cards}</main></html>`;
}

function recipeFor(options, engine) {
  return { compositorVersion: VERSION, calibrationSha256: CALIBRATION_SHA256,
    sharpVersion: engine.sharp.versions.sharp, vipsVersion: engine.sharp.versions.vips,
    preset: options.preset, fit: options.fit, position: options.position, chrome: options.chrome,
    bar: options.bar, background: options.background, cropTopPercent: options.cropTop, cropBottomPercent: options.cropBottom,
    slideDeviceWidth: options.slideDeviceWidth, slideDeviceTop: options.slideDeviceTop,
    slideDeviceLeft: options.slideDeviceLeft, slideWidth: options.slideWidth, slideHeight: options.slideHeight };
}

async function checkOutputs(directory, engine) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  expect(manifest.schemaVersion === 2 && manifest.complete === true, 'A completed v1.2 manifest is required for --check.');
  let failures = 0;
  for (const entry of manifest.entries) {
    const issues = [];
    const expectedRecipeHash = sha256(Buffer.from(JSON.stringify({ recipe: manifest.recipe,
      sourceSha256: entry.sourceSha256, sidecarSha256: entry.framing.sidecarSha256 })));
    if (expectedRecipeHash !== entry.recipeSha256) issues.push('recipe fingerprint changed');
    try {
      const outputPath = path.resolve(root, entry.transparentCutout);
      const relative = path.relative(root, outputPath);
      expect(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Output path escapes the manifest directory.');
      const output = await readFile(outputPath);
      expect(sha256(output) === entry.outputSha256, 'Output checksum changed.');
      expect(['light', 'dark'].includes(entry.statusChrome), 'Invalid status chrome.');
      await verifyCutout(engine, output, entry.statusChrome);
      if (entry.fixedCanvasMaster) {
        const masterPath = path.resolve(root, entry.fixedCanvasMaster);
        const masterRelative = path.relative(root, masterPath);
        expect(masterRelative !== '..' && !masterRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(masterRelative), 'Master path escapes the manifest directory.');
        expect(sha256(await readFile(masterPath)) === entry.masterSha256, 'Master checksum changed.');
      }
    } catch (error) { issues.push(`invalid output: ${error.message}`); }
    try {
      if (sha256(await readFile(entry.source)) !== entry.sourceSha256) issues.push('stale source');
      const sidecar = `${entry.source}.framing.json`;
      const sidecarHash = await exists(sidecar) ? sha256(await readFile(sidecar)) : null;
      if (sidecarHash !== entry.framing.sidecarSha256) issues.push('stale framing');
    } catch { issues.push('source unverifiable'); }
    if (manifest.recipe.compositorVersion !== VERSION || manifest.recipe.calibrationSha256 !== CALIBRATION_SHA256 ||
      manifest.recipe.sharpVersion !== engine.sharp.versions.sharp || manifest.recipe.vipsVersion !== engine.sharp.versions.vips) issues.push('renderer recipe changed');
    if (!entry.framing.passed) issues.push('required framing failed');
    if (issues.length) failures += 1;
    console.log(`${issues.length ? 'FAIL' : 'OK'} ${entry.transparentCutout}: ${issues.join('; ') || 'source current, output intact, hardware and alpha verified'}`);
  }
  if (failures) process.exitCode = 2;
}

async function selfTest(options, skillRoot) {
  const started = Date.now();
  const engine = await loadEngine(options, skillRoot);
  const { sharp, calibration } = engine;
  console.log(`sharp ${sharp.versions?.sharp ?? 'unknown'} from ${engine.engineRoot}`);
  console.log(`assets verified: reference ${engine.referenceHash.slice(0, 12)}…, masks, light chrome patch`);

  const synthetic = (body, topBar) =>
    sharp({ create: { width: 1290, height: 2796, channels: 3, background: body } })
      .composite([
        { input: { create: { width: 1290, height: 320, channels: 3, background: topBar } }, left: 0, top: 0 },
        { input: { create: { width: 1130, height: 520, channels: 3, background: '#ffffff' } }, left: 80, top: 440 },
      ])
      .png()
      .toBuffer();
  const cases = [
    {
      name: 'reference chrome (opt-in, untouched photo)',
      bytes: await synthetic('#fafafa', '#fafafa'),
      settings: { chrome: 'reference', bar: 'reference' },
      expectChrome: 'dark',
      expectGlyph: 'white',
      expectBar: '#181619',
      expectReferenceChanges: 0,
    },
    {
      name: 'adaptive dark header over light body',
      bytes: await synthetic('#fafafa', '#343a40'),
      settings: { chrome: 'auto', bar: 'auto' },
      expectChrome: 'dark',
      expectGlyph: 'white',
      expectBar: '#343a40',
      expectReferenceChanges: 0,
    },
    {
      name: 'adaptive light header over dark body',
      bytes: await synthetic('#14143c', '#fafafa'),
      settings: { chrome: 'auto', bar: 'auto' },
      expectChrome: 'light',
      expectGlyph: 'black',
      expectBar: '#fafafa',
      expectReferenceChanges: calibration.lightChromeProtectedPixelChangesFromReference,
    },
    {
      name: 'adaptive light grey header',
      bytes: await synthetic('#14143c', '#b0b0b0'),
      settings: { chrome: 'auto', bar: 'auto' },
      expectChrome: 'light',
      expectGlyph: 'black',
      expectBar: '#b0b0b0',
      expectReferenceChanges: calibration.lightChromeProtectedPixelChangesFromReference,
    },
    {
      name: 'adaptive saturated mid-tone header (teal) keeps white glyphs',
      bytes: await synthetic('#fafafa', '#0d9488'),
      settings: {},
      expectChrome: 'dark',
      expectGlyph: 'white',
      expectBar: '#0d9488',
      expectReferenceChanges: 0,
    },
    {
      name: 'adaptive orange header keeps white glyphs',
      bytes: await synthetic('#fafafa', '#f97316'),
      settings: {},
      expectChrome: 'dark',
      expectGlyph: 'white',
      expectBar: '#f97316',
      expectReferenceChanges: 0,
    },
  ];
  for (const testCase of cases) {
    const renderOptions = {
      ...options,
      preset: 'below-ios-chrome',
      fit: 'cover',
      position: 'top',
      background: '#181619',
      cropTop: 0,
      cropBottom: 0,
      keepMaster: false,
      ...testCase.settings,
    };
    const result = await renderOne(engine, testCase.bytes, renderOptions);
    expect(
      result.chrome === testCase.expectChrome,
      `${testCase.name}: expected ${testCase.expectChrome} chrome, got ${result.chrome}.`,
    );
    expect(
      result.statusGlyphColor === testCase.expectGlyph,
      `${testCase.name}: expected ${testCase.expectGlyph} glyphs, got ${result.statusGlyphColor}.`,
    );
    expect(
      result.barColor === testCase.expectBar,
      `${testCase.name}: expected bar ${testCase.expectBar}, got ${result.barColor}.`,
    );
    expect(
      result.protectedPixelsChangedFromOriginalReference === testCase.expectReferenceChanges,
      `${testCase.name}: unexpected protected-pixel change count.`,
    );
    console.log(
      `${testCase.name}: ${result.cutoutSize}, ${result.statusGlyphColor} glyphs, ` +
        `bar ${result.barColor}, ${result.protectedPixelsChangedFromOriginalReference} ` +
        'permitted protected-pixel changes from reference',
    );
  }
  // Regression: --fit contain on a phone-ratio screenshot must not leave a flat band beside the UI.
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
  console.log(`self-test passed in ${((Date.now() - started) / 1000).toFixed(1)}s (expected cutout ${calibration.expectedCutoutDimensions})`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (options.version) {
    console.log(`iphone-screen-compositor ${VERSION}\n${skillRoot}`);
    return;
  }
  if (options.selfTest) {
    await selfTest(options, skillRoot);
    return;
  }

  const engine = await loadEngine(options, skillRoot);
  if (options.check) {
    await checkOutputs(options.check, engine);
    return;
  }
  const outputRoot = await findOutputRoot(options);
  const { sources, skipped } = await collectInputs(options.inputs, options.recursive, outputRoot);
  if (sources.length === 0) throw new Error('No supported UI screenshots were found.');

  // Resolve every source and framing contract before publishing any output.
  const plans = [];
  for (const source of sources) {
    const bytes = await readFile(source.absolute);
    const normalized = await normalizeSource(engine.sharp, bytes);
    const geometry = resolveGeometry(normalized.info, engine.calibration, options);
    const sourceHash = sha256(bytes);
    const framing = await sourceFraming(source, sourceHash, geometry, engine, options.requireFraming);
    plans.push({ source: source.absolute, sourceSha256: sourceHash, geometry, framing });
  }
  if (options.geometry || plans.some((plan) => !plan.framing.passed)) {
    console.log(JSON.stringify({ schemaVersion: 1, entries: plans }, null, 2));
    if (plans.some((plan) => !plan.framing.passed)) process.exitCode = 2;
    return;
  }

  const targetPaths = [];
  for (const source of sources) {
    const relative = outputRelativePath(source.relative);
    targetPaths.push(path.join(outputRoot, relative));
    if (options.keepMaster) targetPaths.push(path.join(outputRoot, 'masters', relative));
  }
  targetPaths.push(path.join(outputRoot, 'manifest.json'));
  targetPaths.push(path.join(outputRoot, 'run-status.json'));
  if (options.review) targetPaths.push(path.join(outputRoot, 'review.html'));
  if (new Set(targetPaths.map((target) => target.toLowerCase())).size !== targetPaths.length) {
    throw new Error('Two inputs resolve to the same output name. Separate them into distinct folders.');
  }
  const inputNames = new Set(sources.map((source) => path.resolve(source.absolute).toLowerCase()));
  expect(!targetPaths.some((target) => inputNames.has(path.resolve(target).toLowerCase())),
    'An output would replace a supplied screenshot; choose a different output directory, even with --force.');
  await assertWritableTargets(targetPaths, options.force);
  await mkdir(outputRoot, { recursive: true });

  const lockPath = path.join(outputRoot, '.compositor.lock');
  const lock = await open(lockPath, 'wx').catch(() => {
    throw new Error('Output directory is locked by another or interrupted run. Use a new output directory.');
  });
  try {
  // Repeat under the directory lock to close the preflight race.
  await assertWritableTargets(targetPaths, options.force);

  const entries = [];
  const recipe = recipeFor(options, engine);
  const journal = { complete: false, compositorVersion: VERSION, planned: sources.length, completed: [] };
  await writeFile(path.join(outputRoot, 'run-status.json'), JSON.stringify(journal, null, 2), { flag: options.force ? 'w' : 'wx' });
  // A force rerun must not leave the previous batch claiming completion if it fails.
  if (options.force && await exists(path.join(outputRoot, 'manifest.json'))) await unlink(path.join(outputRoot, 'manifest.json'));
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const sourceBytes = await readFile(source.absolute);
    const plan = plans[index];
    expect(sha256(sourceBytes) === plan.sourceSha256, `Source changed during this run: ${source.absolute}`);
    const currentFraming = await sourceFraming(source, plan.sourceSha256, plan.geometry, engine, options.requireFraming);
    expect(currentFraming.sidecarSha256 === plan.framing.sidecarSha256, `Framing changed during this run: ${source.absolute}`);
    let result;
    try {
      result = await renderOne(engine, sourceBytes, options);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : error} (${source.absolute})`);
    }

    const relativeOutput = outputRelativePath(source.relative);
    const cutoutPath = path.join(outputRoot, relativeOutput);
    await mkdir(path.dirname(cutoutPath), { recursive: true });
    await writeFile(cutoutPath, result.cutout, { flag: options.force ? 'w' : 'wx' });
    let masterRelative = null;
    if (result.master) {
      masterRelative = path.join('masters', relativeOutput);
      const masterPath = path.join(outputRoot, masterRelative);
      await mkdir(path.dirname(masterPath), { recursive: true });
      await writeFile(masterPath, result.master, { flag: options.force ? 'w' : 'wx' });
    }

    entries.push({
      source: source.absolute,
      sourceDimensions: result.sourceDimensions,
      sourceSha256: sha256(sourceBytes),
      outputSha256: sha256(result.cutout),
      recipeSha256: sha256(Buffer.from(JSON.stringify({ recipe, sourceSha256: plan.sourceSha256, sidecarSha256: plan.framing.sidecarSha256 }))),
      transparentCutout: relativeOutput,
      transparentCutoutDimensions: result.cutoutSize,
      fixedCanvasMaster: masterRelative,
      masterSha256: result.master ? sha256(result.master) : null,
      statusChrome: result.chrome,
      statusGlyphColor: result.statusGlyphColor,
      statusBarColor: result.barColor,
      statusChromePatchApplied: result.statusChromePatchApplied,
      protectedPixelsChangedFromOriginalReference:
        result.protectedPixelsChangedFromOriginalReference,
      protectedPixelsChangedOutsidePermittedRegions: 0,
      letterbox: result.letterbox,
      letterboxFill: options.fit === 'contain' ? options.background : null,
      geometry: result.geometry,
      framing: plan.framing,
      validation: result.validation,
      summary: `OK | hardware drift 0 | UI leaks 0 | crop ${(result.geometry.croppedAreaFraction * 100).toFixed(1)}% | ${result.statusGlyphColor} glyphs | anchors ${plan.framing.anchors.filter((a) => a.passed).length}/${plan.framing.anchors.length}`,
    });
    journal.completed.push(relativeOutput);
    await writeFile(path.join(outputRoot, 'run-status.json'), JSON.stringify(journal, null, 2));
    if (result.geometry.croppedAreaFraction > 0.001) {
      console.warn(`Framing: ${relativeOutput} crops ${(result.geometry.croppedAreaFraction * 100).toFixed(1)}% of source area. Use --geometry or framing anchors to check important content.`);
    }
    const boxed = Object.values(result.letterbox).some((px) => px > 0);
    if (boxed && options.background !== 'edge') {
      console.warn(
        `warning: ${relativeOutput} has a ${options.background} letterbox ` +
          `(L${result.letterbox.left} R${result.letterbox.right} T${result.letterbox.top} B${result.letterbox.bottom} px) ` +
          'inside the display; it will show as a band beside any non-matching UI edge. ' +
          'Prefer the default --background edge, or --fit cover.',
      );
    }
    console.log(
      `[${String(index + 1).padStart(2, '0')}/${sources.length}] ${relativeOutput} ` +
        `(${result.statusGlyphColor} glyphs, bar ${result.barColor}, ` +
        `${result.protectedPixelsChangedFromOriginalReference} permitted reference changes)`,
    );
  }

  const manifest = {
    schemaVersion: 2,
    complete: true,
    recipe,
    generatedAt: new Date().toISOString(),
    compositorVersion: VERSION,
    mode: 'transparent-cutouts-default',
    count: entries.length,
    outputRoot,
    engineRoot: engine.engineRoot,
    referenceSha256: engine.referenceHash,
    settings: {
      preset: options.preset,
      fit: options.fit,
      position: options.position,
      chrome: options.chrome,
      bar: options.bar,
      background: options.background,
      cropTopPercent: options.cropTop,
      cropBottomPercent: options.cropBottom,
      fixedCanvasDimensions: `${engine.width}x${engine.height}`,
      transparentCutoutDimensions: engine.calibration.expectedCutoutDimensions,
      keptFixedCanvasMasters: options.keepMaster,
    },
    ignoredExistingPhoneRenderDirectories: true,
    skippedDirectories: skipped.directories,
    skippedFiles: skipped.files,
    entries,
  };
  if (options.review) await writeFile(path.join(outputRoot, 'review.html'), reviewHtml(entries, engine.calibration), { flag: options.force ? 'w' : 'wx' });
  await writeFile(
    path.join(outputRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', flag: options.force ? 'w' : 'wx' },
  );
  journal.complete = true;
  await writeFile(path.join(outputRoot, 'run-status.json'), JSON.stringify(journal, null, 2));

  console.log(`Created ${entries.length} transparent iPhone cutout(s) in ${outputRoot}`);
  console.log(`Cutout dimensions: ${engine.calibration.expectedCutoutDimensions}`);
  console.log('Protected pixels changed outside permitted regions: 0');
  if (skipped.directories.length > 0) console.log(`Skipped ${skipped.directories.length} phone-render/output folder(s)`);
  if (skipped.files.length > 0) console.log(`Skipped ${skipped.files.length} non-image file(s) (listed in manifest.json)`);
  if (!options.keepMaster) console.log('Fixed 5000x5000 masters: not written (default)');
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export { parseArguments, loadEngine, renderOne, verifyCutout, selfTest };
