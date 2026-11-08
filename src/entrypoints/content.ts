import '../styles/index.css';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { logger } from '@/lib/utils/logging/logger';
import { PageControllerManager } from '@/lib/controllers/PageControllerManager';
import { themeManager } from '@/lib/utils/theme';
import { initializeSettings, settings } from '@/lib/stores/settings';
import { extensionFeaturesEnabled } from '@/lib/stores/legal';
import { loadStoredLanguagePreference } from '@/lib/stores/i18n';
import { loadCustomApis } from '@/lib/stores/custom-apis';
import {
	initializeRestrictedAccess,
	resetRestrictedAccess,
	setupRestrictedAccessListener
} from '@/lib/stores/restricted-access';
import { subscribeStorageKey } from '@/lib/utils/storage';
import { clearViewerScopedCaches } from '@/lib/utils/caching/viewer-cache';
import {
	injectBlurStyles,
	injectDefaultBlurStyles,
	removeBlurStyles
} from '@/lib/services/blur/service';
import { detectPageType } from '@/lib/utils/dom/page-detection';
import { computeAndCacheDeviceFingerprint } from '@/lib/utils/device-fingerprint';
import { metricsCollector } from '@/lib/utils/logging/metrics-collector';
import { registerOverlayContainer } from '@/lib/utils/overlay-portal-registry';
import OverlayRoot from '@/components/overlay/OverlayRoot.svelte';

async function registerBuilderSans(): Promise<void> {
	try {
		const url = browser.runtime.getURL(
			'/fonts/builder-sans/BuilderSans.woff2' as Parameters<typeof browser.runtime.getURL>[0]
		);
		const face = new FontFace('Builder Sans', `url("${url}")`, { weight: '400' });
		await face.load();
		document.fonts.add(face);
	} catch (error) {
		logger.warn('Builder Sans font registration failed; falling back to system font', error);
	}
}

async function waitForBody(): Promise<HTMLElement> {
	return new Promise((resolve) => {
		// document.body is typed as non-null but can be null before DOM loads
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- document.body is typed non-null but is null at document_start before DOM parse
		if (document.body) {
			resolve(document.body);
			return;
		}
		const observer = new MutationObserver(() => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- document.body is typed non-null but is null at document_start before DOM parse
			if (document.body) {
				observer.disconnect();
				resolve(document.body);
			}
		});
		observer.observe(document.documentElement, { childList: true });
	});
}

