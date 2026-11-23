import { writable } from 'svelte/store';
import {
	beginFriendsScan,
	failFriendsScan,
	finishFriendsScan,
	recordFriendScanResult,
	resetFriendsScan,
	setFriendsScanFriendIds
} from '../../stores/friends-scan';
import { STORAGE_KEYS } from '../../types/constants';
import type { UserStatus } from '../../types/api';
import type { CombinedStatus, CustomApiResult } from '../../types/custom-api';
import { isAbortError } from '../../utils/abort';
import { logger } from '../../utils/logging/logger';
import { combinedResultToCategory, type ScanCategory } from '../../utils/status/scan-category';
import { getStorage, removeStorage, setStorage, subscribeStorageKey } from '../../utils/storage';
import {
	scanFriendsForUser,
	type FriendScanResume,
	type ScanCounts,
	type ScanProgressDetail
} from './scan-jobs';

export type FriendsScanPhase = 'scanning' | 'complete' | 'error';

export interface FriendsScanState {
	userId: string | null;
	isOwnFriends: boolean;
	phase: FriendsScanPhase;
	percent: number;
	detail: ScanProgressDetail | null;
	counts: ScanCounts;
}

// A scan is owned by this module, not by the component that happens to show it.
// Within one page the session is reused directly. Across page transitions that
// tear the content script down (and across tabs), progress is mirrored into
// storage and a later page either follows the live writer or resumes from its
// completed results instead of starting the lookup over.
export const friendsScanState = writable<FriendsScanState>({
	userId: null,
	isOwnFriends: false,
	phase: 'scanning',
	percent: 0,
	detail: null,
	counts: new Map()
});

// Identifies this content-script instance in the shared scan record.
const WRITER_ID = Math.random().toString(36).slice(2);

// Navigation unmounts the old panel before the next one mounts. Give a new
// panel enough time to join before cancelling the work it was about to reuse.
const RELEASE_GRACE_MS = 5000;
// A completed scan stays resumable so opening the friends page afterwards
// shows the results instantly. Records older than this are discarded.
const RESUME_TTL_MS = 5 * 60 * 1000;
// How often the writer refreshes the liveness heartbeat.
const HEARTBEAT_MS = 1000;
// A follower that has not heard from the writer for this long takes over.
const FOLLOW_STALE_MS = 3000;
// Serializes progress writes; per-friend callbacks arrive far more often.
const PERSIST_INTERVAL_MS = 500;
const TAKEOVER_JITTER_MS = 150;

const STATE_KEY_PREFIX = `${STORAGE_KEYS.FRIENDS_SCAN_STATE}:`;
const HEARTBEAT_KEY_PREFIX = `${STORAGE_KEYS.FRIENDS_SCAN_STATE}-heartbeat:`;

type SerializedCombined = Array<[string, CustomApiResult<UserStatus>]>;

interface PersistedFriendResult {
	category: ScanCategory | null;
	fromIntegration: boolean;
	// Status payloads are only kept for flagged friends. Safe friends carry no
	// useful detail and would otherwise dominate the storage write.
	combined?: SerializedCombined;
}

interface PersistedScanDetail {
	total: number;
	providers: ScanProgressDetail['providers'];
}

interface PersistedFriendsScan {
	version: 1;
	userId: string;
	isOwnFriends: boolean;
	phase: FriendsScanPhase;
	percent: number;
	detail: PersistedScanDetail | null;
	counts: Array<[ScanCategory, number]>;
	friendIds: string[];
	completed: Array<[string, PersistedFriendResult]>;
	writerId: string;
	updatedAt: number;
}

interface PersistedHeartbeat {
	writerId: string;
	updatedAt: number;
}

interface ScanSession {
	userId: string;
	isOwnFriends: boolean;
	subscribers: number;
	controller: AbortController | null;
	releaseTimer: ReturnType<typeof setTimeout> | null;
	persistTimer: ReturnType<typeof setTimeout> | null;
	followTimer: ReturnType<typeof setTimeout> | null;
	heartbeatTimer: ReturnType<typeof setInterval> | null;
	unsubscribeStorage: (() => void) | null;
	following: boolean;
	writerId: string;
	lastSeenAt: number;
	state: FriendsScanState;
	friendIds: string[];
	statuses: Map<string, CombinedStatus<UserStatus>>;
	buckets: Map<string, { category: ScanCategory | null; fromIntegration: boolean }>;
	completedIds: Set<string>;
	hydratedIds: Set<string>;
}

let session: ScanSession | null = null;

function stateKey(userId: string): string {
	return `${STATE_KEY_PREFIX}${userId}`;
}

