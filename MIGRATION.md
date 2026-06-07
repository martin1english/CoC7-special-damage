# CoC7 Special Damage — Foundry v13 / CoC7 v8 Migration Brief

**Status:** COMPLETE (v0.2.0). All integration points migrated to Foundry v13 /
CoC7 v8 — see §8 for the as-built summary and the one known limitation. The
investigation in §2–§5 turned up that v8 rewrote the whole chat-card
architecture (not just hook renames); §8 records how each piece was actually
solved.

**Target environment:** FoundryVTT **13.350**, CoC7 system **8.6**.
The module was written against Foundry v12 + CoC7 7.x, where sheets were
ApplicationV1. CoC7 v8 migrated all actor and item sheets to **ApplicationV2**,
which is the root cause of every break below.

---

## 1. What the module is supposed to do (behaviour spec)

Lets a GM configure any **weapon** Item to deal its damage to a **characteristic
(STR, CON, DEX, SIZ, APP, INT, POW, EDU), Magic Points, or Sanity** instead of
Hit Points — for Mythos effects (blood drain, shrinking ray, eldritch blast).

Per-weapon config (stored in item flag `coc7-special-damage.config`,
shape in [`scripts/config.mjs`](scripts/config.mjs) `DEFAULT_CONFIG`):

- **enabled** — special damage on/off.
- **target** — one of the 10 stats above.
- **permanent** — characteristics only: unchecked = temporary (Active Effect that
  can be removed to restore), checked = modifies base value. MP/SAN are always
  permanent (use system restore functions).
- **automatic** — skip the attack roll, go straight to a damage card (traps,
  guaranteed hits).

Resolution rules:

- **Armor is bypassed** — special damage uses the raw roll total, not the
  armor-reduced value.
- **MP overflow** — MP damage beyond current MP spills to HP (rulebook).
- **SAN** — routed through the system's `setSan()` so insanity triggers fire.
- **Zero characteristic** → actor set to `dead` condition with flavour text
  (`CSD.ZeroStat.*` in `lang/en.json`).
- **Shotgun** weapons are incompatible — config is force-disabled.
- Config UI is **GM-only**; appears below the weapon properties row.
- Damage cards show **Drains: [STAT]** / **Automatic** / **Armor bypassed**
  badges and the raw (un-armored) damage value.

The user-facing behaviour is correct and should NOT change in this migration —
this is a pure platform-compatibility pass.

---

## 2. Root cause

CoC7 v8 sheets are ApplicationV2 (`HandlebarsApplicationMixin(ItemSheetV2)` /
`...(ActorSheetV2)`). Consequences:

- The legacy **`renderItemSheet` / `renderActorSheet` hooks do not fire** for V2
  sheets. V2 fires `render<LeafClassName>` instead.
- Hook callbacks receive an **`HTMLElement`**, not jQuery. (The code already
  guards with `html instanceof HTMLElement ? $(html) : html`, and jQuery is still
  bundled in v13, so this part is fine.)
- **`renderChatMessage` is deprecated** in v13 → use **`renderChatMessageHTML`**.
- Some template/CSS class names changed (e.g. weapon properties container is now
  `.toggle-attributes`, was `.skill-attributes`).
- `renderTemplate` / `loadTemplates` globals are deprecated (still work) → prefer
  `foundry.applications.handlebars.*`.

### Confirmed CoC7 v8 class names (from `systems/CoC7/system.js`)

| Concern | V2 class (leaf) | Notes |
|---|---|---|
| Weapon item sheet | `CoC7ModelsItemWeaponSheet` | extends `CoC7ModelsItemGlobalSheet` → `ItemSheetV2` |
| Character (full) sheet | `CoC7ModelsActorCharacterSheetV3` | the sheet Kaleidoskop uses |
| Character (older/alt) | `CoC7ModelsActorCharacterSheetV2`, `…SummarizedV2/V3` | |
| NPC / Creature | `CoC7ModelsActorNPCSheetV2`, `CoC7ModelsActorCreatureSheetV2` | attackers are often these |
| Base actor sheet | `CoC7ModelsActorGlobalSheet` | all actor sheets extend this |

---

## 3. Integration points — status table

| # | Where | Old trigger | New target | Status |
|---|---|---|---|---|
| 1 | Weapon config UI | `renderItemSheet` | `renderCoC7ModelsItemWeaponSheet` | **FIXED** §4 |
| 2 | Config inject anchor | `.skill-attributes[data-set="properties"]` | `[data-set="properties"]` | **FIXED** §4 |
| 3 | Actor-sheet auto-mode interceptor | `renderActorSheet` | per actor-sheet class, or wrap base `_onRender` | TODO §5 |
| 4 | Damage-card badges + auto-success | `renderChatMessage` | `renderChatMessageHTML` | TODO §5 |
| 5 | Chat-log click listener | `renderChatLog` (+ `#chat-log`) | verify ChatLog V2 + container selector | TODO §5 |
| 6 | DamageCard / Actor wrappers | libWrapper targets | re-validate names/signatures | TODO §5 |
| 7 | Deprecated handlebars globals | `renderTemplate`/`loadTemplates` | `foundry.applications.handlebars.*` | TODO §5 |

