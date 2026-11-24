# RoProtect upstream-to-fork code review

**Scope:** `git diff origin/main...HEAD` (MistAxis `roprotect-refactor`, HEAD `88aa210`)
**Size:** 14 commits, 88 files, +4237 / −281
**Review type:** read-only; no production code changed by this review
**Date:** 2026-10-19

## Verdict

**Not ship-ready.** The PASC provider is partially wired as a production feature while still shipping a mock record and a mock edit path that can reach the real PASC API. Several PASC override paths also fail open, and the content-script feature gate is bypassed by SPA navigation.

Static verification already performed:

- `bun run check` — pass
- `bun run validate:i18n` — pass
- `bun run lint` — pass with one warning: `src/entrypoints/background/http-client.ts:212` (cognitive complexity 40 vs 20)
- `bun run knip` — pass
- `bun run stylelint` — pass
- `bun run build` — pass

These checks cannot catch the problems below because there is no test framework and `validate:i18n` cannot see hardcoded strings.

## Priority definitions

- **P0 — Release blocker:** false data shown about real users, real API writes from mock UI, or equivalent harm.
- **P1 — Must fix before release:** core feature behaves incorrectly, privacy/gating regression, or major state inconsistency.
- **P2 — Fix before release / strong follow-up:** significant UX, security-hardening, localization, or robustness defect.
- **P3 — Cleanup / minor:** low user impact, accessibility polish, dead code, maintenance risk.

## Summary

| ID    | Priority | Area              | Problem                                                                            |
| ----- | -------- | ----------------- | ---------------------------------------------------------------------------------- |
| P0-1  | P0       | PASC mock         | Every tooltip/group can render a fake PASC Unsafe record and fake Discord accounts |
| P0-2  | P0       | PASC mock         | Mock edit/upload path calls the real PASC API with user ID `123456789`             |
| P1-1  | P1       | PASC override     | PASC SAFE downgrade is ignored by `isFlagged` and `getFlaggingResult`              |
| P1-2  | P1       | Content script    | SPA navigation bypasses the feature/API-key gate                                   |
| P1-3  | P1       | PASC parsing      | Unknown flags and no-record detection fail open to SAFE                            |
| P1-4  | P1       | PASC state        | Save/refresh updates the tab only; header and parent status stay stale             |
| P1-5  | P1       | Privacy           | Blur protection now starts after async initialization, causing an unblurred flash  |
| P1-6  | P1       | Overlay lifecycle | `overlay.remove()` does not unmount the Svelte app, so remounts leak instances     |
| P2-1  | P2       | PASC modal        | Report/Recheck modal is contained by `.pasc-container` instead of the viewport     |
| P2-2  | P2       | PASC modal        | Escape cannot close either PASC modal; no focus trap or initial focus              |
| P2-3  | P2       | PASC clearance    | Failed clearance defaults viewer level to M2 (full visibility)                     |
| P2-4  | P2       | PASC editor       | Note visibility and record visibility are coupled; internal floor control is inert |
| P2-5  | P2       | Scan UI           | PASC scan chip is always shown and stays at `0/total` when PASC is disabled        |
| P2-6  | P2       | PASC files        | File upload/download has no size limit and base64-encodes everything in memory     |
| P2-7  | P2       | i18n              | PASC UI is hardcoded English and cannot be detected by `validate:i18n`             |
| P2-8  | P2       | Performance       | Global/progressive timeouts doubled; SCSN/TASE raised to 120s                      |
| P2-9  | P2       | Content script    | No navigation token; slow activation can mount the wrong page                      |
| P2-10 | P2       | PASC state        | Per-user reset omits selected file, delete state, and file action errors           |
| P3-1  | P3       | Accessibility     | `Select` lacks `aria-activedescendant` and roving focus semantics                  |
| P3-2  | P3       | PASC UX           | Report/Recheck buttons remain clickable after a request is sent                    |
| P3-3  | P3       | Resource leak     | File object URL is not revoked when the tooltip unmounts                           |
| P3-4  | P3       | Async state       | Mock file-preview render has no cancellation/token guard                           |
| P3-5  | P3       | PASC editor       | Markdown fallback textarea does not update the preview                             |
| P3-6  | P3       | Dead code         | `PascMockupSection.svelte` is unreferenced                                         |
| P3-7  | P3       | Maintenance       | `pasc-mock.ts` comments claim it is not wired to production                        |
| P3-8  | P3       | Tooling           | `package.json` declares pnpm in a Bun-only repository                              |
| P3-9  | P3       | PASC editor       | Closing with unsaved changes discards them without confirmation                    |
| P3-10 | P3       | Overlay lifecycle | Failed CSS activation leaves `visualsActive = true` with no retry                  |
| P3-11 | P3       | Scan UI           | Progress denominator excludes custom APIs, so the bar can sit at 95%               |

