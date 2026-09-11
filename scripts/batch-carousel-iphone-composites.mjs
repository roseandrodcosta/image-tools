import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const carouselRoot = path.resolve(process.argv[2] ?? '');
const outputRoot = path.resolve(
  process.argv[3] ??
    path.join(projectRoot, 'output', 'odontyn-carousel-iphone-composites'),
);

if (!process.argv[2]) {
  throw new Error(
    'Pass the Odontyn carousel root as the first argument. ' +
      'An optional output directory may be passed second.',
  );
}

const assetRoot = path.join(projectRoot, 'public', 'iphone-compositor');
const referencePath = path.join(
  assetRoot,
  'iphone-16-pro-max-desert-titanium.jpg',
);
const screenMaskPath = path.join(assetRoot, 'iphone-screen-mask.png');
const cutoutMaskPath = path.join(assetRoot, 'iphone-cutout-mask.png');
const calibration = JSON.parse(
  await readFile(path.join(assetRoot, 'calibration.json'), 'utf8'),
);

const carouselFolders = {
  '01': "01 When is Yousef's dental appointment (family accounts)",
  '02': '02 The specialist you were told to find',
  '03': '03 The record that writes itself',
  '04': '04 The five-minute family dental reset',
  '06': '06 From I need a dentist to booked',
  '08': '08 One child, many visits (Back to School)',
};

const targets = [];

function addBilingualTarget(carousel, slide, relativeDirectory, english, arabic) {
  targets.push(
    {
      carousel,
      slide,
      language: 'EN',
      source: path.join(
        carouselRoot,
        carouselFolders[carousel],
        'Assets',
        'UI screens',
        relativeDirectory,
        english,
      ),
    },
    {
      carousel,
      slide,
      language: 'AR',
      source: path.join(
        carouselRoot,
        carouselFolders[carousel],
        'Assets',
        'UI screens',
        relativeDirectory,
        arabic,
      ),
    },
  );
}

addBilingualTarget(
  '01',
  '05',
  'screens for iPhone composites',
  's5-member-appointments-en.png',
  's5-member-appointments-ar.png',
);
addBilingualTarget(
  '01',
  '06',
  'screens for iPhone composites',
  's6-dental-record-scrolled-en.png',
  's6-dental-record-scrolled-ar.png',
);

addBilingualTarget(
  '02',
  '03',
  path.join('raw app captures', 'en'),
  'find-endodontics.png',
  path.join('..', 'ar', 'find-endodontics.png'),
);
addBilingualTarget(
  '02',
  '04',
  path.join('raw app captures', 'en'),
  'transfers.png',
  path.join('..', 'ar', 'transfers.png'),
);
addBilingualTarget(
  '02',
  '05',
  path.join('raw app captures', 'en'),
  'odr-images.png',
  path.join('..', 'ar', 'odr-images.png'),
);

for (const slide of ['03', '04', '05', '06']) {
  addBilingualTarget(
    '03',
    slide,
    'as placed on slides',
    `ui-s${Number(slide)}-en.png`,
    `ui-s${Number(slide)}-ar.png`,
  );
}

for (const slide of ['06', '07']) {
  addBilingualTarget(
    '04',
    slide,
    'as placed on slides',
    `ui-s${Number(slide)}-en.png`,
    `ui-s${Number(slide)}-ar.png`,
  );
}

const carouselSixSources = {
  '02': 'find-dentist-list',
  '03': 'map-dentist-card',
  '04': 'booking-pick-time',
  '05': 'booking-confirm',
};
for (const [slide, name] of Object.entries(carouselSixSources)) {
  addBilingualTarget(
    '06',
    slide,
    'screens for iPhone composites',
    `c6-s${Number(slide)}-${name}-en.png`,
    `c6-s${Number(slide)}-${name}-ar.png`,
  );
}

addBilingualTarget(
  '08',
  '05',
  'as placed on slides',
  'ui-s5-en.png',
  'ui-s5-ar.png',
);

const referenceBytes = await readFile(referencePath);
const screenMaskBytes = await readFile(screenMaskPath);
const cutoutMaskBytes = await readFile(cutoutMaskPath);
const referenceHash = createHash('sha256').update(referenceBytes).digest('hex');
if (referenceHash !== calibration.referenceSha256) {
  throw new Error('The fixed iPhone reference does not match its calibration hash.');
}

