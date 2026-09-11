export const IPHONE_REFERENCE_URL =
  '/iphone-compositor/iphone-16-pro-max-desert-titanium.jpg';
export const IPHONE_MASK_URL = '/iphone-compositor/iphone-screen-mask.png';

export const IPHONE_CANVAS = {
  width: 5000,
  height: 5000,
} as const;

export const IPHONE_SCREEN = {
  x: 1548,
  y: 419,
  width: 1904,
  height: 4146,
} as const;

export type FitMode = 'contain' | 'cover';

export interface CompositeSettings {
  fitMode: FitMode;
  backgroundColor: string;
  zoom: number;
  alignX: number;
  alignY: number;
  cropTop: number;
  cropBottom: number;
  insetTop: number;
  insetBottom: number;
}

export const DEFAULT_COMPOSITE_SETTINGS: CompositeSettings = {
  // cover: phone-ratio screenshots are narrower than the display, contain would letterbox them.
  fitMode: 'cover',
  backgroundColor: '#181619',
  zoom: 1,
  alignX: 0,
  alignY: 0,
  cropTop: 0,
  cropBottom: 0,
  insetTop: 0,
  insetBottom: 0,
};

interface RenderCompositeOptions {
  canvas: HTMLCanvasElement;
  screenshot: CanvasImageSource & { width: number; height: number };
  reference: HTMLImageElement;
  mask: HTMLImageElement;
  settings: CompositeSettings;
  outputSize?: number;
}

export function loadCanvasImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${source}`));
    image.src = source;
  });
}

export function renderIphoneComposite({
  canvas,
  screenshot,
  reference,
  mask,
  settings,
  outputSize = IPHONE_CANVAS.width,
}: RenderCompositeOptions): void {
  const outputScale = outputSize / IPHONE_CANVAS.width;
  const screen = {
    x: IPHONE_SCREEN.x * outputScale,
    y: IPHONE_SCREEN.y * outputScale,
    width: IPHONE_SCREEN.width * outputScale,
    height: IPHONE_SCREEN.height * outputScale,
  };
  const insetTop = screen.height * (Math.min(Math.max(settings.insetTop, 0), 20) / 100);
  const insetBottom =
    screen.height * (Math.min(Math.max(settings.insetBottom, 0), 20) / 100);
  const fittingArea = {
    x: screen.x,
    y: screen.y + insetTop,
    width: screen.width,
    height: screen.height - insetTop - insetBottom,
  };

  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create the output canvas.');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(reference, 0, 0, outputSize, outputSize);

  const uiLayer = document.createElement('canvas');
  uiLayer.width = outputSize;
  uiLayer.height = outputSize;
  const uiContext = uiLayer.getContext('2d');
  if (!uiContext) throw new Error('Could not create the UI layer.');

  uiContext.imageSmoothingEnabled = true;
  uiContext.imageSmoothingQuality = 'high';
  uiContext.fillStyle = settings.backgroundColor;
  uiContext.fillRect(screen.x, screen.y, screen.width, screen.height);

  const cropTop = Math.min(Math.max(settings.cropTop, 0), 40);
  const cropBottom = Math.min(
    Math.max(settings.cropBottom, 0),
    Math.max(0, 90 - cropTop),
  );
  const sourceY = screenshot.height * (cropTop / 100);
  const sourceHeight =
    screenshot.height * (1 - (cropTop + cropBottom) / 100);
  const sourceWidth = screenshot.width;
  const fitScale =
    settings.fitMode === 'cover'
      ? Math.max(
          fittingArea.width / sourceWidth,
          fittingArea.height / sourceHeight,
        )
      : Math.min(
          fittingArea.width / sourceWidth,
          fittingArea.height / sourceHeight,
        );
  const drawScale = fitScale * Math.min(Math.max(settings.zoom, 1), 2);
  const drawWidth = sourceWidth * drawScale;
  const drawHeight = sourceHeight * drawScale;
  const horizontalPosition = (Math.min(Math.max(settings.alignX, -100), 100) + 100) / 200;
  const verticalPosition = (Math.min(Math.max(settings.alignY, -100), 100) + 100) / 200;
  const destinationX =
    fittingArea.x + (fittingArea.width - drawWidth) * horizontalPosition;
  const destinationY =
    fittingArea.y + (fittingArea.height - drawHeight) * verticalPosition;

  uiContext.drawImage(
    screenshot,
    0,
    sourceY,
    sourceWidth,
    sourceHeight,
    destinationX,
    destinationY,
    drawWidth,
    drawHeight,
  );

  // The generated mask contains only pixels belonging to the dark display
  // surface. Everything else remains sourced from the immutable reference.
  uiContext.globalCompositeOperation = 'destination-in';
  uiContext.drawImage(mask, 0, 0, outputSize, outputSize);
  uiContext.globalCompositeOperation = 'source-over';

  context.drawImage(uiLayer, 0, 0);
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the composite as PNG.'));
    }, 'image/png');
  });
}

export function compositeFilename(filename: string): string {
  const finalDot = filename.lastIndexOf('.');
  const basename = finalDot > 0 ? filename.slice(0, finalDot) : filename;
  return `${basename}-iphone-16-pro-max.png`;
}