---

## P0 — Release blockers

### P0-1 — Every tooltip can render a fake PASC Unsafe record

**Where**

- `src/components/status/Tooltip.svelte:297-309`
- `src/components/status/Tooltip.svelte:316`
- `src/components/status/Tooltip.svelte:1616-1642`
- `src/lib/data/pasc-mock.ts`
- `src/components/status/PascDisplay.svelte:300-455`

**Problem**

When `system-pasc` is absent from the combined status, `Tooltip.svelte` still appends a `system-pasc` tab. That branch then renders:

- `MOCK_PASC_RECORD` as the record for the real hovered user
- `MOCK_PASC_DISCORD_ACCOUNTS` as linked Discord accounts
- mock case files and mock internal review
- `canEdit` hardcoded to `true`
- `viewerLevel` hardcoded to `M2`

The mock record is flagged **Unsafe**, so every user/group tooltip can claim a PASC Unsafe verdict that does not exist. This is not isolated to a developer screen; it is the production tooltip path.

The module comment in `pasc-mock.ts` still says “Nothing here is wired to a backend,” but the mock record is now imported by the live tooltip.

**Impact**

- False accusations against every user hovered while PASC is not reported by whoami.
- Fake internal-review and Discord data shown as if real.
- Makes the PASC feature appear broken/unsafe in production.
- The always-added tab also masks the absence of the provider instead of showing “no data.”

**Fix**

Remove the mock branch and the unconditional tab entry before shipping. Render the PASC tab only when `system-pasc` is present in the combined status; for an absent provider show no PASC tab at all. If a developer preview is still needed, gate it behind an explicit dev-only flag or route it through the unused `PascMockupSection` rather than the production tooltip.

---

### P0-2 — Mock edits/uploads can write to the real PASC API

**Where**

- `src/components/status/Tooltip.svelte:1620-1641`
- `src/components/status/PascEditModal.svelte:146-167`
- `src/components/status/PascEditModal.svelte:169-226`
- `src/lib/services/rotector/api-client.ts:257-278`

**Problem**

The mock branch passes `canEdit` without a clearance check and opens a real `PascEditModal` with `record={MOCK_PASC_RECORD}` and no `onSaved`/`onRefresh`. `PascEditModal.save()` calls `apiClient.upsertPascRecord(record.userId, …)`, and the file picker calls `uploadPascFile(record.userId, …)`. The mock record’s user ID is `123456789`.

A normal user will get a failed request, but the dangerous case is a signed-in **M1+ reviewer** (the exact group that can write) seeing the mock path during a whoami/PASC outage or on a build where PASC is not reported.

**Impact**

- Potential overwrite of a real PASC case record for user `123456789`.
- Potential upload of files into that user’s real case file.
- No success feedback or refresh after a successful mock save; modal stays open.
- A production UI exposing destructive/write actions with no mock guard.

**Fix**

Never call API methods for mock records. Either remove the mock branch entirely (preferred), or inject no-op handlers and disable save/upload/delete in mock mode. Also require `$pascCanEdit` and a non-mock record before opening the editor.

