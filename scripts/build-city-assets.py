"""
Turn the Paytm Bazaar city render into the web assets the /city screen needs.

The render has interface painted into its pixels — the exit pill, the header,
the environment controls, the map controls, and the six glowing Bazaar rings.
All of that becomes real HTML/SVG in the app, so it is inpainted out here and
the plate is left as pure environment.

While removing the rings the script also measures them, and prints the six
outlines as normalised coordinates ready to paste into data/bazaars.ts, so the
SVG boundaries land exactly where the render put them.

    python3 scripts/build-city-assets.py [path/to/render.png] [--labels]

    --labels       the render also carries the name/category pin cards; remove them.
    --no-rings     this render has no painted Bazaar rings at all: skip the
                   detection entirely and leave the city untouched.
    --keep-rings   leave the painted Bazaar rings on the plate. By default they
                   are removed and the app redraws them as smooth SVG, which
                   can glow and respond to the pointer.

Output: public/bazaar/city-plate.webp
"""
from pathlib import Path
import sys

import cv2
import numpy as np
from scipy import ndimage

DEFAULT_SRC = "../ChatGPT Image Sep 18, 2026, 04_52_10 AM.png"

# Each ring is searched inside its own window. Globally the warm city floods the
# orange band and the fainter rings lose to their own pin icons; inside a window
# there is only one thing of that colour.
# Saturation/value floors are per ring: the orange band overlaps sunlit roofs
# and warm ground, so that one has to insist on an actual glow, while the
# fainter rings would vanish under the same demand.
# (name, id, hue centre 0-179, tolerance, sat floor, val floor, window)
RINGS = [
    ("Koramangala", "koramangala", 19, 10, 150, 185, (150, 290, 690, 500)),
    ("Indiranagar", "indiranagar", 163, 14, 95, 120, (640, 245, 1090, 425)),
    ("Marathahalli", "marathahalli", 68, 16, 95, 130, (1015, 375, 1490, 565)),
    ("HSR Layout", "hsr-layout", 138, 14, 85, 120, (545, 435, 1055, 690)),
    ("Jayanagar", "jayanagar", 104, 9, 95, 130, (45, 495, 525, 715)),
    ("Electronic City", "electronic-city", 96, 8, 95, 130, (925, 545, 1440, 790)),
]

# Painted interface, in source pixels: (x0, y0, x1, y1, method).
# "clone" copies matching city texture in; "fill" diffuses. Sky and anything
# sitting beside a landmark uses "fill", because cloning there would duplicate
# something recognisable (the BENGALURU rock, for one).
UI_BOXES = [
    (26, 14, 270, 92, "fill"),       # exit pill
    (686, 4, 1002, 102, "fill"),     # centred branding
    (1052, 14, 1666, 94, "fill"),    # time / day / weather / events
    (1576, 696, 1658, 798, "fill"),  # zoom + / -
    (1574, 798, 1660, 882, "fill"),  # compass
]

# Only on the variant that paints the Bazaar names onto the map. Each card sits
# above its ring with a stem running down to it.
LABEL_BOXES = [
    (278, 214, 544, 322, "clone"), (318, 300, 378, 358, "clone"),
    (814, 158, 1070, 266, "clone"), (852, 244, 912, 302, "clone"),
    (1224, 298, 1480, 408, "clone"), (1262, 386, 1322, 438, "clone"),
    (670, 406, 916, 516, "clone"), (702, 494, 762, 548, "clone"),
    (180, 438, 400, 548, "clone"), (216, 526, 274, 572, "clone"),
    (1084, 498, 1336, 610, "clone"), (1120, 588, 1180, 638, "clone"),
    (1482, 296, 1622, 336, "fill"),   # "Bellandur Lake", over water
]


