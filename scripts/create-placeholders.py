#!/usr/bin/env python3
"""Generate placeholder hero images for Hymns At Home."""

from PIL import Image, ImageDraw, ImageFont
import os

out_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')

# Color palettes for each hero image (warm church tones)
palettes = [
    {'bg': (44, 24, 16), 'accent': (212, 160, 86), 'label': 'Piano in Golden Light'},
    {'bg': (26, 15, 10), 'accent': (232, 168, 56), 'label': 'Church Interior'},
    {'bg': (58, 34, 24), 'accent': (232, 196, 122), 'label': 'Stained Glass Glow'},
    {'bg': (36, 20, 12), 'accent': (192, 144, 72), 'label': 'Evening Hymns'},
]

for i, p in enumerate(palettes, 1):
    img = Image.new('RGB', (1200, 600), p['bg'])
    draw = ImageDraw.Draw(img)

    # Warm gradient overlay
    for y in range(600):
        alpha = y / 600
        r = int(p['bg'][0] * (1 - alpha * 0.3) + p['accent'][0] * alpha * 0.3)
        g = int(p['bg'][1] * (1 - alpha * 0.3) + p['accent'][1] * alpha * 0.3)
        b = int(p['bg'][2] * (1 - alpha * 0.3) + p['accent'][2] * alpha * 0.3)
        draw.line([(0, y), (1200, y)], fill=(r, g, b))

    # Draw a simple piano shape
    piano_y = 350
    draw.rectangle([350, piano_y, 850, piano_y + 150], fill=(20, 12, 8), outline=p['accent'])
    # White keys
    for k in range(15):
        x = 370 + k * 30
        draw.rectangle([x, piano_y + 20, x + 26, piano_y + 130], fill=(240, 235, 220), outline=(180, 170, 150))
    # Black keys
    black_pattern = [1, 1, 0, 1, 1, 1, 0]
    for k in range(14):
        if black_pattern[k % 7]:
            x = 388 + k * 30
            draw.rectangle([x, piano_y + 20, x + 16, piano_y + 75], fill=(20, 15, 10))

    # Decorative arch (church window feel)
    draw.arc([450, 50, 750, 300], 180, 360, fill=p['accent'], width=3)
    draw.arc([460, 60, 740, 290], 180, 360, fill=p['accent'], width=2)

    # Label text
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Georgia.ttf', 36)
        small_font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Georgia.ttf', 20)
    except Exception:
        try:
            font = ImageFont.truetype('/System/Library/Fonts/Georgia.ttf', 36)
            small_font = ImageFont.truetype('/System/Library/Fonts/Georgia.ttf', 20)
        except Exception:
            font = ImageFont.load_default()
            small_font = font

    draw.text((600, 180), p['label'], fill=p['accent'], font=font, anchor='mm')
    draw.text((600, 560), f'Placeholder Hero {i}', fill=(p['accent'][0]//2, p['accent'][1]//2, p['accent'][2]//2), font=small_font, anchor='mm')

    img.save(os.path.join(out_dir, f'hero-{i}.jpg'), 'JPEG', quality=85)
    print(f'Created hero-{i}.jpg')

# Default hero.jpg (copy of hero-1)
img1 = Image.open(os.path.join(out_dir, 'hero-1.jpg'))
img1.save(os.path.join(out_dir, 'hero.jpg'), 'JPEG', quality=85)
print('Created hero.jpg (copy of hero-1)')
