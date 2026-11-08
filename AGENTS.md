# AGENTS.md

RoProtect — MV3 browser extension (Chrome/Edge/Firefox) that warns about flagged Roblox users.
WXT + Svelte 5 (runes) + TypeScript + Tailwind 4. **Bun only** (`bun.lock`, `bun run ...`, lefthook shells out to `bun`/`bunx`).

## Commands

```bash
bun install          # postinstall runs `wxt prepare && lefthook install`
bun run dev          # Chrome (also: dev:firefox, dev:edge)
bun run build        # -> .output/chrome-mv3 (build:firefox, build:edge)
bun run quality      # pre-commit gate: check && knip && validate:i18n && stylelint && lint:fix
```

- `bun run lint` is three tools: `oxlint` → `eslint . --cache` → `oxfmt --check`. Fix with `lint:fix`.
- `bun run check` is the only typecheck (`svelte-check --tsgo`). Do **not** use `tsc --noEmit` — it does not understand `.svelte`.
- `bun run format` = `oxfmt`. Formatting is oxfmt, not prettier (prettier is present only to disable overlapping eslint rules).
- **There is no test framework** — no vitest/jest/playwright, no `test` script. Verification is purely static: `check`, `knip`, `validate:i18n`, `stylelint`, `lint`, `build`.
- CI (`.github/workflows/ci.yml`) runs on every push: `lint` → `stylelint` → `check` → `knip` → `validate:i18n` → `build`. Note it runs `lint` (check mode), not `lint:fix`. (The CI step named "Run ESLint" actually runs the full `bun run lint`.)
- `bun run quality` ends in `lint:fix`, which **rewrites your files** — always re-read the diff after running it.

### Browser targets

`build:firefox` / `dev:firefox` / `zip:firefox` pass `--mv2`, so Firefox output is **MV2** (`.output/firefox-mv2`).

### Releases

`.github/workflows/release.yml` is `workflow_dispatch` only. It reads the version from `package.json`, builds all three targets, and pushes tag `v<package.json version>` with a **draft** GitHub release (a human publishes it). There is no publish automation to the stores.

## Version lives in two places — keep them in sync

1. `package.json` → `version`
2. `wxt.config.ts` → `manifest().version` (hardcoded string, not read from package.json)

User-facing changes also belong in `src/lib/data/changelog-entries.ts`: newest entry first, `CHANGELOGS[0]` is "latest", `silent: true` suppresses the auto-modal. A new version is not "released" to users until an entry exists.

### Firefox signing (`bun run sign:firefox`)

Unlisted AMO submission via `web-ext@8` under Node (not Bun — Bun aborts the spawn with a libuv assertion). Credentials come from `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` (or `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`) in `.env` (gitignored); real env vars win over `.env`.

