#!/usr/bin/env python3
"""Generate Clack's PWA icons (PNG) into web/public/icons/, reusing the same
ember-cursor art as the macOS .icns. Run once; the PNGs are committed as static
assets so colleagues don't need Pillow. Usage: make-web-icons.py
"""
import importlib.util
import os

from PIL import Image

# make-icon.py has a hyphen (not importable by name) — load it by path.
_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("clack_icon", os.path.join(_here, "make-icon.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
render = _mod.render


def main() -> None:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(repo, "web", "public", "icons")
    os.makedirs(out, exist_ok=True)
    master = render()
    for size in (180, 192, 512):
        master.resize((size, size), Image.LANCZOS).save(os.path.join(out, f"icon-{size}.png"))
    print(f"wrote PWA icons -> {out}")


if __name__ == "__main__":
    main()
