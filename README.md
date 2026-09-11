This is a [Next.js](https://nextjs.org) image-processing workspace.

## iPhone UI compositor

Open `/iphone-compositor` to place one or more UI screenshots into the calibrated iPhone 16 Pro Max desert titanium reference.

The default handoff for carousel work is a tightly trimmed transparent PNG phone cut-out. Generate or retain a full 5000×5000 canvas only when it is explicitly needed as a master or for QA.

- The reference canvas always remains 5000×5000 pixels.
- A generated display mask allows only the original dark screen surface to change.
- The titanium hardware, continuous corners, status bar, Dynamic Island, and home indicator remain sourced from the reference.
- `Fill & crop` (default) fills the screen edge to edge and crops overflow; `Fit entire UI` preserves the complete screenshot and letterboxes it. Phone-ratio screenshots are narrower than the display's fitting area, so `Fit` leaves a strip each side in the screen fill colour; keep that colour matched to the UI edge or use `Fill`. The portable skill (1.1.3+) replicates the screenshot edge into that strip automatically.
- Single images export as lossless PNG; multiple images export together as a ZIP.

Rebuild the protection mask after intentionally replacing or recalibrating the hardware image:

```bash
npm run build:iphone-reference
```

Verify fixed dimensions and zero changes outside the display mask:

```bash
npm run verify:iphone-compositor
```

An optional screenshot and output path may be supplied directly:

```bash
node scripts/verify-iphone-compositor.mjs path/to/ui.png path/to/output.png
```

Append `--below-ios-chrome` to exercise the matching safe-area preset.

Generate the complete Odontyn carousel phone batch from underlying UI screens,
without reading the old phone-render folders:

```bash
npm run batch:carousel-iphones -- "path/to/Odontyn Carousels v3 - final slides"
```

The batch writes both immutable 5000×5000 composites and trimmed transparent
cut-outs organized by carousel, language, and target slide number.

Verify every generated file, including a pixel comparison of all protected
hardware/chrome against the reference:

```bash
npm run verify:carousel-iphones
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