def patch_fill(img: np.ndarray, boxes, blocked: np.ndarray) -> np.ndarray:
    """
    Fill each box by cloning the best-matching patch from nearby city.

    Diffusion inpainting smears dense content like rooftops and tree canopy
    into mush. Instead, for every box we search the neighbourhood for a patch
    whose surrounding band best matches the band around the hole, then blend
    that patch in. It reads as city rather than as a blurred rectangle.
    """
    out = img.copy()
    height, width = img.shape[:2]
    band = 10

    def ring(source, x, y, bw, bh):
        return np.concatenate([
            source[y - band:y, x:x + bw].reshape(-1, 3),
            source[y + bh:y + bh + band, x:x + bw].reshape(-1, 3),
            source[y:y + bh, x - band:x].reshape(-1, 3),
            source[y:y + bh, x + bw:x + bw + band].reshape(-1, 3),
        ]).astype(np.float32)

    for x0, y0, x1, y1 in boxes:
        bw, bh = x1 - x0, y1 - y0
        if bw < 4 or bh < 4:
            continue
        if x0 - band < 0 or y0 - band < 0 or x1 + band >= width or y1 + band >= height:
            continue

        target = ring(img, x0, y0, bw, bh)
        best, best_cost = None, None

        for dy in range(-120, 121, 8):
            for dx in range(-420, 421, 8):
                # must not overlap the hole, or any other painted interface
                if abs(dx) < bw * 0.55 and abs(dy) < bh * 0.55:
                    continue
                x, y = x0 + dx, y0 + dy
                if x - band < 0 or y - band < 0 or x + bw + band >= width or y + bh + band >= height:
                    continue
                if blocked[y:y + bh, x:x + bw].any():
                    continue

                # Lighting and perspective change fastest with depth, so a
                # patch from far up the frame (distant hills) is penalised even
                # when its border happens to match.
                cost = float(np.mean((target - ring(img, x, y, bw, bh)) ** 2))
                cost *= 1.0 + abs(dy) / 70.0
                if best_cost is None or cost < best_cost:
                    best, best_cost = (x, y), cost

        if best is None:
            continue

        x, y = best
        patch = img[y:y + bh, x:x + bw].astype(np.float32)
        # Shift the clone onto the local exposure so no rectangle shows through.
        patch = np.clip(
            patch + (target.mean(axis=0) - ring(img, x, y, bw, bh).mean(axis=0)), 0, 255
        )

        feather = np.ones((bh, bw), np.float32)
        edge = max(3, min(bw, bh) // 10)
        ramp = np.linspace(0, 1, edge, dtype=np.float32)
        feather[:edge, :] *= ramp[:, None]
        feather[-edge:, :] *= ramp[::-1, None]
        feather[:, :edge] *= ramp[None, :]
        feather[:, -edge:] *= ramp[None, ::-1]
        feather = feather[..., None]

        out[y0:y1, x0:x1] = (
            patch * feather + out[y0:y1, x0:x1].astype(np.float32) * (1 - feather)
        ).astype(np.uint8)

    return out


def outline(mask: np.ndarray, name: str) -> np.ndarray:
    """Four corners of the ring, ordered TL, TR, BR, BL."""
    if not mask.any():
        raise ValueError(f"no ring pixels for {name}")

    cleaned = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if not cleaned.any():
        cleaned = mask

    points = np.column_stack(np.nonzero(cleaned)[::-1]).astype(np.float32)
    corners = cv2.boxPoints(cv2.minAreaRect(points)).astype(np.float64)

    centre = corners.mean(axis=0)
    angles = np.arctan2(corners[:, 1] - centre[1], corners[:, 0] - centre[0])
    corners = corners[np.argsort(angles)]
    return np.roll(corners, -int(np.argmin(corners.sum(axis=1))), axis=0)


def main() -> None:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = positional[0] if positional else DEFAULT_SRC
    out_dir = Path(__file__).resolve().parent.parent / "public" / "bazaar"

    bgr = cv2.imread(src, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"could not read {src}")
    height, width = bgr.shape[:2]

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    hue = hsv[..., 0].astype(np.int16)
    sat, val = hsv[..., 1], hsv[..., 2]

    keep_rings = True if "--no-rings" in sys.argv else "--keep-rings" in sys.argv
    rings = [] if "--no-rings" in sys.argv else RINGS
    boxes = UI_BOXES + (LABEL_BOXES if "--labels" in sys.argv else [])

    # The painted interface shares these hues (the logo is blue, the pins are
    # the ring colours), so keep it out of the detector's way entirely.
    chrome = np.zeros((height, width), bool)
    for x0, y0, x1, y1, _ in boxes:
        chrome[max(0, y0):min(height, y1), max(0, x0):min(width, x1)] = True

    erase = np.zeros((height, width), np.uint8)
    outlines = []

    for name, ident, centre, tol, smin, vmin, (wx0, wy0, wx1, wy1) in rings:
        window = np.zeros((height, width), bool)
        window[wy0:wy1, wx0:wx1] = True

        delta = np.abs(((hue - centre + 90) % 180) - 90)
        ring = ((delta <= tol) & (sat >= smin) & (val >= vmin) & window & ~chrome).astype(np.uint8)
        ring = cv2.morphologyEx(ring, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

        try:
            outlines.append((name, ident, outline(ring, name)))
        except ValueError as error:
            print(f"!! {error}", file=sys.stderr)

        if not keep_rings:
            # Erase the drawn line only. A wide band has to invent too much
            # and mushes the streets; the soft halo that survives is hidden
            # under the SVG ring the app draws back on top.
            erase |= cv2.dilate(ring, np.ones((3, 3), np.uint8), iterations=2)

    # Sky-backed interface inpaints cleanly; the rest is dense city, where a
    # cloned patch beats a diffused blur.
    clone_boxes = [b[:4] for b in boxes if b[4] == "clone"]
    fill_boxes = [b[:4] for b in boxes if b[4] == "fill"]

    blocked = np.zeros((height, width), bool)
    for x0, y0, x1, y1, _ in boxes:
        blocked[max(0, y0):min(height, y1), max(0, x0):min(width, x1)] = True

    plate = patch_fill(bgr, clone_boxes, blocked)

    for x0, y0, x1, y1 in fill_boxes:
        erase[max(0, y0):min(height, y1), max(0, x0):min(width, x1)] = 1
    if erase.any():
        plate = cv2.inpaint(plate, erase, 4, cv2.INPAINT_TELEA)

    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "city-plate.webp"
    cv2.imwrite(str(target), plate, [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(f"wrote {target}  ({width}x{height})\n")

    print("// outlines for data/bazaars.ts")
    for name, ident, corners in outlines:
        points = ", ".join(f"[{x / width:.4f}, {y / height:.4f}]" for x, y in corners)
        print(f'    // {name}\n    "{ident}": [{points}],')


if __name__ == "__main__":
    main()
