import type {
	GroupStatus,
	GroupTrackedUsersResponse,
	QueueLimitsData,
	QueueResult,
	RobloxUserDiscordLookup,
	UserStatus
} from '@/lib/types/api';
import type { QueueStatusResponse } from '@/lib/types/queue-history';
import { API_CONFIG } from '@/lib/types/constants';
import { SETTINGS_KEYS } from '@/lib/types/settings';
import { getStorage } from '@/lib/utils/storage';
import {
	parseGroupStatus,
	parseGroupStatusMap,
	parseGroupTrackedUsers,
	parseQueueLimits,
	parseQueueResult,
	parseQueueStatusResponse,
	parseRobloxUserDiscordLookup,
	parseUserStatus,
	parseUserStatusMap
} from '@/lib/schemas/rotector';
import { parseDiscordAvatarMap, type DiscordAvatar } from '@/lib/schemas/custom-api';
import { fetchImageAsDataUrl } from '@/lib/utils/image';
import { makeHttpRequest } from '../http-client';
import { processBatchEntityIds, validateEntityId } from '@/lib/utils/dom/sanitizer';
import { logger } from '@/lib/utils/logging/logger';

// SCSN returns flagType: -1 (UNKNOWN) with a "no record" reason for groups
// it doesn't track. Treat that as "no data" rather than "update required".
function isScsnNoRecord(status: GroupStatus): boolean {
	if (status.flagType !== -1) return false;
	const reason = Object.values(status.reasons)[0];
	return reason?.message?.includes('no record') ?? false;
}

export async function checkUserStatus(
	userId: string | number,
	clientId?: string,
	readPrimary?: boolean
): Promise<UserStatus> {
	const sanitizedUserId = validateEntityId(userId);
	const excludeInfo = !(await getStorage<boolean>(
		'sync',
		SETTINGS_KEYS.ADVANCED_VIOLATION_INFO_ENABLED,
		false
	));

	const params = new URLSearchParams();
	params.set('excludeInfo', excludeInfo.toString());

	const url = `${API_CONFIG.ENDPOINTS.USER_CHECK}/${sanitizedUserId}?${params.toString()}`;
	return makeHttpRequest(url, { method: 'GET', clientId, readPrimary, parse: parseUserStatus });
}

export async function checkGroupStatus(
	groupId: string | number,
	clientId?: string
): Promise<GroupStatus | null> {
	const sanitizedGroupId = validateEntityId(groupId);

	const url = `${API_CONFIG.ENDPOINTS.GROUP_CHECK}/${sanitizedGroupId}`;
	try {
		// SCSN returns bare verdict objects, not the Rotector {success, data} envelope.
		// rawResponse: true skips envelope unwrap; we parse the body directly.
		const status = await makeHttpRequest(url, {
			method: 'GET',
			clientId,
			rawResponse: true,
			parse: parseGroupStatus
		});
		// SCSN returns UNKNOWN (-1) with a "no record" reason for untracked groups.
		// Treat that as "no data" instead of rendering "Update Required".
		if (isScsnNoRecord(status)) return null;
		return status;
	} catch (error) {
		logger.warn('[core] SCSN group lookup unavailable, returning no status', {
			groupId: sanitizedGroupId,
			error
		});
		return null;
	}
}

export async function checkMultipleUsers(
	userIds: Array<string | number>,
	clientId?: string,
	lookupContext?: string,
	readPrimary?: boolean
): Promise<UserStatus[]> {
	const sanitizedUserIds = processBatchEntityIds(userIds);
	const excludeInfo = !(await getStorage<boolean>(
		'sync',
		SETTINGS_KEYS.ADVANCED_VIOLATION_INFO_ENABLED,
		false
	));

	const requestBody: Record<string, unknown> = {
		ids: sanitizedUserIds.map((id) => Number.parseInt(id, 10)),
		...(excludeInfo && { excludeInfo: true })
	};

	const map = await makeHttpRequest(API_CONFIG.ENDPOINTS.USER_CHECK, {
		method: 'POST',
		body: JSON.stringify(requestBody),
		clientId,
		lookupContext,
		readPrimary,
		parse: parseUserStatusMap
	});

	return Object.values(map);
}

export async function checkMultipleGroups(
	groupIds: Array<string | number>,
	clientId?: string,
	lookupContext?: string
): Promise<Array<GroupStatus | null>> {
	const sanitizedGroupIds = processBatchEntityIds(groupIds);

	const requestBody = {
		ids: sanitizedGroupIds.map((id) => Number.parseInt(id, 10))
	};

	try {
		// SCSN returns bare verdict map, not the Rotector envelope.
		const map = await makeHttpRequest(API_CONFIG.ENDPOINTS.GROUP_CHECK, {
			method: 'POST',
			body: JSON.stringify(requestBody),
			clientId,
			lookupContext,
			rawResponse: true,
			parse: parseGroupStatusMap
		});

		// SCSN returns UNKNOWN (-1) + "no record" for untracked groups.
		// Convert those to null so callers see "no data" not "update required".
		return sanitizedGroupIds.map((id) => {
			const status = map[id];
			return status && !isScsnNoRecord(status) ? status : null;
		});
	} catch (error) {
		logger.warn('[core] SCSN batch group lookup unavailable, returning no status', {
			count: sanitizedGroupIds.length,
			error
		});
		return sanitizedGroupIds.map(() => null);
	}
}

