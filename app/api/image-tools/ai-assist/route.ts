import { NextRequest, NextResponse } from 'next/server';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_PROMPT = `You are an image background analyzer for e-commerce product images. Your task is to identify the EXACT background color and determine the best approach to convert it to white.

## Analysis Task
1. Look at the product image carefully
2. Identify the EXACT background color (sample from corners/edges away from the product)
3. Identify if the product itself contains similar colors to the background
4. Determine the best whitening approach

## Response Format
Return a JSON object with these EXACT fields:
{
  "backgroundColor": "#XXXXXX",
  "backgroundRGB": {"r": 0-255, "g": 0-255, "b": 0-255},
  "productHasSimilarColor": true/false,
  "approach": "threshold" | "colorMatch",
  "suggestedThreshold": 180-250,
  "colorTolerance": 5-30,
  "confidence": "high" | "medium" | "low",
  "notes": "explanation"
}

## Approach Guidelines
- Use "threshold" for simple cases where product is clearly different from background
- Use "colorMatch" when product has similar grey/white tones as background
  - In colorMatch mode, we replace pixels that are VERY close to the exact backgroundColor
  - Set colorTolerance low (5-15) to only replace the exact background color, not the product

## Examples
- White shirt on light grey background: threshold=230, approach="threshold"
- Grey pants on grey background: approach="colorMatch", backgroundColor="#F0F0F0", colorTolerance=10
- Dark product on light background: threshold=200, approach="threshold"

Return ONLY the JSON object, no explanation or markdown.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageDataUrl } = body;

    if (!imageDataUrl) {
      return NextResponse.json(
        { error: 'Image data URL is required' },
        { status: 400 }
      );
    }

    if (!OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: 'OpenRouter API key not configured. Add OPENROUTER_API_KEY to your environment variables.' },
        { status: 500 }
      );
    }

    // Validate image data URL format
    if (!imageDataUrl.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'Invalid image data URL format' },
        { status: 400 }
      );
    }

    // Call OpenRouter with Gemini Flash 2.0 for vision analysis
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://image-tools.vercel.app',
        'X-Title': 'Image Tools - Background Analyzer',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: SYSTEM_PROMPT + '\n\nAnalyze this product image. Identify the exact background color and whether the product has similar colors. Suggest the best approach to whiten the background without affecting the product.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter error:', errorText);
      let errorMessage = 'AI analysis failed';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '{}';

    // Clean up the response if it has markdown
    content = content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\n?/, '');
      content = content.replace(/\n?```$/, '');
    }

    try {
      const analysis = JSON.parse(content);
      return NextResponse.json({
        ...analysis,
        approach: analysis.approach || 'threshold',
        suggestedThreshold: analysis.suggestedThreshold || 220,
        colorTolerance: analysis.colorTolerance || 15,
        backgroundRGB: analysis.backgroundRGB || { r: 240, g: 240, b: 240 },
      });
    } catch {
      console.error('Failed to parse AI response:', content);
      return NextResponse.json({
        backgroundColor: '#F0F0F0',
        backgroundRGB: { r: 240, g: 240, b: 240 },
        productHasSimilarColor: false,
        approach: 'threshold',
        suggestedThreshold: 220,
        colorTolerance: 15,
        confidence: 'low',
        notes: 'AI response parsing failed, using default settings',
      });
    }
  } catch (error) {
    console.error('AI assist error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze image' },
      { status: 500 }
    );
  }
}
