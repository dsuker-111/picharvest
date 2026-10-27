from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
S = 1024
INK = (27, 23, 18, 255)
CREAM = (248, 243, 234, 255)
ORANGE = (239, 91, 51, 255)
ORANGE_DEEP = (201, 65, 29, 255)
LIME = (220, 235, 157, 255)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# App tile
rounded(d, (0, 0, S - 1, S - 1), 224, fill=INK)

# Back photo card, slightly rotated
back = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(back)
rounded(bd, (154, 148, 700, 650), 74, fill=(255, 255, 255, 34), outline=(248, 243, 234, 70), width=10)
back = back.rotate(-9, resample=Image.Resampling.BICUBIC, center=(430, 400))
img.alpha_composite(back)

# Front photo card
card = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cd = ImageDraw.Draw(card)
rounded(cd, (188, 164, 790, 654), 82, fill=CREAM)
# Image cutout
rounded(cd, (240, 216, 738, 548), 44, fill=(232, 223, 207, 255))
# Sun
cd.ellipse((290, 264, 390, 364), fill=ORANGE)
# Mountains (clipped inside the cutout)
mountain = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mountain)
md.polygon([(212, 572), (392, 380), (520, 500), (608, 412), (766, 572)], fill=255)
clip = Image.new("L", (S, S), 0)
ImageDraw.Draw(clip).rounded_rectangle((240, 216, 738, 548), radius=44, fill=255)
mask = Image.composite(mountain, Image.new("L", (S, S), 0), clip)
cd.bitmap((0, 0), mask, fill=(27, 23, 18, 255))
# Small highlight bar
rounded(cd, (270, 578, 444, 598), 10, fill=(27, 23, 18, 58))
card = card.rotate(4, resample=Image.Resampling.BICUBIC, center=(500, 420))
img.alpha_composite(card)

# Download badge
d = ImageDraw.Draw(img)
d.ellipse((604, 588, 924, 908), fill=ORANGE, outline=INK, width=14)
# Arrow
d.rounded_rectangle((746, 652, 782, 770), radius=18, fill=CREAM)
d.polygon([(680, 748), (848, 748), (764, 848)], fill=CREAM)
# Baseline tray
d.rounded_rectangle((684, 820, 844, 850), radius=15, fill=CREAM)

# Tiny spark
d.ellipse((128, 746, 168, 786), fill=LIME)

img.save(OUT / "icon1024.png", optimize=True)
for size in (128, 48, 32, 16):
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(OUT / f"icon{size}.png", optimize=True)
print("icons written:", ", ".join(p.name for p in sorted(OUT.glob("*.png"))))
