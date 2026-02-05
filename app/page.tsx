'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, Trash2, Sparkles, Image as ImageIcon, Loader2 } from 'lucide-react';

interface ProcessedImage {
  id: string;
  file: File;
  originalDataUrl: string;
  processedDataUrl: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  usedAI: boolean;
}

export default function ImageToolsPage() {
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [threshold, setThreshold] = useState(220);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [aiProcessingId, setAiProcessingId] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<string>('');
  const [aiProcessingAll, setAiProcessingAll] = useState(false);
  const [aiProcessingProgress, setAiProcessingProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Process image with threshold-based whitening
  const processImage = useCallback((imageDataUrl: string, thresh: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Process each pixel
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // If all RGB values are above threshold, consider it grey background
          if (r >= thresh && g >= thresh && b >= thresh) {
            data[i] = 255;     // R
            data[i + 1] = 255; // G
            data[i + 2] = 255; // B
            // Alpha stays the same
          }
        }

        // Put processed data back
        ctx.putImageData(imageData, 0, 0);

        // Convert to data URL (JPEG for smaller size)
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageDataUrl;
    });
  }, []);

  // Handle file selection
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;

    const newImages: ProcessedImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;

      const id = `${Date.now()}-${i}`;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      // Process immediately
      try {
        const processed = await processImage(dataUrl, threshold);
        newImages.push({
          id,
          file,
          originalDataUrl: dataUrl,
          processedDataUrl: processed,
          status: 'done',
          usedAI: false,
        });
      } catch {
        newImages.push({
          id,
          file,
          originalDataUrl: dataUrl,
          processedDataUrl: null,
          status: 'error',
          usedAI: false,
        });
      }
    }

    setImages((prev) => [...prev, ...newImages]);
    if (newImages.length > 0 && !selectedImageId) {
      setSelectedImageId(newImages[0].id);
    }
  }, [threshold, processImage, selectedImageId]);

  // Handle threshold change
  const handleThresholdChange = useCallback(async (value: number[]) => {
    const newThreshold = value[0];
    setThreshold(newThreshold);

    // Re-process all images with new threshold
    const updatedImages = await Promise.all(
      images.map(async (img) => {
        if (img.originalDataUrl && !img.usedAI) {
          try {
            const processed = await processImage(img.originalDataUrl, newThreshold);
            return { ...img, processedDataUrl: processed, status: 'done' as const };
          } catch {
            return img;
          }
        }
        return img;
      })
    );
    setImages(updatedImages);
  }, [images, processImage]);

  // Convert filename to .jpg extension
  const toJpgFilename = (filename: string): string => {
    const lastDot = filename.lastIndexOf('.');
    const baseName = lastDot > 0 ? filename.substring(0, lastDot) : filename;
    return `${baseName}.jpg`;
  };

  // Download single image
  const downloadImage = (img: ProcessedImage) => {
    if (!img.processedDataUrl) return;

    const link = document.createElement('a');
    link.href = img.processedDataUrl;
    link.download = toJpgFilename(img.file.name);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download all images
  const downloadAll = async () => {
    const processedImages = images.filter((img) => img.processedDataUrl);
    if (processedImages.length === 0) return;

    if (processedImages.length === 1) {
      downloadImage(processedImages[0]);
      return;
    }

    // Multiple images - download as ZIP
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (const img of processedImages) {
      if (!img.processedDataUrl) continue;
      const response = await fetch(img.processedDataUrl);
      const blob = await response.blob();
      zip.file(toJpgFilename(img.file.name), blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `whitened_images_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Remove image
  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (selectedImageId === id) {
      const remaining = images.filter((img) => img.id !== id);
      setSelectedImageId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Clear all images
  const clearAll = () => {
    setImages([]);
    setSelectedImageId(null);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // Composite data URL (transparent PNG) onto white background
  const compositeDataUrlOnWhite = useCallback((dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Fill with white background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the transparent image on top
        ctx.drawImage(img, 0, 0);

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = () => reject(new Error('Failed to load processed image'));
      img.src = dataUrl;
    });
  }, []);

  // AI Background Removal - uses birefnet model via fal.ai API
  const handleAIAssist = async (imageId: string) => {
    const targetImage = images.find((img) => img.id === imageId);
    if (!targetImage) return;

    setAiProcessingId(imageId);
    setModelProgress('Processing with AI (birefnet)...');

    try {
      const response = await fetch('/api/image-tools/birefnet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: targetImage.originalDataUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'AI processing failed');
      }

      const data = await response.json();

      // Composite the transparent result onto white background
      const processed = await compositeDataUrlOnWhite(data.processedImageDataUrl);

      setImages((prev) =>
        prev.map((img) =>
          img.id === imageId
            ? { ...img, processedDataUrl: processed, usedAI: true }
            : img
        )
      );

      setModelProgress('');
    } catch (error) {
      console.error('AI background removal error:', error);
      const errorMessage = error instanceof Error ? error.message : 'AI processing failed';
      alert(`AI background removal failed: ${errorMessage}`);
      setModelProgress('');
    } finally {
      setAiProcessingId(null);
    }
  };

  // AI Apply to All - process all images that haven't been AI processed
  const handleAIApplyToAll = async () => {
    const imagesToProcess = images.filter((img) => !img.usedAI && img.status === 'done');
    if (imagesToProcess.length === 0) return;

    setAiProcessingAll(true);
    setAiProcessingProgress({ current: 0, total: imagesToProcess.length });

    for (let i = 0; i < imagesToProcess.length; i++) {
      const img = imagesToProcess[i];
      setAiProcessingProgress({ current: i + 1, total: imagesToProcess.length });
      setModelProgress(`Processing ${i + 1}/${imagesToProcess.length}: ${img.file.name}`);
      setAiProcessingId(img.id);

      try {
        const response = await fetch('/api/image-tools/birefnet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl: img.originalDataUrl,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          console.error(`AI processing failed for ${img.file.name}:`, error.error);
          continue;
        }

        const data = await response.json();
        const processed = await compositeDataUrlOnWhite(data.processedImageDataUrl);

        setImages((prev) =>
          prev.map((prevImg) =>
            prevImg.id === img.id
              ? { ...prevImg, processedDataUrl: processed, usedAI: true }
              : prevImg
          )
        );
      } catch (error) {
        console.error(`AI processing error for ${img.file.name}:`, error);
      }
    }

    setAiProcessingId(null);
    setAiProcessingAll(false);
    setModelProgress('');
    setAiProcessingProgress({ current: 0, total: 0 });
  };

  const selectedImage = images.find((img) => img.id === selectedImageId);
  const processedCount = images.filter((img) => img.processedDataUrl).length;
  const nonAiCount = images.filter((img) => !img.usedAI && img.status === 'done').length;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 max-w-6xl">
          <h1 className="text-xl font-bold">Image Tools</h1>
          <p className="text-sm text-gray-500">Convert grey backgrounds to pure white for product images</p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Upload & Image List */}
          <div className="space-y-4">
            {/* Upload Zone */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Upload Images</CardTitle>
                <CardDescription>
                  Drag & drop or click to upload
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    Drop images here or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    JPG, PNG, WebP supported
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </CardContent>
            </Card>

            {/* Image List */}
            {images.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      Images ({images.length})
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={clearAll}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                        selectedImageId === img.id
                          ? 'bg-blue-50 border border-blue-200'
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedImageId(img.id)}
                    >
                      <img
                        src={img.originalDataUrl}
                        alt={img.file.name}
                        className="w-12 h-12 object-cover rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {img.file.name}
                        </p>
                        <div className="flex items-center gap-2">
                          {img.status === 'done' && (
                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                              Ready
                            </Badge>
                          )}
                          {img.usedAI && (
                            <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700">
                              AI
                            </Badge>
                          )}
                          {aiProcessingId === img.id && (
                            <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700">
                              Analyzing...
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="AI Remove Background"
                        disabled={aiProcessingId !== null || img.usedAI}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAIAssist(img.id);
                        }}
                      >
                        {aiProcessingId === img.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                        ) : (
                          <Sparkles className={`h-4 w-4 ${img.usedAI ? 'text-purple-400' : 'text-gray-400 hover:text-purple-500'}`} />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(img.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-gray-400" />
                      </Button>
                    </div>
                  ))}

                  {nonAiCount > 0 && (
                    <Button
                      variant="outline"
                      className="w-full mt-4"
                      onClick={handleAIApplyToAll}
                      disabled={aiProcessingAll || aiProcessingId !== null}
                    >
                      {aiProcessingAll ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          AI Processing {aiProcessingProgress.current}/{aiProcessingProgress.total}
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          AI Apply to All ({nonAiCount})
                        </>
                      )}
                    </Button>
                  )}

                  {processedCount > 0 && (
                    <Button
                      className="w-full mt-2"
                      onClick={downloadAll}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download {processedCount === 1 ? 'Image' : `All (${processedCount})`}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Preview & Controls */}
          <div className="lg:col-span-2 space-y-4">
            {/* Controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Processing Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Threshold: {threshold}</Label>
                    <span className="text-xs text-gray-500">
                      Higher = more aggressive
                    </span>
                  </div>
                  <input
                    type="range"
                    value={threshold}
                    onChange={(e) => handleThresholdChange([parseInt(e.target.value)])}
                    min={180}
                    max={250}
                    step={1}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-xs text-gray-500">
                    Pixels with R, G, B all above {threshold} will become white
                  </p>
                </div>

                {modelProgress && (
                  <div className="text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {modelProgress}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => selectedImageId && handleAIAssist(selectedImageId)}
                    disabled={!selectedImage || aiProcessingId !== null || selectedImage?.usedAI}
                    className="flex-1"
                    title="Uses AI to precisely remove background"
                  >
                    {aiProcessingId ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    {selectedImage?.usedAI ? 'AI Applied' : 'AI Remove BG'}
                  </Button>
                  {selectedImage?.processedDataUrl && (
                    <Button
                      onClick={() => selectedImage && downloadImage(selectedImage)}
                      className="flex-1"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Preview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Preview</CardTitle>
                {selectedImage && (
                  <CardDescription>{selectedImage.file.name}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {selectedImage ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium mb-2 text-gray-600">Original</p>
                      <div className="border rounded-lg overflow-hidden bg-gray-100">
                        <img
                          src={selectedImage.originalDataUrl}
                          alt="Original"
                          className="w-full h-auto"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-2 text-gray-600">
                        Whitened {selectedImage.usedAI && '(AI)'}
                      </p>
                      <div className="border rounded-lg overflow-hidden bg-white">
                        {selectedImage.processedDataUrl ? (
                          <img
                            src={selectedImage.processedDataUrl}
                            alt="Processed"
                            className="w-full h-auto"
                          />
                        ) : (
                          <div className="h-64 flex items-center justify-center text-gray-400">
                            Processing...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-gray-400">
                    <ImageIcon className="h-12 w-12 mb-2" />
                    <p>Upload an image to get started</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </main>
  );
}
