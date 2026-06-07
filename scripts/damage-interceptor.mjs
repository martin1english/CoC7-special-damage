import { MODULE_ID } from './config.mjs';
import { applySpecialDamage, applyingOverflow } from './special-damage-logic.mjs';

/**
 * Damage interception for CoC7 v8 / Foundry v13.
 *
 * CoC7 v8 rewrote the chat-card architecture: the old `game.CoC7.cards.DamageCard`
 * class is gone (now a deprecation stub). Damage cards are chat messages carrying
 * `message.flags.CoC7.load` data, and every damage path — melee (CoC7ChatDamage,
 * button `data-action="dealDamage"`) and ranged (CoC7ChatCombatRanged, button
 * `data-action="deal-range-damage"`) — funnels through `actor.dealDamage(amount, …)`.
 *
 * We therefore intercept at a single robust point: `Actor#dealDamage`. A
 * capturing-phase click listener on the chat log detects a damage button for a
 * special-damage weapon (resolved from the message flags) and records a pending
 * config; the `dealDamage` wrapper then redirects that call to `applySpecialDamage`
 * with the raw, armor-bypassed amount and reports 0 HP damage dealt.
 */

// The CoC7 system stores its chat-card data under this flag scope.
const COC7_SCOPE = 'CoC7';

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
// Weapon / config resolution
// ─────────────────────────────────────────────

/**
 * Read the special damage config from a weapon, returning null if not active.
 */
function getActiveConfig (weapon) {
  if (!weapon?.getFlag) return null;
  const sdConfig = weapon.getFlag(MODULE_ID, 'config');
  if (!sdConfig?.enabled) return null;
  if (weapon.system?.properties?.shotgun) return null;
  return sdConfig;
}

/**
 * Resolve the weapon Item referenced by a CoC7 chat-card message, synchronously.
 * v8 stores the weapon uuid in `message.flags.CoC7.load.itemUuid` for both
 * CoC7ChatDamage (melee) and CoC7ChatCombatRanged cards. Embedded items on a
 * loaded actor resolve synchronously via fromUuidSync.
 */
