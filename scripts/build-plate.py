"""
Turn a Paytm Bazaar render into the plate the app draws on.

The renders come with the interface painted into their pixels — the back/exit
pill, the centred branding, the environment controls and the map controls. The
app draws all of those as real elements in the same places, so they are
inpainted out here and the plate is left as pure environment. Nothing over the
city or the street itself is touched.

    python3 scripts/build-plate.py <render.png> <output-name>

    python3 scripts/build-plate.py ~/render-city.png   city-plate
    python3 scripts/build-plate.py ~/render-street.png bazaar-plate

Output: public/bazaar/<output-name>.webp
"""
from pathlib import Path
import sys

import cv2
import numpy as np

# Painted interface, as fractions of the render so it holds at any size.
# (x0, y0, x1, y1), measured against the 1672x941 renders.
BOXES = [
    (26, 14, 270, 92),       # back / exit pill
    (686, 4, 1002, 102),     # centred branding
    (1052, 14, 1666, 94),    # time / day / weather / events
    (1576, 696, 1658, 798),  # zoom + / -
    (1574, 798, 1660, 882),  # compass
]
REFERENCE_W, REFERENCE_H = 1672, 941


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)

    src, name = sys.argv[1], sys.argv[2]
    out_dir = Path(__file__).resolve().parent.parent / "public" / "bazaar"

    bgr = cv2.imread(src, cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"could not read {src}")
    height, width = bgr.shape[:2]

    scale_x, scale_y = width / REFERENCE_W, height / REFERENCE_H
    mask = np.zeros((height, width), np.uint8)
    for x0, y0, x1, y1 in BOXES:
        mask[int(y0 * scale_y):int(y1 * scale_y), int(x0 * scale_x):int(x1 * scale_x)] = 1

    # The chrome sits on sky or on soft background, where diffusion is invisible.
    plate = cv2.inpaint(bgr, mask, 6, cv2.INPAINT_NS)

    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{name}.webp"
    cv2.imwrite(str(target), plate, [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(f"wrote {target}  ({width}x{height})")


if __name__ == "__main__":
    main()
