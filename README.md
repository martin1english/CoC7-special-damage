# CoC7 Special Damage

A [FoundryVTT](https://foundryvtt.com/) module for the [Call of Cthulhu 7th Edition](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT) system that enables weapons to deal damage to **characteristics**, **Magic Points**, or **Sanity** instead of Hit Points.

Perfect for mythos artifacts, psychic attacks, cursed weapons, poison effects, or any scenario where damage targets something other than HP.

## Features

- **Stat-targeted damage** -- Configure any weapon to drain STR, CON, DEX, SIZ, APP, INT, POW, EDU, MP, or SAN instead of HP
- **Temporary or permanent drain** -- Characteristic damage can be temporary (via Active Effects that can be removed to restore the stat) or permanent (directly modifies the base value)
- **Automatic attack mode** -- Skip the attack roll entirely and go straight to damage -- useful for traps, environmental hazards, or guaranteed-hit effects
- **Armor bypass** -- Special damage ignores physical armor since it targets stats, not HP
- **MP overflow** -- When MP damage exceeds current MP, the overflow is applied as HP damage per the rulebook
- **SAN integration** -- SAN drain uses the system's built-in `setSan()` method, which automatically handles insanity triggers (temporary insanity at 5+ loss, indefinite insanity at daily limit)
- **Zero-stat consequences** -- When any characteristic reaches 0, the actor is set to the "dead" condition with evocative flavor text describing their demise
- **Chat card integration** -- Damage cards display "Drains: [STAT]" and "Automatic" badges, hide irrelevant armor controls, and show the correct un-armored damage values
- **Full compatibility** -- Works with melee weapons, ranged weapons, the character sheet, macros, and CoC7Links

## Requirements

| Dependency | Version |
|---|---|
| FoundryVTT | v12 -- v13 |
| CoC7 System | 7.13+ |
| lib-wrapper | Recommended (not required) |

[lib-wrapper](https://foundryvtt.com/packages/lib-wrapper) provides clean method wrapping with conflict detection. The module falls back to manual monkey-patching if lib-wrapper is not installed, but lib-wrapper is strongly recommended for compatibility with other modules.

## Installation

### Manual Install

1. In Foundry, go to **Add-on Modules** > **Install Module**
2. Paste the following manifest URL:
   ```
   https://github.com/<owner>/coc7-special-damage/releases/latest/download/module.json
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
5. For characteristics (STR--EDU), choose whether the drain is **Permanent** or temporary:
   - **Permanent** directly modifies the characteristic's base value
   - **Temporary** (unchecked) creates an Active Effect -- removing the effect restores the stat
   - MP and SAN always use direct reduction
6. Optionally check **Automatic** to skip the attack roll entirely

### Making an Attack

**Normal mode** (Automatic unchecked):
- Attack as usual from the character sheet, a macro, or a CoC7Link
- The initiator card and damage card work normally
- When damage is dealt, it is redirected to the configured stat instead of HP
- Armor is bypassed automatically

**Automatic mode** (Automatic checked):
1. Target one or more tokens on the canvas
2. Click the weapon name on the character sheet (or trigger via macro)
3. The attack roll is skipped entirely
4. A damage card is created for each target with the damage automatically rolled and applied

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

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
