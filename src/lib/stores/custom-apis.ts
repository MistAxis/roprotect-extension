import { writable, get } from 'svelte/store';
import * as v from 'valibot';
import type { CustomApiConfig } from '../types/custom-api';
import { SETTINGS_KEYS } from '../types/settings';
import { API_CONFIG } from '../types/constants';
import { logger } from '../utils/logging/logger';
import {
	hasPermissionsForOrigins,
	requestPermissionsForOrigins,
	extractApiOrigins
} from '../utils/permissions';
import { asApiError } from '../utils/api/api-error';
import { testCustomApiConnection } from '../services/custom-api-test';
import { getAllStorage, getStorage, setStorage, subscribeStorageKey } from '../utils/storage';
import { generateLocalId } from '../utils/id';
import { PersistedCustomApiSchema } from '../schemas/custom-api';
import { apiClient } from '../services/rotector/api-client';
import { getAssetUrl } from '../utils/assets';

export const MAX_CUSTOM_APIS = 5;

export const RO_PROTECT_API_ID = 'system-roprotect';

const SERVICE_ORDER = ['scsn', 'rab', 'tase', 'pasc'] as const;
const SERVICE_LABELS: Record<string, string> = {
	scsn: 'SIGMANET',
	rab: 'RAB',
	tase: 'TASE',
	pasc: 'PASC'
};
const SERVICE_IMAGES: Record<(typeof SERVICE_ORDER)[number], string> = {
	scsn: getAssetUrl('/assets/sigmanet-dark.png'),
	rab: getAssetUrl('/assets/rab.webp'),
	tase: getAssetUrl('/assets/tase.webp'),
	pasc: getAssetUrl('/assets/pasc-tab.png')
};

interface WhoamiData {
	services: string[];
	endpoints: Record<string, { single: string; batch: string }>;
	label: string;
	fingerprint: string;
	isAdmin: boolean;
	rateLimitPerMinute: number;
	limits: Record<string, number>;
}

export const customApis = writable<CustomApiConfig[]>([]);

function generateCustomApiId(): string {
	return generateLocalId('custom-api');
}

// Validates entries individually so one corrupt record cannot wipe the user's
// entire provider list (a whole-array parse used to reset everything to []).
function recoverUserApis(stored: unknown): CustomApiConfig[] {
	if (!Array.isArray(stored)) return [];
	return stored.filter(
		(entry): entry is CustomApiConfig =>
			v.is(PersistedCustomApiSchema, entry) && !entry.isSystem && !entry.id.startsWith('system-')
	);
}

// Open tabs must pick up provider add/edit/delete/enable without a reload,
// otherwise a deleted provider keeps receiving lookups until every tab reloads.
let storageWired = false;
function wireCustomApiStorage(): void {
	if (storageWired) return;
	storageWired = true;

	subscribeStorageKey<unknown>('local', SETTINGS_KEYS.CUSTOM_APIS, (next) => {
		if (next === undefined) return;
		const userApis = recoverUserApis(next);
		const systemApis = get(customApis).filter((api) => api.isSystem);
		customApis.set([...systemApis, ...userApis]);
	});
}

// Serializes concurrent loads (page init, key change, Discord sign-in) so a
// stale whoami result cannot overwrite a newer one.
let loadInFlight: Promise<void> | null = null;
let reloadQueued = false;

export function loadCustomApis(): Promise<void> {
	if (loadInFlight) {
		reloadQueued = true;
		return loadInFlight;
	}

	loadInFlight = (async () => {
		for (;;) {
			reloadQueued = false;
			await performLoadCustomApis();
			// Read through a call: TS narrows the module flag and treats this as dead.
			if (!shouldReloadCustomApis()) break;
		}
	})().finally(() => {
		loadInFlight = null;
	});

	return loadInFlight;
}

// Reads the module-level flag without letting TypeScript narrow it to `false`.
function shouldReloadCustomApis(): boolean {
	return reloadQueued;
}

