import { MODULE_ID } from './config.mjs';
import { registerWrappers, registerChatListener, registerSheetInterceptor } from './damage-interceptor.mjs';
import { onRenderItemSheet, injectDamageCardBadge, autoSetInitiatorSuccess } from './sheet-injection.mjs';

/**
 * CoC7 Special Damage - Module Entry Point
 *
 * Extends the CoC7 weapon damage pipeline to support damage to
 * characteristics, Magic Points, and Sanity instead of Hit Points.
 */

// ─────────────────────────────────────────────
// init: Preload templates
// ─────────────────────────────────────────────
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`);

  loadTemplates([
    `modules/${MODULE_ID}/templates/special-damage-config.hbs`
  ]);
});

// ─────────────────────────────────────────────
// ready: Register method wrappers
// Must be 'ready' (not 'init') because game.CoC7 is set
// during the system's init hook, and module init order
// is not guaranteed.
// ─────────────────────────────────────────────
Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Ready — registering wrappers`);
  registerWrappers();
});

// ─────────────────────────────────────────────
// renderChatLog: Register capturing-phase click listener
// for legacy melee and ranged damage buttons
// ─────────────────────────────────────────────
Hooks.on('renderChatLog', (app, html, data) => {
  registerChatListener(html);
});

// ─────────────────────────────────────────────
// renderActorSheet: Intercept weapon clicks for Automatic mode
// The CoC7 character sheet bypasses actor.weaponCheck() and
// directly creates initiator cards — this listener catches
// automatic-mode weapons before the sheet handler fires.
// ─────────────────────────────────────────────
Hooks.on('renderActorSheet', (app, html, data) => {
  registerSheetInterceptor(app, html, data);
});

// ─────────────────────────────────────────────
// renderItemSheet: Inject Special Damage config on weapon sheets
// ─────────────────────────────────────────────
Hooks.on('renderItemSheet', (app, html, data) => {
  onRenderItemSheet(app, html, data);
});

// ─────────────────────────────────────────────
// renderChatMessage: Auto-Success on initiator cards + badges on damage cards
// ─────────────────────────────────────────────
Hooks.on('renderChatMessage', (message, html, data) => {
  autoSetInitiatorSuccess(message, html, data);
  injectDamageCardBadge(message, html, data);
});