export default defineContentScript({
	matches: [
		// All Roblox pages
		'https://*.roblox.com/*',
		// Internationalized URLs
		'https://*.roblox.com/*/*'
	],
	runAt: 'document_start',

	async main(ctx: ContentScriptContext) {
		try {
			logger.info('Rotector content script initializing...');

			// Privacy first: blur supported pages before any async storage/API
			// work. The per-setting pass below replaces this default stylesheet
			// once settings are loaded.
			if (detectPageType(globalThis.location.href) !== null) {
				injectDefaultBlurStyles();
			}

			logger.debug('Loading stored language preference...');
			await loadStoredLanguagePreference();
			logger.debug('Language preference loaded successfully');

			logger.debug('Initializing settings...');
			await initializeSettings();
			logger.debug('Settings loaded successfully');

			if (detectPageType(globalThis.location.href) !== null) {
				injectBlurStyles();
			}

			logger.debug('Loading custom APIs configuration...');
			await loadCustomApis();
			logger.debug('Custom APIs loaded successfully');

			// Set once navigation is wired below. A key change re-runs the current
			// URL so page controllers rebuild with the new viewer's data.
			let reapplyNavigation: (() => void) | null = null;

			// Reload custom APIs when API key changes (so new system APIs from whoami are loaded)
			subscribeStorageKey<string>('sync', 'apiKey', async (newKey) => {
				// A different key is a different viewer: drop cached verdicts,
				// PASC clearance/case details, and linked Discord data before
				// anything can be rendered under the new identity.
				clearViewerScopedCaches();
				// A different key may have different access; never keep a stale block.
				await resetRestrictedAccess();
				if (newKey?.trim()) {
					logger.debug('API key changed, reloading custom APIs...');
					await loadCustomApis();
					logger.debug('Custom APIs reloaded successfully');
				}
				reapplyNavigation?.();
			});

			logger.debug('Initializing access state...');
			await initializeRestrictedAccess();
			setupRestrictedAccessListener();
			logger.debug('Access state initialized');

			await waitForBody();

			// Register Builder Sans against document.fonts. WXT moves @font-face rules
			// into document.head where relative URLs resolve against the page origin
			// and 404; the FontFace API takes the explicit extension URL.
			void registerBuilderSans();

			themeManager.initializeRobloxTheme();

			// Pages without extension features (settings, game details, ...) get a
			// zero visual footprint: no overlay, no injected styles, no controllers.
			// The manager is created lazily only once the feature gate opens.
			let pageManager: PageControllerManager | null = null;
			const ensurePageManager = (): PageControllerManager => {
				pageManager ??= new PageControllerManager();
				return pageManager;
			};

			type Overlay = Awaited<ReturnType<typeof createShadowRootUi>>;
			let overlay: Overlay | null = null;
			let overlayApp: ReturnType<typeof mount> | null = null;
			let overlayAttached = false;
			let overlayLoading: Promise<void> | null = null;
			let visualsActive = false;
			let activationEpoch = 0;
			let telemetryStarted = false;
			let currentUrl = globalThis.location.href;
			let navigationToken = 0;
			let listenersInstalled = false;
			let navPollId: ReturnType<typeof setInterval> | null = null;

			function visualsAreActive(): boolean {
				return visualsActive;
			}

			// Read through a function: TypeScript narrows the module-level flag from an
			// earlier check and would otherwise treat the post-await re-check as dead.
			function isOverlayAttached(): boolean {
				return overlayAttached;
			}

			// Mounts the shadow-root overlay (onboarding, API-key prompt, toasts,
			// modals). Kept separate from `activateVisuals` so a user without an API
			// key still sees onboarding instead of a silently inert extension.
			function ensureOverlay(): Promise<boolean> {
				if (overlayAttached) return Promise.resolve(true);

				// Single-flight: concurrent navigations must not create or mount twice.
				overlayLoading ??= (async () => {
					if (!overlay) {
						const cssUrl = browser.runtime.getURL(
							'/content-scripts/content.css' as Parameters<typeof browser.runtime.getURL>[0]
						);
						const cssResponse = await fetch(cssUrl);
						const shadowCssRaw = await cssResponse.text();
						const cssText = shadowCssRaw.replaceAll(':root', ':host');

						overlay = await createShadowRootUi(ctx, {
							name: 'rotector-overlay',
							position: 'overlay',
							zIndex: 10_000,
							css: cssText,
							onMount(uiContainer, _shadow, shadowHost) {
								registerOverlayContainer(uiContainer);
								themeManager.registerPortalContainer(shadowHost);

								// Register inner html element so [data-theme] CSS selectors
								// match inside the shadow root (bare attribute selectors
								// don't match the shadow host from within shadow CSS)
								const shadowHtml = _shadow.querySelector('html');
								if (shadowHtml) themeManager.registerPortalContainer(shadowHtml);

								overlayApp = mount(OverlayRoot, { target: uiContainer });
								logger.debug('Shadow root overlay mounted');
							},
							onRemove() {
								// Safety net for removals not initiated by teardownOverlay.
								const app = overlayApp;
								overlayApp = null;
								if (app) void unmount(app);
								logger.debug('Shadow root overlay removed');
							}
						});
					}

					// Re-check after the await: teardown or another navigation may have
					// won while the stylesheet and shadow root were loading.
					const ui = overlay;
					if (isOverlayAttached()) return;

					try {
						ui.mount();
						overlayAttached = true;
					} catch (error) {
						// A failed mount must not leave a half-attached overlay that the
						// next navigation mounts a second time.
						overlay = null;
						overlayAttached = false;
						ui.remove();
						throw error;
					}
				})().finally(() => {
					overlayLoading = null;
				});

				return overlayLoading.then(
					() => overlayAttached,
					() => false
				);
			}

			function teardownOverlay(): void {
				overlayAttached = false;
				const app = overlayApp;
				overlayApp = null;
				if (app) void unmount(app);

				const currentOverlay = overlay;
				overlay = null;
				currentOverlay?.remove();
			}

			async function activateVisuals(): Promise<void> {
				if (visualsAreActive()) return;

				injectDefaultBlurStyles();
				injectBlurStyles();
				logger.debug('Blur styles injected');

				const epoch = ++activationEpoch;
				const mounted = await ensureOverlay();

				// Teardown (gate close / unsupported navigation) may have won while the
				// stylesheet or shadow root was loading.
				if (!mounted || epoch !== activationEpoch) return;

				// Only mark active once the stylesheet fetch and mount succeeded, so a
				// failed activation can be retried on the next navigation.
				visualsActive = true;

				if (!telemetryStarted) {
					telemetryStarted = true;
					void computeAndCacheDeviceFingerprint();
					metricsCollector.start();
				}
			}

			// Removes page-level features (blur + controllers) but keeps the overlay
			// mounted so onboarding / API-key prompts remain available.
			function deactivatePageFeatures(): void {
				activationEpoch++;
				visualsActive = false;
				removeBlurStyles();
			}

			function deactivateVisuals(): void {
				deactivatePageFeatures();
				teardownOverlay();
				logger.debug('Visuals deactivated for unsupported page');
			}

			async function handleUrl(url: string): Promise<void> {
				const token = ++navigationToken;

				if (detectPageType(url) === null) {
					deactivateVisuals();
					await pageManager?.deactivate();
					return;
				}

				// Supported page: the overlay is mounted even while the feature gate is
				// closed, otherwise a fresh install (no API key) would never see
				// onboarding or the key prompt.
				const mounted = await ensureOverlay();
				if (!mounted) {
					deactivateVisuals();
					return;
				}
				if (token !== navigationToken) return;

				// The gate is part of the URL contract: SPA navigation must not bypass
				// onboarding/API-key state.
				if (!get(extensionFeaturesEnabled)) {
					deactivatePageFeatures();
					await pageManager?.deactivate();
					return;
				}

				await activateVisuals();

				// Gate closed while activation was pending: no page features may survive.
				if (!get(extensionFeaturesEnabled)) {
					deactivatePageFeatures();
					await pageManager?.deactivate();
					return;
				}
				// A newer navigation owns the overlay/controller now.
				if (token !== navigationToken) return;

				await ensurePageManager().handleNavigation(url);
			}

			const navigate = (url: string): void => {
				void handleUrl(url).catch((error: unknown) => {
					logger.error('Failed to handle navigation:', error, { url });
				});
			};

			reapplyNavigation = () => {
				const url = globalThis.location.href;
				void (async () => {
					// Force a clean rebuild: component state captured from the old
					// key must not survive the viewer switch.
					await pageManager?.deactivate();
					navigate(url);
				})();
			};

			const checkForNavigation = () => {
				if (globalThis.location.href !== currentUrl) {
					currentUrl = globalThis.location.href;
					logger.debug('Navigation detected', {
						newUrl: currentUrl,
						pathname: globalThis.location.pathname,
						hash: globalThis.location.hash
					});
					navigate(currentUrl);
				}
			};

			const handlePopstate = () => {
				logger.debug('Popstate event detected');
				checkForNavigation();
			};

			const handleHashchange = () => {
				logger.debug('Hash change detected', { hash: globalThis.location.hash });
				checkForNavigation();
			};

			// Roblox is an SPA that navigates with history.pushState, which never fires
			// popstate. Poll the URL as a fallback (the content-script isolated world
			// cannot patch the page's history object) so status UI follows the page.
			const installNavigationListeners = (): void => {
				if (listenersInstalled) return;
				listenersInstalled = true;
				globalThis.addEventListener('popstate', handlePopstate);
				globalThis.addEventListener('hashchange', handleHashchange);
				navPollId = setInterval(checkForNavigation, 500);
			};

			const removeNavigationListeners = (): void => {
				if (!listenersInstalled) return;
				listenersInstalled = false;
				globalThis.removeEventListener('popstate', handlePopstate);
				globalThis.removeEventListener('hashchange', handleHashchange);
				if (navPollId) {
					clearInterval(navPollId);
					navPollId = null;
				}
			};

			installNavigationListeners();

			// The gate can open (API key accepted) or close (key removed) during a
			// session; re-run the current URL through the gated path either way.
			const unsubscribeGate = extensionFeaturesEnabled.subscribe(() => {
				currentUrl = globalThis.location.href;
				navigate(currentUrl);
			});

			// Blur settings are applied as CSS, so re-inject whenever the user changes
			// any of them instead of requiring a Roblox tab reload.
			const unsubscribeSettings = settings.subscribe(() => {
				if (!visualsAreActive()) return;
				injectBlurStyles();
			});

			let cleanedUp = false;
			const cleanup = (): void => {
				if (cleanedUp) return;
				cleanedUp = true;
				logger.debug('Content script cleanup on page unload');
				removeNavigationListeners();
				unsubscribeGate();
				unsubscribeSettings();
				deactivateVisuals();
				void pageManager?.deactivate();
				metricsCollector.stop();
				themeManager.cleanup();
			};

			// pagehide fires on real unloads and bfcache eviction. `beforeunload` can
			// be cancelled by the page, which would leave a live tab fully torn down.
			globalThis.addEventListener('pagehide', cleanup, { once: true });
			ctx.onInvalidated(cleanup);

			logger.info('Rotector content script successfully initialized');
		} catch (error) {
			logger.error('Failed to initialize content script:', error);
			themeManager.cleanup();
		}
	}
});
