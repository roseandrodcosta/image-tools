import { NextRequest, NextResponse } from 'next/server';

// Default local rembg server URL (run with: docker run -p 7000:7000 danielgatis/rembg s)
const REMBG_SERVER_URL = process.env.REMBG_SERVER_URL || 'http://localhost:7000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageDataUrl, model = 'birefnet-general' } = body;

    if (!imageDataUrl) {
      return NextResponse.json(
        { error: 'Image data URL is required' },
        { status: 400 }
      );
    }

    // Validate image data URL format
    if (!imageDataUrl.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'Invalid image data URL format' },
        { status: 400 }
      );
    }

    // Extract base64 data and convert to buffer
    const base64Data = imageDataUrl.split(',')[1];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Create form data for rembg server
    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('file', imageBlob, 'image.png');

    // Call local rembg server with birefnet model
    const response = await fetch(`${REMBG_SERVER_URL}/api/remove?model=${model}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 502 || response.status === 503) {
        return NextResponse.json(
          {
            error: 'Rembg server not available. Start it with: docker run -p 7000:7000 danielgatis/rembg s',
            serverUnavailable: true
          },
          { status: 503 }
        );
      }
      const errorText = await response.text();
      console.error('Rembg error:', errorText);
      return NextResponse.json(
        { error: `Rembg processing failed: ${errorText}` },
        { status: 500 }
      );
    }

    // Get the processed image as blob
    const processedImageBlob = await response.blob();
    const arrayBuffer = await processedImageBlob.arrayBuffer();
    const processedBase64 = Buffer.from(arrayBuffer).toString('base64');

    return NextResponse.json({
      success: true,
      processedImageDataUrl: `data:image/png;base64,${processedBase64}`,
      model,
    });
  } catch (error) {
    console.error('Rembg API error:', error);

    // Check if it's a connection error (server not running)
    if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
      return NextResponse.json(
        {
          error: 'Rembg server not running. Start it with: docker run -p 7000:7000 danielgatis/rembg s',
          serverUnavailable: true
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to process image with rembg' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  try {
    const response = await fetch(`${REMBG_SERVER_URL}/api`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });

    if (response.ok) {
      return NextResponse.json({
        available: true,
        serverUrl: REMBG_SERVER_URL,
        models: [
          'birefnet-general',
          'birefnet-general-lite',
          'birefnet-portrait',
          'u2net',
          'u2netp',
          'isnet-general-use',
          'bria-rmbg'
        ]
      });
    }
    return NextResponse.json({ available: false });
  } catch {
    return NextResponse.json({ available: false });
  }
}
