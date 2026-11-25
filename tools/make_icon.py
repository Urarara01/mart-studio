"""Ícono de Mart Studio: mismo tile que Tapa Studio, cinco franjas (una por tinta de modo)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "assets" / "icon"
S = 2048  # se dibuja grande y se reduce para bordes limpios
k = S / 512
INKS = ["#FF2E88", "#FFE600", "#22E07A", "#A98BFF", "#FF7A00"]


def render() -> Image.Image:
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # sombra suave como la de Tapa
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([35 * k, 43 * k, 476 * k, 484 * k], radius=95 * k, fill=(0, 0, 0, 150))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(9 * k)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([35 * k, 35 * k, 476 * k, 476 * k], radius=95 * k, fill="#0B0B0C")
    # Tapa: 3 franjas de 72 px con 34 px de aire entre 113 y 397. Mart: 5 franjas en el mismo bloque.
    top, bot, gap = 104, 406, 18
    h = (bot - top - gap * 4) / 5
    for i, c in enumerate(INKS):
        y = top + i * (h + gap)
        d.rectangle([105 * k, y * k, 405 * k, (y + h) * k], fill=c)
    return im


big = render()
OUT.mkdir(parents=True, exist_ok=True)
for n in (32, 64, 128, 256, 512):
    big.resize((n, n), Image.Resampling.LANCZOS).save(OUT / f"mart-studio-{n}.png")
big.resize((1024, 1024), Image.Resampling.LANCZOS).save(OUT / "mart-studio.png")
big.resize((256, 256), Image.Resampling.LANCZOS).save(
    OUT / "mart-studio.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
