import {
  MODULE_ID, CHARACTERISTICS, ALL_TARGETS, STAT_LABELS, DEFAULT_CONFIG
} from './config.mjs';

// ─────────────────────────────────────────────
// Weapon Sheet: Special Damage Config Injection
// Hook: renderItemSheet
// ─────────────────────────────────────────────

/**
 * Inject the Special Damage configuration UI into weapon item sheets.
 * Only visible to GMs, only on weapon items.
 */
export async function onRenderItemSheet (app, html, data) {
  // Guard: only weapon items
  if (app.item?.type !== 'weapon') return;

  // Guard: GM only
  if (!game.user.isGM) return;

  // Ensure html is jQuery
  const $html = html instanceof HTMLElement ? $(html) : html;

  // Guard: don't double-inject on re-render
  if ($html.find('.special-damage-config').length) return;

  // Read current config from item flags
  const sdConfig = app.item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };

  // Read shotgun state from weapon properties
  const isShotgun = app.item.system?.properties?.shotgun === true;

  // Determine if current target is a characteristic
  const isCharacteristic = CHARACTERISTICS.includes(sdConfig.target);

  // Build template data
  const templateData = {
    enabled: sdConfig.enabled && !isShotgun,
    target: sdConfig.target,
    permanent: sdConfig.permanent,
    automatic: sdConfig.automatic,
    isShotgun,
    isCharacteristic,
    targets: ALL_TARGETS.map(t => ({
      key: t,
      label: STAT_LABELS[t],
      selected: t === sdConfig.target
    }))
  };

  // Render the Handlebars template
  const rendered = await renderTemplate(
    `modules/${MODULE_ID}/templates/special-damage-config.hbs`,
    templateData
  );

  // Find injection point: after the weapon properties div
  const propertiesDiv = $html.find('.skill-attributes[data-set="properties"]');
  if (!propertiesDiv.length) return;

  // Inject our config UI after the properties
  propertiesDiv.after(rendered);

  // Bind change listeners
  const configEl = $html.find('.special-damage-config');

  configEl.find('.sd-enabled-checkbox').on('change', async (event) => {
    const newEnabled = event.target.checked;
    const current = app.item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    await app.item.setFlag(MODULE_ID, 'config', {
      ...current,
      enabled: newEnabled
    });
  });

  configEl.find('.sd-target-select').on('change', async (event) => {
    const newTarget = event.target.value;
    const current = app.item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    const isMpSan = !CHARACTERISTICS.includes(newTarget);
    await app.item.setFlag(MODULE_ID, 'config', {
      ...current,
      target: newTarget,
      // Force permanent for MP/SAN
      permanent: isMpSan ? true : current.permanent
    });
  });

  configEl.find('.sd-permanent-checkbox').on('change', async (event) => {
    const newPermanent = event.target.checked;
    const current = app.item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    await app.item.setFlag(MODULE_ID, 'config', {
      ...current,
      permanent: newPermanent
    });
  });

  configEl.find('.sd-automatic-checkbox').on('change', async (event) => {
    const newAutomatic = event.target.checked;
    const current = app.item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    await app.item.setFlag(MODULE_ID, 'config', {
      ...current,
      automatic: newAutomatic
    });
  });
}

// ─────────────────────────────────────────────
// Shared: Actor key resolution
// ─────────────────────────────────────────────

/**
 * Resolve actor from key, handling "TOKEN.tokenId", "sceneId.tokenId",
 * and plain actorId formats.
 */
function resolveActorFromKey (key) {
  if (!key) return null;
  // Synthetic token actor: "TOKEN.tokenId"
  if (key.startsWith('TOKEN.')) {
    const tokenId = key.slice(6);
    return game.actors.tokens[tokenId] ?? null;
  }
  // Scene token: "sceneId.tokenId"
  if (key.includes('.')) {
    const [sceneId, tokenId] = key.split('.');
    const scene = game.scenes.get(sceneId);
    if (!scene) return null;
    const tokenDoc = scene.tokens.get(tokenId);
    return tokenDoc?.actor ?? null;
  }
  // Direct actor ID
  return game.actors.get(key) ?? null;
}

/**
 * Resolve weapon Item from an actor key + item ID pair.
 */
