# =====================================================================
#  Draws the app icon: a white paw print on the app's gold
# =====================================================================
#  Writes the PNG files the home-screen install uses into icons/.
#  Plain Python, nothing to install. Run it again only if the icon
#  should change:
#
#    python3 tools/make-icons.py
# =====================================================================

import math
import os
import struct
import zlib

GOLD = (168, 105, 15)      # the app's accent color (--accent)
WHITE = (255, 255, 255)

# The paw, on a 0-1 square: (center x, center y, half-width, half-height, tilt in degrees)
PAW = [
    (0.50, 0.63, 0.185, 0.150, 0),     # main pad
    (0.27, 0.43, 0.075, 0.098, -24),   # outer toes
    (0.73, 0.43, 0.075, 0.098, 24),
    (0.405, 0.28, 0.078, 0.102, -9),   # inner toes
    (0.595, 0.28, 0.078, 0.102, 9),
]


def inside(x, y, shapes):
    """How far inside the nearest shape (x, y) is: below 1 means inside."""
    best = 99.0
    for cx, cy, rx, ry, tilt in shapes:
        a = math.radians(tilt)
        dx, dy = x - cx, y - cy
        u = dx * math.cos(a) + dy * math.sin(a)
        v = -dx * math.sin(a) + dy * math.cos(a)
        best = min(best, (u / rx) ** 2 + (v / ry) ** 2)
    return best


def draw(size, paw_scale=1.0):
    # Shrink the paw toward the middle (for the "maskable" icon, which
    # phones may crop to a circle).
    shapes = [(0.5 + (cx - 0.5) * paw_scale, 0.5 + (cy - 0.5) * paw_scale,
               rx * paw_scale, ry * paw_scale, t) for cx, cy, rx, ry, t in PAW]
    rows = []
    n = 4  # smoothing: 4 x 4 samples per pixel near edges
    for py in range(size):
        row = bytearray([0])  # each PNG row starts with a filter byte
        for px in range(size):
            d = inside((px + 0.5) / size, (py + 0.5) / size, shapes)
            if d < 0.7:
                cover = 1.0
            elif d > 1.4:
                cover = 0.0
            else:
                hits = sum(inside((px + (i + 0.5) / n) / size, (py + (j + 0.5) / n) / size, shapes) <= 1
                           for i in range(n) for j in range(n))
                cover = hits / (n * n)
            row += bytes(round(g + (w - g) * cover) for g, w in zip(GOLD, WHITE))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))   # 8-bit RGB
    png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'icons')
os.makedirs(out, exist_ok=True)
for name, size, scale in [
    ('icon-512.png', 512, 1.0),
    ('icon-192.png', 192, 1.0),
    ('apple-touch-icon.png', 180, 0.92),   # iPhone home screen
    ('icon-maskable-512.png', 512, 0.72),  # Android, may be cropped to a circle
    ('favicon-32.png', 32, 1.0),
]:
    write_png(os.path.join(out, name), size, draw(size, scale))
    print('wrote icons/' + name)