function heartbeatKey(userId: string): string {
	return `${HEARTBEAT_KEY_PREFIX}${userId}`;
}

function isWriter(target: ScanSession): boolean {
	return !target.following && target.writerId === WRITER_ID;
}

function publish(target: ScanSession): void {
	if (session === target) friendsScanState.set(target.state);
}

function emptyState(userId: string | null, isOwnFriends = false): FriendsScanState {
	return {
		userId,
		isOwnFriends,
		phase: 'scanning',
		percent: 0,
		detail: null,
		counts: new Map()
	};
}

function serializeCombined(combined: CombinedStatus<UserStatus>): SerializedCombined {
	return [...combined.entries()];
}

function deserializeCombined(entries: SerializedCombined): CombinedStatus<UserStatus> {
	return new Map(entries);
}

function buildPersisted(target: ScanSession): PersistedFriendsScan {
	const completed: Array<[string, PersistedFriendResult]> = [];
	for (const friendId of target.completedIds) {
		const bucket = target.buckets.get(friendId);
		if (!bucket) continue;

		const entry: PersistedFriendResult = {
			category: bucket.category,
			fromIntegration: bucket.fromIntegration
		};
		const combined = target.statuses.get(friendId);
		if (bucket.category && bucket.category !== 'safe' && combined) {
			entry.combined = serializeCombined(combined);
		}
		completed.push([friendId, entry]);
	}

	const detail = target.state.detail
		? { total: target.state.detail.total, providers: target.state.detail.providers }
		: null;

	return {
		version: 1,
		userId: target.userId,
		isOwnFriends: target.isOwnFriends,
		phase: target.state.phase,
		percent: target.state.percent,
		detail,
		counts: [...target.state.counts.entries()],
		friendIds: [...target.friendIds],
		completed,
		writerId: target.writerId,
		updatedAt: Date.now()
	};
}

async function readPersisted(userId: string): Promise<PersistedFriendsScan | null> {
	const value = await getStorage<PersistedFriendsScan | null>('local', stateKey(userId), null);
	if (value?.userId !== userId) return null;

	if (Date.now() - value.updatedAt > RESUME_TTL_MS) {
		void removeStorage('local', [stateKey(userId), heartbeatKey(userId)]);
		return null;
	}

	return value;
}

// Applies a persisted record to a session. `initial` performs the one-time
// store reset; later calls only merge friends the follower has not seen yet.
function applyPersisted(
	target: ScanSession,
	persisted: PersistedFriendsScan,
	initial: boolean
): void {
	if (initial) {
		target.friendIds = [...persisted.friendIds];
		target.statuses.clear();
		target.buckets.clear();
		target.completedIds.clear();
		target.hydratedIds.clear();
		beginFriendsScan(target.userId);
		setFriendsScanFriendIds(target.userId, target.friendIds);
	} else if (persisted.friendIds.length !== target.friendIds.length) {
		target.friendIds = [...persisted.friendIds];
		setFriendsScanFriendIds(target.userId, target.friendIds);
	}

	for (const [friendId, entry] of persisted.completed) {
		if (target.hydratedIds.has(friendId)) continue;

		const combined: CombinedStatus<UserStatus> = entry.combined
			? deserializeCombined(entry.combined)
			: new Map<string, CustomApiResult<UserStatus>>();
		target.statuses.set(friendId, combined);
		target.buckets.set(friendId, {
			category: entry.category,
			fromIntegration: entry.fromIntegration
		});
		target.completedIds.add(friendId);
		target.hydratedIds.add(friendId);
		recordFriendScanResult(target.userId, friendId, entry.category, combined);
	}

	target.state = {
		userId: target.userId,
		isOwnFriends: persisted.isOwnFriends,
		phase: persisted.phase,
		percent: Math.max(target.state.percent, persisted.percent),
		detail: persisted.detail ? { ...persisted.detail } : null,
		counts: new Map(persisted.counts)
	};
	publish(target);

	if (persisted.phase === 'complete') {
		finishFriendsScan(target.userId);
	} else if (persisted.phase === 'error') {
		failFriendsScan(target.userId);
	}
}

function buildResume(target: ScanSession): FriendScanResume | null {
	if (target.friendIds.length === 0) return null;

	const results = new Map<
		string,
		{
			category: ScanCategory | null;
			fromIntegration: boolean;
			combined: CombinedStatus<UserStatus>;
		}
	>();

	for (const friendId of target.completedIds) {
		const bucket = target.buckets.get(friendId);
		if (!bucket) continue;
		results.set(friendId, {
			category: bucket.category,
			fromIntegration: bucket.fromIntegration,
			combined: target.statuses.get(friendId) ?? new Map<string, CustomApiResult<UserStatus>>()
		});
	}

	return { friendIds: [...target.friendIds], results };
}

