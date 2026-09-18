"""
One-off preprocessing of the Paytm Bazaar reference render into web assets.

The source render has the portal, the "Our Team" and "Our Idea" labels painted
into the pixels. Those all become real HTML in the app, so they are inpainted
out here. Also extracts a cloud-only layer (with alpha) so the landing page can
parallax the clouds away from the city during the Enter transition.

Outputs (public/bazaar/): sky-plate.webp, clouds.webp

    python3 scripts/build-bazaar-assets.py [path/to/render.png]
"""
from pathlib import Path
import sys

from PIL import Image, ImageFilter
import numpy as np

# The source render lives outside the repository; pass a path to override.
DEFAULT_SRC = "../ChatGPT Image Sep 17, 2026, 10_02_55 PM.png"

SRC = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
OUT = Path(__file__).resolve().parent.parent / "public" / "bazaar"

rng = np.random.default_rng(7)
im = Image.open(SRC).convert("RGB")
W, H = im.size
img = np.asarray(im).astype(np.float32) / 255.0
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def blur(arr, radius):
    """Gaussian blur a float array in [0,1], any channel count."""
    mode = "RGB" if arr.ndim == 3 else "L"
    u8 = (np.clip(arr, 0, 1) * 255).astype(np.uint8)
    out = Image.fromarray(u8, mode=mode).filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(out).astype(np.float32) / 255.0


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def noise(shape, radius, seed_scale=1.0):
    n = rng.random(shape).astype(np.float32)
    n = blur(n, radius)
    n -= n.min()
    n /= max(n.max(), 1e-6)
    return 0.5 + (n - 0.5) * seed_scale


# --------------------------------------------------------------- regions to fix
PORTAL_CX, PORTAL_CY, PORTAL_R = 857.0, 462.0, 238.0
dist = np.hypot(xx - PORTAL_CX, yy - PORTAL_CY)
portal_soft = np.clip((PORTAL_R - dist) / 30.0, 0.0, 1.0)


def box_soft(x0, y0, x1, y1, feather=14.0):
    d = np.minimum(np.minimum(xx - x0, x1 - xx), np.minimum(yy - y0, y1 - yy))
    return np.clip(d / feather, 0.0, 1.0)


team_soft = box_soft(18, 686, 268, 856)
idea_soft = box_soft(1432, 684, 1608, 836)

soft = np.maximum(np.maximum(portal_soft, team_soft), idea_soft)
hard = soft > 0.0

# ------------------------------------------------------------------- diffusion
# Repeatedly blur, then restore the known pixels. The unknown region fills in as
# a smooth continuation of its surroundings, which clouds tolerate very well.
work = img.copy()
work[hard] = blur(img, 60)[hard]
for radius, iterations in ((22, 90), (8, 30), (3, 12)):
    for _ in range(iterations):
        work = np.where(hard[..., None], blur(work, radius), img)

filled = img * (1 - soft[..., None]) + work * soft[..., None]

# ------------------------------------------------- lay a real cloud bank on top
# Diffusion alone leaves the large portal area flat and grey. Composite genuine
# cloud texture (cloned from a cloud-only corner of the same render, so the
# lighting matches) with a noise-warped edge so it reads as drifting cloud
# rather than a pasted circle.
SIDE = 760
src = im.crop((1150, 715, 1450, 935))  # verified cloud-only patch
a = np.asarray(src.resize((SIDE, SIDE), Image.LANCZOS)).astype(np.float32) / 255.0
b = np.asarray(
    src.transpose(Image.FLIP_LEFT_RIGHT).resize((SIDE, SIDE), Image.LANCZOS)
).astype(np.float32) / 255.0
c = np.asarray(
    src.transpose(Image.FLIP_TOP_BOTTOM).resize((int(SIDE * 1.6),) * 2, Image.LANCZOS)
).astype(np.float32)[80:80 + SIDE, 140:140 + SIDE] / 255.0