// Loads APIs from storage, and if API key is present, loads services from whoami
async function performLoadCustomApis(): Promise<void> {
	wireCustomApiStorage();
	const stored = await getStorage<unknown>('local', SETTINGS_KEYS.CUSTOM_APIS, undefined);
	const allSync = await getAllStorage('sync');
	const settings = allSync;

	const apiKey = (settings[SETTINGS_KEYS.API_KEY] as string | undefined)?.trim();

	logger.debug('[loadCustomApis] Storage state:', {
		hasApiKey: !!apiKey,
		apiKeyLength: apiKey?.length ?? 0,
		storedKeys: Object.keys(settings),
		allSyncKeys: Object.keys(allSync)
	});

	if (stored === undefined) {
		await setStorage('local', SETTINGS_KEYS.CUSTOM_APIS, []);
	}

	let userApis: CustomApiConfig[] = [];
	if (stored !== undefined) {
		userApis = recoverUserApis(stored);
		const invalidCount = Array.isArray(stored)
			? stored.filter((entry) => !v.is(PersistedCustomApiSchema, entry)).length
			: 1;
		if (invalidCount > 0) {
			// Keep whatever still validates and preserve the raw value for recovery
			// instead of destroying every configured provider.
			logger.warn('Some stored custom APIs failed validation; kept the valid entries', {
				invalid: invalidCount,
				valid: userApis.length
			});
			await setStorage('local', `${SETTINGS_KEYS.CUSTOM_APIS}_corrupt_backup`, stored);
		}
	}

	// Preserve the previously loaded system providers when whoami fails, but only
	// when they were built from the same key (a different key invalidates them).
	let systemApis: CustomApiConfig[] = [];
	if (apiKey) {
		systemApis = get(customApis).filter((api) => api.isSystem && api.apiKey === apiKey);
		try {
			// Fetch services from whoami
			const response = await apiClient.whoami(apiKey);
			const whoamiData = response.data as WhoamiData | undefined;
			logger.debug('[loadCustomApis] whoami response:', {
				success: response.success,
				hasData: !!response.data,
				error: response.error,
				dataServices: whoamiData?.services,
				dataEndpoints: whoamiData?.endpoints ? Object.keys(whoamiData.endpoints) : null
			});
			if (response.success && whoamiData) {
				systemApis = createSystemApisFromWhoami(whoamiData, apiKey);
			} else if (systemApis.length === 0) {
				logger.warn('[loadCustomApis] whoami did not return provider data; lookups unavailable');
			}
		} catch (error) {
			logger.error('Failed to load services from whoami:', error);
		}
	} else {
		logger.debug('[loadCustomApis] No API key found in sync storage');
	}

	const allApis = [...systemApis, ...userApis];
	customApis.set(allApis);
	logger.debug('Loaded APIs:', {
		total: allApis.length,
		system: systemApis.length,
		user: userApis.length,
		systemApiIds: systemApis.map((a) => a.id)
	});
}

function createSystemApisFromWhoami(whoami: WhoamiData, apiKey: string): CustomApiConfig[] {
	logger.debug('[createSystemApisFromWhoami] whoami endpoints:', {
		endpointKeys: Object.keys(whoami.endpoints),
		endpoints: whoami.endpoints
	});

	// whoami reports each service's lookup URL, which may be an absolute URL or a path
	// relative to the host that served whoami. fetch() cannot resolve a bare path in a
	// service worker, so anchor anything host-relative to the API origin first.
	// The path is joined as a string rather than through `new URL()` because that
	// percent-encodes the literal `{userId}` placeholder into `%7BuserId%7D`, which
	// would stop customApiCheckUser from substituting the real ID.
	const resolveEndpoint = (value: string | undefined, fallbackPath: string): string => {
		const raw = (value ?? fallbackPath).trim();
		const { origin } = new URL(`${API_CONFIG.BASE_URL}/`);
		if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
			// whoami is remote data. An absolute URL here decides where the
			// extension sends the user's API key, so only accept HTTPS on the
			// same origin that served whoami. Anything else falls back to the
			// known-good path instead of silently exfiltrating credentials.
			try {
				const candidate = new URL(raw);
				if (candidate.protocol === 'https:' && candidate.origin === origin) {
					return raw;
				}
			} catch {
				// fall through to the safe fallback
			}
			logger.warn('Ignoring whoami endpoint outside the API origin:', { endpoint: raw });
			return `${origin}${fallbackPath.startsWith('/') ? '' : '/'}${fallbackPath}`;
		}
		return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
	};

	// RoProtect presents PASC as `system-pasc` (the extension provider id) while
	// everything else calls it `pasc`, so match either spelling in both lists.
	return SERVICE_ORDER.filter(
		(id) => whoami.services.includes(id) || whoami.services.includes(`system-${id}`)
	).map((id, index) => {
		const endpoint = whoami.endpoints[id] ?? whoami.endpoints[`system-${id}`];
		// TASE now uses V2 endpoints: /v1/tase/v2/lookup/user/{userId} and /v1/tase/v2/lookup/users
		// Always use V2 for TASE, ignoring what whoami returns (it may have v1 paths)
		const isTase = id === 'tase';
		const singleFallback = isTase
			? '/v1/tase/v2/lookup/user/{userId}'
			: `/v1/${id}/v1/lookup/user/{userId}`;
		const batchFallback = isTase ? '/v1/tase/v2/lookup/users' : `/v1/${id}/v1/lookup/users`;
		// For TASE, always use V2 fallback; for others, use whoami if it provides a path
		const singleUrl = isTase
			? resolveEndpoint(undefined, singleFallback)
			: resolveEndpoint(endpoint?.single, singleFallback);
		const batchUrl = isTase
			? resolveEndpoint(undefined, batchFallback)
			: resolveEndpoint(endpoint?.batch, batchFallback);
		logger.debug(`[createSystemApisFromWhoami] Service ${id} endpoint:`, {
			single: singleUrl,
			batch: batchUrl,
			isTaseV2: isTase
		});
		return {
			id: `system-${id}`,
			name: SERVICE_LABELS[id] ?? 'Unknown',
			singleUrl,
			batchUrl,
			enabled: true,
			// SCSN and TASE are slow; give them a longer timeout. Other system
			// providers use the default.
			timeout: id === 'scsn' || id === 'tase' ? 60_000 : API_CONFIG.TIMEOUT,
			order: index,
			createdAt: 0,
			isSystem: true,
			reasonFormat: 'numeric',
			landscapeImageDataUrl: SERVICE_IMAGES[id],
			apiKey,
			authHeaderType: 'x-auth-token' as const
		};
	});
}

