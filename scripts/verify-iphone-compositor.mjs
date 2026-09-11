import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const projectRoot = path.resolve(import.meta.dirname, '..');
const assetDirectory = path.join(projectRoot, 'public', 'iphone-compositor');
const referencePath = path.join(
  assetDirectory,
  'iphone-16-pro-max-desert-titanium.jpg',
);
const maskPath = path.join(assetDirectory, 'iphone-screen-mask.png');
const manifestPath = path.join(assetDirectory, 'calibration.json');
const outputPath = path.resolve(
  process.argv[3] ?? path.join(projectRoot, 'output', 'iphone-compositor-verification.png'),
);
const useChromeSafePreset = process.argv.includes('--below-ios-chrome');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const referenceBytes = await readFile(referencePath);
const referenceHash = createHash('sha256').update(referenceBytes).digest('hex');
if (referenceHash !== manifest.referenceSha256) {
  throw new Error('Reference SHA-256 does not match the calibration manifest.');
}

const builtInScreenshot = Buffer.from(`
  <svg width="390" height="844" viewBox="0 0 390 844" xmlns="http://www.w3.org/2000/svg">
    <rect width="390" height="844" fill="#eef8fb"/>
    <rect width="390" height="116" fill="#25332f"/>
    <circle cx="42" cy="54" r="20" fill="#75d2ea"/>
    <rect x="78" y="39" width="180" height="14" rx="7" fill="#ffffff"/>
    <rect x="78" y="65" width="118" height="9" rx="4.5" fill="#c8d6d2"/>
    <rect x="20" y="146" width="350" height="62" rx="18" fill="#ffffff"/>
    <rect x="38" y="168" width="210" height="11" rx="5.5" fill="#80959e"/>
    <rect x="20" y="232" width="350" height="220" rx="22" fill="#ffffff"/>
    <rect x="44" y="258" width="180" height="15" rx="7.5" fill="#25332f"/>
    <rect x="44" y="292" width="278" height="9" rx="4.5" fill="#b4c3c8"/>
    <rect x="44" y="316" width="245" height="9" rx="4.5" fill="#b4c3c8"/>
    <rect x="44" y="372" width="302" height="52" rx="26" fill="#23a8db"/>
    <rect x="20" y="476" width="350" height="328" rx="22" fill="#ffffff"/>
    <circle cx="78" cy="535" r="28" fill="#75d2ea"/>
    <rect x="122" y="515" width="162" height="13" rx="6.5" fill="#25332f"/>
    <rect x="122" y="543" width="96" height="9" rx="4.5" fill="#b4c3c8"/>
    <rect x="44" y="594" width="302" height="10" rx="5" fill="#d6e0e3"/>
    <rect x="44" y="625" width="264" height="10" rx="5" fill="#d6e0e3"/>
  </svg>
`);
const screenshotInput = process.argv[2]
  ? path.resolve(process.argv[2])
  : builtInScreenshot;
const topInset = useChromeSafePreset
  ? Math.round(manifest.screen.height * 0.06)
  : 0;
const fittingHeight = manifest.screen.height - topInset;

const preparedScreenshot = await sharp(screenshotInput)
  .resize(manifest.screen.width, fittingHeight, {
    fit: useChromeSafePreset ? 'cover' : 'contain',
    position: 'top',
    background: { r: 24, g: 22, b: 25, alpha: 1 },
  })
  .png()
  .toBuffer();

const unmaskedLayer = await sharp({
  create: {
    width: manifest.canvas.width,
    height: manifest.canvas.height,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    {
      input: preparedScreenshot,
      left: manifest.screen.x,
      top: manifest.screen.y + topInset,
    },
  ])
  .png()
  .toBuffer();

const maskedLayer = await sharp(unmaskedLayer)
  .composite([{ input: maskPath, blend: 'dest-in' }])
  .png()
  .toBuffer();

await mkdir(path.dirname(outputPath), { recursive: true });
await sharp(referencePath)
  .composite([{ input: maskedLayer, left: 0, top: 0 }])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

const [referenceRaw, outputRaw, maskRaw] = await Promise.all([
  sharp(referencePath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  sharp(maskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
]);

if (
  outputRaw.info.width !== manifest.canvas.width ||
  outputRaw.info.height !== manifest.canvas.height
) {
  throw new Error('Composite dimensions differ from the immutable reference.');
}

let protectedMismatchCount = 0;
let changedScreenPixelCount = 0;
const pixelCount = manifest.canvas.width * manifest.canvas.height;
for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const maskAlpha = maskRaw.data[pixel * maskRaw.info.channels + 3];
  const referenceIndex = pixel * referenceRaw.info.channels;
  const outputIndex = pixel * outputRaw.info.channels;
  const differs =
    referenceRaw.data[referenceIndex] !== outputRaw.data[outputIndex] ||
    referenceRaw.data[referenceIndex + 1] !== outputRaw.data[outputIndex + 1] ||
    referenceRaw.data[referenceIndex + 2] !== outputRaw.data[outputIndex + 2];

  if (maskAlpha === 0 && differs) protectedMismatchCount += 1;
  if (maskAlpha > 0 && differs) changedScreenPixelCount += 1;
}

if (protectedMismatchCount !== 0) {
  throw new Error(
    `${protectedMismatchCount.toLocaleString()} protected reference pixels changed.`,
  );
}
if (changedScreenPixelCount === 0) {
  throw new Error('The verification UI did not change any screen pixels.');
}

console.log(`Verified ${path.relative(projectRoot, outputPath)}`);
console.log(`Dimensions: ${manifest.canvas.width}x${manifest.canvas.height}`);
console.log('Protected reference pixel changes: 0');
console.log(`UI screen pixels changed: ${changedScreenPixelCount.toLocaleString()}`);
if (useChromeSafePreset) console.log('Preset: Below iOS chrome');