- Run `bun run build:firefox` first — the script signs `.output/firefox-mv2` in place.
- **AMO accepts one upload per version.** A "Conflict" / "already been submitted" error means that version number is spent: bump both version spots above and rebuild before signing again. (The script's own hint naming `REQUIRED_LEGAL_VERSION` in `constants.ts` is stale — no such symbol exists.)
- **Icons must be square and true to size.** WXT auto-detects `public/icon/{16,32,48,96,128}.png`; AMO fails the upload with `ICON_NOT_SQUARE` otherwise. Generate each size by cropping the source square first, then downscaling — never copy one file into all five slots.
- The script's final `Signed: ...` line picks the last `.xpi` **alphabetically**, not the newest — it can name a stale artifact. Verify by timestamp in `web-ext-artifacts/` (gitignored).
- The `strict_min_version` vs `data_collection_permissions` (needs FF 140, pinned at 129.0) mismatch is a **warning**, not a blocker. Don't "fix" it by raising the minimum without being asked.

## Architecture

Entrypoints are WXT-discovered; `src/entrypoints/` maps 1:1 to runtime contexts:

- `background/index.ts` — single message hub + queue-status polling/notifications + settings seeding. Everything from content/popup funnels through `dispatchContentMessage`.
- `content.ts` — Roblox pages. Matches are an explicit `matches[]` glob list in the file (plain and `https://*.roblox.com/*/...` i18n-prefixed variants). Roblox is an SPA, so it polls `popstate`/`hashchange` and hands URLs to `PageControllerManager`.
- `roscoe-bridge.content.ts` — Firefox shim: Firefox has no `externally_connectable`, so roscoe.com pages postMessage and this forwards to background.
- `popup/`, `options/` — extension pages.

**Adding support for a Roblox page touches four files:** `PAGE_TYPES` (`src/lib/types/constants.ts`) → `detectPageType` (`src/lib/utils/dom/page-detection.ts`) → a controller factory in `PageControllerManager` → a Svelte `*PageManager.svelte` under `src/components/features/`.

**Content-script UI lives in a shadow root.** `content.ts` calls `createShadowRootUi` (`rotector-overlay`) and mounts `OverlayRoot.svelte` inside. But the same `content-scripts/content.css` is **also injected page-global** via the manifest `content_scripts` `css` array, so every class in `src/styles/` applies to Roblox's own markup too. Keep class names prefixed (`rotector-*`, feature-specific) — a bare name like `page-content` matched `#game-detail-page` and broke game/settings page layout. Consequences:

- Roblox DOM is reached through `src/lib/controllers/selectors/*` and mutated via the controller/`mounted-component-registry`, not by styling Roblox's classes.
- Injected CSS has `:root` rewritten to `:host`; a bare attribute selector won't match the shadow host.
- All modals/portals go through `OverlayPortal.svelte` / `overlay-portal-registry.ts`, not ad-hoc appends to `document.body`.
- Builder Sans is registered with the `FontFace` API because WXT relocates `@font-face` into the page origin, where relative URLs 404.

**Messaging is schema-gated.** Incoming messages are parsed with valibot (`src/lib/schemas/content-message.ts`, `captcha.ts`) before dispatch; new background actions need both a schema and an `API_ACTIONS` entry. Never trust an inbound message shape.

**Storage** goes through `src/lib/utils/storage.ts` (`getStorage('sync' | 'local', key, fallback)`, `setStorageMulti`, `subscribeStorageKey` for cross-context reactivity) — not raw `browser.storage`. `sync` for settings, `local` for logs/history. New settings need entries in `SETTINGS_KEYS`, the `Settings` interface, and `SETTINGS_DEFAULTS` (all in `src/lib/types/settings.ts`), and background seeds missing defaults on startup.

## Colors & theming

There is no standalone palette doc: **`src/styles/theme/colors.css` is the source of truth** (imported by `src/styles/index.css`). It has three token layers:

- `--primitive-*` — raw values (grays, blues, status hues, dark surfaces, overlay/shadow opacities). Defined only in that file.
- `--color-*` — semantic tokens (`bg`, `text`, `border`, `primary`/`accent`, `success`/`warning`/`error`, `status-*`, `tier-*`, form controls, reasons/evidence). This is what components consume.
- `--roblox-*` — a small palette for UI rendered into Roblox's own DOM (cipher, group-members carousel) so it matches Roblox's page theme instead of the extension's.

Rules:

- **No hardcoded colors in feature CSS/Svelte** — use `var(--color-*)`. If nothing fits, add a semantic token to `colors.css` instead of a one-off hex. White/black and `color-mix()` alpha tints are the only existing exceptions.
- **Semantic over primitive:** referencing `var(--primitive-*)` outside `colors.css` is a smell. Status colors in TS (`src/lib/utils/status/scan-category.ts`, `src/lib/data/pasc.ts`) are `'var(--color-status-*)'` strings — keep them as tokens; CSS does theme switching, not JS.
- **Tints use `color-mix(in srgb, var(--color-x) 10%, transparent)`**, not new rgba literals.
- **Register every new token in the right blocks:** base value in `:root` (light); if it differs in dark, add it to **both** `@media (prefers-color-scheme: dark)` and `[data-theme='dark']` (keep those two identical — drift is a bug), and to `[data-theme='light']` whenever the dark blocks override it, so a manual light theme still wins under a dark OS.
- **Colors are not Tailwind `@theme` tokens.** `colors.css` uses plain `:root`, so utilities like `bg-primary`/`text-text-subtle` generate nothing — use `var(--color-*)` in CSS or Svelte `style` bindings (or arbitrary values like `bg-[var(--color-bg)]`). Only `radius.css`, `typography.css`, and `shadows.css` define `@theme` tokens.
- Naming is by convention (stylelint leaves `custom-property-pattern` off): `--primitive-<hue>-<step>` and `--color-<role>[-<variant>]`.

Theme mechanics live in `src/lib/utils/theme.ts`:

- `Theme = 'light' | 'dark' | 'auto'`; the default is `'dark'` (`SETTINGS_DEFAULTS`). `auto` follows Roblox's `body.dark-theme` on Roblox pages, otherwise the content-script theme, otherwise `prefers-color-scheme`.
- The manager sets `data-theme` on `<html>` and on each registered portal container. New shadow/portal roots must call `themeManager.registerPortalContainer(host)`; never set `data-theme` by hand.
- Content scripts mirror the resolved theme to `local` storage under `STORAGE_KEYS.CONTENT_THEME` (`rotector-content-theme`) and the popup subscribes to stay aligned. Use `storage.ts` / `subscribeStorageKey`, not raw `browser.storage`.
- Content CSS rewrites `:root` to `:host`, so tokens must not depend on a page-global `:root` selector.

## i18n (24 locales, both trees matter)

- `public/locales/<locale>/messages.json` — the real UI catalog consumed by svelte-i18n. Locale codes are hyphenated: `zh-CN`, `zh-TW`. `en` is the base.
- `public/_locales/<locale>/messages.json` — a **separate** Chrome/Firefox manifest catalog holding only `extensionName` / `extensionDescription` for `__MSG_*__`. Never put UI strings there.
- `bun run validate:i18n` regex-scans `src/**` for keys inside `$_()`, `get(_)()`, `t(...)`, `*Key:` / `*Key =` assignments. A key it can't see is "unused" (warning), a key it sees but can't find in `en` is "missing" (**fails CI**). Keep key literals directly inline in those call shapes.
- Add new keys to **all 24** locale files with matching `{0}`-style placeholders (mismatches fail CI), then run `bun run format:i18n` (sorts keys, tab-indents).
- New locale also requires updating `SUPPORTED_LOCALES` + `LOCALE_DISPLAY_NAMES` in `src/lib/utils/i18n.ts`, and possibly `RTL_LOCALES` / `NO_WORD_BREAK_LOCALES`.

## Lint / type strictness that will bite you

`tsconfig.json` extends `.wxt/tsconfig.json` and adds `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` (no enums, namespaces, or parameter properties), `noPropertyAccessFromIndexSignature` (index signatures need `obj['key']`, hence `process.env['NODE_ENV']` style), `verbatimModuleSyntax` (`import type`), `noImplicitReturns`, plus `noUnusedLocals` / `noUnusedParameters` (unused vars fail the typecheck, not just lint).

- Aliases: `@/` → `src/`, `@@/` → repo root (defined in `.wxt/tsconfig.json`, regenerated by `wxt prepare`).
- **Use `logger` from `@/lib/utils/logging/logger`, not `console.*`.** `no-console` is warn (not error) in `eslint.config.js`, with a hardcoded allowlist that turns it off per file. It names `src/lib/stores/statistics.ts`, which does not exist — so console is _not_ allowed in any store file. Adding a file to the list requires editing `eslint.config.js`.
- `knip` runs with `files`, `exports`, `types`, `unresolved`, `dependencies` all set to `error`. Unused exports, unused files, and unlisted deps fail CI. `knip.json` → `entry` already globs `src/components/**` and every `src/lib/**` dir, so files added there need no registration — only genuinely new entrypoints outside those globs (e.g. under `src/entrypoints/`).
- `src/lib/services/cipher/**` is exempted from `no-control-regex` in `.oxlintrc.json`; the rule is on everywhere else.
- oxfmt owns formatting: **tabs**, single quotes, print width 100, **no trailing commas**, and it sorts Tailwind classes and Svelte attribute order. eslint's `better-tailwindcss` enforces canonical class/variant form. Run `bun run format` after writing Svelte or CSS.

## Dev API switching

`wxt.config.ts` defines `import.meta.env.USE_DEV_API` as `'true'` when `NODE_ENV=development` **or** `process.argv` contains `dev`. Read it as `import.meta.env.USE_DEV_API === 'true'` (string, not boolean): `src/lib/types/constants.ts` uses it to pick the API domain (`roprotect-dev.tlet.xyz` vs `roprotect.tlet.xyz`), while `roscoe-bridge.content.ts` uses it to pick the roscoe web origin (`roscoe-dev.rotector.com` vs `roscoe.rotector.com`). `wxt build` / `wxt zip` always target production — there is no script for a production-mode build against the dev API.

`WXT_USE_POLLING=1` switches the vite dev server to 1s polling; use it on network/WSL drives where file watching misses changes.

## Gotchas

- lefthook pre-commit auto-fixes staged files and runs the typecheck, so a commit mutates your working tree. Inspect `git status`/diff after committing.
- commitlint enforces conventional commits on `commit-msg` (`feat:`, `fix:`, `chore:`, …).
- `wxt.config.ts` patches emitted chunks to escape Unicode non-characters (`\uFDD0`–`\uFDEF`, `\uFFFE`/`\uFFFF`) and aliases `webgl-obj-loader` to its unminified dist — both are required for MV3 CSP / Chrome content-script loading. Don't remove them.
- CSS minification is `lightningcss` (not esbuild/terser) with explicit browser targets.
