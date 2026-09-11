import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputRoot = path.resolve(
  process.argv[2] ??
    path.join(projectRoot, 'output', 'odontyn-carousel-iphone-composites'),
);
const assetRoot = path.join(projectRoot, 'public', 'iphone-compositor');
const referencePath = path.join(
  assetRoot,
  'iphone-16-pro-max-desert-titanium.jpg',
);
const screenMaskPath = path.join(assetRoot, 'iphone-screen-mask.png');
const manifest = JSON.parse(
  await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'),
);

if (!manifest.ignoredExistingPhoneRenders) {
  throw new Error('The batch manifest does not confirm old phone renders were ignored.');
}

const [reference, mask] = await Promise.all([
  sharp(referencePath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  sharp(screenMaskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
]);

const protectedRanges = [];
let rangeStart = -1;
const pixelCount = reference.info.width * reference.info.height;
for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const protectedPixel = mask.data[pixel * mask.info.channels + 3] === 0;
  if (protectedPixel && rangeStart < 0) rangeStart = pixel;
  if (!protectedPixel && rangeStart >= 0) {
    protectedRanges.push([rangeStart * 3, pixel * 3]);
    rangeStart = -1;
  }
}
if (rangeStart >= 0) protectedRanges.push([rangeStart * 3, pixelCount * 3]);

let verifiedCount = 0;
for (const entry of manifest.entries) {
  const fixedPath = path.join(outputRoot, entry.fixedCanvas);
  const cutoutPath = path.join(outputRoot, entry.transparentCutout);
  const [fixed, cutoutMetadata] = await Promise.all([
    sharp(fixedPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(cutoutPath).metadata(),
  ]);

  if (
    fixed.info.width !== reference.info.width ||
    fixed.info.height !== reference.info.height
  ) {
    throw new Error(`Fixed canvas changed dimensions: ${entry.fixedCanvas}`);
  }
  if (
    `${cutoutMetadata.width}x${cutoutMetadata.height}` !==
      manifest.settings.transparentCutoutDimensions ||
    !cutoutMetadata.hasAlpha
  ) {
    throw new Error(`Transparent cut-out invariant failed: ${entry.transparentCutout}`);
  }

  for (const [start, end] of protectedRanges) {
    if (!reference.data.subarray(start, end).equals(fixed.data.subarray(start, end))) {
      throw new Error(`Protected hardware pixels changed: ${entry.fixedCanvas}`);
    }
  }

  verifiedCount += 1;
  console.log(
    `[${String(verifiedCount).padStart(2, '0')}/${manifest.entries.length}] ` +
      `${entry.carousel}/${entry.language}/${entry.slide}.png`,
  );
}

console.log(`Verified ${verifiedCount} fixed-reference composites.`);
console.log('Protected hardware pixel changes: 0');
console.log(`Fixed canvas: ${reference.info.width}x${reference.info.height}`);
console.log(
  `Transparent cut-outs: ${manifest.settings.transparentCutoutDimensions}`,
);
