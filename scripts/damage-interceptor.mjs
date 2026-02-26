import { MODULE_ID } from './config.mjs';
import { applySpecialDamage, applyingOverflow } from './special-damage-logic.mjs';

/**
 * Module-scoped context variable. Set by the capturing-phase click listener
 * before the system's bubbling-phase handler fires, then consumed by
 * the Actor.dealDamage wrapper.
 */
let pendingSpecialDamageConfig = null;

// ─────────────────────────────────────────────
// libWrapper / monkey-patch utility
// ─────────────────────────────────────────────

function registerWrapper (target, fn, type = 'MIXED') {
  if (typeof libWrapper !== 'undefined') {
    libWrapper.register(MODULE_ID, target, fn, type);
  } else {
    // Manual monkey-patch fallback
    const parts = target.split('.');
    const fnName = parts.pop();
    let obj = globalThis;
    for (const part of parts) {
      obj = obj[part];
      if (!obj) {
        console.error(`${MODULE_ID} | Could not resolve wrapper target: ${target}`);
        return;
      }
    }
    const original = obj[fnName];
    obj[fnName] = function (...args) {
      return fn.call(this, original.bind(this), ...args);
    };
  }
}

// ─────────────────────────────────────────────
// Actor key resolution (reimplements chatHelper.getActorFromKey)
// ─────────────────────────────────────────────

function resolveActorFromKey (key) {
  if (!key) return null;
  // "TOKEN.tokenId" format
  if (key.startsWith('TOKEN.')) {
    const tokenId = key.slice(6);
    return game.actors.tokens[tokenId] ?? null;
  }
  // "sceneId.tokenId" format
  if (key.includes('.')) {
    const [sceneId, tokenId] = key.split('.');
    const scene = game.scenes.get(sceneId);
    if (!scene) return null;
    const tokenDoc = scene.tokens.get(tokenId);
    return tokenDoc?.actor ?? null;
  }
  return game.actors.get(key) ?? null;
}

/**
 * Read the special damage config from a weapon, returning null if not active.
 */
function getActiveConfig (weapon) {
  if (!weapon) return null;
  const sdConfig = weapon.getFlag(MODULE_ID, 'config');
  if (!sdConfig?.enabled) return null;
  if (weapon.system?.properties?.shotgun) return null;
  return sdConfig;
}

/**
 * Resolve a weapon Item from weaponData (which may be an Item, or an object
 * with uuid/id/name, as passed to actor.weaponCheck).
 */
