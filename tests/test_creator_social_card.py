import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/generate-creator-social-card.py"
BLUE = (0x1E, 0x4D, 0x7A)
PAGE = (0xF7, 0xF8, 0xFA)
CUBE = (0x97, 0x68, 0x22)
LATEST = (0x93, 0x4B, 0x42)
INK = (0x10, 0x18, 0x20)


class CreatorSocialCardTests(unittest.TestCase):
    def render(self, root: Path, slug: str, *, creator: str, headline: str, score: int, environment: str, source_type: str, source_day: str = ""):
        og = root / f"{slug}-og.png"
        square = root / f"{slug}-square.png"
        subprocess.run(
            [
                sys.executable,
                str(GENERATOR),
                "--output",
                str(og),
                "--square-output",
                str(square),
                "--creator",
                creator,
                "--headline",
                headline,
                "--score",
                str(score),
                "--environment",
                environment,
                "--source-type",
                source_type,
                "--source-day",
                source_day,
            ],
            cwd=ROOT,
            check=True,
        )
        return og, square

    def test_renderer_uses_only_pack_one_brand_assets(self):
        source = GENERATOR.read_text(encoding="utf-8")
        for stale in ("/usr/share/fonts", "DejaVuSans", "LiberationSans"):
            self.assertNotIn(stale, source)
        for relative in (
            "mobile/assets/images/header-mark.png",
            "assets/fonts/barlow-condensed-600.woff2",
            "assets/fonts/barlow-condensed-700.woff2",
            "assets/fonts/source-sans-3-400.woff2",
            "assets/fonts/source-sans-3-600.woff2",
            "assets/fonts/source-sans-3-700.woff2",
        ):
            self.assertIn(relative, source)
            self.assertTrue((ROOT / relative).is_file(), relative)
        self.assertIn('daily-home-game\\[data-environment="powered-cube"', source)
        self.assertIn('css_color(visual, "--page")', source)

    def test_representative_cards_render_exact_formats_and_environment_accents(self):
        cases = (
            ("draft-practice", "Sam", "Can you beat Sam?", 87, "mixed", "practice", "", BLUE),
            ("powered-cube", "Killjoy00", "Bet you can't beat this one!", 96, "powered-cube", "practice", "", CUBE),
            ("latest-daily", "Daily Creator", "Can you beat Daily Creator?", 91, "latest", "daily", "2026-09-11", LATEST),
            (
                "long-name",
                "Alexandria Montgomery-Wellington the Third",
                "Can you beat Alexandria Montgomery-Wellington the Third on the same eight draft decisions?",
                83,
                "mixed",
                "practice",
                "",
                BLUE,
            ),
        )
        fixture_dir = os.environ.get("PACK1_CREATOR_FIXTURE_DIR")
        temp = None
        if fixture_dir:
            root = Path(fixture_dir)
            root.mkdir(parents=True, exist_ok=True)
        else:
            temp = tempfile.TemporaryDirectory(prefix="packone-creator-social-tests-")
            root = Path(temp.name)
        try:
            for slug, creator, headline, score, environment, source_type, source_day, accent in cases:
                with self.subTest(slug=slug):
                    og, square = self.render(
                        root,
                        slug,
                        creator=creator,
                        headline=headline,
                        score=score,
                        environment=environment,
                        source_type=source_type,
                        source_day=source_day,
                    )
                    with Image.open(og) as image:
                        self.assertEqual(image.size, (1200, 630))
                        self.assertEqual(image.mode, "RGB")
                        self.assertEqual(image.getpixel((0, 0)), BLUE)
                        self.assertEqual(image.getpixel((0, 10)), PAGE)
                        self.assertEqual(image.getpixel((515, 400)), accent)
                        if slug == "long-name":
                            self.assertNotIn(INK, image.crop((72, 332, 1128, 350)).getdata())
                    with Image.open(square) as image:
                        self.assertEqual(image.size, (1080, 1080))
                        self.assertEqual(image.mode, "RGB")
                        self.assertEqual(image.getpixel((0, 0)), BLUE)
                        self.assertEqual(image.getpixel((0, 10)), PAGE)
                        self.assertEqual(image.getpixel((520, 600)), accent)
        finally:
            if temp is not None:
                temp.cleanup()

    def test_checked_in_creator_social_assets_match_registry_state(self):
        registry = json.loads((ROOT / "creator-challenges.json").read_text(encoding="utf-8"))
        for entry in registry:
            with self.subTest(slug=entry["slug"], status=entry.get("status")):
                subprocess.run(
                    [sys.executable, str(ROOT / "scripts/check-creator-social-card.py"), "--slug", entry["slug"]],
                    cwd=ROOT,
                    check=True,
                )

    def test_maximum_valid_headline_stays_clear_of_scorecard_dividers(self):
        with tempfile.TemporaryDirectory(prefix="packone-creator-social-max-") as tmp:
            headline=("Can you beat " + "W" * 148)[:160]
            og, square = self.render(
                Path(tmp),
                "max-headline",
                creator="A" * 80,
                headline=headline,
                score=100,
                environment="mixed",
                source_type="practice",
            )
            with Image.open(og) as image:
                self.assertNotIn(INK, image.crop((72, 332, 1128, 350)).getdata())
            with Image.open(square) as image:
                self.assertNotIn(INK, image.crop((70, 476, 1010, 500)).getdata())


if __name__ == "__main__":
    unittest.main()