---

## P1 — Must fix before release

### P1-1 — PASC SAFE downgrade is ignored by flag-state consumers

**Where**

- `src/lib/utils/status/status-utils.ts:110-145`
- `src/lib/utils/status/status-utils.ts:230-242`
- `src/components/features/profile/ProfilePageManager.svelte:67`, `:355`
- `src/components/features/friends/FriendWarning.svelte:46`
- `src/components/features/lists/UserListManager.svelte:455`, `:467`

**Problem**

`pickHighestSeveritySystemResult` correctly makes a present PASC record authoritative, including downgrades to SAFE. But `isFlagged` checks _any_ API result for an actionable flag, and `getFlaggingResult` only returns PASC when PASC itself is actionable. Therefore:

- PASC SAFE + SCSN UNSAFE ⇒ `isFlagged` still true.
- Profile and list UIs still treat the user as flagged.
- Friend-request warning still opens and uses SCSN/RAB/TASE reasons.
- Mixed PASC outcomes such as non-actionable PASC past-offender/provisional records are also bypassed.

This contradicts the changelog claim that indicators follow the PASC verdict.

**Impact**

Users see the status indicator as SAFE while the profile warning, list flag, and friend warning still behave as UNSAFE. PASC’s core override promise is broken in the most user-visible warning flows.

**Fix**

Make PASC record presence authoritative in every flag-state helper, not only the summary helper. At minimum:

- `isFlagged` should return `false` when a present PASC record is non-actionable and should not fall through to other providers.
- `getFlaggingResult` should return the PASC result (or an explicit no-flag result) whenever PASC is present.
- Consider a single `hasPascRecord`/`getAuthoritativeVerdict` helper used by all of these paths.
- Add regression coverage for PASC SAFE + SCSN UNSAFE across profile, list, and friend-warning flows (manual test if no framework).

---

### P1-2 — SPA navigation bypasses the feature/API-key gate

**Where**

- `src/entrypoints/content.ts:109-120`
- `src/entrypoints/content.ts:179-221`

**Problem**

The initial gate is only applied around `handleUrl(currentUrl)` at `:210-219`. But `popstate`/`hashchange` listeners are registered unconditionally at `:200-208`, and `handleUrl` (`:179-185`) never checks `extensionFeaturesEnabled`. A user with no API key who performs an SPA navigation onto a supported Roblox page will run `activateVisuals()` and `pageManager.handleNavigation()` anyway.

`extensionFeaturesEnabled` is derived from API-key presence via `legal.ts:21`, so this is an onboarding/feature gate, not just a visual preference.

**Impact**

- Overlay and page controllers can initialize without the required API key/onboarding state.
- Status requests fail or show error states in a UI that should not exist yet.
- The gate is trivially bypassed without a full page reload.

**Fix**

- Guard `handleUrl` itself with `get(extensionFeaturesEnabled)`.
- Do not register navigation listeners until the gate opens.
- Subscribe to gate changes for both enable and disable; on disable, call `deactivateVisuals()` and clean up the current controller.
- Do not construct `PageControllerManager` before the gate is known to be open unless it is truly inert.

---

### P1-3 — PASC parsing fails open to SAFE

**Where**

- `src/lib/utils/status/pasc-record.ts:58-60`
- `src/lib/utils/status/status-utils.ts:198-215`
- `src/lib/utils/status/status-utils.ts:230-242`

**Problem**

Two independent fail-open paths exist:

1. `mapPascUserStatus` maps `NUMERIC_TO_PASC_FLAG[data.flagType] ?? 'safe'`. Any flag value not in the map (including `UNKNOWN = -1`, or a future PASC flag) becomes SAFE in the PASC tab.
2. `isPascRecordPresent` treats any PASC data without the exact English badge `PASC - Not in database` as a real record. If the proxy changes the wording, adds a prefix, or returns a different miss shape, every miss becomes an authoritative record and `pickHighestSeveritySystemResult` overrides the automatic providers with the miss’s SAFE verdict.