function persistNow(target: ScanSession): void {
	if (session !== target || !isWriter(target)) return;
	const record = buildPersisted(target);
	void setStorage('local', stateKey(target.userId), record);
	void setStorage('local', heartbeatKey(target.userId), {
		writerId: target.writerId,
		updatedAt: Date.now()
	} satisfies PersistedHeartbeat);
}

function schedulePersist(target: ScanSession): void {
	if (!isWriter(target) || target.persistTimer !== null) return;
	target.persistTimer = setTimeout(() => {
		target.persistTimer = null;
		persistNow(target);
	}, PERSIST_INTERVAL_MS);
}

function startHeartbeat(target: ScanSession): void {
	if (target.heartbeatTimer !== null) return;
	target.heartbeatTimer = setInterval(() => {
		if (session !== target || !isWriter(target)) return;
		void setStorage('local', heartbeatKey(target.userId), {
			writerId: target.writerId,
			updatedAt: Date.now()
		} satisfies PersistedHeartbeat);
	}, HEARTBEAT_MS);
}

function stopHeartbeat(target: ScanSession): void {
	if (target.heartbeatTimer === null) return;
	clearInterval(target.heartbeatTimer);
	target.heartbeatTimer = null;
}

function clearFollowTimer(target: ScanSession): void {
	if (target.followTimer === null) return;
	clearTimeout(target.followTimer);
	target.followTimer = null;
}

function scheduleFollowCheck(target: ScanSession): void {
	if (!target.following) return;
	clearFollowTimer(target);
	target.followTimer = setTimeout(() => {
		target.followTimer = null;
		if (session !== target || !target.following) return;
		void takeOver(target);
	}, FOLLOW_STALE_MS);
}

async function takeOver(target: ScanSession): Promise<void> {
	if (session !== target || !target.following) return;

	// Claim the record first so two followers that notice the same stale writer
	// do not both resume the remaining friends.
	const claim = buildPersisted(target);
	claim.writerId = WRITER_ID;
	claim.updatedAt = Date.now();
	await setStorage('local', stateKey(target.userId), claim);
	await setStorage('local', heartbeatKey(target.userId), {
		writerId: WRITER_ID,
		updatedAt: Date.now()
	} satisfies PersistedHeartbeat);

	await new Promise((resolve) => setTimeout(resolve, TAKEOVER_JITTER_MS));
	if (session !== target) return;

	const latest = await readPersisted(target.userId);
	if (latest && latest.writerId !== WRITER_ID) {
		target.lastSeenAt = latest.updatedAt;
		applyPersisted(target, latest, false);
		if (latest.phase === 'scanning') scheduleFollowCheck(target);
		return;
	}

	target.following = false;
	target.writerId = WRITER_ID;
	target.unsubscribeStorage?.();
	target.unsubscribeStorage = null;
	startHeartbeat(target);
	void runScan(target, buildResume(target));
}

function subscribeToPersisted(target: ScanSession): void {
	const unsubscribeState = subscribeStorageKey<PersistedFriendsScan | undefined>(
		'local',
		stateKey(target.userId),
		(value) => {
			if (session !== target || value?.userId !== target.userId) return;
			if (value.writerId === WRITER_ID) return;
			if (value.updatedAt < target.lastSeenAt) return;

			target.lastSeenAt = value.updatedAt;
			applyPersisted(target, value, false);

			if (value.phase === 'scanning') {
				scheduleFollowCheck(target);
			} else {
				clearFollowTimer(target);
			}
		}
	);

	const unsubscribeHeartbeat = subscribeStorageKey<PersistedHeartbeat | undefined>(
		'local',
		heartbeatKey(target.userId),
		(value) => {
			if (session !== target || !value || value.writerId === WRITER_ID) return;
			target.lastSeenAt = Math.max(target.lastSeenAt, value.updatedAt);
			scheduleFollowCheck(target);
		}
	);

	target.unsubscribeStorage = () => {
		unsubscribeState();
		unsubscribeHeartbeat();
	};
}

function cancelRelease(target: ScanSession): void {
	if (target.releaseTimer === null) return;
	clearTimeout(target.releaseTimer);
	target.releaseTimer = null;
}

function scheduleRelease(target: ScanSession): void {
	if (target.releaseTimer !== null) return;
	const delay = target.controller ? RELEASE_GRACE_MS : RESUME_TTL_MS;
	target.releaseTimer = setTimeout(() => {
		target.releaseTimer = null;
		if (session !== target || target.subscribers > 0) return;
		stopSession(target, false);
	}, delay);
}

