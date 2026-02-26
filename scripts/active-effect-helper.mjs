import { MODULE_ID, STAT_PATHS, STAT_LABELS, AE_ICON } from './config.mjs';

/**
 * Create an Active Effect on an actor that reduces a characteristic by a given amount.
 * Used for temporary (reversible) drains. Removing the AE restores the stat.
 *
 * @param {Actor} actor - The target actor
 * @param {string} targetKey - Stat key (e.g. 'str', 'con')
 * @param {number} amount - Positive amount to drain
 * @returns {Promise<ActiveEffect[]>} The created effect documents
 */
export async function createDrainEffect (actor, targetKey, amount) {
  if (amount <= 0) return [];

  const statPath = STAT_PATHS[targetKey];
  if (!statPath) {
    console.error(`${MODULE_ID} | Unknown stat key: ${targetKey}`);
    return [];
  }

  const statLabel = STAT_LABELS[targetKey];
  const effectName = game.i18n.format('CSD.ActiveEffectLabel', {
    stat: statLabel,
    amount: amount
  });

  const aeData = {
    name: effectName,
    icon: AE_ICON,
    changes: [{
      key: statPath,
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: -amount,
      priority: 20
    }],
    disabled: false,
    transfer: false,
    duration: {},
    flags: {
      [MODULE_ID]: {
        isDrain: true,
        stat: targetKey,
        amount: amount
      }
    }
  };

  return actor.createEmbeddedDocuments('ActiveEffect', [aeData]);
}