**Impact**

- A backend flag addition can silently clear real unsafe verdicts.
- A wording/casing change in a badge can downgrade every user to SAFE and show a fake PASC record.
- PASC tab and summary indicator can disagree for unknown flags.

**Fix**

- Do not default unknown flags to SAFE. Treat them as UNKNOWN/error and do not override.
- Replace magic English badge matching with an explicit proxy field such as `recordPresent`, `miss`, or `recordId`.
- If a marker must remain, make it a shared constant returned by the backend contract and fail closed when it is absent/ambiguous.
- Add tests for unknown flag, miss, flag-only record, and changed marker text.

---

### P1-4 — PASC save/refresh updates only the tab, leaving header and parent state stale

**Where**

- `src/components/status/Tooltip.svelte:323-337`
- `src/components/status/Tooltip.svelte:386-402`
- `src/components/status/Tooltip.svelte:408-431`
- `src/components/status/Tooltip.svelte:1547-1613`

**Problem**

`pascDisplayRecord` prefers `pascSavedStatus`, but `pascHeaderBadge` reads `pascResult?.data` from the original combined status. After a save or refresh:

- Changing Unsafe → SAFE leaves the header badge Unsafe.
- Changing SAFE → Unsafe leaves the header badge SAFE.
- Creating a record from the draft path leaves `pascResult` as the old miss. `pascDisplayRecord` becomes non-null, so `pascReferral` returns null, and the header badge can disappear entirely.

The parent `userStatus` combined map is not updated either, so status indicators, list flags, profile warnings, and scans remain stale until a full refetch.

**Impact**

Immediate UI lies about the result of the moderator’s action and can leave the page-level flag state inconsistent with the edited record.

**Fix**

- Derive the header badge from `pascSavedStatus ?? pascResult.data` with the same record-presence logic.
- Update or invalidate the parent combined status after a write; trigger a refetch of the current user and list row.
- On create, construct a proper record-presence state instead of relying on the old miss result.
- Add a manual test for create, safe→unsafe, unsafe→safe, and refresh after file upload/delete.

---

### P1-5 — Blur protection starts late and leaks an unblurred flash

**Where**

- `src/entrypoints/content.ts:122-128`
- `src/entrypoints/content.ts:100-107`
- Old behavior: `origin/main:src/entrypoints/content.ts:67` injected at `document_start`.

**Problem**

`injectDefaultBlurStyles()` and `injectBlurStyles()` now run only inside `activateVisuals()`, which is reached after:

1. language preference load
2. settings initialization
3. custom API load
4. `waitForBody()`
5. page-type detection and async activation

On supported pages, names and avatars are visible during that window. The previous implementation injected default blur at the top of `main()` before any awaits.

**Impact**

Privacy regression for users who rely on display-name/username/avatar blurring. The exact duration depends on storage/API latency and page readiness.

**Fix**

Inject default blur styles immediately when the current URL is a supported page, before the async loads. If the zero-footprint goal on unsupported pages matters, detect the URL synchronously and only inject there; remove on unsupported navigation.

---

### P1-6 — Overlay teardown does not unmount the Svelte app

**Where**

- `src/entrypoints/content.ts:130-162`
- `src/entrypoints/content.ts:171-176`

**Problem**

`deactivateVisuals()` calls `overlay?.remove()`. WXT’s shadow-root `remove()` clears the UI container and invokes `onRemove`, but it does not call Svelte’s `unmount()`. On return to a supported page, `overlay.mount()` invokes `onMount` again and mounts a second `OverlayRoot` while the first instance is still alive and detached.

**Impact**

- Duplicate reactive effects/listeners after each supported ↔ unsupported SPA cycle.
- Memory growth over long Roblox sessions.
- Stale portal/modal state from the detached app can interact with the same `uiContainer` after remount.
- `themeManager.registerPortalContainer` is re-run with the same host, but the old app remains subscribed.

