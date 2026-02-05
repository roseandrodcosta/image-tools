import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

const FAL_KEY = process.env.FAL_KEY;

// Configure fal client
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

export async function POST(request: NextRequest) {
  try {
    if (!FAL_KEY) {
      return NextResponse.json(
        { error: 'FAL_KEY not configured. Add FAL_KEY to your environment variables.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { imageDataUrl } = body;

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

    // Call fal.ai birefnet API
    const result = await fal.subscribe('fal-ai/birefnet', {
      input: {
        image_url: imageDataUrl,
        model: 'General Use (Heavy)', // Most accurate model
        operating_resolution: '1024x1024',
        refine_foreground: true,
        output_format: 'png',
      },
    });

    // Get the output image URL
    const outputImageUrl = result.data?.image?.url;

    if (!outputImageUrl) {
      return NextResponse.json(
        { error: 'No output image received from birefnet' },
        { status: 500 }
      );
    }

    // Fetch the image and convert to base64
    const imageResponse = await fetch(outputImageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch processed image' },
        { status: 500 }
      );
    }

    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageArrayBuffer).toString('base64');

    return NextResponse.json({
      success: true,
      processedImageDataUrl: `data:image/png;base64,${base64}`,
    });
  } catch (error) {
    console.error('Birefnet API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Birefnet processing failed';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
