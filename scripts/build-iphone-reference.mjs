import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const referencePath = path.resolve(
  process.argv[2] ??
    path.join(
      projectRoot,
      'public',
      'iphone-compositor',
      'iphone-16-pro-max-desert-titanium.jpg',
    ),
);
const outputDirectory = path.resolve(
  process.argv[3] ?? path.join(projectRoot, 'public', 'iphone-compositor'),
);

const calibration = {
  canvas: { width: 5000, height: 5000 },
  screen: { x: 1548, y: 419, width: 1904, height: 4146 },
  sampledScreenColor: { red: 24, green: 22, blue: 25 },
  colorDistance: 16,
};

const reference = sharp(referencePath);
const metadata = await reference.metadata();

if (
  metadata.width !== calibration.canvas.width ||
  metadata.height !== calibration.canvas.height
) {
  throw new Error(
    `Expected a ${calibration.canvas.width}x${calibration.canvas.height} reference, ` +
      `received ${metadata.width ?? 'unknown'}x${metadata.height ?? 'unknown'}.`,
  );
}

const { data, info } = await reference
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const mask = Buffer.alloc(calibration.canvas.width * calibration.canvas.height * 4);
const maximumDistanceSquared = calibration.colorDistance ** 2;
const screenRight = calibration.screen.x + calibration.screen.width;
const screenBottom = calibration.screen.y + calibration.screen.height;
let replaceablePixelCount = 0;

for (let y = calibration.screen.y; y < screenBottom; y += 1) {
  for (let x = calibration.screen.x; x < screenRight; x += 1) {
    const sourceIndex = (y * info.width + x) * info.channels;
    const redDifference =
      data[sourceIndex] - calibration.sampledScreenColor.red;
    const greenDifference =
      data[sourceIndex + 1] - calibration.sampledScreenColor.green;
    const blueDifference =
      data[sourceIndex + 2] - calibration.sampledScreenColor.blue;
    const colorDistanceSquared =
      redDifference ** 2 + greenDifference ** 2 + blueDifference ** 2;

    if (colorDistanceSquared > maximumDistanceSquared) continue;

    const maskIndex = (y * calibration.canvas.width + x) * 4;
    mask[maskIndex] = 255;
    mask[maskIndex + 1] = 255;
    mask[maskIndex + 2] = 255;
    mask[maskIndex + 3] = 255;
  }
}

// Keep only the display surface connected to the screen center. This removes
// isolated JPEG pixels around the bezel without making assumptions about the
// iPhone's continuous corner curve.
const queue = new Int32Array(calibration.screen.width * calibration.screen.height);
let queueHead = 0;
let queueTail = 0;
const centerX = Math.floor(calibration.screen.width / 2);
const centerY = Math.floor(calibration.screen.height / 2);
const centerIndex = centerY * calibration.screen.width + centerX;
const centerMaskIndex =
  ((calibration.screen.y + centerY) * calibration.canvas.width +
    calibration.screen.x +
    centerX) *
  4;

if (mask[centerMaskIndex + 3] !== 255) {
  throw new Error('The calibrated screen center was not detected as replaceable.');
}

queue[queueTail] = centerIndex;
queueTail += 1;
mask[centerMaskIndex + 3] = 254;

while (queueHead < queueTail) {
  const localIndex = queue[queueHead];
  queueHead += 1;
  const localX = localIndex % calibration.screen.width;
  const localY = Math.floor(localIndex / calibration.screen.width);

  const neighbours = [
    localX > 0 ? localIndex - 1 : -1,
    localX + 1 < calibration.screen.width ? localIndex + 1 : -1,
    localY > 0 ? localIndex - calibration.screen.width : -1,
    localY + 1 < calibration.screen.height
      ? localIndex + calibration.screen.width
      : -1,
  ];

  for (const neighbour of neighbours) {
    if (neighbour < 0) continue;
    const neighbourX = neighbour % calibration.screen.width;
    const neighbourY = Math.floor(neighbour / calibration.screen.width);
    const neighbourMaskIndex =
      ((calibration.screen.y + neighbourY) * calibration.canvas.width +
        calibration.screen.x +
        neighbourX) *
      4;

    if (mask[neighbourMaskIndex + 3] !== 255) continue;
    mask[neighbourMaskIndex + 3] = 254;
    queue[queueTail] = neighbour;
    queueTail += 1;
  }
}

for (let y = calibration.screen.y; y < screenBottom; y += 1) {
  for (let x = calibration.screen.x; x < screenRight; x += 1) {
    const maskIndex = (y * calibration.canvas.width + x) * 4;
    if (mask[maskIndex + 3] === 254) {
      mask[maskIndex + 3] = 255;
      replaceablePixelCount += 1;
      continue;
    }

    mask[maskIndex] = 0;
    mask[maskIndex + 1] = 0;
    mask[maskIndex + 2] = 0;
    mask[maskIndex + 3] = 0;
  }
}

