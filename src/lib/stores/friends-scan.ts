import { writable } from 'svelte/store';
import type { UserStatus } from '../types/api';
import type { CombinedStatus } from '../types/custom-api';
import type { ScanCategory } from '../utils/status/scan-category';
import { withUpdatedProviderData } from '../utils/status/status-utils';

// Live scan results for the friends page. The scan already queries every
// friend to build its summary; keeping the per-friend bucket lets the tag
// filters reuse that work instead of running a second full lookup.
export interface FriendsScanSnapshot {
	userId: string | null;
	scanning: boolean;
	complete: boolean;
	failed: boolean;
	friendIds: readonly string[];
	categories: ReadonlyMap<string, ScanCategory>;
	statuses: ReadonlyMap<string, CombinedStatus<UserStatus>>;
	revision: number;
}

const EMPTY_SNAPSHOT: FriendsScanSnapshot = {
	userId: null,
	scanning: false,
	complete: false,
	failed: false,
	friendIds: [],
	categories: new Map(),
	statuses: new Map(),
	revision: 0
};

export const friendsScanStore = writable<FriendsScanSnapshot>(EMPTY_SNAPSHOT);

// null means "show the native list / All chip".
export const selectedFriendsCategory = writable<ScanCategory | null>(null);

let userId: string | null = null;
let scanning = false;
let complete = false;
let failed = false;
let friendIds: string[] = [];
let categories = new Map<string, ScanCategory>();
let statuses = new Map<string, CombinedStatus<UserStatus>>();
let revision = 0;
let flushScheduled = false;

function publish(): void {
	revision += 1;
	friendsScanStore.set({
		userId,
		scanning,
		complete,
		failed,
		friendIds,
		categories,
		statuses,
		revision
	});
}

// Provider callbacks arrive per friend (and per provider update), so coalesce
// DOM updates into a single store notification per microtask.
function schedulePublish(): void {
	if (flushScheduled) return;
	flushScheduled = true;
	queueMicrotask(() => {
		flushScheduled = false;
		publish();
	});
}

export function beginFriendsScan(nextUserId: string): void {
	userId = nextUserId;
	scanning = true;
	complete = false;
	failed = false;
	friendIds = [];
	categories = new Map();
	statuses = new Map();
	selectedFriendsCategory.set(null);
	publish();
}

export function setFriendsScanFriendIds(nextUserId: string, ids: readonly string[]): void {
	if (userId !== nextUserId) return;
	friendIds = [...ids];
	schedulePublish();
}

export function recordFriendScanResult(
	nextUserId: string,
	friendId: string,
	category: ScanCategory | null,
	combined: CombinedStatus<UserStatus>
): void {
	if (userId !== nextUserId) return;
	if (category === null) {
		categories.delete(friendId);
	} else {
		categories.set(friendId, category);
	}
	statuses.set(friendId, combined);
	schedulePublish();
}

// A PASC save/refresh inside the tooltip replaces the authoritative verdict for
// the friend, so keep the cached combined status in sync with the indicator.
export function updateFriendScanStatus(friendId: string, next: UserStatus): void {
	const current = statuses.get(friendId);
	if (!current) return;
	statuses.set(friendId, withUpdatedProviderData(current, 'system-pasc', next));
	schedulePublish();
}

export function finishFriendsScan(nextUserId: string): void {
	if (userId !== nextUserId) return;
	scanning = false;
	complete = true;
	failed = false;
	publish();
}

export function failFriendsScan(nextUserId: string): void {
	if (userId !== nextUserId) return;
	scanning = false;
	complete = false;
	failed = true;
	publish();
}

export function resetFriendsScan(): void {
	userId = null;
	scanning = false;
	complete = false;
	failed = false;
	friendIds = [];
	categories = new Map();
	statuses = new Map();
	selectedFriendsCategory.set(null);
	publish();
}

export function toggleSelectedFriendsCategory(category: ScanCategory): void {
	selectedFriendsCategory.update((current) => (current === category ? null : category));
}