function stopSession(target: ScanSession, clearPersisted: boolean): void {
	target.controller?.abort();
	target.controller = null;
	cancelRelease(target);
	clearFollowTimer(target);
	stopHeartbeat(target);
	target.unsubscribeStorage?.();
	target.unsubscribeStorage = null;

	if (target.persistTimer !== null) {
		clearTimeout(target.persistTimer);
		target.persistTimer = null;
	}

	if (clearPersisted) {
		void removeStorage('local', [stateKey(target.userId), heartbeatKey(target.userId)]);
	}

	if (session !== target) return;
	session = null;
	friendsScanState.set(emptyState(null));
	resetFriendsScan();
}

async function runScan(target: ScanSession, resume: FriendScanResume | null): Promise<void> {
	const { userId, isOwnFriends } = target;
	const controller = new AbortController();
	target.controller = controller;

	try {
		const result = await scanFriendsForUser(
			userId,
			isOwnFriends,
			(percent, detail) => {
				if (session !== target || controller.signal.aborted) return;
				target.state = {
					...target.state,
					// A resumed run starts its percentage from the restored friend
					// count, which can be below the last reported provider progress.
					percent: Math.max(target.state.percent, percent),
					...(detail ? { detail, counts: detail.counts ?? target.state.counts } : {})
				};
				publish(target);
				schedulePersist(target);
			},
			controller.signal,
			{
				onFriendIds: (ids) => {
					if (session !== target || controller.signal.aborted) return;
					target.friendIds = [...ids];
					setFriendsScanFriendIds(userId, ids);
					schedulePersist(target);
				},
				onFriendResult: (friendId, category, fromIntegration, combined) => {
					if (session !== target || controller.signal.aborted) return;
					target.statuses.set(friendId, combined);
					target.buckets.set(friendId, { category, fromIntegration });
					recordFriendScanResult(userId, friendId, category, combined);
					schedulePersist(target);
				},
				onFriendComplete: (friendId, combined) => {
					if (session !== target || controller.signal.aborted) return;
					target.completedIds.add(friendId);
					target.statuses.set(friendId, combined);
					schedulePersist(target);
				}
			},
			resume ?? undefined
		);

		if (session !== target || controller.signal.aborted) return;

		target.controller = null;
		target.state = {
			...target.state,
			phase: 'complete',
			percent: 100,
			counts: result
		};
		publish(target);
		finishFriendsScan(userId);
		stopHeartbeat(target);
		persistNow(target);

		if (target.subscribers === 0) scheduleRelease(target);
	} catch (error) {
		if (session !== target || controller.signal.aborted || isAbortError(error)) return;

		target.controller = null;
		target.state = { ...target.state, phase: 'error' };
		publish(target);
		failFriendsScan(userId);
		stopHeartbeat(target);
		persistNow(target);
		logger.error('Friends scan failed', error);

		if (target.subscribers === 0) scheduleRelease(target);
	}
}

function createSession(userId: string, isOwnFriends: boolean): ScanSession {
	const target: ScanSession = {
		userId,
		isOwnFriends,
		subscribers: 0,
		controller: null,
		releaseTimer: null,
		persistTimer: null,
		followTimer: null,
		heartbeatTimer: null,
		unsubscribeStorage: null,
		following: false,
		writerId: WRITER_ID,
		lastSeenAt: 0,
		state: emptyState(userId, isOwnFriends),
		friendIds: [],
		statuses: new Map(),
		buckets: new Map(),
		completedIds: new Set(),
		hydratedIds: new Set()
	};

	beginFriendsScan(userId);
	return target;
}

async function initializeSession(target: ScanSession): Promise<void> {
	try {
		const persisted = await readPersisted(target.userId);
		if (session !== target) return;

		if (persisted) {
			applyPersisted(target, persisted, true);
			target.lastSeenAt = persisted.updatedAt;

			if (persisted.phase !== 'scanning') return;

			const heartbeat = await getStorage<PersistedHeartbeat | null>(
				'local',
				heartbeatKey(target.userId),
				null
			);
			if (session !== target) return;

			const writerAlive =
				heartbeat !== null &&
				heartbeat.writerId === persisted.writerId &&
				Date.now() - heartbeat.updatedAt < FOLLOW_STALE_MS;

			if (writerAlive) {
				logger.debug('Friends scan: following live writer', {
					userId: target.userId,
					completed: target.completedIds.size
				});
				target.following = true;
				target.writerId = '';
				subscribeToPersisted(target);
				scheduleFollowCheck(target);
				return;
			}

			// The writer stopped before finishing (page reload/close). Continue its
			// work from the friends it had already resolved.
			logger.debug('Friends scan: resuming persisted scan', {
				userId: target.userId,
				completed: target.completedIds.size,
				total: target.friendIds.length
			});
			target.following = false;
			target.writerId = WRITER_ID;
			startHeartbeat(target);
			void runScan(target, buildResume(target));
			return;
		}

		target.following = false;
		target.writerId = WRITER_ID;
		startHeartbeat(target);
		void runScan(target, null);
	} catch (error) {
		logger.error('Failed to restore friends scan state', error);
		if (session !== target) return;
		target.following = false;
		target.writerId = WRITER_ID;
		startHeartbeat(target);
		void runScan(target, null);
	}
}

