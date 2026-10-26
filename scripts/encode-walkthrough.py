"""Encode sampled UI captures as a 60-second walkthrough; requires Pillow."""
import json
from pathlib import Path
import sys
from PIL import Image

source, output = Path(sys.argv[1]), Path(sys.argv[2])
paths = sorted(source.glob("frame-*.png"))
if len(paths) != 12:
    raise SystemExit("Expected exactly 12 captured UI states")
frames = []
for path in paths:
    with Image.open(path) as image:
        size = (1000, round(image.height * 1000 / image.width))
        frames.append(image.resize(size, Image.Resampling.LANCZOS).convert("P", palette=Image.Palette.ADAPTIVE, colors=96))
frames[0].save(output, save_all=True, append_images=frames[1:], duration=[5000] * len(frames), loop=0, optimize=True, disposal=2)
print(json.dumps({"frames": len(frames), "durationMs": 60000, "width": frames[0].width, "height": frames[0].height}))
