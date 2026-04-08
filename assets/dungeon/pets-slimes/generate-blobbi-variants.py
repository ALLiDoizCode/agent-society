#!/usr/bin/env python3
"""
Generate 16 Blobbi-type slime color variants from the base CC0 slime sprites.
Uses hue rotation + saturation/brightness shifts on the Stealthix animated slimes.

Source: Animated Slimes 16x16 by Stealthix (CC0)
Each sprite sheet is a 4x4 grid of 16x16 frames (4 directions × 4 animation frames).
"""

from PIL import Image
import colorsys
import os

# Base sprite to use for recoloring (blue has the most neutral saturation for hue-shifting)
BASE_MEDIUM = "Slime_Medium_Blue.png"
BASE_SMALL = "Slime_Small_Blue.png"

# Blobbi types mapped to TARGET hue (absolute, 0-360) + saturation/value multipliers
# We convert each pixel from its current hue to the target hue, preserving relative shade.
# Blue source hue is ~240 degrees.
BLOBBI_PALETTE = {
    # Water/ice
    "droppi":  (210,  1.0, 1.0),    # Blue (water) — keep blue
    # Fire/warm
    "flammi":  (15,   1.3, 1.1),    # Red-orange (fire)
    "rosey":   (340,  1.1, 1.0),    # Deep pink/rose
    "bloomi":  (320,  0.8, 1.15),   # Pink (flower)
    "starri":  (50,   1.2, 1.2),    # Yellow/gold (star)
    "catti":   (30,   0.9, 0.85),   # Warm orange-brown (cat)
    # Nature/green
    "leafy":   (120,  1.0, 0.9),    # Green (leaf)
    "froggi":  (140,  1.3, 0.75),   # Dark green (frog)
    "cacti":   (90,   0.9, 0.85),   # Yellow-green (cactus)
    "mushie":  (280,  0.9, 0.8),    # Purple (mushroom)
    # Crystal/elements
    "crysti":  (175,  0.7, 1.1),    # Teal/cyan (crystal)
    "cloudi":  (210,  0.15, 1.3),   # Very desaturated light blue (cloud)
    "breezy":  (190,  0.3, 1.2),    # Pale cyan (wind)
    # Earth/neutral
    "rocky":   (220,  0.15, 0.5),   # Dark grey (rock)
    "pandi":   (220,  0.05, 0.75),  # Light grey (panda — near b&w)
    "owli":    (35,   0.7, 0.65),   # Brown/tan (owl)
}

# Source hue for the blue slime (in 0-1 range for colorsys)
SOURCE_HUE_DEG = 210.0


def recolor_pixel(r, g, b, a, target_hue_deg, sat_mult, val_mult):
    """Recolor an RGBA pixel to a target hue, preserving relative shade and alpha."""
    if a == 0:
        return (r, g, b, a)

    # Convert to HSV
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)

    # Calculate hue offset from source blue
    source_hue = SOURCE_HUE_DEG / 360.0
    hue_offset = h - source_hue

    # Apply target hue + preserve relative offset (for shading variation)
    target_h = (target_hue_deg / 360.0 + hue_offset) % 1.0
    target_s = min(1.0, max(0.0, s * sat_mult))
    target_v = min(1.0, max(0.0, v * val_mult))

    # Convert back to RGB
    nr, ng, nb = colorsys.hsv_to_rgb(target_h, target_s, target_v)
    return (int(nr * 255), int(ng * 255), int(nb * 255), a)


def recolor_sprite(input_path, output_path, target_hue, sat_mult, val_mult):
    """Recolor an entire sprite sheet to a target hue."""
    img = Image.open(input_path).convert("RGBA")
    pixels = img.load()

    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = pixels[x, y]
            pixels[x, y] = recolor_pixel(r, g, b, a, target_hue, sat_mult, val_mult)

    img.save(output_path)


def main():
    output_dir = os.path.join(os.path.dirname(__file__), "blobbi-types")
    os.makedirs(output_dir, exist_ok=True)

    for blobbi_name, (hue_shift, sat_mult, val_mult) in BLOBBI_PALETTE.items():
        for size, base_file in [("Medium", BASE_MEDIUM), ("Small", BASE_SMALL)]:
            input_path = os.path.join(os.path.dirname(__file__), base_file)
            output_file = f"Blobbi_{size}_{blobbi_name}.png"
            output_path = os.path.join(output_dir, output_file)

            recolor_sprite(input_path, output_path, hue_shift, sat_mult, val_mult)
            print(f"  Created: {output_file}")

    print(f"\nGenerated {len(BLOBBI_PALETTE) * 2} Blobbi variant sprites in {output_dir}/")
    print("All derived from CC0 source (Animated Slimes by Stealthix)")


if __name__ == "__main__":
    main()
