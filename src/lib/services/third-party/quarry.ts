import { get } from 'svelte/store';
import { getCacheTtlMs, settings } from '../../stores/settings';
import { SETTINGS_KEYS } from '../../types/settings';
import { DedupeCache } from '../../utils/caching/dedupe-cache';
import { apiClient } from '../rotector/api-client';

const cache = new DedupeCache<string, Record<string, string[] | null>>(getCacheTtlMs);

// Maps each Discord ID to the Quarry-logged server names it was seen in, or null
// when it is in none (or Quarry is not configured).
export async function getQuarryServers(
	discordIds: string[]
): Promise<Record<string, string[] | null>> {
	const ids = [...new Set(discordIds)].toSorted();
	if (ids.length === 0) return {};
	// Skip the background round-trip (and its storage reads) when Quarry is not
	// configured: every tooltip would otherwise ask for a lookup that can only
	// return an empty map.
	const current = get(settings);
	if (!current[SETTINGS_KEYS.QUARRY_URL].trim() || !current[SETTINGS_KEYS.QUARRY_KEY].trim()) {
		return {};
	}
	return cache.get(ids.join(','), () => apiClient.lookupQuarry(ids));
}

export function clearQuarryCache(): void {
	cache.clear();
}