**Fix**

Choose one lifecycle model:

- Keep the overlay mounted and hide/deactivate it without removing the app, or
- Call `unmount()` on the Svelte app and set `overlay = null` before re-creating it on return.

Also reset `visualsActive` only after successful teardown.

---

## P2 — Fix before release / strong follow-up

### P2-1 — Report/Recheck modal is contained by `.pasc-container`

**Where**

- `src/styles/features/pasc.css:6-9`
- `src/components/status/PascDisplay.svelte:300`
- `src/components/status/PascDisplay.svelte:574-585`

**Problem**

`PascDisplay`’s root is `.pasc-container`, which sets `container-type: inline-size`. That applies layout containment, making it a containing block for fixed-position descendants. The Report/Recheck `modal-overlay.visible` (`position: fixed; inset: 0`) is rendered inside that root, so its containing block becomes the PASC panel instead of the viewport. The modal is also not portalled through `OverlayPortal`, contrary to the project convention.

**Impact**

- Overlay does not cover the page.
- Modal is constrained to the tooltip/PASC content width rather than centered in the viewport.
- Clicking outside the PASC panel does not behave like the rest of the app’s modals.
- Higher risk of clipping/scroll interactions.

**Fix**

Render the review modal through `OverlayPortal` outside `.pasc-container`, or move the overlay markup out of the container. Keep the `modal-overlay`/`modal-popup` shell.

---

### P2-2 — Escape cannot close PASC modals; focus is not managed

**Where**

- `src/components/status/PascEditModal.svelte:253-259`
- `src/components/status/PascReviewModal.svelte:49-55`
- `src/components/status/Tooltip.svelte:1564-1566`
- `src/components/status/PascDisplay.svelte:581-583`

**Problem**

Both modal roots stop **all** keydown propagation. The parent overlay handlers that check `Escape` never receive the event, and the modal roots themselves do not close on Escape. The overlays have `tabindex="-1"` but never focus themselves, and there is no focus trap or initial focus.

**Impact**

- Escape does nothing in either PASC modal.
- Keyboard focus stays on the Edit/Report button behind the overlay.
- Tab can escape into the tooltip/page.
- Accessibility and expected modal behavior are broken.

**Fix**

Handle Escape inside the modal roots before stopping propagation. Move focus into the dialog on open, trap Tab, restore focus on close, and keep the existing overlay fallback or remove the dead overlay handlers.

---

### P2-3 — Failed clearance defaults to M2 (full visibility)

**Where**

- `src/lib/stores/pasc-clearance.ts:39-48`
- `src/components/status/PascDisplay.svelte:78-90`
- `src/components/status/Tooltip.svelte:1547-1556`

**Problem**

`pascViewerLevel` is `state.level ?? 'M2'`. If clearance is loading or the request fails, the client treats the viewer as M2 and enables all client-side PASC detail gates: public note, internal review, files, and the A2 Discord block. The comment argues that server-filtered data makes this safe, but it removes client defense-in-depth and is immediately unsafe for the mock record.

The Discord block is derived from TASE detections, not PASC server filtering; the A2 gate there is purely client-side. TASE may already expose similar data in its own tab, but the PASC-specific gate still does not hold on failure.

**Impact**

- A failed clearance lookup never reduces shown detail.
- Client-side PASC clearance becomes effectively advisory.
- Combined with P0-1, every viewer is treated as M2.

**Fix**

Use a loading/unknown state instead of M2. Render details only after clearance resolves, or default to `'0'` and rely on an explicit server-side signal for any elevated detail. Do not use a full-access fallback.

---

### P2-4 — PASC editor’s visibility controls are inconsistent

**Where**

- `src/components/status/PascEditModal.svelte:79-83`
- `src/components/status/PascEditModal.svelte:146-160`
- `src/components/status/PascEditModal.svelte:288-311`