async function saveCustomApis(apis: CustomApiConfig[]): Promise<void> {
	const userApis = apis.filter((api) => !api.isSystem);
	await setStorage('local', SETTINGS_KEYS.CUSTOM_APIS, userApis);

	customApis.set(apis);
	logger.debug('Saved custom APIs:', { total: apis.length, userApis: userApis.length });
}

// Auto-disables the new API when host permissions are missing or origins cannot be extracted
export async function addCustomApi(
	config: Omit<CustomApiConfig, 'id' | 'order' | 'createdAt'>
): Promise<CustomApiConfig> {
	const current = get(customApis);

	const userApiCount = current.filter((api) => !api.isSystem).length;
	if (userApiCount >= MAX_CUSTOM_APIS) {
		throw new Error(`Maximum of ${String(MAX_CUSTOM_APIS)} custom APIs allowed`);
	}

	let finalEnabled = config.enabled;
	if (config.enabled) {
		const origins = extractApiOrigins(config);
		if (origins.length === 0) {
			logger.error('Failed to extract origins from API URLs');
			finalEnabled = false;
		} else {
			const hasPermissions = await hasPermissionsForOrigins(origins);
			if (!hasPermissions) {
				finalEnabled = false;
				logger.info('Auto-disabled custom API due to missing permissions:', {
					name: config.name,
					origins
				});
			}
		}
	}

	const newApi: CustomApiConfig = {
		...config,
		enabled: finalEnabled,
		id: generateCustomApiId(),
		order: current.length,
		createdAt: Date.now()
	};

	const updated = [...current, newApi];
	await saveCustomApis(updated);

	logger.info('Added custom API:', { id: newApi.id, name: newApi.name, enabled: finalEnabled });
	return newApi;
}

// Throws sentinel strings INVALID_URL or PERMISSIONS_REQUIRED when enabling without granted host access
export async function updateCustomApi(
	id: string,
	updates: Partial<Omit<CustomApiConfig, 'id' | 'order' | 'createdAt'>>
): Promise<void> {
	const current = get(customApis);

	const index = current.findIndex((api) => api.id === id);
	const existing = current[index];
	if (!existing) {
		throw new Error(`Custom API not found: ${id}`);
	}

	if (existing.isSystem) {
		throw new Error('Cannot modify system APIs');
	}

	if (updates.enabled === true) {
		const merged = { ...existing, ...updates };
		const origins = extractApiOrigins(merged);
		if (origins.length === 0) {
			throw new Error('INVALID_URL');
		}

		const hasPermissions = await hasPermissionsForOrigins(origins);
		if (!hasPermissions) {
			throw new Error('PERMISSIONS_REQUIRED');
		}
	}

	const updated = [...current];
	updated[index] = { ...existing, ...updates };

	await saveCustomApis(updated);
	logger.info('Updated custom API:', { id, updates });
}