function resolveWeapon (actorKey, itemId) {
  if (!actorKey || !itemId) return null;
  const actor = resolveActorFromKey(actorKey);
  return actor?.items?.get(itemId) ?? null;
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

// ─────────────────────────────────────────────
// Initiator Card: Auto-Success for Automatic mode
// Hook: renderChatMessage
// ─────────────────────────────────────────────

/**
 * When a combat initiator card (melee or range) is rendered for a weapon
 * with Automatic mode, set the auto-success flag so the attack auto-succeeds.
 * The card uses HTML data attributes (not dataset.object), so we update
 * the chat message content directly.
 */
export function autoSetInitiatorSuccess (message, html, data) {
  // GM only — prevent multiple clients racing to update
  if (!game.user.isGM) return;

  const $html = html instanceof HTMLElement ? $(html) : html;

  // Find melee or range initiator cards
  let cardElement = $html.find('.coc7.chat-card.initiator');
  if (!cardElement.length) cardElement = $html.filter('.coc7.chat-card.initiator');
  if (!cardElement.length) return;

  const chatCard = cardElement[0];

  // Already set? Skip to prevent infinite loop
  if (chatCard.dataset.autoSuccess === 'true') return;

  // Resolve weapon from the card's data attributes
  const actorKey = chatCard.dataset.actorKey;
  const itemId = chatCard.dataset.itemId;
  const weapon = resolveWeapon(actorKey, itemId);
  const sdConfig = getActiveConfig(weapon);
  if (!sdConfig?.automatic) return;

  console.log(`${MODULE_ID} | Auto-setting autoSuccess on initiator card`);

  // Update the message content to set auto-success
  const content = message.content;
  const newContent = content.replace(
    /data-auto-success="false"/,
    'data-auto-success="true"'
  );

  if (newContent !== content) {
    message.update({ content: newContent });
  }
}

// ─────────────────────────────────────────────
// Damage Card: Badge + Display Injection
// Hook: renderChatMessage
// ─────────────────────────────────────────────

/**
 * Inject badges, hide armor controls, fix damage display, and add
 * explanatory text on damage cards for weapons with special damage.
 */
export function injectDamageCardBadge (message, html, data) {
  const $html = html instanceof HTMLElement ? $(html) : html;

  let cardElement = $html.find('.coc7.chat-card.damage');
  if (!cardElement.length) cardElement = $html.filter('.coc7.chat-card.damage');
  if (!cardElement.length) return;

  const chatCard = cardElement[0];

  // Re-render guard
  if (cardElement.find('.sd-info-block').length) return;

  let weapon = null;
  let cardData = null;

  // Try InteractiveChatCard path: data serialised in dataset.object
  if (chatCard.dataset.object) {
    try {
      cardData = JSON.parse(unescape(chatCard.dataset.object));
      const actorKey = cardData.actorKey;
      const itemId = cardData.itemId;
      if (actorKey && itemId) {
        weapon = resolveWeapon(actorKey, itemId);
      }
    } catch (e) {
      // Not a parseable card, skip
    }
  }

  // Fallback: legacy card with data attributes directly on the card div
  if (!weapon && chatCard.dataset.actorKey && chatCard.dataset.itemId) {
    weapon = resolveWeapon(chatCard.dataset.actorKey, chatCard.dataset.itemId);
  }

  if (!weapon) return;

  const sdConfig = getActiveConfig(weapon);
  if (!sdConfig) return;

  const statLabel = STAT_LABELS[sdConfig.target];

  // ── Inject info block after header ──────────────────
  const header = cardElement.find('.card-header');
  const infoTarget = header.length ? header : cardElement.children().first();

  const drainText = game.i18n.format('CSD.Drains', { stat: statLabel });
  const bypassText = game.i18n.localize('CSD.ArmorBypassed');
  let infoHtml = `<div class="sd-info-block">`;
  infoHtml += `<span class="tag drain-tag">${drainText}</span>`;
  if (sdConfig.automatic) {
    infoHtml += `<span class="tag auto-tag">${game.i18n.localize('CSD.Automatic')}</span>`;
  }
  infoHtml += `<span class="sd-bypass-note">${bypassText}</span>`;
  infoHtml += `</div>`;
  infoTarget.after(infoHtml);

  // ── Hide armor controls ──────────────────────
  // Hide pre-deal armor input/toggle
  cardElement.find('.armor').hide();

  // Hide post-deal armor tags (e.g. "Armor: 3") in the options area
  const armorLocalized = game.i18n.localize('CoC7.Armor');
  cardElement.find('.options .tag').filter(function () {
    return $(this).text().includes(armorLocalized);
  }).hide();
  // Also hide "Armor Ignored" tags
  const armorIgnoredLocalized = game.i18n.localize('CoC7.ArmorIgnored');
  cardElement.find('.options .tag').filter(function () {
    return $(this).text().includes(armorIgnoredLocalized);
  }).hide();

  // ── Fix damage display to show raw (un-armored) total ──
  let rawDamage = null;
  if (cardData) {
    const formula = cardData.damageFormula;
    if (formula !== undefined && formula !== null) {
      rawDamage = !isNaN(Number(formula))
        ? Number(formula)
        : (cardData.roll?.total ?? null);
    }
  }

  if (rawDamage !== null) {
    // Update "Inflict Pain (X)" button to show raw damage
    const dealBtn = cardElement.find('button[data-action="dealDamage"]');
    if (dealBtn.length) {
      const painLabel = game.i18n.localize('CoC7.InflictPain');
      dealBtn.text(`${painLabel} (${rawDamage})`);
    }

    // Update "Damage Inflicted: X" result to show raw damage
    const cardResult = cardElement.find('.card-result');
    if (cardResult.length) {
      const inflictedLabel = game.i18n.localize('CoC7.DamageInflicted');
      cardResult.text(`${inflictedLabel} : ${rawDamage}`);
    }
  }
}