**Problem**

- `accessLevel` is sent as `publicNoteLevel`, so changing “Public note visibility” also changes who can see the whole record.
- `internalMinLevel` is exposed as “Internal review visibility” but is never sent. The comment says it has no server field and the floor is always M1, so the control is inert.
- The UI allows selecting `M2` for the internal floor even though the server normalizes to M1.
- `record.internalReviewMinLevel` can come from the mapper as `M1`; editing cannot preserve/change a different floor.

**Impact**

Moderators cannot configure the two visibilities independently despite the UI claiming they can. A user may believe they tightened internal review visibility when nothing was sent.

**Fix**

Either send and honor `internalReviewMinLevel`, or remove the control and show a fixed “M1+ (server enforced)” label. Keep record access and public-note visibility as separate fields if the PASC schema supports them.

---

### P2-5 — PASC scan chip is always shown and sticks at `0/total`

**Where**

- `src/lib/services/rotector/scan-jobs.ts:72-103`
- `src/lib/services/rotector/scan-jobs.ts:238-259`
- `src/components/features/scan/ScanBar.svelte:148-173`

**Problem**

`withPascChip` always appends a display-only PASC provider. When PASC is not enabled, no PASC lookup runs, so the chip stays at `0/total` for the entire scan. The progress percentage denominator uses only the enabled system providers, so the bar can reach 95% while the PASC chip is still zero.

In custom-only scans, `onUpdate` calls `onProgress(pct)` without a detail object, so `ScanBar` keeps the initial zeroed PASC chip indefinitely.

**Impact**

Every friend scan displays a broken/stuck PASC indicator, making the new progress UI look unreliable and implying PASC is enabled when it is not.

**Fix**

Only add the PASC chip when `system-pasc` is in the enabled provider list. If a disabled placeholder is desired, render it as disabled and do not present it as progress. Ensure custom-only scans either include PASC in the denominator or omit the chip.

---

### P2-6 — PASC file transfer has no size limit and base64-buffers everything

**Where**

- `src/lib/schemas/content-message.ts:170-180`
- `src/components/status/PascEditModal.svelte:169-226`
- `src/lib/services/rotector/api-client.ts:33-49`, `:264-294`
- `src/entrypoints/background/endpoints/pasc.ts:84-135`, `:145-180`

**Problem**

- `bytesBase64` has only `minLength(1)`; no max.
- `PascEditModal` reads each file fully into an `ArrayBuffer`, base64-encodes it, and sends it through extension messaging.
- The background decodes it to a binary string/Uint8Array and builds a `Blob`/`FormData`.
- Download does the same in reverse; the whole file is in memory at least twice.
- No total upload size or file-count cap.
- Raw `fetch` calls for upload/download/delete bypass the normal timeout, retry, Retry-After, and client-ID handling.

**Impact**

Large files can freeze the content script/background, exceed messaging limits, fail with opaque errors, or leave the modal stuck on “Uploading.” A hung raw fetch has no timeout.

**Fix**

Add a client and schema maximum file size and total batch size (e.g., 5–10 MB), validate `contentType` length, enforce file count, and show a clear size error before reading the file. Give raw PASC file requests explicit timeouts and client IDs; consider streaming/downloading through the browser download API rather than base64 messaging.

---

### P2-7 — PASC UI is hardcoded English

**Where**

- `src/components/status/PascDisplay.svelte`
- `src/components/status/PascEditModal.svelte`
- `src/components/status/PascReviewModal.svelte`
- `src/components/status/PascLinkedDiscord.svelte`
- `src/components/status/PascMarkdownEditor.svelte`
- `src/lib/data/pasc-mock.ts`
- `src/components/status/Tooltip.svelte` (PASC aria-labels)

**Problem**

