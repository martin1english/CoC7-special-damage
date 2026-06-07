import { MODULE_ID } from './config.mjs';
import { registerWrappers, registerChatListener, registerSheetInterceptor } from './damage-interceptor.mjs';
import { onRenderItemSheet, injectDamageCardBadge } from './sheet-injection.mjs';

/**
 * CoC7 Special Damage - Module Entry Point
 *
 * Extends the CoC7 weapon damage pipeline to support damage to
 * characteristics, Magic Points, and Sanity instead of Hit Points.
 *
 * Foundry v13 / CoC7 v8 notes:
 * - CoC7 v8 sheets are ApplicationV2. AppV2 fires render hooks for the ENTIRE
 *   class inheritance chain (Foundry `application.mjs` #callHooks, parentClassHooks
 *   defaults true), so a single `renderCoC7ModelsActorGlobalSheet` hook covers every
 *   actor sheet (character/NPC/creature/vehicle) and `renderCoC7ModelsItemWeaponSheet`
 *   covers the weapon sheet. The render hook signature is (app, element, context),
 *   where `element` is an HTMLElement.
 * - `renderChatMessage` is deprecated → `renderChatMessageHTML` (HTMLElement arg).
 */

// ─────────────────────────────────────────────
// init: Preload templates
// ─────────────────────────────────────────────
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`);

  // v13: `loadTemplates` global is deprecated in favour of the namespaced helper.
  const loader = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  loader([
    `modules/${MODULE_ID}/templates/special-damage-config.hbs`
  ]);
});

// ─────────────────────────────────────────────
// ready: Register method wrappers
// Must be 'ready' (not 'init') because the CoC7 actor document class is set
// during the system's init hook, and module init order is not guaranteed.
// ─────────────────────────────────────────────
Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Ready — registering wrappers`);
  registerWrappers();
});

// ─────────────────────────────────────────────
// Chat log: capturing-phase click listener for damage buttons.
// ChatLog is now an ApplicationV2 (foundry.applications.sidebar.tabs.ChatLog);
// the `renderChatLog` hook still fires (class-name hook), but `html` is an
// HTMLElement and the message list container is `ol.chat-log` (was `#chat-log`).
// ─────────────────────────────────────────────
Hooks.on('renderChatLog', (app, html) => {
  registerChatListener(html);
});

// ─────────────────────────────────────────────
// Actor sheets: intercept weapon clicks for Automatic mode.
// `renderCoC7ModelsActorGlobalSheet` is the base actor-sheet class hook and,
// thanks to AppV2 parent-class hooks, fires for every concrete actor sheet.
// `renderActorSheet` is kept as a v12 fallback.
// ─────────────────────────────────────────────
Hooks.on('renderCoC7ModelsActorGlobalSheet', (app, html) => {
  registerSheetInterceptor(app, html);
});
Hooks.on('renderActorSheet', (app, html) => {
  registerSheetInterceptor(app, html);
});

// ─────────────────────────────────────────────
// Weapon item sheets: inject the Special Damage config UI.
// `renderCoC7ModelsItemWeaponSheet` is the v8 (AppV2) weapon-sheet hook;
// `renderItemSheet` is kept as a v12 fallback. onRenderItemSheet guards on type.
// ─────────────────────────────────────────────
Hooks.on('renderCoC7ModelsItemWeaponSheet', (app, html) => {
  onRenderItemSheet(app, html);
});
Hooks.on('renderItemSheet', (app, html) => {
  onRenderItemSheet(app, html);
});

// ─────────────────────────────────────────────
// Chat messages: badges + raw-damage display on special-damage damage cards.
// v13: renderChatMessageHTML replaces the deprecated renderChatMessage and
// passes an HTMLElement instead of jQuery.
// ─────────────────────────────────────────────
Hooks.on('renderChatMessageHTML', (message, html) => {
  injectDamageCardBadge(message, html);
});
