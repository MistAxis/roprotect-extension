import { derived, get, writable } from 'svelte/store';
import { apiClient } from '../services/rotector/api-client';
import { PASC_ACCESS_RANK, type PascAccessLevel } from '../data/pasc';
import { logger } from '../utils/logging/logger';

interface PascClearanceState {
	level: PascAccessLevel | null;
	loading: boolean;
}

// Viewer's PASC clearance, fetched once per session through the RoProtect
// proxy (`GET /v1/pasc/v1/clearance`). Null until loaded; a failed fetch leaves
// it null (edit stays hidden, details render from server-filtered data).
const clearanceState = writable<PascClearanceState>({ level: null, loading: false });

let inflight: Promise<PascAccessLevel | null> | null = null;
// Invalidates an in-flight lookup when the API key changes, so a result for the
// previous viewer can never grant clearance to the new one.
let generation = 0;
let lastFailedAt = 0;

// A failed lookup is retried lazily, but not on every tooltip: without this a
// level-0 viewer would re-request clearance for every hover while the proxy is
// down or refuses the route.
const CLEARANCE_RETRY_MS = 30_000;

// Drops the cached clearance. Call whenever the API key changes: PASC access is
// resolved from that key, so the previous viewer's level must not survive a
// sign-out or account switch in the same tab.
export function resetPascClearance(): void {
	generation += 1;
	inflight = null;
	lastFailedAt = 0;
	clearanceState.set({ level: null, loading: false });
}

export function ensurePascClearance(): Promise<PascAccessLevel | null> {
	const current = get(clearanceState);
	if (current.level !== null || current.loading) {
		if (current.loading && inflight) return inflight;
		return Promise.resolve(current.level);
	}
	if (Date.now() - lastFailedAt < CLEARANCE_RETRY_MS) {
		return Promise.resolve(null);
	}

	const requestGeneration = generation;
	clearanceState.set({ level: null, loading: true });
	inflight = apiClient
		.getPascClearance()
		.then((level) => {
			if (requestGeneration !== generation) return null;
			clearanceState.set({ level, loading: false });
			return level;
		})
		.catch((error: unknown) => {
			if (requestGeneration !== generation) return null;
			logger.warn('[PASC] Clearance lookup failed; edit stays hidden:', error);
			lastFailedAt = Date.now();
			clearanceState.set({ level: null, loading: false });
			return null;
		})
		.finally(() => {
			if (requestGeneration === generation) inflight = null;
		});
	return inflight;
}

export const pascClearance = derived(clearanceState, ($state) => $state.level);

// Until clearance resolves (or if it fails), treat the viewer as the lowest
// clearance. A full-visibility fallback would make every client-side PASC
// detail gate fail open; showing less until the server answers is the only
// safe default.
export const pascViewerLevel = derived(
	clearanceState,
	($state): PascAccessLevel => $state.level ?? '0'
);

export const pascCanEdit = derived(
	clearanceState,
	($state) => $state.level !== null && PASC_ACCESS_RANK[$state.level] >= PASC_ACCESS_RANK.M1
);
