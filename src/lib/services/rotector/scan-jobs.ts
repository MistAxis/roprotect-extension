import { fetchAllFriendIds } from '../roblox/friends';
import { fetchAllUserGroupIds } from '../roblox/groups';
import { groupStatusService } from './entity-status';
import { queryMultipleUsers, getEnabledCustomApis } from './unified-query';
import { getAssetUrl } from '../../utils/assets';
import type { CustomApiConfig, CombinedStatus } from '../../types/custom-api';
import type { UserStatus } from '../../types/api';
import { LOOKUP_CONTEXT } from '../../types/constants';
import {
	combinedResultToCategory,
	flagToCategory,
	type ScanCategory,
	type ScanCounts
} from '../../utils/status/scan-category';

export type { ScanCategory, ScanCounts } from '../../utils/status/scan-category';

const SCAN_PHASE_CHECK_START = 30;
const SCAN_PHASE_CHECK_RANGE = 70;
const FRIEND_SCAN_PROGRESS_MAX = 95;

// Per-provider resolution counts surfaced alongside the percentage so the bar
// can show e.g. "(65/248 SIGMANET, 80/248 RAB, 20/248 TASE)".
export interface ScanProviderProgress {
	apiId: string;
	apiName: string;
	logoUrl: string;
	fallbackLogoUrl: string;
	resolved: number;
}

export interface ScanProgressDetail {
	total: number;
	providers: ScanProviderProgress[];
	// Live tag counts for the entities resolved so far, so the scan overview can
	// fill in tag types while the search is still running instead of staying
	// empty until the whole batch finishes.
	counts?: ScanCounts;
}

export type ScanProgressCallback = (pct: number, detail?: ScanProgressDetail) => void;

// Optional observer used by the friends-page tag filters. The scan already
// queries every friend, so the filters reuse those results instead of issuing
// a second full lookup just to know which tags are present.
export interface FriendScanHooks {
	onFriendIds?: (friendIds: string[]) => void;
	onFriendResult?: (
		friendId: string,
		category: ScanCategory | null,
		fromIntegration: boolean,
		combined: CombinedStatus<UserStatus>
	) => void;
}

// Dedicated readout-only logos for the scan progress chips. These deliberately
// differ from the provider's landscapeImageDataUrl (used by tooltip tabs etc):
// small circular crops that stay legible at 14px.
// Drop the provider's cropped readout logo at this path and `wxt prepare` will
// pick it up as a valid PublicPath (until then the cast below stands in).
const SCAN_PROVIDER_LOGO_OVERRIDES: Record<string, string> = {
	'system-pasc': getAssetUrl('/assets/pasc-scan.png'),
	'system-scsn': getAssetUrl('/assets/scsn-scan.png'),
	'system-rab': getAssetUrl('/assets/rab-scan.png'),
	'system-tase': getAssetUrl('/assets/tase-scan.png')
};
const PROVIDER_ORDER = ['system-scsn', 'system-rab', 'system-tase', 'system-pasc'];
// Deterministic display order regardless of store ordering. Unknown ids sort
// last so a future provider never jumps ahead of the known ones.
function sortProviders<T extends { apiId: string }>(providers: T[]): T[] {
	const orderOf = (apiId: string): number => {
		const index = PROVIDER_ORDER.indexOf(apiId);
		return index === -1 ? PROVIDER_ORDER.length : index;
	};
	return [...providers].toSorted((a, b) => orderOf(a.apiId) - orderOf(b.apiId));
}

// Zeroed readout for the friend-ID fetch phase (0→30%), so the provider strip
// renders from the start instead of waiting for the first batch answer. Includes
// every enabled API (system and custom) because the denominator counts them all;
// PASC only appears when it is actually enabled.
function buildZeroedDetail(total: number): ScanProgressDetail {
	const apis = getEnabledCustomApis();
	const providers = sortProviders(
		apis.map((api) => ({
			apiId: api.id,
			apiName: api.name,
			logoUrl: SCAN_PROVIDER_LOGO_OVERRIDES[api.id] ?? api.landscapeImageDataUrl ?? '',
			fallbackLogoUrl: api.landscapeImageDataUrl ?? '',
			resolved: 0
		}))
	);
	return { total, providers };
}

function increment(counts: ScanCounts, category: ScanCategory): void {
	counts.set(category, (counts.get(category) ?? 0) + 1);
}

function decrement(counts: ScanCounts, category: ScanCategory): void {
	const next = (counts.get(category) ?? 0) - 1;
	if (next > 0) {
		counts.set(category, next);
	} else {
		counts.delete(category);
	}
}

