import { getCacheTtlMs } from '../../stores/settings';
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
	return cache.get(ids.join(','), () => apiClient.lookupQuarry(ids));
}