const topInset = Math.round(calibration.screen.height * 0.06);
const fittingHeight = calibration.screen.height - topInset;
const fullCanvasDirectory = path.join(outputRoot, 'fixed-5000-canvas');
const cutoutDirectory = path.join(outputRoot, 'transparent-cutouts');
await mkdir(fullCanvasDirectory, { recursive: true });
await mkdir(cutoutDirectory, { recursive: true });

const manifestEntries = [];
let expectedTrimmedSize = null;

for (let index = 0; index < targets.length; index += 1) {
  const target = targets[index];
  const sourceBytes = await readFile(target.source);
  const sourceMetadata = await sharp(sourceBytes).metadata();
  const preparedScreenshot = await sharp(sourceBytes)
    .resize(calibration.screen.width, fittingHeight, {
      fit: 'cover',
      position: 'top',
      background: { r: 24, g: 22, b: 25, alpha: 1 },
    })
    .png()
    .toBuffer();

  const unmaskedLayer = await sharp({
    create: {
      width: calibration.canvas.width,
      height: calibration.canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: preparedScreenshot,
        left: calibration.screen.x,
        top: calibration.screen.y + topInset,
      },
    ])
    .png()
    .toBuffer();

  const screenLayer = await sharp(unmaskedLayer)
    .composite([{ input: screenMaskBytes, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const fixedCanvas = await sharp(referenceBytes)
    .composite([{ input: screenLayer, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const transparentCanvas = await sharp(fixedCanvas)
    .ensureAlpha()
    .composite([{ input: cutoutMaskBytes, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const trimmedCutout = await sharp(transparentCanvas)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 0,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const targetRelativePath = path.join(
    target.carousel,
    target.language,
    `${target.slide}.png`,
  );
  const fixedPath = path.join(fullCanvasDirectory, targetRelativePath);
  const cutoutPath = path.join(cutoutDirectory, targetRelativePath);
  await mkdir(path.dirname(fixedPath), { recursive: true });
  await mkdir(path.dirname(cutoutPath), { recursive: true });
  await writeFile(fixedPath, fixedCanvas);
  await writeFile(cutoutPath, trimmedCutout);

  const [fixedMetadata, cutoutMetadata] = await Promise.all([
    sharp(fixedCanvas).metadata(),
    sharp(trimmedCutout).metadata(),
  ]);
  if (
    fixedMetadata.width !== calibration.canvas.width ||
    fixedMetadata.height !== calibration.canvas.height
  ) {
    throw new Error(`Fixed canvas dimensions changed for ${targetRelativePath}.`);
  }
  if (!cutoutMetadata.hasAlpha) {
    throw new Error(`Transparent cut-out has no alpha channel: ${targetRelativePath}.`);
  }

  const currentTrimmedSize = `${cutoutMetadata.width}x${cutoutMetadata.height}`;
  if (expectedTrimmedSize === null) expectedTrimmedSize = currentTrimmedSize;
  if (currentTrimmedSize !== expectedTrimmedSize) {
    throw new Error(
      `Phone cut-out size changed for ${targetRelativePath}: ` +
        `${currentTrimmedSize} instead of ${expectedTrimmedSize}.`,
    );
  }

  manifestEntries.push({
    carousel: target.carousel,
    slide: target.slide,
    language: target.language,
    source: path.relative(carouselRoot, target.source),
    sourceDimensions: `${sourceMetadata.width}x${sourceMetadata.height}`,
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    fixedCanvas: path.relative(outputRoot, fixedPath),
    transparentCutout: path.relative(outputRoot, cutoutPath),
    transparentCutoutDimensions: currentTrimmedSize,
  });

  console.log(
    `[${String(index + 1).padStart(2, '0')}/${targets.length}] ` +
      `${target.carousel}/${target.language}/${target.slide}.png`,
  );
}

const batchManifest = {
  generatedAt: new Date().toISOString(),
  sourceRoot: carouselRoot,
  reference: path.relative(projectRoot, referencePath),
  referenceSha256: referenceHash,
  settings: {
    preset: 'below-ios-chrome',
    fit: 'cover',
    position: 'top',
    topInsetPercent: 6,
    outputCanvas: `${calibration.canvas.width}x${calibration.canvas.height}`,
    transparentCutoutDimensions: expectedTrimmedSize,
  },
  ignoredExistingPhoneRenders: true,
  count: manifestEntries.length,
  entries: manifestEntries,
};
await writeFile(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify(batchManifest, null, 2)}\n`,
  'utf8',
);

console.log(`Generated ${targets.length} composites in ${outputRoot}`);
console.log(`Fixed canvas: ${calibration.canvas.width}x${calibration.canvas.height}`);
console.log(`Transparent cut-out: ${expectedTrimmedSize}`);
