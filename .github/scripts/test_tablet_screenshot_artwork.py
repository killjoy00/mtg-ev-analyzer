"""Cheap preflight before spending CI resources on APK builds and emulators."""
import unittest
import xml.etree.ElementTree as ET
from io import BytesIO

from PIL import Image, ImageDraw

from tablet_screenshot_artwork import artwork_ready


def fixture(*, art=True, clipped=False, missing=False):
    image = Image.new("RGB", (500, 400), "#eeeeee")
    if art:
        draw = ImageDraw.Draw(image)
        for start in (10, 250):
            for y in range(10, 290, 20):
                draw.rectangle((start, y, start + 199, y + 9), fill="#002a82")
    root = ET.Element("hierarchy")
    for name, start in (("Hero in Training", 10), ("Web Up", 250)):
        if missing and name == "Web Up":
            continue
        ET.SubElement(root, "node", {
            "class": "android.widget.ImageView",
            "content-desc": name,
            "bounds": f"[{start},10][{start+200},{150 if clipped else 290}]",
        })
    data = BytesIO()
    image.save(data, format="PNG")
    return root, data.getvalue()


class ArtworkTest(unittest.TestCase):
    names = ("Hero in Training", "Web Up")

    def test_complete_art_passes(self):
        self.assertTrue(artwork_ready(*fixture(), self.names))

    def test_blank_art_fails(self):
        self.assertFalse(artwork_ready(*fixture(art=False), self.names))

    def test_clipped_art_fails(self):
        self.assertFalse(artwork_ready(*fixture(clipped=True), self.names))

    def test_missing_art_fails(self):
        self.assertFalse(artwork_ready(*fixture(missing=True), self.names))


if __name__ == "__main__":
    unittest.main()
