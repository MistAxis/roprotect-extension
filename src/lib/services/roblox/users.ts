import { ROBLOX_API } from '../../types/constants';
import { logger } from '../../utils/logging/logger';
import { parseRobloxUsersByIdResponse } from '../../schemas/roblox-api';
import { getMemberThumbnails } from './groups';

export interface UserInfo {
	username: string;
	displayName: string;
	thumbnailUrl: string | null;
}

interface CacheEntry {
	info: UserInfo | null;
	expiresAt: number;
}

const TTL_MS = 5 * 60_000;
// Browsing friends/groups can touch thousands of ids in one session. Keep the
// name cache bounded and drop expired entries instead of retaining every user
// ever rendered.
const MAX_CACHE_ENTRIES = 1000;
const cache = new Map<number, CacheEntry>();

function evictIfNeeded(): void {
	const now = Date.now();
	for (const [id, entry] of cache) {
		if (entry.expiresAt <= now) cache.delete(id);
	}
	while (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

async function fetchUserNames(userIds: number[]): Promise<Map<number, UserInfo>> {
	const response = await fetch(`${ROBLOX_API.USERS}/v1/users`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userIds, excludeBannedUsers: false })
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch user names: ${String(response.status)}`);
	}

	const data = parseRobloxUsersByIdResponse(await response.json());
	return new Map(
		data.data.map((u) => [
			u.id,
			{ username: u.name, displayName: u.displayName, thumbnailUrl: null }
		])
	);
}

export async function getUsersInfoBatch(userIds: number[]): Promise<Map<number, UserInfo | null>> {
	const now = Date.now();
	const out = new Map<number, UserInfo | null>();
	const missing: number[] = [];

	for (const id of userIds) {
		const entry = cache.get(id);
		if (entry && entry.expiresAt > now) {
			out.set(id, entry.info);
		} else {
			if (entry) cache.delete(id);
			missing.push(id);
		}
	}

	if (missing.length === 0) return out;

	const thumbsPromise = getMemberThumbnails(missing).catch((error: unknown) => {
		logger.warn('User headshot batch failed; continuing without thumbnails:', error);
		return new Map<number, string>();
	});

	try {
		const [names, thumbs] = await Promise.all([fetchUserNames(missing), thumbsPromise]);
		const expiresAt = now + TTL_MS;
		for (const id of missing) {
			const name = names.get(id);
			const info = name ? { ...name, thumbnailUrl: thumbs.get(id) ?? null } : null;
			cache.set(id, { info, expiresAt });
			out.set(id, info);
		}
		evictIfNeeded();
	} catch (error) {
		logger.error('Error fetching user names batch:', error);
		for (const id of missing) {
			if (!out.has(id)) out.set(id, null);
		}
	}

	return out;
}