function weaponFromMessage (message) {
  const itemUuid = message?.flags?.[COC7_SCOPE]?.load?.itemUuid;
  if (!itemUuid) return null;
  try {
    return fromUuidSync(itemUuid);
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────
// Wrapper: Actor.prototype.dealDamage
// The single funnel all v8 damage paths pass through.
// Signature: dealDamage(amount, { armor, ignoreArmor })
// ─────────────────────────────────────────────

async function wrappedActorDealDamage (wrapped, amount, options = {}) {
  // Guard: skip if this is the MP-overflow HP damage call from our own logic.
  if (applyingOverflow) return wrapped(amount, options);

  // A special-damage context was armed by the capturing-phase click listener?
  if (pendingSpecialDamageConfig) {
    const config = pendingSpecialDamageConfig;

    // One-shot (melee): consume immediately.
    // Persistent (ranged): keep until the burst's setTimeout clears it.
    if (!config._persistent) {
      pendingSpecialDamageConfig = null;
    }

    console.log(`${MODULE_ID} | actor.dealDamage intercepted: ${amount} → ${config.target} (armor bypassed)`);
    // `amount` is the raw, pre-armor roll value (melee passes ignoreArmor:true;
    // ranged passes the raw part total). Drain the configured stat with it.
    await applySpecialDamage(this, config, Number(amount));
    return 0; // No HP damage dealt.
  }

  return wrapped(amount, options);
}

// ─────────────────────────────────────────────
// Actor Sheet interceptor (capturing-phase)
// For Automatic mode: clicking a weapon name normally rolls to-hit. For an
// automatic weapon we instead trigger the row's direct "weapon-damage" action
// (CoC7 _onWeaponDamage → CoC7ChatDamage.createFromWeapon), which skips the
// attack roll and produces a damage card straight away.
// ─────────────────────────────────────────────

export function registerSheetInterceptor (app, html) {
  const element = html instanceof HTMLElement ? html : (html?.[0] ?? html);
  if (!element?.addEventListener) return;

  // AppV2 re-uses the same root element across re-renders, so guard against
  // binding the listener more than once.
  if (element.dataset.sdInterceptorBound) return;
  element.dataset.sdInterceptorBound = 'true';

  element.addEventListener('click', (event) => {
    const weaponEl = event.target.closest('.weapon-name.rollable');
    if (!weaponEl) return;

    // v8 combat tabs key rows by data-item-uuid (was data-item-id).
    const row = weaponEl.closest('[data-item-uuid]') || weaponEl.closest('[data-item-id]');
    const uuid = row?.dataset?.itemUuid;
    const id = row?.dataset?.itemId;

    let weapon = null;
    if (uuid) {
      try { weapon = fromUuidSync(uuid); } catch (e) { weapon = null; }
    } else if (id) {
      weapon = (app.actor ?? app.document)?.items?.get(id) ?? null;
    }

    const sdConfig = getActiveConfig(weapon);
    if (!sdConfig?.automatic) return;

    // Trigger the direct-damage action for this weapon, bypassing the attack roll.
    const dmgAnchor = row.querySelector('[data-action="weapon-damage"]');
    if (!dmgAnchor) {
      // No damage range to roll directly — fall back to the normal handler.
      console.warn(`${MODULE_ID} | Automatic mode: no weapon-damage control found for ${weapon?.name}`);
      return;
    }

    // Prevent the sheet's own (bubbling) weapon-name handler from rolling to-hit.
    event.stopPropagation();
    event.preventDefault();
    console.log(`${MODULE_ID} | Automatic mode: creating damage card directly for ${weapon.name}`);
    dmgAnchor.click();
  }, true); // capturing phase: fires before the sheet's bubbling-phase handlers
}

// ─────────────────────────────────────────────
// Capturing-phase click listener on the chat log.
// Fires before CoC7's per-button bubbling-phase handlers, so we can arm the
// special-damage context before the system calls actor.dealDamage.
// ─────────────────────────────────────────────

function onChatLogClick (event) {
  const control = event.target.closest('[data-action]');
  if (!control) return;

  const action = control.dataset.action;
  // Melee single-target damage card → "dealDamage"; ranged → "deal-range-damage".
  if (action !== 'dealDamage' && action !== 'deal-range-damage') return;

  const messageEl = control.closest('[data-message-id]');
  const messageId = messageEl?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const weapon = weaponFromMessage(message);
  const sdConfig = getActiveConfig(weapon);
  if (!sdConfig) {
    // A damage click for a non-special weapon: make sure no stale context (e.g.
    // from a prior ranged burst) leaks onto this call and wrongly drains a stat.
    pendingSpecialDamageConfig = null;
    return;
  }

  console.log(`${MODULE_ID} | Chat click intercepted: ${action} for ${sdConfig.target} drain`);

  pendingSpecialDamageConfig = {
    target: sdConfig.target,
    permanent: sdConfig.permanent
  };

  if (action === 'deal-range-damage') {
    // Ranged combat calls actor.dealDamage() in a loop (multiple rolls/targets).
    // Keep the context alive across that async burst, then clear it. The
    // non-special-click reset above guards against the brief stale window.
    pendingSpecialDamageConfig._persistent = true;
    const armed = pendingSpecialDamageConfig;
    setTimeout(() => {
      if (pendingSpecialDamageConfig === armed) pendingSpecialDamageConfig = null;
    }, 1000);
  } else {
    // Melee one-shot: the wrapper clears it on consumption. Add a safety clear
    // in case the system never reaches dealDamage (e.g. armor fully absorbs).
    const armed = pendingSpecialDamageConfig;
    setTimeout(() => {
      if (pendingSpecialDamageConfig === armed) pendingSpecialDamageConfig = null;
    }, 2000);
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Register method wrappers. Call from the 'ready' hook.
 */
export function registerWrappers () {
  if (CONFIG.Actor?.documentClass?.prototype?.dealDamage) {
    registerWrapper(
      'CONFIG.Actor.documentClass.prototype.dealDamage',
      wrappedActorDealDamage
    );
    console.log(`${MODULE_ID} | Wrapped CONFIG.Actor.documentClass.prototype.dealDamage`);
  } else {
    console.warn(`${MODULE_ID} | CONFIG.Actor.documentClass.prototype.dealDamage not found — special damage will not fire`);
  }
}

/**
 * Register the capturing-phase click listener on the chat log.
 * Call from the 'renderChatLog' hook.
 *
 * @param {jQuery|HTMLElement} html - The ChatLog application's element
 */
export function registerChatListener (html) {
  const element = html instanceof HTMLElement ? html : (html?.[0] ?? html);
  if (!element?.querySelector) return;

  // v13: the message list is `ol.chat-log` inside the ChatLog app element.
  const chatLog = element.matches?.('.chat-log') ? element
    : (element.querySelector('.chat-log') ?? element);

  if (chatLog.dataset?.sdChatBound) return;
  if (chatLog.dataset) chatLog.dataset.sdChatBound = 'true';

  chatLog.addEventListener('click', onChatLogClick, true); // capturing phase
  console.log(`${MODULE_ID} | Registered capturing-phase chat log listener`);
}
