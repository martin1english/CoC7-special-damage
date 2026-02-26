# CoC7 Special Damage

A [FoundryVTT](https://foundryvtt.com/) module for the [Call of Cthulhu 7th Edition](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT) system that enables Weapon Items to deal damage to **Characteristics (STATS), **Magic Points**, or **Sanity** **instead of **Hit Points.**

Intended for those tricky follow-on damages that Mythos Creatures inflict. Byakhee Blood Drain, Migo Shrinking Ray, Disfiguring Eldritch Blast. This module lets you roll an attack or apply an automatic damage roll from normal combat card in the chat.

## Features

- **Stat-targeted damage** -- Configure any weapon to drain STR, CON, DEX, SIZ, APP, INT, POW, EDU, MP, or SAN instead of HP
- **Temporary or permanent drain** -- Characteristic damage can be temporary (via Active Effects that can be removed to restore the stat) or permanent (directly modifies the base value)
- **Automatic attack mode** -- Skip the attack roll entirely and go straight to damage -- useful for traps, environmental hazards, or guaranteed-hit effects
- **Armor bypass** -- Special damage ignores physical armor since it targets stats, not HP
- **MP overflow** -- When MP damage exceeds current MP, the overflow is applied as HP damage as per the rulebook
- **SAN integration** -- SAN drain uses the system's built-in `setSan()` method, which automatically handles insanity triggers (temporary insanity at 5+ loss, indefinite insanity at daily limit)
- **Zero-stat consequences** -- When any characteristic reaches 0, the actor is set to the "dead" condition with evocative flavor text describing their demise.
- **Full compatibility** -- Works with melee weapons, ranged weapons, the character sheet, macros, and CoC7Links

## Requirements

| Dependency  | Version                    |
| ----------- | -------------------------- |
| FoundryVTT  | v12 -- v13                 |
| CoC7 System | 7.13+                      |
| lib-wrapper | Recommended (not required) |

[lib-wrapper](https://foundryvtt.com/packages/lib-wrapper) provides clean method wrapping with conflict detection. The module falls back to manual monkey-patching if lib-wrapper is not installed, but lib-wrapper is strongly recommended for compatibility with other modules.

## Installation

### Manual Install

1. In Foundry, go to **Add-on Modules** > **Install Module**
2. Paste the following manifest URL:
   ```
   https://github.com/martin1english/CoC7-special-damage/releases/latest/download/module.json
   ```
3. Click **Install**

### From Files

1. Download or clone this repository
2. Place the `coc7-special-damage` folder in your Foundry `Data/modules/` directory
3. Restart Foundry and enable the module in your world

## Usage

### Configuring a Weapon

1. Open any weapon item sheet (GM only)
2. Below the weapon properties, you'll see a new **Special Damage** section
3. Check **Special Damage** to enable it
4. Choose the **Target** stat from the dropdown (STR, CON, DEX, SIZ, APP, INT, POW, EDU, MP, or SAN)
5. Damage For characteristics (STR--EDU):
   - **(Unchecked) = Temporary** the default mode creates an Active Effect on the character sheet effects page -- removing this effect restores the stat.
   - **(Checked ) = Permanent** directly modifies the characteristic's base value -- (Note this can only be reversed manually)
6. Damage for MP and SAN 
   - Special damage always inflicts Permanant reductions -- use the character sheet functions to restore.
6. **Automatic** toggling this will skip the attack roll entirely. Damage will be rolled immediately.

### Making an Attack

- Target one or more tokens on the canvas
- Attack as usual from the weapon section of the character sheet.
- Default weapons will roll to hit using the normal combat card rules and then substitute a special damage card.
- Automatic weapons will skip directly to damage rolls.  

### Reading the Damage Card

Damage cards for special damage weapons display:

- A red **"Drains: [STAT]"** badge showing the target stat
- A green **"Automatic"** badge if automatic mode is active
- An **"Armor bypassed"** note
- The raw damage value (not reduced by armor)

### Chat Messages

When special damage is applied, the module posts a summary to chat:

> *Investigator loses 3 STR (9 remaining)*

When a stat reaches 0, evocative flavor text describes the consequence:

> *Investigator's body fails entirely, muscles wasted beyond function. It is as if they are dead.*

## Limitations

- **Shotgun weapons** are incompatible with special damage (the checkbox is disabled for shotguns)
- The module is **GM-only** for configuration -- players cannot see or modify the Special Damage settings on weapon sheets
- Automatic mode requires at least one target to be selected on the canvas

## Technical Details

The module works by wrapping three methods in the CoC7 system using lib-wrapper (or manual monkey-patching):

1. **`DamageCard.prototype.dealDamage`** -- Intercepts the modern damage card path and redirects damage to the configured stat
2. **`Actor.prototype.dealDamage`** -- Intercepts the legacy melee/ranged combat path where `actor.dealDamage()` is called directly
3. **`Actor.prototype.weaponCheck`** -- Implements automatic mode for macros and CoC7Links

Additionally, a capturing-phase click listener on actor sheets intercepts weapon clicks for automatic mode (since the CoC7 character sheet creates initiator cards directly without calling `weaponCheck()`).

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