/**
 * Carry a PASC save/refresh made in a friend's tooltip into the shared scan
 * session: the live store is updated by the caller, and this keeps the bucket
 * (plus the summary counts) used for resuming/persisting in sync so a later
 * page or tab does not restore the verdict the record had before the edit.
 */
export function applyFriendScanStatusUpdate(
	userId: string,
	friendId: string,
	combined: CombinedStatus<UserStatus>
): void {
	const target = session;
	if (target?.userId !== userId) return;

	const previous = target.buckets.get(friendId);
	if (!previous) return;

	const bucket = combinedResultToCategory(combined);
	target.statuses.set(friendId, combined);
	target.buckets.set(friendId, bucket);

	const counts = new Map(target.state.counts);
	const bump = (category: ScanCategory, delta: number) => {
		const next = (counts.get(category) ?? 0) + delta;
		if (next > 0) {
			counts.set(category, next);
		} else {
			counts.delete(category);
		}
	};
	if (previous.category) bump(previous.category, -1);
	// 'integration' overlaps the severity buckets, so a friend contributes to it
	// separately from its own category.
	if (previous.fromIntegration) bump('integration', -1);
	if (bucket.category) bump(bucket.category, 1);
	if (bucket.fromIntegration) bump('integration', 1);

	// Replace the map rather than mutating it: the panel's derived counts only
	// recompute when the Map identity changes.
	target.state = { ...target.state, counts };
	publish(target);

	// Also refreshes the store's cached category through recordFriendScanResult.
	recordFriendScanResult(target.userId, friendId, bucket.category, combined);
	schedulePersist(target);
}

/**
 * Join the scan for a user, starting one if it is not already running. Late
 * joiners (a profile followed by its friends page, or the reverse) reuse the
 * in-flight scan and receive its current progress immediately. When the page
 * was torn down, the persisted record is followed or resumed instead.
 *
 * Returns a release function for the component's cleanup.
 */
export function joinFriendsScan(userId: string, isOwnFriends: boolean): () => void {
	if (session !== null && session.userId !== userId) stopSession(session, false);

	if (session === null) {
		session = createSession(userId, isOwnFriends);
		session.subscribers = 1;
		publish(session);
		void initializeSession(session);
		const joined = session;
		return () => releaseFriendsScan(joined);
	}

	cancelRelease(session);
	session.subscribers += 1;
	logger.debug('Friends scan: reusing in-memory session', {
		userId,
		phase: session.state.phase,
		percent: session.state.percent
	});
	const joined = session;
	return () => releaseFriendsScan(joined);
}

function releaseFriendsScan(target: ScanSession): void {
	if (session !== target) return;
	target.subscribers = Math.max(0, target.subscribers - 1);
	if (target.subscribers === 0) scheduleRelease(target);
}

/**
 * Restart the scan for a user (the retry action). Subscribers are preserved so
 * every mounted panel follows the fresh run.
 */
export function restartFriendsScan(userId: string, isOwnFriends: boolean): void {
	if (session !== null && session.userId !== userId) stopSession(session, false);

	if (session === null) {
		session = createSession(userId, isOwnFriends);
		publish(session);
	}

	const target = session;
	cancelRelease(target);
	clearFollowTimer(target);
	target.controller?.abort();
	target.controller = null;
	target.following = false;
	target.writerId = WRITER_ID;
	target.friendIds = [];
	target.statuses.clear();
	target.buckets.clear();
	target.completedIds.clear();
	target.hydratedIds.clear();
	target.state = emptyState(userId, isOwnFriends);
	beginFriendsScan(userId);
	publish(target);
	startHeartbeat(target);
	void runScan(target, null);
}

/**
 * Abandon the active scan entirely and forget its persisted progress. Used when
 * viewer-scoped caches are cleared (API key change), where replaying the
 * previous viewer's scan would be wrong.
 */
export function stopFriendsScan(): void {
	if (session === null) return;
	stopSession(session, true);
}