The PASC feature contains extensive hardcoded English: flag labels, “PASC verdict,” “Linked Discord,” “Edit record,” “Create record,” “Report,” “Ask for Recheck,” “Case details require…,” modal titles, placeholders, errors, and date/footer text. None of these use `$_()`.

`bun run validate:i18n` passes because it only scans known key-call shapes and cannot see literals. Non-English users get a half-translated tooltip in a new provider tab.

**Impact**

Feature is inaccessible/inconsistent in 23 of 24 supported locales. The PASC tab is user-facing and appears on every tooltip due to P0-1.

**Fix**

Add keys for every string to all 24 locale catalogs, use existing status keys where possible, run `bun run format:i18n`, and add the keys to `validate:i18n` coverage. Do not ship the tab to non-English users until translated, or gate it to English.

---

### P2-8 — Timeout changes are broad and likely unintended

**Where**

- `src/lib/types/constants.ts` (`TIMEOUT`, `PROGRESSIVE_API_TIMEOUT`)
- `src/lib/stores/custom-apis.ts:171-177`

**Problem**

- Global timeout: `10s → 30s`
- Progressive API timeout: `15s → 30s`
- SCSN/TASE provider timeout: `60s → 120s`

These affect the entire extension, not only PASC. Scans and tooltips can wait much longer for a failing provider. With the existing retry policy, a failing SCSN/TASE batch can take minutes per chunk. PASC’s own batch timeout is 30s, so the global increase is not explained by PASC alone.

**Impact**

- Tooltips can remain in a loading state for 30s instead of 15s.
- Scans can stall far longer when a provider is down.
- Worse perceived performance across the whole extension.

**Fix**

Revert the global/progressive changes unless separately justified. If SCSN/TASE need a longer timeout, scope it to those providers or add an overall scan/tooltip deadline. Make timeout policy explicit per endpoint.

---

### P2-9 — No navigation token; slow activation can mount the wrong page

**Where**

- `src/entrypoints/content.ts:179-197`
- `src/lib/controllers/PageControllerManager.ts:90-117`

**Problem**

`handleUrl(url)` awaits `activateVisuals()` and then `pageManager.handleNavigation(url)`. There is no generation/token or abort. If the user navigates again while activation is pending, the older call can complete after the newer one and mount the overlay/controller for the stale URL. `PageControllerManager` has an `isNavigating` guard, but that drops a navigation rather than ensuring the latest URL wins.

**Impact**

- Overlay/controllers can attach to the wrong page after rapid SPA navigation.
- Visual/controller state may not match `location.href`.
- Reproducible during initial activation when CSS fetch and mount are asynchronous.

**Fix**

Add a monotonically increasing navigation token or `AbortController`. After every `await`, compare the token/URL and discard stale results. Do not let `isNavigating` silently drop the latest navigation.

---

### P2-10 — Per-user PASC reset is incomplete

**Where**

- `src/components/status/PascDisplay.svelte:97-110`
- `src/components/status/PascDisplay.svelte:134-151`
- `src/components/status/PascDisplay.svelte:157-214`
- `src/components/status/PascDisplay.svelte:218-236`

**Problem**

The `$effect` explicitly resets per-user state because the component can be reused across tooltips, but it does not reset:

- `selectedFileId`
- `fileActionError`
- `deletingFile`
- `confirmingDeleteId` when there is no new record

If a reviewer previews a file for user A and the component is reused for user B, B can inherit A’s selected file ID, a stale file error, or a stuck delete state. If file IDs happen to collide, B’s file can auto-download unexpectedly.

**Impact**

Cross-user UI leakage and confusing error/selection state in a moderator tool that handles sensitive case files.

**Fix**

Reset all user-scoped file state in the userId effect (`selectedFileId = null`, `fileActionError = null`, `deletingFile = false`, `confirmingDeleteId = null`) and revoke any active object URL. Better: key the tooltip/PASC component by user ID so reuse cannot occur.

---

## P3 — Cleanup / minor

### P3-1 — `Select` accessibility

