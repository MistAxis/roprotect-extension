import { SETTINGS_KEYS } from '@/lib/types/settings';
import { getStorage } from '@/lib/utils/storage';
import { logger } from '@/lib/utils/logging/logger';

export type QuarryLookupResult = Record<string, string[] | null>;

const QUARRY_PATH = '/api/v1/lookup';
const QUARRY_TIMEOUT_MS = 10_000;

async function readConfig(): Promise<{ origin: string; key: string } | null> {
	const [rawUrl, rawKey] = await Promise.all([
		getStorage<string>('sync', SETTINGS_KEYS.QUARRY_URL, ''),
		getStorage<string>('sync', SETTINGS_KEYS.QUARRY_KEY, '')
	]);
	const key = typeof rawKey === 'string' ? rawKey.trim() : '';
	if (!key || typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
	try {
		const parsed = new URL(rawUrl.trim());
		if (parsed.protocol !== 'https:') return null;
		return { origin: parsed.origin, key };
	} catch {
		return null;
	}
}

// Returns {} when Quarry is not configured or unreachable so a flaky or absent
// third-party service never breaks the tooltip it decorates.
export async function lookupQuarry(ids: string[]): Promise<QuarryLookupResult> {
	const config = await readConfig();
	if (!config) return {};

	try {
		const response = await fetch(`${config.origin}${QUARRY_PATH}`, {
			method: 'POST',
			headers: { 'x-api-key': config.key, 'content-type': 'application/json' },
			body: JSON.stringify({ ids }),
			signal: AbortSignal.timeout(QUARRY_TIMEOUT_MS)
		});
		if (!response.ok) {
			logger.warn('[quarry] lookup rejected', { status: response.status });
			return {};
		}
		const body: unknown = await response.json();
		const results =
			typeof body === 'object' && body !== null
				? (body as { results?: unknown }).results
				: undefined;
		if (typeof results !== 'object' || results === null) return {};

		const parsed: QuarryLookupResult = {};
		for (const [id, servers] of Object.entries(results)) {
			parsed[id] =
				Array.isArray(servers) && servers.every((name) => typeof name === 'string')
					? servers
					: null;
		}
		return parsed;
	} catch (error) {
		logger.warn('[quarry] lookup failed', { error });
		return {};
	}
}
