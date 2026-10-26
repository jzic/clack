#!/usr/bin/env python3
"""Generate Clack's app icon as a .iconset directory (feed to `iconutil -c icns`).

On-brand with the UI: dark rounded square, a muted terminal prompt chevron, and
the ember block cursor. Usage: make-icon.py <output.iconset dir>
"""
import os
import sys

from PIL import Image, ImageDraw

S = 1024
BG_TOP = (20, 23, 29)      # --bg-raised
BG_BOTTOM = (11, 13, 16)   # --bg
BORDER = (42, 48, 56)      # --border-bright
EMBER = (232, 105, 90)     # --ember
MUTED = (120, 128, 140)


def render() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # vertical gradient body
    grad = Image.new("RGB", (1, S))
    for y in range(S):
        t = y / (S - 1)
        grad.putpixel(
            (0, y),
            tuple(int(a * (1 - t) + b * t) for a, b in zip(BG_TOP, BG_BOTTOM)),
        )
    grad = grad.resize((S, S))

    # rounded-square mask (macOS "squircle"-ish corner radius)
    radius = int(0.2237 * S)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle([5, 5, S - 6, S - 6], radius=radius - 4, outline=BORDER, width=7)

    # terminal prompt chevron  ❯  (two thick rounded strokes)
    w = 54
    apex = (508, 512)
    top_end = (372, 402)
    bot_end = (372, 622)
    d.line([top_end, apex], fill=MUTED, width=w)
    d.line([apex, bot_end], fill=MUTED, width=w)
    for px, py in (top_end, apex, bot_end):  # round the caps + joint
        d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=MUTED)

    # ember block cursor
    cx, cy, cw, ch = 566, 404, 98, 216
    d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=20, fill=EMBER)
    return img


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: make-icon.py <output.iconset dir>")
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    master = render()
    # the exact set `iconutil` expects
    for size in (16, 32, 128, 256, 512):
        master.resize((size, size), Image.LANCZOS).save(os.path.join(out, f"icon_{size}x{size}.png"))
        master.resize((size * 2, size * 2), Image.LANCZOS).save(
            os.path.join(out, f"icon_{size}x{size}@2x.png")
        )
    print(f"wrote iconset -> {out}")


if __name__ == "__main__":
    main()