`src/components/ui/Select.svelte:200-250` uses a listbox with focusable `<button role="option">` elements and no `aria-activedescendant`. Arrow keys move `activeIndex` but focus stays on the trigger, so screen readers do not announce the active option. Add stable option IDs, `aria-activedescendant`, and roving `tabindex`/option focus semantics. Also stop propagation when Escape is consumed so it cannot close the parent tooltip if the component is reused outside a modal.

### P3-2 — Duplicate Report/Recheck requests

`PascDisplay.svelte:320-329` and `:492-501` change the label after `reviewDone` but leave the button enabled. Clicking again reopens the modal and can send another request. Disable the button while sent, or require an explicit edit/reset.

### P3-3 — File object URL leak on unmount

`PascDisplay.svelte:157-214` revokes the previous object URL when the selection changes, but the effect cleanup only sets `cancelled = true`. The final blob URL is not revoked when the tooltip unmounts. Add cleanup that revokes `lastObjectUrl` on destroy.

### P3-4 — Mock file preview race

`PascDisplay.svelte:168-173` starts `renderMarkdown(preview)` without a cancellation/token guard. Rapidly selecting two mock files can let the older render overwrite the newer preview. Reuse the token/cleanup pattern used for notes.

### P3-5 — Markdown fallback preview does not update

`PascMarkdownEditor.svelte` falls back to a textarea when CodeMirror fails, but only the CodeMirror update listener refreshes `previewHtml`. Typing in the fallback updates `value` but not the preview. Add an `oninput`/effect for the fallback path.

### P3-6 — `PascMockupSection` is dead code

`src/components/popup/developer/PascMockupSection.svelte` is not imported anywhere. Its comments claim it is mounted on the Stats page. Either wire it into a dev-only route or delete it so the mock harness does not imply a working preview path.

### P3-7 — Stale PASC comments

`src/lib/data/pasc-mock.ts:1-5` still says “Nothing here is wired to a backend” and “dev-only preview.” In reality the module supplies production types, access-rank logic, maps, and the always-rendered mock record. Update or remove these comments before the mock code is deleted.

### P3-8 — pnpm declared in a Bun-only repo

`package.json` adds `"packageManager": "pnpm@12.11.2+sha512:…"` while the repo documents `bun.lock`/Bun-only workflows. This can confuse Corepack, editors, and contributors. Remove the pnpm entry unless the repo is intentionally migrating.

### P3-9 — Unsaved PASC edits close silently

`PascEditModal` closes on X/Cancel without checking whether fields changed. A moderator can lose a substantial public note or internal review. Add a dirty check/confirmation or autosave as a draft.

### P3-10 — Failed overlay activation is permanent

`content.ts:122-128` sets `visualsActive = true` before fetching/mounting. If `fetch(cssUrl)` or `createShadowRootUi` fails, the flag stays true and subsequent navigations skip activation. The initial error is caught only by the outer `main()` catch. Set the flag after successful mount and reset it on failure.

### P3-11 — Scan progress denominator excludes custom APIs

`scan-jobs.ts:238-259` computes progress from system providers only, while completion waits for custom APIs too. With a slow custom API, the bar can sit at 95% after all system providers finish. This is not incorrect data, but the progress UI promises more than it measures. Include custom APIs in the progress model or label the bar as system-provider progress.

---

## Release recommendation

1. Remove the production PASC mock branch and all mock write paths.
2. Fix PASC authoritative-verdict handling in `isFlagged`/`getFlaggingResult`.
3. Add the feature gate to navigation and teardown.
4. Replace fail-open PASC parsing with explicit record/flag fields.
5. Fix PASC state propagation and modal lifecycle.
6. Restore immediate blur injection.
7. Address localization and file-size limits before exposing PASC broadly.

P0 and P1 items are release blockers. P2 items should be fixed in the same pass because they affect the same PASC release surface. P3 items can follow, except accessibility/focus fixes that are cheap to include with P2-2.