---

## 4. Already fixed (this session)

- [`scripts/main.mjs`](scripts/main.mjs): added `renderCoC7ModelsItemWeaponSheet`
  hook alongside the legacy `renderItemSheet` (kept as a v12 fallback;
  `onRenderItemSheet` guards on `item.type === 'weapon'`).
- [`scripts/sheet-injection.mjs`](scripts/sheet-injection.mjs): injection anchor
  changed from `.skill-attributes[data-set="properties"]` to
  `[data-set="properties"]` (matches the V2 `.toggle-attributes` container by its
  stable `data-set` attribute).

Result: the **Special Damage config UI appears on weapon sheets again** —
**verified** in the Kaleidoskop world (Foundry 13.350 / CoC7 8.6) on 2026-06-06.
The damage *logic* below is still on V1 hooks and will not fire yet.

---

## 5. Remaining work (file by file)

### `scripts/main.mjs` — hooks
- **Actor-sheet interceptor** (currently `renderActorSheet`): will not fire.
  Options, best first:
  1. Wrap `CoC7ModelsActorGlobalSheet.prototype._onRender` via libWrapper and run
     `registerSheetInterceptor` there — covers character/NPC/creature in one place.
     Resolve the class from `CONFIG.Actor.sheetClasses` at `ready`.
  2. Or register `render<Class>` for each relevant actor-sheet class (V3, V2,
     NPC, Creature). More hooks, more brittle.
- **Chat message** (currently `renderChatMessage`): switch to
  `renderChatMessageHTML`. Confirm callback signature `(message, html, …)` where
  `html` is an `HTMLElement`. Both `autoSetInitiatorSuccess` and
  `injectDamageCardBadge` already handle HTMLElement.
- **Chat log** (currently `renderChatLog`): verify the hook still fires in v13
  (ChatLog is now `foundry.applications.sidebar.tabs.ChatLog`) and that the
  `#chat-log` container selector in `registerChatListener` still resolves; the
  inner element id/class may have changed.

### `scripts/sheet-injection.mjs` — DOM selectors for the interceptor
- `registerSheetInterceptor` listens for clicks on `.weapon-name.rollable` and
  walks to `li[data-item-id]`. **Verify these selectors against the V3 combat
  tab** (`systems/CoC7/templates/actors/investigator-v3/tabs/combat.hbs`); the
  weapon row markup likely changed.
- `buildActorKeyFromSheet` uses `app.token` / `app.actor` — confirm these still
  exist on ActorSheetV2 (V2 exposes `this.document`; `app.actor` getter usually
  present — verify).

### `scripts/damage-interceptor.mjs` — libWrapper targets
Re-validate each target still exists with the same signature (the `ready`-hook
guards already `console.warn` when a target is missing — check the console after
load to see which registered):
- `game.CoC7.cards.DamageCard.prototype.dealDamage` — confirm `game.CoC7.cards.DamageCard` and that `this.weapon` / `this.targetActor` / `this.roll` still hold.
- `CONFIG.Actor.documentClass.prototype.dealDamage` — confirm CoC7 actor still defines `dealDamage(amount, options)`.
- `CONFIG.Actor.documentClass.prototype.weaponCheck` — confirm signature `(weaponData, fastForward)`.
- `createAutomaticDamageCards`: confirm `new game.CoC7.cards.DamageCard({fastForward})` and `card.actorKey/itemId/ignoreArmor/targetKey/updateChatCard()` API.

### `scripts/special-damage-logic.mjs` + `active-effect-helper.mjs` — lower risk
Document data APIs (`actor.update`, Active Effects, `setSan()`) are largely stable
v12→v13. Re-verify: the `STAT_PATHS` still match the v8 data model; `setSan()`
signature; Active Effect creation (`createEmbeddedDocuments('ActiveEffect', …)`)
and the AE `changes` key paths.

### `scripts/main.mjs` — deprecated globals
- `loadTemplates([...])` → `foundry.applications.handlebars.loadTemplates`.
- In `sheet-injection.mjs`, `renderTemplate(...)` →
  `foundry.applications.handlebars.renderTemplate`.

### `module.json`
- Bump `compatibility.verified` to `13`. Consider raising the CoC7 relationship
  `minimum` to the v8 line, and noting that v8 is required (V2 sheets).

---

## 6. Manual test checklist (acceptance criteria)

Run as GM in the Kaleidoskop world (CoC7 8.6 / Foundry 13.350):

- [x] Weapon sheet shows the Special Damage section below properties *(appears,
      verified 2026-06-06)*; still confirm toggles persist across close/reopen
      (flags written).