type SetEnabledResult =
	| { ok: true; granted: boolean }
	| {
			ok: false;
			reason: 'invalid_url' | 'permission_denied' | 'test_failed' | 'error';
			message?: string | undefined;
	  };

// Requests host permissions on enable and the user can deny so the API stays disabled
export async function setCustomApiEnabled(
	api: CustomApiConfig,
	enabled: boolean
): Promise<SetEnabledResult> {
	if (!enabled) {
		try {
			await updateCustomApi(api.id, { enabled: false });
			logger.userAction('custom_api_toggled', { apiId: api.id, apiName: api.name, enabled: false });
			return { ok: true, granted: false };
		} catch (error) {
			logger.error('Failed to disable custom API:', error);
			return { ok: false, reason: 'error', message: asApiError(error).message };
		}
	}

	const origins = extractApiOrigins(api);
	if (origins.length === 0) {
		return { ok: false, reason: 'invalid_url' };
	}

	// Request host permission first: without it the test fetch is CORS-blocked
	// and would report a bogus connection failure the user cannot act on.
	try {
		const hasPerms = await hasPermissionsForOrigins(origins);
		const granted = hasPerms || (await requestPermissionsForOrigins(origins));
		if (!granted) {
			return { ok: false, reason: 'permission_denied' };
		}

		// Turning on an untested API runs a connection test first and only enables it on success
		if (api.lastTestSuccess !== true) {
			const success = await testCustomApiConnection(api);
			await updateTestResult(api.id, success);
			if (!success) {
				return { ok: false, reason: 'test_failed' };
			}
		}

		await updateCustomApi(api.id, { enabled: true });
		logger.userAction('custom_api_toggled', { apiId: api.id, apiName: api.name, enabled: true });
		return { ok: true, granted };
	} catch (error) {
		logger.error('Failed to enable custom API:', error);
		return { ok: false, reason: 'error', message: asApiError(error).message };
	}
}

// Reassigns sequential order indexes to the remaining APIs after removal
export async function deleteCustomApi(id: string): Promise<void> {
	const current = get(customApis);

	const api = current.find((api) => api.id === id);
	if (!api) {
		throw new Error(`Custom API not found: ${id}`);
	}

	if (api.isSystem) {
		throw new Error('Cannot delete system APIs');
	}

	const filtered = current.filter((api) => api.id !== id);

	const reordered = filtered.map((api, index) => ({
		...api,
		order: index
	}));

	await saveCustomApis(reordered);
	logger.info('Deleted custom API:', { id });
}

// No-op when the swap target is a system API or out of bounds, otherwise rewrites order indexes
export async function reorderCustomApi(id: string, direction: 'up' | 'down'): Promise<void> {
	const current = get(customApis);

	const index = current.findIndex((api) => api.id === id);
	const existing = current[index];
	if (!existing) {
		throw new Error(`Custom API not found: ${id}`);
	}

	if (existing.isSystem) {
		throw new Error('Cannot reorder system APIs');
	}

	const newIndex = direction === 'up' ? index - 1 : index + 1;

	const swapTarget = current[newIndex];
	if (!swapTarget || swapTarget.isSystem) {
		return;
	}

	const updated = [...current];
	[updated[index], updated[newIndex]] = [swapTarget, existing];

	const reordered = updated.map((api, idx) => ({
		...api,
		order: idx
	}));

	await saveCustomApis(reordered);
	logger.info('Reordered custom API:', { id, direction, from: index, to: newIndex });
}

export async function updateTestResult(id: string, success: boolean): Promise<void> {
	await updateCustomApi(id, {
		lastTested: Date.now(),
		lastTestSuccess: success
	});
}

export async function refreshSystemApis(apiKey: string): Promise<void> {
	try {
		const response = await apiClient.whoami(apiKey);
		if (response.success && response.data) {
			const systemApis = createSystemApisFromWhoami(response.data as WhoamiData, apiKey);
			const current = get(customApis);
			const userApis = current.filter((api) => !api.isSystem);
			customApis.set([...systemApis, ...userApis]);
			logger.debug('Refreshed system APIs from whoami', { count: systemApis.length });
		}
	} catch (error) {
		logger.error('Failed to refresh system APIs:', error);
	}
}
