"""Build the light-chrome status-bar patch for the iPhone screen compositor skill.

The locked reference photographs the phone with DARK status chrome (white glyphs on
a near-black bar). Light UIs need the inverse: black glyphs on a light bar. The bar
BACKGROUND is already replaceable (it sits inside the screen mask), so the only thing
that has to change is the protected glyph pixels. This script derives a small RGBA
patch covering just those pixels, inverted, and locks it (and the masks) into
calibration.json with SHA-256 hashes and pixel counts.

Run from image-tools/:  python scripts/build-light-chrome-patch.py
Requires: Pillow, numpy.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SKILL = Path(__file__).resolve().parent.parent / "codex-skills" / "iphone-screen-compositor"
ASSETS = SKILL / "assets"
CALIBRATION = ASSETS / "calibration.json"
STATUS_BAR_FRACTION = 0.06  # matches the compositor's below-ios-chrome inset
BLACK_LUMINANCE = 10        # Dynamic Island interior + inner black frame: never touched


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def flood(region: np.ndarray, seed: tuple[int, int]) -> np.ndarray:
    """Connected component of `region` containing seed=(x, y), via PIL flood fill."""
    # RGB mode: PIL's flood fill is a silent no-op on single-band "L" images.
    image = Image.fromarray(region.astype(np.uint8) * 255, "L").convert("RGB")
    if image.getpixel(seed) != (255, 255, 255):
        raise ValueError(f"seed {seed} is not inside the region")
    ImageDraw.floodfill(image, seed, (128, 0, 0))
    return np.array(image)[:, :, 0] == 128


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Mask plus every enclosed hole: flood the exterior from (0,0) and take the complement."""
    return ~flood(~mask, seed=(0, 0))


def main() -> None:
    calibration = json.loads(CALIBRATION.read_text())
    screen = calibration["screen"]
    reference = np.array(Image.open(ASSETS / calibration["referenceFile"]).convert("RGB")).astype(np.int32)
    screen_mask = np.array(Image.open(ASSETS / calibration["maskFile"]).convert("RGBA"))[:, :, 3] == 255
    cutout_mask = np.array(Image.open(ASSETS / calibration["cutoutMaskFile"]).convert("RGBA"))[:, :, 3] == 255

    bar_height = round(screen["height"] * STATUS_BAR_FRACTION)
    top, bottom = screen["y"], screen["y"] + bar_height
    left, right = screen["x"], screen["x"] + screen["width"]

    # Display interior = screen mask with its glyph / island holes filled. This excludes
    # the titanium bezel that intrudes into the screen bounding box at the corners.
    display = fill_holes(screen_mask)
    band = np.zeros_like(screen_mask)
    band[top:bottom, left:right] = True
    glyphs = band & display & ~screen_mask

    lum = reference.mean(axis=2)
    r, g, b = reference[:, :, 0], reference[:, :, 1], reference[:, :, 2]
    keep = (lum < BLACK_LUMINANCE) | ((g > r + 40) & (g > b + 40))  # black hardware + green privacy dot

    # Dynamic Island = the black blob at the horizontal centre of the bar. Keep its whole
    # padded box untouched so the camera lens and island edge stay photographic.
    island = flood(glyphs & (lum < BLACK_LUMINANCE), seed=(left + screen["width"] // 2, top + bar_height // 2))
    ys, xs = np.where(island)
    pad = 4
    keep[ys.min() - pad : ys.max() + pad + 1, xs.min() - pad : xs.max() + pad + 1] = True

    invert = glyphs & ~keep
    patch = np.zeros((bar_height, screen["width"], 4), dtype=np.uint8)
    sub = lambda a: a[top:bottom, left:right]  # noqa: E731
    src = sub(reference)
    patch[sub(invert), :3] = (255 - src[sub(invert)]).astype(np.uint8)
    patch[sub(keep & glyphs), :3] = src[sub(keep & glyphs)].astype(np.uint8)
    patch[sub(glyphs), 3] = 255

    patch_name = "iphone-status-chrome-light.png"
    Image.fromarray(patch, "RGBA").save(ASSETS / patch_name, optimize=True)

    cy, cx = np.where(cutout_mask)
    cutout_w, cutout_h = int(cx.max() - cx.min() + 1), int(cy.max() - cy.min() + 1)
    calibration.update(
        {
            "statusBar": {"heightFraction": STATUS_BAR_FRACTION, "height": bar_height},
            "lightChromePatchFile": patch_name,
            "lightChromePatch": {"x": left, "y": top, "width": screen["width"], "height": bar_height},
            "lightChromePatchSha256": sha256(ASSETS / patch_name),
            "lightChromePatchOpaquePixelCount": int(glyphs.sum()),
            "lightChromeProtectedPixelChangesFromReference": int(invert.sum()),
            "screenMaskSha256": sha256(ASSETS / calibration["maskFile"]),
            "cutoutMaskSha256": sha256(ASSETS / calibration["cutoutMaskFile"]),
            "cutoutBox": {"x": int(cx.min()), "y": int(cy.min()), "width": cutout_w, "height": cutout_h},
            "expectedCutoutDimensions": f"{cutout_w}x{cutout_h}",
            "replaceablePixelCount": int(screen_mask.sum()),
            "protectedPixelCount": int((~screen_mask).sum()),
            "opaqueCutoutPixelCount": int(cutout_mask.sum()),
        }
    )
    CALIBRATION.write_text(json.dumps(calibration, indent=2) + "\n")
    print(f"patch {patch.shape[1]}x{patch.shape[0]}: {int(glyphs.sum())} opaque px, {int(invert.sum())} inverted, {int((keep & glyphs).sum())} kept")
    print(f"island box x{xs.min()}-{xs.max()} y{ys.min()}-{ys.max()}")
    print("calibration updated:", CALIBRATION)


if __name__ == "__main__":
    main()