- [ ] Setting a shotgun property disables/*greys* the config.
- [ ] **Melee** attack (manual) with a stat-target weapon → target loses the stat,
      armor ignored, chat summary "*loses N STAT (M remaining)*".
- [ ] **Ranged** attack with multiple rolls/targets → each target drained.
- [ ] **Automatic** mode from the character-sheet weapon click → no attack roll,
      damage card created directly.
- [ ] **Automatic** via macro / CoC7Link (`weaponCheck`) → same.
- [ ] **MP** target with damage > current MP → overflow applied to HP.
- [ ] **SAN** target → `setSan` path; temp/indefinite insanity triggers fire.
- [ ] Characteristic reduced to **0** → actor `dead` + flavour text.
- [ ] **Temporary** characteristic drain creates a removable Active Effect;
      **permanent** modifies the base value.
- [ ] Damage card shows Drains / Automatic / Armor-bypassed badges and the raw
      (un-armored) damage number.

---

## 7. Dev workflow notes

- Canonical source is this repo. The world runs a **manual copy** at
  `…/FoundryVTT/Data/modules/coc7-special-damage` (no symlink). After editing,
  mirror `scripts/` (and any changed assets) to that path, then **hard reload**
  Foundry (Ctrl+F5) — `.mjs` files can be browser-cached.
- Consider a dev symlink (`mklink /D` / `New-Item -ItemType SymbolicLink`) from
  the modules dir to this repo to eliminate copy drift during the migration.
- The `ready`-hook wrapper guards log which wrappers registered vs were skipped —
  read the console first; it tells you immediately which CoC7 internals moved.
- jQuery is still bundled in v13; the existing `$(html)` usage can stay for now.
  A later pass could drop jQuery for native DOM, but it is not required for
  compatibility.

---

## 8. As-built summary (v0.2.0)

What v8 actually changed and how each integration point was solved:

**Hooks ([`main.mjs`](scripts/main.mjs))**
- AppV2 fires render hooks for the *entire* class inheritance chain (Foundry
  `application.mjs` `#callHooks`, `parentClassHooks` defaults `true`). So one
  **`renderCoC7ModelsActorGlobalSheet`** hook covers every actor sheet
  (character V2/V3, NPC, creature, vehicle) — no need to register per-leaf.
  `renderActorSheet` kept as a v12 fallback.
- `renderChatMessage` → **`renderChatMessageHTML`** (HTMLElement arg).
- `renderChatLog` still fires; the message list is **`ol.chat-log`** (the
  `#chat-log` id is gone). Listener attaches there (capturing phase).
- `loadTemplates` → `foundry.applications.handlebars.loadTemplates`.

**Damage pipeline ([`damage-interceptor.mjs`](scripts/damage-interceptor.mjs))**
- `game.CoC7.cards.DamageCard` is **gone** (deprecation stub). The whole
  DamageCard-wrapper path was removed.
- All v8 damage funnels through **`Actor#dealDamage(amount, {ignoreArmor})`**
  (melee `CoC7ChatDamage` passes `ignoreArmor:true`; ranged
  `CoC7ChatCombatRanged` passes the raw pre-armor `part.total`). We wrap only
  that one method — it always receives the raw, armor-bypassed amount.
- The capturing chat-log listener now detects **`data-action="dealDamage"`**
  (melee) and **`data-action="deal-range-damage"`** (ranged), resolves the
  weapon from **`message.flags.CoC7.load.itemUuid`** (via `fromUuidSync`), and
  arms the pending config the wrapper consumes.

**Automatic mode ([`damage-interceptor.mjs`](scripts/damage-interceptor.mjs) `registerSheetInterceptor`)**
- Combat-tab rows key on **`data-item-uuid`** (was `data-item-id`).
- The unexposed card classes can't be instantiated directly, so automatic mode
  reuses the system's own direct-damage path: intercept the weapon-name click
  and trigger the row's **`[data-action="weapon-damage"]`** anchor
  (`_onWeaponDamage` → `CoC7ChatDamage.createFromWeapon`), which skips the
  attack roll and posts a damage card. The drain then fires when its
  "Inflict Pain" (`dealDamage`) button is used.

**Badges ([`sheet-injection.mjs`](scripts/sheet-injection.mjs) `injectDamageCardBadge`)**
- Rewritten for the new markup: identifies special-damage cards via
  `message.flags.CoC7.load`, injects `.sd-info-block` after `.coc7-chat-header`,
  and hides the armor controls. CSS de-scoped from the dead
  `.coc7.chat-card.damage` wrapper. The obsolete `data-auto-success`
  string-rewrite (`autoSetInitiatorSuccess`) was removed.

**Data APIs** — `STAT_PATHS`, `setSan`/`setMp`/`setCondition`, `hp`/`mp`/`san`
getters all unchanged in v8. ActiveEffect `icon` → `img` (both set for safety).

**`module.json`** — `compatibility` 13/13; CoC7 relationship `minimum` 8.0,
`verified` 8.6.

### Known limitation
- **Automatic mode via macro / CoC7Link** (`weaponCheck`) no longer skips the
  to-hit roll: the class that builds a no-roll damage card
  (`CoC7ChatDamage.createFromWeapon`) is not exposed on `game.CoC7` and can only
  be reached through the combat-tab DOM anchor. Macro-driven attacks therefore
  roll to-hit as normal, but the stat **drain still applies** to the resulting
  damage card. Sheet-click automatic mode is unaffected. Re-enabling the macro
  skip would need the system to expose that class (or a libWrapper on the
  internal handler if it later becomes reachable).