await mkdir(outputDirectory, { recursive: true });

const maskPath = path.join(outputDirectory, 'iphone-screen-mask.png');
await sharp(mask, {
  raw: {
    width: calibration.canvas.width,
    height: calibration.canvas.height,
    channels: 4,
  },
})
  .png({ compressionLevel: 9, palette: true })
  .toFile(maskPath);

// Build a second mask for carousel-ready transparent exports. Only the white
// canvas connected to the image boundary is removed, so white UI content inside
// the closed phone silhouette remains fully opaque.
const pixelCount = calibration.canvas.width * calibration.canvas.height;
const exterior = Buffer.alloc(pixelCount);
const exteriorQueue = new Int32Array(pixelCount);
let exteriorHead = 0;
let exteriorTail = 0;

function isExteriorBackground(pixelIndex) {
  const sourceIndex = pixelIndex * info.channels;
  return (
    data[sourceIndex] >= 242 &&
    data[sourceIndex + 1] >= 242 &&
    data[sourceIndex + 2] >= 242
  );
}

function enqueueExterior(pixelIndex) {
  if (exterior[pixelIndex] || !isExteriorBackground(pixelIndex)) return;
  exterior[pixelIndex] = 1;
  exteriorQueue[exteriorTail] = pixelIndex;
  exteriorTail += 1;
}

for (let x = 0; x < calibration.canvas.width; x += 1) {
  enqueueExterior(x);
  enqueueExterior((calibration.canvas.height - 1) * calibration.canvas.width + x);
}
for (let y = 1; y < calibration.canvas.height - 1; y += 1) {
  enqueueExterior(y * calibration.canvas.width);
  enqueueExterior(y * calibration.canvas.width + calibration.canvas.width - 1);
}

while (exteriorHead < exteriorTail) {
  const pixelIndex = exteriorQueue[exteriorHead];
  exteriorHead += 1;
  const x = pixelIndex % calibration.canvas.width;
  const y = Math.floor(pixelIndex / calibration.canvas.width);

  if (x > 0) enqueueExterior(pixelIndex - 1);
  if (x + 1 < calibration.canvas.width) enqueueExterior(pixelIndex + 1);
  if (y > 0) enqueueExterior(pixelIndex - calibration.canvas.width);
  if (y + 1 < calibration.canvas.height) {
    enqueueExterior(pixelIndex + calibration.canvas.width);
  }
}

const cutoutMask = Buffer.alloc(pixelCount * 4);
const cutoutBounds = {
  left: 850,
  top: 250,
  right: 4150,
  bottom: 4800,
};
let opaqueCutoutPixelCount = 0;

for (let y = cutoutBounds.top; y < cutoutBounds.bottom; y += 1) {
  for (let x = cutoutBounds.left; x < cutoutBounds.right; x += 1) {
    const pixelIndex = y * calibration.canvas.width + x;
    if (exterior[pixelIndex]) continue;
    const cutoutIndex = pixelIndex * 4;
    cutoutMask[cutoutIndex] = 255;
    cutoutMask[cutoutIndex + 1] = 255;
    cutoutMask[cutoutIndex + 2] = 255;
    cutoutMask[cutoutIndex + 3] = 255;
    opaqueCutoutPixelCount += 1;
  }
}

const cutoutMaskPath = path.join(outputDirectory, 'iphone-cutout-mask.png');
await sharp(cutoutMask, {
  raw: {
    width: calibration.canvas.width,
    height: calibration.canvas.height,
    channels: 4,
  },
})
  .png({ compressionLevel: 9, palette: true })
  .toFile(cutoutMaskPath);

const referenceBytes = await readFile(referencePath);
const manifest = {
  ...calibration,
  referenceFile: path.basename(referencePath),
  maskFile: path.basename(maskPath),
  cutoutMaskFile: path.basename(cutoutMaskPath),
  referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
  replaceablePixelCount,
  protectedPixelCount:
    calibration.canvas.width * calibration.canvas.height -
    replaceablePixelCount,
  opaqueCutoutPixelCount,
};

await writeFile(
  path.join(outputDirectory, 'calibration.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(
  `Created ${path.relative(projectRoot, maskPath)} with ` +
    `${replaceablePixelCount.toLocaleString()} replaceable screen pixels.`,
);
console.log(
  `Created ${path.relative(projectRoot, cutoutMaskPath)} with ` +
    `${opaqueCutoutPixelCount.toLocaleString()} opaque cut-out pixels.`,
);