function resolveWeapon (actor, weaponData) {
  if (!weaponData || !actor) return null;
  // Already an Item document
  if (weaponData.getFlag) return weaponData;
  // Object with id
  if (weaponData.id) {
    const w = actor.items.get(weaponData.id);
    if (w) return w;
  }
  // Object with name
  if (weaponData.name) {
    const w = actor.items.getName(weaponData.name);
    if (w) return w;
  }
  // Object with uuid (macros pass { name, uuid } — extract embedded item ID)
  if (weaponData.uuid) {
    try {
      const parsed = foundry.utils.parseUuid(weaponData.uuid);
      if (parsed?.id) {
        const w = actor.items.get(parsed.id);
        if (w) return w;
      }
    } catch (e) {
      // Invalid UUID, skip
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Wrapper 1: DamageCard.prototype.dealDamage
// Handles the modern melee DamageCard path.
// ─────────────────────────────────────────────

async function wrappedDealDamage (wrapped, options = { update: true }) {
  // `this` is the DamageCard instance
  const weapon = this.weapon; // InteractiveChatCard.weapon → this.item
  const sdConfig = getActiveConfig(weapon);

  if (!sdConfig) {
    console.log(`${MODULE_ID} | dealDamage: no active config, using vanilla path`);
    return wrapped(options);
  }

  if (!this.targetActor) {
    console.log(`${MODULE_ID} | dealDamage: no targetActor, using vanilla path`);
    return wrapped(options);
  }

  // Bypass armor: read raw roll total instead of totalDamageString
  // totalDamageString (damage.js:71) subtracts armor — we want the raw value
  let rawDamage;
  if (this.isDamageNumber) {
    rawDamage = Number(this.damageFormula);
  } else {
    rawDamage = this.roll?.total ?? 0;
  }

  console.log(`${MODULE_ID} | dealDamage: applying ${rawDamage} special damage to ${sdConfig.target} (armor bypassed)`);
  await applySpecialDamage(this.targetActor, sdConfig, rawDamage);

  // Mark the card as dealt (matches original dealDamage behavior)
  this.damageInflicted = true;
  const shouldUpdate = typeof options.update === 'undefined' ? true : options.update;
  if (shouldUpdate) this.updateChatCard();
}

// ─────────────────────────────────────────────
// Wrapper 2: Actor.prototype.dealDamage
// Handles legacy melee and ranged combat paths
// where actor.dealDamage() is called directly.
// ─────────────────────────────────────────────

async function wrappedActorDealDamage (wrapped, amount, options = {}) {
  // Guard: skip if this is an MP overflow HP damage call from our own logic
  if (applyingOverflow) return wrapped(amount, options);

  // Check if a special damage context was set by the capturing-phase listener
  if (pendingSpecialDamageConfig) {
    const config = pendingSpecialDamageConfig;

    // For one-shot (melee): consume immediately.
    // For persistent (ranged): keep until setTimeout clears it.
    if (!config._persistent) {
      pendingSpecialDamageConfig = null;
    }

    console.log(`${MODULE_ID} | actor.dealDamage intercepted: ${amount} → ${config.target}`);
    await applySpecialDamage(this, config, Number(amount));
    return 0; // Return 0 to indicate no HP damage dealt
  }

  return wrapped(amount, options);
}

// ─────────────────────────────────────────────
// Shared automatic-mode helper
// Creates a DamageCard for each targeted token,
// bypassing the attack roll entirely.
// ─────────────────────────────────────────────

async function createAutomaticDamageCards (actorKey, weapon) {
  const targets = game.user.targets;
  if (!targets.size) {
    ui.notifications.warn(game.i18n.localize('CSD.NoTarget'));
    return;
  }

  console.log(`${MODULE_ID} | Automatic mode: creating DamageCard directly`);

  const DamageCard = game.CoC7.cards.DamageCard;
  for (const target of targets) {
    const card = new DamageCard({ fastForward: true });
    card.actorKey = actorKey;
    card.itemId = weapon.id;
    card.ignoreArmor = true; // Special damage bypasses armor

    // Build target key from token
    const tokenDoc = target.document;
    if (tokenDoc?.parent?.id) {
      card.targetKey = `${tokenDoc.parent.id}.${tokenDoc.id}`;
    } else {
      card.targetKey = target.actor?.id;
    }

    await card.updateChatCard();
  }
}

// ─────────────────────────────────────────────
// Wrapper 3: Actor.prototype.weaponCheck
// Implements Automatic mode: skip attack roll,
// create DamageCard directly.
// (Only fires from macros and CoC7Links.)
// ─────────────────────────────────────────────

async function wrappedWeaponCheck (wrapped, weaponData, fastForward = false) {
  const weapon = resolveWeapon(this, weaponData);
  const sdConfig = getActiveConfig(weapon);

  if (!sdConfig?.automatic) return wrapped(weaponData, fastForward);

  await createAutomaticDamageCards(this.tokenKey, weapon);
}

// ─────────────────────────────────────────────
// Actor Sheet interceptor (capturing-phase)
// The CoC7 character sheet does NOT call
// actor.weaponCheck() — it directly creates
// initiator cards. This listener intercepts
// weapon-name clicks BEFORE the sheet handler.
// ─────────────────────────────────────────────

function buildActorKeyFromSheet (app) {
  if (!app.token) return app.actor.id;
  if (app.actor.isToken && game.actors.tokens[app.token.id]) {
    return `TOKEN.${app.token.id}`;
  }
  return `${app.token.parent.id}.${app.token.id}`;
}

export function registerSheetInterceptor (app, html, data) {
  const element = html instanceof HTMLElement ? html : html[0] ?? html;

  element.addEventListener('click', async (event) => {
    const weaponEl = event.target.closest('.weapon-name.rollable');
    if (!weaponEl) return;

    const li = weaponEl.closest('li') || weaponEl.closest('.item');
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;

    const weapon = app.actor.items.get(itemId);
    const sdConfig = getActiveConfig(weapon);
    if (!sdConfig?.automatic) return;

    // Automatic mode: prevent the sheet's handler from creating an initiator
    event.stopPropagation();
    event.preventDefault();

    const actorKey = buildActorKeyFromSheet(app);
    await createAutomaticDamageCards(actorKey, weapon);
  }, true); // capturing phase fires before the sheet's bubbling-phase jQuery handler
}

// ─────────────────────────────────────────────
// Capturing-phase click listener on #chat-log
// Fires before the system's bubbling-phase jQuery handlers.
// ─────────────────────────────────────────────

function onChatLogClick (event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  if (action !== 'deal-melee-damage' && action !== 'deal-range-damage') return;

  // Find the chat card element containing the weapon data
  const card = button.closest('.chat-card');
  if (!card) return;

  // Extract actor key and item ID from the card's dataset
  const actorKey = card.dataset.actorKey;
  const itemId = card.dataset.itemId;
  if (!actorKey || !itemId) return;

  const actor = resolveActorFromKey(actorKey);
  if (!actor) return;

  const weapon = actor.items.get(itemId);
  const sdConfig = getActiveConfig(weapon);
  if (!sdConfig) return;

  console.log(`${MODULE_ID} | Chat click intercepted: ${action} for ${sdConfig.target} drain`);

  // Set the pending context for the Actor.dealDamage wrapper
  pendingSpecialDamageConfig = {
    target: sdConfig.target,
    permanent: sdConfig.permanent
  };

  if (action === 'deal-range-damage') {
    // Range combat calls actor.dealDamage() in a loop for multiple rolls/targets.
    // Mark as persistent so the wrapper doesn't consume it on the first call.
    // setTimeout(0) clears it after the entire async chain completes.
    pendingSpecialDamageConfig._persistent = true;
    setTimeout(() => {
      if (pendingSpecialDamageConfig?._persistent) {
        pendingSpecialDamageConfig = null;
      }
    }, 0);
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Register all method wrappers. Call from the 'ready' hook
 * (not 'init') because game.CoC7 is set during the system's init.
 */
export function registerWrappers () {
  // Wrapper 1: DamageCard.prototype.dealDamage
  if (game.CoC7?.cards?.DamageCard) {
    registerWrapper(
      'game.CoC7.cards.DamageCard.prototype.dealDamage',
      wrappedDealDamage
    );
    console.log(`${MODULE_ID} | Wrapped DamageCard.prototype.dealDamage`);
  } else {
    console.warn(`${MODULE_ID} | game.CoC7.cards.DamageCard not found — DamageCard wrapper skipped`);
  }

  // Wrapper 2: Actor.prototype.dealDamage
  if (CONFIG.Actor?.documentClass?.prototype?.dealDamage) {
    registerWrapper(
      'CONFIG.Actor.documentClass.prototype.dealDamage',
      wrappedActorDealDamage
    );
    console.log(`${MODULE_ID} | Wrapped CONFIG.Actor.documentClass.prototype.dealDamage`);
  } else {
    console.warn(`${MODULE_ID} | CONFIG.Actor.documentClass.prototype.dealDamage not found — Actor wrapper skipped`);
  }

  // Wrapper 3: Actor.prototype.weaponCheck (Automatic mode)
  if (CONFIG.Actor?.documentClass?.prototype?.weaponCheck) {
    registerWrapper(
      'CONFIG.Actor.documentClass.prototype.weaponCheck',
      wrappedWeaponCheck
    );
    console.log(`${MODULE_ID} | Wrapped CONFIG.Actor.documentClass.prototype.weaponCheck`);
  } else {
    console.warn(`${MODULE_ID} | CONFIG.Actor.documentClass.prototype.weaponCheck not found — Automatic mode unavailable`);
  }
}

/**
 * Register the capturing-phase click listener on the chat log.
 * Call from the 'renderChatLog' hook.
 *
 * @param {jQuery|HTMLElement} html - The chat log HTML
 */
export function registerChatListener (html) {
  // html may be jQuery or a raw DOM element depending on Foundry version
  const element = html instanceof HTMLElement ? html : html[0] ?? html;
  const chatLog = element.querySelector?.('#chat-log') ?? element;

  chatLog.addEventListener('click', onChatLogClick, true); // true = capturing phase
  console.log(`${MODULE_ID} | Registered capturing-phase chat log listener`);
}
