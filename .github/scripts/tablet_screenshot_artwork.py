"""Validate card artwork from actual Android screenshot pixels and UI bounds."""
import re
from io import BytesIO

from PIL import Image, ImageStat


def artwork_ready(root, data, names):
    """Reject missing, clipped or blank card art, using real UI ImageView bounds."""
    image = Image.open(BytesIO(data)).convert("RGB")
    for name in names:
        found = False
        for node in root.iter("node"):
            if node.get("class") != "android.widget.ImageView":
                continue
            if name not in (node.get("text"), node.get("content-desc")):
                continue
            box = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
            if len(box) != 4:
                continue
            x1, y1, x2, y2 = box
            width, height = x2 - x1, y2 - y1
            # Native card aspectRatio is 0.716. Allow minor rounding/clipping,
            # but not the substantially truncated cards seen in previous runs.
            if not (width >= 120 and width * 1.30 <= height <= width * 1.48):
                continue
            if not (0 <= x1 < x2 <= image.width and 0 <= y1 < y2 <= image.height):
                continue
            dx, dy = int(width * .15), int(height * .15)
            center = image.crop((x1 + dx, y1 + dy, x2 - dx, y2 - dy))
            if max(ImageStat.Stat(center).stddev) > 18:
                found = True
                break
        if not found:
            return False
    return True
