# Dungeon Crawl Assets

Asset packs for the TOON Pet Dungeon Crawl system (Epic 11, Sprint 5).

**Decision source:** Party Mode 2026-04-08 (D11-PM-009)

## Asset Packs

### Primary Packs

| Pack | Source | License | Contents |
|------|--------|---------|----------|
| **0x72 Dungeon Tileset II v1.7** | [itch.io](https://0x72.itch.io/dungeontileset-ii) | CC0 | 16x16 dungeon tiles, 12+ animated monsters, 4 animated heroes, items, effects |
| **Ninja Adventure** | [itch.io](https://pixel-boy.itch.io/ninja-adventure-asset-pack) | CC0 | 100+ animated monsters, 200+ environment tiles, items, UI, sound, music |

### Extensions (0x72 Community)

| Pack | Source | License | Contents |
|------|--------|---------|----------|
| **Extended Pack v1.1** (nijikokun) | [itch.io](https://nijikokun.itch.io/dungeontileset-ii-extended) | CC0 | Additional tiles and items |
| **Autotile Remix** (safwyl) | [itch.io](https://safwyl.itch.io/16x16-dungeon-autotile-remix) | CC0 | Wall and floor autotiles for procedural generation |
| **Dark Dungeon** (kosinaz) | [itch.io](https://kosinaz.itch.io/16x16-dark-dungeon-tileset) | CC0 | Dark palette dungeon theme variant |
| **Stairs** (keymaster777) | [itch.io](https://keymaster777.itch.io/0x72-dungeon-tileset-2-stairs-extension) | CC0 | Stair sprites for multi-floor dungeons |

### Community Extras

| File | Description |
|------|-------------|
| `pumpkin_dude.png` | Pumpkin character sprite |
| `doc.png` | Documentation/reference image |

### Pet/Blobbi Sprites

| Pack | Source | License | Contents |
|------|--------|---------|----------|
| **Animated Slimes** (Stealthix) | [itch.io](https://stealthix.itch.io/animated-slimes) | CC0 | 16x16 slime sprites in 5 colors (blue, green, red, white, orange) + orange extension |

**Generated Blobbi Variants:** `pets-slimes/blobbi-types/` contains 32 palette-swapped sprites (16 Blobbi types × Medium + Small) generated from the CC0 base using `generate-blobbi-variants.py`. Regenerate with `python3 generate-blobbi-variants.py`.

| Blobbi Type | Color | Base |
|-------------|-------|------|
| droppi (water) | Blue | Original |
| flammi (fire) | Red-orange | Recolored |
| leafy (leaf) | Green | Recolored |
| froggi (frog) | Dark green | Recolored |
| cacti (cactus) | Yellow-green | Recolored |
| starri (star) | Yellow-gold | Recolored |
| crysti (crystal) | Teal/cyan | Recolored |
| mushie (mushroom) | Purple | Recolored |
| bloomi (flower) | Magenta-pink | Recolored |
| rosey (rose) | Hot pink | Recolored |
| cloudi (cloud) | Pale blue | Recolored |
| breezy (wind) | Pale cyan | Recolored |
| rocky (rock) | Dark grey | Recolored |
| pandi (panda) | Light grey | Recolored |
| owli (owl) | Brown | Recolored |
| catti (cat) | Warm orange-brown | Recolored |

## Directory Structure

```
assets/dungeon/
  0x72-base/           # Base tileset (v1.7) — monsters, heroes, tiles, items
  0x72-extended/       # Extended pack (v1.1) — additional tiles and items
  0x72-autotile-remix/ # Autotile wall/floor variants for procedural gen
  0x72-dark-dungeon/   # Dark palette theme variant
  0x72-stairs/         # Stair sprites
  ninja-adventure/     # Massive CC0 pack — monsters, tiles, items, audio
  pets-slimes/         # Blobbi pet sprites (Animated Slimes base + 16 generated variants)
    blobbi-types/      # Generated: 32 Blobbi variant sprites (16 types × 2 sizes)
    generate-blobbi-variants.py  # Regeneration script
  community/           # Miscellaneous community contributions
```

## Usage

These assets are for the client-side dungeon viewer (future Ditto integration).
The DVM backend (Stories 11-15 through 11-17) is headless and does not use sprites.

All assets are CC0 (public domain) — no attribution required, no licensing restrictions.
Third-party dungeon DVM providers can freely use these assets.
