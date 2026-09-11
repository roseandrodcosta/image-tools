'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
  ChevronLeft,
  Download,
  FileArchive,
  ImagePlus,
  Loader2,
  LockKeyhole,
  RotateCcw,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  canvasToPng,
  compositeFilename,
  DEFAULT_COMPOSITE_SETTINGS,
  type CompositeSettings,
  IPHONE_CANVAS,
  IPHONE_MASK_URL,
  IPHONE_REFERENCE_URL,
  IPHONE_SCREEN,
  loadCanvasImage,
  renderIphoneComposite,
} from '@/lib/iphone-compositor';

interface ScreenshotItem {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
}

interface ReferenceAssets {
  reference: HTMLImageElement;
  mask: HTMLImageElement;
}

const PREVIEW_SIZE = 1000;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SliderControl({
  label,
  valueLabel,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">{valueLabel}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#a9684e]"
      />
    </label>
  );
}

export function IphoneCompositor() {
  const [items, setItems] = useState<ScreenshotItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<CompositeSettings>(
    DEFAULT_COMPOSITE_SETTINGS,
  );
  const [assets, setAssets] = useState<ReferenceAssets | null>(null);
  const [assetError, setAssetError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [exportState, setExportState] = useState<{
    active: boolean;
    current: number;
    total: number;
  }>({ active: false, current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef(new Map<string, Promise<HTMLImageElement>>());
  const objectUrlsRef = useRef(new Set<string>());

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const updateSetting = useCallback(
    <Key extends keyof CompositeSettings>(
      key: Key,
      value: CompositeSettings[Key],
    ) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const getScreenshotImage = useCallback((item: ScreenshotItem) => {
    const cached = imageCacheRef.current.get(item.url);
    if (cached) return cached;
    const imagePromise = loadCanvasImage(item.url);
    imageCacheRef.current.set(item.url, imagePromise);
    return imagePromise;
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadCanvasImage(IPHONE_REFERENCE_URL),
      loadCanvasImage(IPHONE_MASK_URL),
    ])
      .then(([reference, mask]) => {
        if (cancelled) return;
        if (
          reference.naturalWidth !== IPHONE_CANVAS.width ||
          reference.naturalHeight !== IPHONE_CANVAS.height ||
          mask.naturalWidth !== IPHONE_CANVAS.width ||
          mask.naturalHeight !== IPHONE_CANVAS.height
        ) {
          throw new Error('The calibrated reference assets are not 5000×5000.');
        }
        setAssets({ reference, mask });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssetError(
            error instanceof Error
              ? error.message
              : 'Could not load the calibrated iPhone reference.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    return () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, []);

  useEffect(() => {
    if (!selectedItem || !assets || !previewCanvasRef.current) return;
    let cancelled = false;
    setIsPreviewing(true);

    getScreenshotImage(selectedItem)
      .then((screenshot) => {
        if (cancelled || !previewCanvasRef.current) return;
        renderIphoneComposite({
          canvas: previewCanvasRef.current,
          screenshot,
          reference: assets.reference,
          mask: assets.mask,
          settings,
          outputSize: PREVIEW_SIZE,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssetError(
            error instanceof Error ? error.message : 'Could not render preview.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsPreviewing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assets, getScreenshotImage, selectedItem, settings]);

  const addFiles = useCallback(
    async (incomingFiles: FileList | File[]) => {
      const files = Array.from(incomingFiles).filter((file) =>
        ACCEPTED_TYPES.has(file.type),
      );
      if (files.length === 0) return;

      const accepted: ScreenshotItem[] = [];
      for (const file of files) {
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.add(url);
        try {
          const image = await loadCanvasImage(url);
          imageCacheRef.current.set(url, Promise.resolve(image));
          accepted.push({
            id: crypto.randomUUID(),
            file,
            url,
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        } catch {
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(url);
        }
      }

      if (accepted.length === 0) return;
      setItems((current) => [...current, ...accepted]);
      setSelectedId((current) => current ?? accepted[0].id);
    },
    [],
  );

  const removeItem = useCallback(
    (item: ScreenshotItem) => {
      URL.revokeObjectURL(item.url);
      objectUrlsRef.current.delete(item.url);
      imageCacheRef.current.delete(item.url);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setSelectedId((current) => {
        if (current !== item.id) return current;
        const remaining = items.filter((entry) => entry.id !== item.id);
        return remaining[0]?.id ?? null;
      });
    },
    [items],
  );

  const renderFullResolution = useCallback(
    async (item: ScreenshotItem) => {
      if (!assets) throw new Error('The iPhone reference is still loading.');
      const screenshot = await getScreenshotImage(item);
      const canvas = document.createElement('canvas');
      renderIphoneComposite({
        canvas,
        screenshot,
        reference: assets.reference,
        mask: assets.mask,
        settings,
      });
      return canvasToPng(canvas);
    },
    [assets, getScreenshotImage, settings],
  );

  const downloadSelected = useCallback(async () => {
    if (!selectedItem || exportState.active) return;
    setExportState({ active: true, current: 1, total: 1 });
    try {
      const blob = await renderFullResolution(selectedItem);
      downloadBlob(blob, compositeFilename(selectedItem.file.name));
    } catch (error: unknown) {
      setAssetError(
        error instanceof Error ? error.message : 'Could not export the composite.',
      );
    } finally {
      setExportState({ active: false, current: 0, total: 0 });
    }
  }, [exportState.active, renderFullResolution, selectedItem]);

  const downloadAll = useCallback(async () => {
    if (items.length === 0 || exportState.active) return;
    setExportState({ active: true, current: 0, total: items.length });
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setExportState({
          active: true,
          current: index + 1,
          total: items.length,
        });
        const blob = await renderFullResolution(item);
        zip.file(compositeFilename(item.file.name), blob);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'iphone-16-pro-max-composites.zip');
    } catch (error: unknown) {
      setAssetError(
        error instanceof Error ? error.message : 'Could not export the composites.',
      );
    } finally {
      setExportState({ active: false, current: 0, total: 0 });
    }
  }, [exportState.active, items, renderFullResolution]);

  const croppedRatio = selectedItem
    ? selectedItem.width /
      (selectedItem.height *
        (1 - (settings.cropTop + settings.cropBottom) / 100))
    : 0;
  const screenRatio = IPHONE_SCREEN.width / IPHONE_SCREEN.height;
  const ratioDifference = selectedItem
    ? Math.abs(croppedRatio - screenRatio) / screenRatio
    : 0;

  return (
    <main className="min-h-screen bg-[#f4f1ee] text-slate-950">
      <header className="border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild aria-label="Back to Image Tools">
              <Link href="/">
                <ChevronLeft />
              </Link>
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2c2724] text-white shadow-sm">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-semibold tracking-tight">iPhone UI Compositor</h1>
              <p className="text-xs text-slate-500">
                Fixed hardware · calibrated screen · full-resolution export
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
              <LockKeyhole /> Hardware locked
            </Badge>
            <Badge variant="outline" className="bg-white text-slate-600">
              5000 × 5000 px
            </Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-5 py-6 lg:grid-cols-[340px_minmax(460px,1fr)_340px] lg:px-8">
        <aside className="space-y-5">
          <Card className="gap-4 border-black/5 bg-white py-5 shadow-sm">
            <CardHeader className="gap-1 px-5">
              <CardTitle className="text-base">UI screenshots</CardTitle>
              <CardDescription>PNG, JPG, or WebP · one or many</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  void addFiles(event.dataTransfer.files);
                }}
                className={`group flex w-full flex-col items-center rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors ${
                  isDragging
                    ? 'border-[#a9684e] bg-[#fbf3ef]'
                    : 'border-slate-200 bg-slate-50 hover:border-[#c58a72] hover:bg-[#fcf8f6]'
                }`}
              >
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#a9684e] shadow-sm ring-1 ring-black/5">
                  <Upload className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  Drop screenshots here
                </span>
                <span className="mt-1 text-xs text-slate-500">or click to browse</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.target.value = '';
                }}
              />

              {items.length === 0 ? (
                <div className="rounded-lg border border-slate-100 px-4 py-5 text-center text-xs leading-5 text-slate-500">
                  Each screenshot will use the same fit settings and the exact same
                  iPhone reference.
                </div>
              ) : (
                <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`flex w-full items-center gap-1 rounded-xl border p-1 transition-colors ${
                        selectedId === item.id
                          ? 'border-[#c58a72] bg-[#fcf5f1]'
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left"
                      >
                        <img
                          src={item.url}
                          alt=""
                          className="h-14 w-11 rounded-md bg-slate-100 object-cover object-top ring-1 ring-black/5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {item.file.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {item.width} × {item.height}
                          </span>
                        </span>
                        {selectedId === item.id && (
                          <Check className="h-4 w-4 text-[#a9684e]" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeItem(item);
                        }}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-900">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <LockKeyhole className="h-4 w-4" />
              Reference protection
            </div>
            <p className="text-xs leading-5 text-emerald-800">
              The mask changes only the detected display surface. Frame, corners,
              status icons, Dynamic Island, and home indicator stay original.
            </p>
          </div>
        </aside>

        <section className="min-w-0">
          <Card className="sticky top-5 gap-4 overflow-hidden border-black/5 bg-white py-5 shadow-sm">
            <CardHeader className="flex-row items-center justify-between px-5">
              <div>
                <CardTitle className="text-base">Composite preview</CardTitle>
                <CardDescription className="mt-1">
                  {selectedItem?.file.name ?? 'Upload a UI screenshot to begin'}
                </CardDescription>
              </div>
              {isPreviewing && <Loader2 className="h-4 w-4 animate-spin text-[#a9684e]" />}
            </CardHeader>
            <CardContent className="px-5">
              <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-inner">
                {selectedItem ? (
                  <canvas
                    ref={previewCanvasRef}
                    aria-label="iPhone composite preview"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="relative h-full w-full">
                    <img
                      src={IPHONE_REFERENCE_URL}
                      alt="iPhone 16 Pro Max desert titanium reference"
                      className="h-full w-full object-contain"
                    />
                    {!assets && !assetError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                        <Loader2 className="h-6 w-6 animate-spin text-[#a9684e]" />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {assetError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {assetError}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>Preview scaled to 1000 px</span>
                <span>Export always 5000 × 5000 PNG</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-5">
          <Card className="gap-4 border-black/5 bg-white py-5 shadow-sm">
            <CardHeader className="flex-row items-start justify-between px-5">
              <div>
                <CardTitle className="text-base">Fit controls</CardTitle>
                <CardDescription className="mt-1">
                  The phone never moves or resizes
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Reset controls"
                onClick={() => setSettings(DEFAULT_COMPOSITE_SETTINGS)}
              >
                <RotateCcw />
              </Button>
            </CardHeader>
            <CardContent className="space-y-5 px-5">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Fit mode</div>
                <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
                  {(['contain', 'cover'] as const).map((fitMode) => (
                    <button
                      type="button"
                      key={fitMode}
                      onClick={() => updateSetting('fitMode', fitMode)}
                      className={`rounded-md px-3 py-2 text-xs font-semibold capitalize transition-all ${
                        settings.fitMode === fitMode
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {fitMode === 'contain' ? 'Fit entire UI' : 'Fill & crop'}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {settings.fitMode === 'contain'
                    ? 'Shows the full screenshot without distortion. Empty space uses the chosen screen color.'
                    : 'Fills every screen pixel without distortion. Overflow is cropped.'}
                </p>
              </div>

              {selectedItem && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    ratioDifference < 0.025
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {ratioDifference < 0.025
                    ? 'Screenshot ratio matches the calibrated display.'
                    : 'Screenshot ratio differs from the display. Use Fit for no cropping or Fill to remove gaps.'}
                </div>
              )}

              <SliderControl
                label="Zoom"
                valueLabel={`${Math.round(settings.zoom * 100)}%`}
                value={settings.zoom * 100}
                min={100}
                max={160}
                onChange={(value) => updateSetting('zoom', value / 100)}
              />
              <SliderControl
                label="Horizontal position"
                valueLabel={settings.alignX === 0 ? 'Center' : `${settings.alignX}`}
                value={settings.alignX}
                min={-100}
                max={100}
                onChange={(value) => updateSetting('alignX', value)}
              />
              <SliderControl
                label="Vertical position"
                valueLabel={settings.alignY === 0 ? 'Center' : `${settings.alignY}`}
                value={settings.alignY}
                min={-100}
                max={100}
                onChange={(value) => updateSetting('alignY', value)}
              />

              <div className="border-t border-slate-100 pt-5">
                <div className="mb-1 text-sm font-medium text-slate-700">
                  Optional safe-area inset
                </div>
                <p className="mb-4 text-xs leading-5 text-slate-500">
                  Reserve space when UI content should begin below the baked-in iOS chrome.
                </p>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        insetTop: 0,
                        insetBottom: 0,
                        alignY: 0,
                      }))
                    }
                    className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Full display
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        fitMode: 'cover',
                        insetTop: 6,
                        insetBottom: 0,
                        alignY: -100,
                      }))
                    }
                    className="rounded-lg border border-[#dab19f] bg-[#fcf5f1] px-2 py-2 text-xs font-medium text-[#8e533c] hover:bg-[#f9ece5]"
                  >
                    Below iOS chrome
                  </button>
                </div>
                <div className="space-y-4">
                  <SliderControl
                    label="Top inset"
                    valueLabel={`${settings.insetTop}%`}
                    value={settings.insetTop}
                    min={0}
                    max={12}
                    onChange={(value) => updateSetting('insetTop', value)}
                  />
                  <SliderControl
                    label="Bottom inset"
                    valueLabel={`${settings.insetBottom}%`}
                    value={settings.insetBottom}
                    min={0}
                    max={8}
                    onChange={(value) => updateSetting('insetBottom', value)}
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <div className="mb-1 text-sm font-medium text-slate-700">
                  Remove screenshot chrome
                </div>
                <p className="mb-4 text-xs leading-5 text-slate-500">
                  Crop a status bar or browser bar already present in the uploaded image.
                </p>
                <div className="space-y-4">
                  <SliderControl
                    label="Crop top"
                    valueLabel={`${settings.cropTop}%`}
                    value={settings.cropTop}
                    min={0}
                    max={30}
                    onChange={(value) => updateSetting('cropTop', value)}
                  />
                  <SliderControl
                    label="Crop bottom"
                    valueLabel={`${settings.cropBottom}%`}
                    value={settings.cropBottom}
                    min={0}
                    max={30}
                    onChange={(value) => updateSetting('cropBottom', value)}
                  />
                </div>
              </div>

              <label className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5 text-sm font-medium text-slate-700">
                Screen fill color
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={settings.backgroundColor}
                    onChange={(event) =>
                      updateSetting('backgroundColor', event.target.value)
                    }
                    className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-1"
                  />
                  <span className="w-[66px] font-mono text-xs font-normal uppercase text-slate-500">
                    {settings.backgroundColor}
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          <Card className="gap-4 border-black/5 bg-[#2c2724] py-5 text-white shadow-sm">
            <CardHeader className="px-5">
              <CardTitle className="text-base">Export</CardTitle>
              <CardDescription className="text-stone-300">
                Lossless PNG at the reference&apos;s native size
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-5">
              <Button
                className="w-full bg-[#d08b6e] text-white hover:bg-[#bd765a]"
                disabled={!selectedItem || !assets || exportState.active}
                onClick={() => void downloadSelected()}
              >
                {exportState.active && exportState.total === 1 ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                Download selected
              </Button>
              <Button
                variant="outline"
                className="w-full border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                disabled={items.length === 0 || !assets || exportState.active}
                onClick={() => void downloadAll()}
              >
                {exportState.active && exportState.total > 1 ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FileArchive />
                )}
                {exportState.active && exportState.total > 1
                  ? `Compositing ${exportState.current}/${exportState.total}`
                  : `Download all${items.length > 1 ? ` (${items.length})` : ''}`}
              </Button>
              <p className="pt-1 text-center text-[11px] leading-4 text-stone-400">
                Batch export applies these controls consistently to every screenshot.
              </p>
            </CardContent>
          </Card>

          {items.length === 0 && (
            <Button
              variant="outline"
              className="w-full border-dashed bg-white"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus /> Add first screenshot
            </Button>
          )}
        </aside>
      </div>
    </main>
  );
}
