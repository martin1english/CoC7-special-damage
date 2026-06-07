import {
  MODULE_ID, CHARACTERISTICS, ALL_TARGETS, STAT_LABELS, DEFAULT_CONFIG
} from './config.mjs';

// The CoC7 system stores its chat-card data under this flag scope.
const COC7_SCOPE = 'CoC7';

/**
 * Render a Handlebars template, preferring the v13 namespaced helper and
 * falling back to the (deprecated) global for v12.
 */
function renderHbs (path, data) {
  const fn = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
  return fn(path, data);
}

// ─────────────────────────────────────────────
// Weapon Sheet: Special Damage Config Injection
// Hooks: renderCoC7ModelsItemWeaponSheet (v8) / renderItemSheet (v12 fallback)
// ─────────────────────────────────────────────

/**
 * Inject the Special Damage configuration UI into weapon item sheets.
 * Only visible to GMs, only on weapon items.
 */
export async function onRenderItemSheet (app, html) {
  // ApplicationV2 sheets expose `document`; V1 sheets expose `item`.
  const item = app.item ?? app.document;

  // Guard: only weapon items
  if (item?.type !== 'weapon') return;

  // Guard: GM only
  if (!game.user.isGM) return;

  // Ensure html is jQuery (jQuery is still bundled in v13)
  const $html = html instanceof HTMLElement ? $(html) : html;

  // Guard: don't double-inject on re-render
  if ($html.find('.special-damage-config').length) return;

  // Read current config from item flags
  const sdConfig = item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };

  // Read shotgun state from weapon properties
  const isShotgun = item.system?.properties?.shotgun === true;

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
  const rendered = await renderHbs(
    `modules/${MODULE_ID}/templates/special-damage-config.hbs`,
    templateData
  );

  // Find injection point: after the weapon properties div. CoC7 v8 (V2 sheet)
  // renamed this container's class to .toggle-attributes, so match on the
  // data-set attribute, which is stable across class-name changes.
  const propertiesDiv = $html.find('[data-set="properties"]');
  if (!propertiesDiv.length) return;

  // Inject our config UI after the properties
  propertiesDiv.after(rendered);

  // Bind change listeners
  const configEl = $html.find('.special-damage-config');

  configEl.find('.sd-enabled-checkbox').on('change', async (event) => {
    const newEnabled = event.target.checked;
    const current = item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    await item.setFlag(MODULE_ID, 'config', {
      ...current,
      enabled: newEnabled
    });
  });

  configEl.find('.sd-target-select').on('change', async (event) => {
    const newTarget = event.target.value;
    const current = item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    const isMpSan = !CHARACTERISTICS.includes(newTarget);
    await item.setFlag(MODULE_ID, 'config', {
      ...current,
      target: newTarget,
      // Force permanent for MP/SAN
      permanent: isMpSan ? true : current.permanent
    });
  });

  configEl.find('.sd-permanent-checkbox').on('change', async (event) => {
    const newPermanent = event.target.checked;
    const current = item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    await item.setFlag(MODULE_ID, 'config', {
      ...current,
      permanent: newPermanent
    });
  });

  configEl.find('.sd-automatic-checkbox').on('change', async (event) => {
    const newAutomatic = event.target.checked;
    const current = item.getFlag(MODULE_ID, 'config') ?? { ...DEFAULT_CONFIG };
    await item.setFlag(MODULE_ID, 'config', {
      ...current,
      automatic: newAutomatic
    });
  });
}

// ─────────────────────────────────────────────
// Shared helpers
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
 * Resolve the weapon Item referenced by a CoC7 chat-card message.
 * v8 stores the weapon uuid in `message.flags.CoC7.load.itemUuid`.
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
// Damage Card: Badge + Display Injection
// Hook: renderChatMessageHTML
// ─────────────────────────────────────────────

/**
 * Inject badges and hide armor controls on v8 damage cards for weapons with
 * special damage. v8 damage cards are CoC7ChatDamage (melee) or
 * CoC7ChatCombatRanged messages identified via `message.flags.CoC7.load`.
 */
export function injectDamageCardBadge (message, html) {
  const element = html instanceof HTMLElement ? html : (html?.[0] ?? html);
  if (!element?.querySelector) return;

  const load = message?.flags?.[COC7_SCOPE]?.load;
  if (!load) return;
  if (load.as !== 'CoC7ChatDamage' && load.as !== 'CoC7ChatCombatRanged') return;

  // Re-render guard
  if (element.querySelector('.sd-info-block')) return;

  const weapon = weaponFromMessage(message);
  const sdConfig = getActiveConfig(weapon);
  if (!sdConfig) return;

  const statLabel = STAT_LABELS[sdConfig.target] ?? sdConfig.target;

  // ── Build the info block ───────────────────────────
  const infoBlock = document.createElement('div');
  infoBlock.className = 'sd-info-block';

  const drainTag = document.createElement('span');
  drainTag.className = 'tag drain-tag';
  drainTag.textContent = game.i18n.format('CSD.Drains', { stat: statLabel });
  infoBlock.appendChild(drainTag);

  if (sdConfig.automatic) {
    const autoTag = document.createElement('span');
    autoTag.className = 'tag auto-tag';
    autoTag.textContent = game.i18n.localize('CSD.Automatic');
    infoBlock.appendChild(autoTag);
  }

  const bypassNote = document.createElement('span');
  bypassNote.className = 'sd-bypass-note';
  bypassNote.textContent = game.i18n.localize('CSD.ArmorBypassed');
  infoBlock.appendChild(bypassNote);

  // ── Inject after the card header ───────────────────
  const header = element.querySelector('.coc7-chat-header');
  if (header) {
    header.after(infoBlock);
  } else {
    (element.querySelector('.message-content') ?? element).prepend(infoBlock);
  }

  // ── Hide armor controls (special damage always bypasses armor) ──
  const armorLabel = game.i18n.localize('CoC7.Armor');
  element.querySelectorAll('label, span').forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    if (text === `${armorLabel}:` || text.startsWith(`${armorLabel}:`)) {
      const row = el.closest('.flexrow') ?? el.parentElement;
      if (row) row.style.display = 'none';
    }
  });
  const ignoreToggle = element.querySelector('[data-action="toggleValue"][data-set="ignoreArmor"]');
  if (ignoreToggle) {
    const row = ignoreToggle.closest('.flexrow') ?? ignoreToggle.parentElement;
    if (row) row.style.display = 'none';
  }
}