patch = np.clip(a * 0.5 + b * 0.28 + c * 0.22, 0, 1)
# restore local contrast lost to the averaging
patch = np.clip(blur(patch, 30) + (patch - blur(patch, 30)) * 1.55, 0, 1)

px0, py0 = int(PORTAL_CX - SIDE // 2), int(PORTAL_CY - SIDE // 2)
region = filled[py0:py0 + SIDE, px0:px0 + SIDE]
sub_dist = dist[py0:py0 + SIDE, px0:px0 + SIDE]

# Nudge the clone's luminance toward the local scene without killing its colour.
lum_local = blur(region, 50).mean(axis=2, keepdims=True)
patch = np.clip(patch + (lum_local - patch.mean()) * 0.40, 0, 1)

# Wispy, irregular boundary. Three octaves of noise plus a directional bias
# push the fill out into the real cloud banks on the lower left and hold it back
# on the right, where the city is: without that it dissolves as a tidy circle,
# which the eye reads as pasted on.
sub_y, sub_x = np.mgrid[0:SIDE, 0:SIDE].astype(np.float32)
theta = np.arctan2(sub_y - SIDE / 2, sub_x - SIDE / 2)
bias = 74.0 * np.cos(theta - np.deg2rad(152.0))

warp = (
    (noise((SIDE, SIDE), 52) - 0.5) * 250.0
    + (noise((SIDE, SIDE), 18) - 0.5) * 96.0
    + (noise((SIDE, SIDE), 6) - 0.5) * 30.0
)
warped = sub_dist - bias + warp
alpha_tex = 1.0 - smoothstep(198.0, 372.0, warped)
# never uncover the diffused disc itself
alpha_tex = np.maximum(alpha_tex, 1.0 - smoothstep(214.0, 250.0, sub_dist))
alpha_tex *= 0.70 + 0.30 * noise((SIDE, SIDE), 22)
alpha_tex = np.clip(blur(alpha_tex, 5) * 1.12, 0, 1)[..., None] * 0.96

filled[py0:py0 + SIDE, px0:px0 + SIDE] = region * (1 - alpha_tex) + patch * alpha_tex

plate = np.clip(filled, 0, 1)
plate_img = Image.fromarray((plate * 255).astype(np.uint8))

# ------------------------------------------------------- cloud extraction layer
mx, mn = plate.max(axis=2), plate.min(axis=2)
sat = np.where(mx > 1e-5, (mx - mn) / np.maximum(mx, 1e-5), 0.0)

bright = smoothstep(0.74, 0.94, mx)
flat = 1.0 - smoothstep(0.10, 0.34, sat)

# Clouds are smooth; the city is dense high-contrast detail.
gray = plate.mean(axis=2)
detail = np.abs(gray - blur(gray, 3))
detail = blur(np.clip(detail * 6, 0, 1), 9)
smooth = 1.0 - smoothstep(0.10, 0.42, detail)

alpha = np.clip(blur(bright * flat * smooth, 4) * 1.35, 0, 1)
# The balloon is bright and smooth enough to register as cloud. It must stay put
# in the plate, so keep it out of the layer that parallaxes away.
alpha *= 1.0 - box_soft(1436, -60, 1672, 302, feather=34.0)
# The filled portal area reads as cloud too. Leaving it in would stack a second
# copy of it on top of the plate, so cut it out of the parallax layers.
alpha *= np.clip((dist - 196.0) / 74.0, 0.0, 1.0)
clouds = np.dstack([plate * 255, alpha * 255]).astype(np.uint8)
clouds_img = Image.fromarray(clouds, mode="RGBA")

OUT.mkdir(parents=True, exist_ok=True)
plate_img.save(OUT / "sky-plate.webp", quality=88, method=6)
clouds_img.save(OUT / "clouds.webp", quality=84, method=6)
print(f"wrote {OUT}/sky-plate.webp and {OUT}/clouds.webp")
