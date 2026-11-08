import { API_CONFIG, CAPTCHA_EXTERNAL_MESSAGES } from '@/lib/types/constants';

// The bridge accepts page messages only so the captcha window can hand back a
// token. Forwarding arbitrary payloads would let any script running on the
// hosting origin (or its embedder) drive privileged background actions such as
// PASC writes, OAuth starts, or API key validation.
const ALLOWED_TYPES: ReadonlySet<string> = new Set(Object.values(CAPTCHA_EXTERNAL_MESSAGES));

// Firefox lacks `externally_connectable`, so roscoe pages can't reach the extension
// via `browser.runtime.sendMessage(extensionId)`. The backend falls back to
// `window.postMessage` on non-Chromium browsers and this script forwards those to background.
export default defineContentScript({
	matches: [
		`https://${import.meta.env.USE_DEV_API === 'true' ? 'roscoe-dev' : 'roscoe'}.rotector.com/*`
	],
	runAt: 'document_start',

	main() {
		window.addEventListener('message', (event: MessageEvent<unknown>) => {
			// The captcha window is served from the RoProtect origin, which may be
			// framed by the Roscoe page. Only that exact origin is trusted.
			if (event.origin !== API_CONFIG.BASE_URL) return;

			const data = event.data as Record<string, unknown> | null;
			if (!data || typeof data !== 'object') return;
			if (data['source'] !== 'rotector-web') return;

			const type = data['type'];
			if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) return;

			const { source: _, ...payload } = data;

			browser.runtime.sendMessage(payload).catch(() => {});
			window.postMessage({ source: 'rotector-extension' }, event.origin);
		});
	}
});
