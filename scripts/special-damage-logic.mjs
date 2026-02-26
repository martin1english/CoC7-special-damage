import {
  MODULE_ID, CHARACTERISTICS, STAT_PATHS, STAT_LABELS, ZERO_STAT_KEYS
} from './config.mjs';
import { createDrainEffect } from './active-effect-helper.mjs';

/**
 * Flag checked by the Actor.dealDamage wrapper to avoid intercepting
 * the MP overflow HP damage call.
 */
export let applyingOverflow = false;

/**
 * Apply special damage to an actor, routing to the appropriate handler
 * based on the configured target stat.
 *
 * @param {Actor} actor - The target actor
 * @param {object} config - The special damage config from the weapon flag
 * @param {string} config.target - Target stat key
 * @param {boolean} config.permanent - Whether the drain is permanent
 * @param {number} rawDamage - The raw damage amount (before any armor)
 */
export async function applySpecialDamage (actor, config, rawDamage) {
  const amount = Math.max(0, Math.floor(rawDamage));
  if (amount === 0) return;

  const { target, permanent } = config;
  const actorName = actor.name;

  if (target === 'san') {
    await applySanDrain(actor, actorName, amount);
  } else if (target === 'mp') {
    await applyMpDrain(actor, actorName, amount);
  } else if (CHARACTERISTICS.includes(target)) {
    await applyCharacteristicDrain(actor, actorName, target, amount, permanent);
  }
}

/**
 * Apply SAN loss using the system's setSan() method, which handles
 * insanity triggers (tempoInsane at loss >= 5, indefInsane at daily limit).
 */
async function applySanDrain (actor, actorName, amount) {
  const currentSan = actor.san;
  const newSan = Math.max(0, currentSan - amount);

  await actor.setSan(newSan);

  await postDrainMessage(actorName, amount, 'SAN', newSan);

  if (newSan <= 0) {
    await postChatMessage(
      game.i18n.format('CSD.SanZero', { name: actorName })
    );
  }
}

/**
 * Apply MP drain. If the drain exceeds current MP, the overflow
 * is applied as HP damage per the rulebook.
 */
async function applyMpDrain (actor, actorName, amount) {
  const currentMp = actor.mp;

  if (amount <= currentMp) {
    const newMp = currentMp - amount;
    await actor.setMp(newMp);
    await postDrainMessage(actorName, amount, 'MP', newMp);
  } else {
    const mpDrained = currentMp;
    const overflow = amount - currentMp;
    await actor.setMp(0);

    // Apply overflow as HP damage through the standard path.
    // Set guard flag so our Actor.dealDamage wrapper doesn't intercept this.
    applyingOverflow = true;
    try {
      await actor.dealDamage(overflow, { ignoreArmor: true });
    } finally {
      applyingOverflow = false;
    }

    const hpRemaining = actor.hp;
    await postChatMessage(
      game.i18n.format('CSD.MPOverflow', {
        name: actorName,
        mpDrained: mpDrained,
        overflow: overflow,
        hpRemaining: hpRemaining
      })
    );
  }
}

/**
 * Apply characteristic drain (STR, CON, DEX, SIZ, APP, INT, POW, EDU).
 * Default is temporary (Active Effect). Permanent directly modifies the base value.
 */
async function applyCharacteristicDrain (actor, actorName, target, amount, permanent) {
  const statPath = STAT_PATHS[target];
  const statLabel = STAT_LABELS[target];
  const currentValue = getStatValue(actor, target);
  const newValue = Math.max(0, currentValue - amount);

  if (permanent) {
    await actor.update({ [statPath]: newValue });
  } else {
    // Temporary drain via Active Effect.
    // Clamp the AE amount so the stat doesn't go below 0.
    const effectAmount = Math.min(amount, currentValue);
    if (effectAmount > 0) {
      await createDrainEffect(actor, target, effectAmount);
    }
  }

  await postDrainMessage(actorName, amount, statLabel, newValue);

  // Zero-stat consequence: dead condition
  if (newValue <= 0) {
    await actor.setCondition('dead');
    const zeroKey = ZERO_STAT_KEYS[target];
    if (zeroKey) {
      await postChatMessage(
        game.i18n.format(zeroKey, { name: actorName }),
        true
      );
    }
  }
}

/**
 * Read the current value of a stat from an actor's data.
 */
function getStatValue (actor, target) {
  const path = STAT_PATHS[target];
  if (!path) return 0;
  const value = foundry.utils.getProperty(actor, path);
  return parseInt(value) || 0;
}

/**
 * Post a public drain summary message to chat.
 */
async function postDrainMessage (actorName, amount, statLabel, remaining) {
  const content = game.i18n.format('CSD.DrainMessage', {
    name: actorName,
    amount: amount,
    stat: statLabel,
    remaining: remaining
  });
  await postChatMessage(content);
}

/**
 * Post a public chat message from the module.
 * @param {string} content - HTML content
 * @param {boolean} [isEvocative=false] - If true, render in italic dark red
 */
async function postChatMessage (content, isEvocative = false) {
  const styledContent = isEvocative
    ? `<em style="color: #8b0000; font-weight: bold;">${content}</em>`
    : content;

  await ChatMessage.create({
    content: styledContent,
    speaker: { alias: 'Special Damage' }
  });
}