export async function queueUser(
	userId: string | number,
	outfitNames: string[] = [],
	outfitIds: number[] = [],
	inappropriateProfile = false,
	inappropriateFriends = false,
	inappropriateGroups = false,
	clientId?: string,
	captchaToken?: string
): Promise<QueueResult> {
	const sanitizedUserId = validateEntityId(userId);

	const requestBody = {
		id: Number.parseInt(sanitizedUserId, 10),
		inappropriate_profile: inappropriateProfile,
		inappropriate_friends: inappropriateFriends,
		inappropriate_groups: inappropriateGroups,
		...(outfitNames.length > 0 && { outfit_names: outfitNames }),
		...(outfitIds.length > 0 && { outfit_ids: outfitIds }),
		...(captchaToken && { captcha_token: captchaToken })
	};

	return makeHttpRequest(API_CONFIG.ENDPOINTS.QUEUE_USER, {
		method: 'POST',
		body: JSON.stringify(requestBody),
		clientId,
		maxRetries: 1,
		rawResponse: true,
		parse: parseQueueResult
	});
}

export async function getQueueLimits(clientId?: string): Promise<QueueLimitsData> {
	return makeHttpRequest(API_CONFIG.ENDPOINTS.QUEUE_LIMITS, {
		method: 'GET',
		clientId,
		parse: parseQueueLimits
	});
}

export async function getQueueStatus(
	userIds: number[],
	clientId?: string
): Promise<QueueStatusResponse> {
	return makeHttpRequest(API_CONFIG.ENDPOINTS.QUEUE_STATUS, {
		method: 'POST',
		body: JSON.stringify({ ids: userIds }),
		clientId,
		parse: parseQueueStatusResponse
	});
}

export async function getGroupTrackedUsers(
	groupId: string | number,
	cursor?: string,
	limit = 24,
	active?: 'true' | 'false'
): Promise<GroupTrackedUsersResponse> {
	const sanitizedGroupId = validateEntityId(groupId);

	const params = new URLSearchParams();
	params.set('limit', String(Math.min(limit, 100)));
	if (cursor) {
		params.set('cursor', cursor);
	}
	if (active) {
		params.set('active', active);
	}

	// Tracked users stay on the first-party backend: SCSN serves the group
	// verdict routes but not this sub-route yet. Kept as its own constant so
	// switching GROUP_CHECK to SCSN cannot repoint it by accident.
	const url = `${API_CONFIG.ENDPOINTS.GROUP_TRACKED_USERS}/${sanitizedGroupId}/tracked-users?${params.toString()}`;
	try {
		return await makeHttpRequest(url, { method: 'GET', parse: parseGroupTrackedUsers });
	} catch (error) {
		logger.warn('[core] group tracked-users lookup unavailable, returning empty page', {
			groupId: sanitizedGroupId,
			error
		});
		return { users: [], totalCount: 0, nextCursor: null, hasMore: false };
	}
}

export async function lookupRobloxUserDiscord(
	userId: string | number,
	clientId?: string
): Promise<RobloxUserDiscordLookup> {
	const sanitizedUserId = validateEntityId(userId);
	return makeHttpRequest(`${API_CONFIG.ENDPOINTS.USER_CHECK}/${sanitizedUserId}/discord`, {
		method: 'GET',
		clientId,
		parse: parseRobloxUserDiscordLookup
	});
}

const DISCORD_CDN = 'https://cdn.discordapp.com/avatars';

// The batch route only guarantees `avatarUrl` for users with a cached avatar.
// Rebuild the CDN path from the hash when it sends the hash alone.
function resolveAvatarUrl(discordId: string, avatar: DiscordAvatar): string | null {
	if (avatar.avatarUrl) return avatar.avatarUrl;
	if (!avatar.avatarHash) return null;
	// Both values come from the response; encode them so they cannot change the
	// CDN path (or add a query) when interpolated.
	const safeId = encodeURIComponent(discordId);
	const safeHash = encodeURIComponent(avatar.avatarHash);
	return `${DISCORD_CDN}/${safeId}/${safeHash}.${avatar.isAnimated ? 'gif' : 'png'}`;
}

// The tooltip is injected into roblox.com, whose page CSP omits
// cdn.discordapp.com from `img-src`, so a plain cross-origin <img> is blocked.
// `data:` is allowed, so inline the bytes here in the extension context instead
// of letting the page request them.
async function inlineAvatarImages(
	avatars: Record<string, DiscordAvatar>
): Promise<Record<string, DiscordAvatar>> {
	const entries = await Promise.all(
		Object.entries(avatars).map(async ([discordId, avatar]) => {
			const url = resolveAvatarUrl(discordId, avatar);
			if (!url) return [discordId, avatar] as const;
			try {
				const avatarDataUrl = await fetchImageAsDataUrl(url);
				return [discordId, { ...avatar, avatarDataUrl }] as const;
			} catch (error) {
				logger.error('Failed to inline Discord avatar', { discordId, url, error });
				return [discordId, avatar] as const;
			}
		})
	);

	const result: Record<string, DiscordAvatar> = {};
	for (const [discordId, avatar] of entries) {
		result[discordId] = avatar;
	}
	return result;
}

export async function getDiscordAvatars(
	discordUserIds: string[],
	clientId?: string
): Promise<Record<string, DiscordAvatar>> {
	const requestBody = { ids: discordUserIds };
	const avatars = await makeHttpRequest(API_CONFIG.ENDPOINTS.DISCORD_AVATAR_BATCH, {
		method: 'POST',
		body: JSON.stringify(requestBody),
		clientId,
		// This route answers with the bare id -> avatar map, not the usual
		// { success, data } envelope, so envelope unwrapping has to be skipped.
		rawResponse: true,
		parse: parseDiscordAvatarMap
	});

	return inlineAvatarImages(avatars);
}