export async function scanFriendsForUser(
	userId: string,
	isOwnFriends: boolean,
	onProgress: ScanProgressCallback,
	signal: AbortSignal,
	hooks?: FriendScanHooks
): Promise<ScanCounts> {
	const counts: ScanCounts = new Map();

	const friendIds = await fetchAllFriendIds(
		userId,
		(fetched) => {
			onProgress(Math.min(fetched * 0.15, SCAN_PHASE_CHECK_START), buildZeroedDetail(fetched));
		},
		signal
	);

	if (friendIds.length === 0) return counts;

	hooks?.onFriendIds?.(friendIds.map((id) => id.toString()));

	onProgress(SCAN_PHASE_CHECK_START, buildZeroedDetail(friendIds.length));

	const lookupContext = isOwnFriends ? LOOKUP_CONTEXT.FRIENDS : undefined;
	const completed = new Set<string>();
	const total = friendIds.length;

	// Live tally of the buckets each friend currently falls into. A provider
	// answering can move a friend between buckets (e.g. safe → unsafe), so keep
	// the last bucket per friend and apply the difference instead of re-counting
	// the whole batch on every update.
	const liveCounts: ScanCounts = new Map();
	const liveBuckets = new Map<
		string,
		{ category: ScanCategory | null; fromIntegration: boolean }
	>();

	const trackBucket = (
		friendId: string,
		category: ScanCategory | null,
		fromIntegration: boolean
	) => {
		const previous = liveBuckets.get(friendId);
		if (previous?.category === category && previous.fromIntegration === fromIntegration) {
			return;
		}
		if (previous?.category) decrement(liveCounts, previous.category);
		if (previous?.fromIntegration) decrement(liveCounts, 'integration');
		if (category) increment(liveCounts, category);
		if (fromIntegration) increment(liveCounts, 'integration');
		liveBuckets.set(friendId, { category, fromIntegration });
	};

	const snapshotCounts = (): ScanCounts => new Map(liveCounts);

	const results = await queryMultipleUsers(
		friendIds.map((id) => id.toString()),
		{
			lookupContext,
			signal,
			onUpdate: (friendId, combined, providers) => {
				const bucket = combinedResultToCategory(combined);
				trackBucket(friendId, bucket.category, bucket.fromIntegration);
				hooks?.onFriendResult?.(friendId, bucket.category, bucket.fromIntegration, combined);
				const live = snapshotCounts();

				// Completion tracks every enabled API the user can actually access —
				// system providers plus custom ones — so a friend counts once all of
				// *their* sources have answered, whichever those are.
				const enabledIds: string[] = getEnabledCustomApis().map((api: CustomApiConfig) => api.id);
				if (enabledIds.length === 0) return; // no APIs configured at all

				const allResolved = enabledIds.every((id: string) => {
					const result = combined.get(id);
					return result && !result.loading;
				});
				if (allResolved && !completed.has(friendId)) {
					completed.add(friendId);
				}

				// Advance on ANY provider's answers, not just fully-resolved friends:
				// holding the bar until the slowest provider finishes its first chunk
				// is what pinned it at 30%. System and custom providers both report
				// per-provider counts; the per-friend fallback is only a safety net.
				if (providers.length === 0) {
					const pct = SCAN_PHASE_CHECK_START + (completed.size / total) * SCAN_PHASE_CHECK_RANGE;
					onProgress(Math.min(pct, FRIEND_SCAN_PROGRESS_MAX), {
						total,
						providers: [],
						counts: live
					});
					return;
				}
				const resolvedSum = providers.reduce((sum, p) => sum + p.resolved, 0);
				const pct =
					SCAN_PHASE_CHECK_START +
					(resolvedSum / (total * providers.length)) * SCAN_PHASE_CHECK_RANGE;
				const detail: ScanProgressDetail = {
					total,
					counts: live,
					providers: sortProviders(providers).map((p) => ({
						apiId: p.apiId,
						apiName: p.apiName,
						logoUrl: SCAN_PROVIDER_LOGO_OVERRIDES[p.apiId] ?? p.logoUrl,
						fallbackLogoUrl: p.logoUrl,
						resolved: p.resolved
					}))
				};
				onProgress(Math.min(pct, FRIEND_SCAN_PROGRESS_MAX), detail);
			}
		}
	);

	for (const [friendId, combined] of results.entries()) {
		const { category, fromIntegration } = combinedResultToCategory(combined);
		hooks?.onFriendResult?.(friendId, category, fromIntegration, combined);
		if (category) increment(counts, category);
		// Overlaps the severity buckets above, so the scan bar keeps it out of its total
		if (fromIntegration) increment(counts, 'integration');
	}

	return counts;
}

export async function scanGroupsForUser(
	userId: string,
	onProgress: ScanProgressCallback,
	signal: AbortSignal
): Promise<ScanCounts> {
	const counts: ScanCounts = new Map();

	const groupIds = await fetchAllUserGroupIds(
		userId,
		(fetched) => onProgress(Math.min(fetched * 0.15, SCAN_PHASE_CHECK_START)),
		signal
	);

	if (groupIds.length === 0) return counts;

	onProgress(SCAN_PHASE_CHECK_START);

	const results = await groupStatusService.getStatuses(
		groupIds.map((id) => id.toString()),
		{
			lookupContext: LOOKUP_CONTEXT.GROUPS,
			signal,
			onProgress: (completed, total) => {
				onProgress(SCAN_PHASE_CHECK_START + (completed / total) * SCAN_PHASE_CHECK_RANGE);
			}
		}
	);

	for (const status of results.values()) {
		if (!status) continue;
		increment(counts, flagToCategory(status.flagType));
	}

	return counts;
}
