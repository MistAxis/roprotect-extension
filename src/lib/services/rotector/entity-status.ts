import type { EntityStatus, GroupStatus, UserStatus } from '../../types/api';
import { API_CONFIG } from '../../types/constants';
import { getCacheTtlMs } from '../../stores/settings';
import { abortableSleep, getAbortError } from '../../utils/abort';
import { asApiError } from '../../utils/api/api-error';
import { logger } from '../../utils/logging/logger';
import { chunkArray } from '../../utils/array';
import { apiClient } from './api-client';

interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

// Status objects are small but unbounded scans (friends, group members, tracked
// users) can populate one entry per entity. Keep the cache bounded and evict the
// least recently used entries once it grows past this ceiling.
const MAX_CACHE_ENTRIES = 5000;

interface StatusRequest<T> {
	resolve: (value: T | null) => void;
	reject: (error: Error) => void;
}

interface GetStatusOptions {
	signal?: AbortSignal | undefined;
}

interface GetStatusesOptions {
	lookupContext?: string | undefined;
	signal?: AbortSignal | undefined;
	onProgress?: ((completed: number, total: number) => void) | undefined;
}

// The controller short-circuits the shared fetch only when every queued waiter has aborted,
// so one caller's cancel can never reject another caller's still-active request
interface PendingEntry<T> {
	queue: Array<StatusRequest<T>>;
	controller: AbortController;
}

class EntityStatusService<T extends EntityStatus> {
	private readonly cache = new Map<string, CacheEntry<T>>();
	private readonly pendingRequests = new Map<string, PendingEntry<T>>();
	private readonly entityType: 'user' | 'group';
	private readonly fetchSingle: (id: string, options?: GetStatusOptions) => Promise<T>;
	private readonly fetchMultiple: (ids: string[], lookupContext?: string) => Promise<T[]>;

	constructor(
		entityType: 'user' | 'group',
		fetchSingle: (id: string, options?: GetStatusOptions) => Promise<T>,
		fetchMultiple: (ids: string[], lookupContext?: string) => Promise<T[]>
	) {
		this.entityType = entityType;
		this.fetchSingle = fetchSingle;
		this.fetchMultiple = fetchMultiple;
	}

	// Joins an in-flight fetch when one exists for entityId, otherwise starts one and dedupes waiters
	public async getStatus(entityId: string, options?: GetStatusOptions): Promise<T | null> {
		if (options?.signal?.aborted) {
			throw getAbortError(options.signal);
		}

		const cached = this.getCachedStatus(entityId);
		if (cached) {
			logger.info(`${this.entityType}StatusService`, 'Returning cached status', { entityId });
			return cached;
		}

		return new Promise<T | null>((resolve, reject) => {
			const signal = options?.signal;
			let onAbort: (() => void) | undefined;

			const request: StatusRequest<T> = {
				resolve: (value) => {
					if (onAbort) signal?.removeEventListener('abort', onAbort);
					resolve(value);
				},
				reject: (error) => {
					if (onAbort) signal?.removeEventListener('abort', onAbort);
					reject(error);
				}
			};

			let entry = this.pendingRequests.get(entityId);
			const isPrimary = !entry;
			if (!entry) {
				entry = { queue: [], controller: new AbortController() };
				this.pendingRequests.set(entityId, entry);
			}
			const pendingEntry = entry;

			if (signal) {
				onAbort = () => {
					const idx = pendingEntry.queue.indexOf(request);
					if (idx !== -1) pendingEntry.queue.splice(idx, 1);
					// Short-circuit the shared fetch only when every caller has abandoned it
					if (pendingEntry.queue.length === 0) {
						pendingEntry.controller.abort();
					}
					reject(getAbortError(signal));
				};
				signal.addEventListener('abort', onAbort, { once: true });
			}

			pendingEntry.queue.push(request);

			if (isPrimary) {
				logger.info(`${this.entityType}StatusService`, 'Fetching fresh status', { entityId });
				void this.runFetch(entityId, pendingEntry);
			} else {
				logger.info(`${this.entityType}StatusService`, 'Request already pending, waiting...', {
					entityId
				});
			}
		});
	}

	// Returns cached status immediately if valid, otherwise fetches in the background
	// and resolves to the fetched status (or null on cache miss + fetch failure)
	public async getOrFetch(entityId: string, options?: GetStatusOptions): Promise<T | null> {
		const cached = this.getCachedStatus(entityId);
		if (cached) {
			logger.debug(`${this.entityType}StatusService: using cached status`, {
				entityId,
				flagType: cached.flagType
			});
			return cached;
		}
		try {
			const result = await this.getStatus(entityId, options);
			if (result) {
				logger.debug(`${this.entityType}StatusService: fetched new status`, {
					entityId,
					flagType: result.flagType
				});
			}
			return result;
		} catch (error) {
			logger.error(`${this.entityType}StatusService: failed to fetch status`, {
				entityId,
				error
			});
			return null;
		}
	}

	// Returns cached status if valid, null if expired or not found
	public getCachedStatus(entityId: string): T | null {
		const entry = this.cache.get(entityId);
		if (!entry) return null;

		if (Date.now() - entry.timestamp > getCacheTtlMs()) {
			this.cache.delete(entityId);
			return null;
		}

		// Refresh insertion order so eviction is least-recently-used
		this.cache.delete(entityId);
		this.cache.set(entityId, entry);
		return entry.data;
	}

	// Writes a cache entry and trims the oldest entries when the ceiling is exceeded
	private setCachedStatus(entityId: string, data: T): void {
		this.cache.delete(entityId);
		this.cache.set(entityId, { data, timestamp: Date.now() });

		while (this.cache.size > MAX_CACHE_ENTRIES) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey === undefined) break;
			this.cache.delete(oldestKey);
		}
	}

	// Chunks uncached IDs through fetchMultiple in batches with abort support, fills missing entries with null
	public async getStatuses(
		entityIds: string[],
		options?: GetStatusesOptions
	): Promise<Map<string, T | null>> {
		if (options?.signal?.aborted) {
			throw getAbortError(options.signal);
		}

		const results = new Map<string, T | null>();
		const toFetch: string[] = [];

		for (const entityId of entityIds) {
			const cached = this.getCachedStatus(entityId);
			if (cached) {
				results.set(entityId, cached);
			} else {
				toFetch.push(entityId);
			}
		}

		const cachedCount = results.size;
		options?.onProgress?.(cachedCount, entityIds.length);

		if (toFetch.length > 0) {
			const chunks = chunkArray(toFetch, API_CONFIG.BATCH_SIZE);

			logger.info(`${this.entityType}StatusService`, 'Batch fetching statuses', {
				count: toFetch.length,
				chunks: chunks.length
			});

			let processed = 0;

			for (const [i, chunk] of chunks.entries()) {
				if (i > 0) {
					await abortableSleep(API_CONFIG.BATCH_DELAY, options?.signal);
				}

				if (options?.signal?.aborted) {
					throw getAbortError(options.signal);
				}

				await this.fetchChunk(chunk, i, results, options);
				processed += chunk.length;
				options?.onProgress?.(cachedCount + processed, entityIds.length);
			}

			for (const entityId of toFetch) {
				if (!results.has(entityId)) {
					results.set(entityId, null);
				}
			}
		}

		return results;
	}

	private async fetchChunk(
		chunk: string[],
		chunkIndex: number,
		results: Map<string, T | null>,
		options: GetStatusesOptions | undefined
	): Promise<void> {
		try {
			const batchStatuses = await this.fetchMultiple(chunk, options?.lookupContext);

			// Drop results if the caller aborted while the request was in flight. Otherwise a
			// superseded scan could still populate the cache and let stale indicators win.
			if (options?.signal?.aborted) {
				throw getAbortError(options.signal);
			}

			for (const status of batchStatuses) {
				if (status.id) {
					const entityId = status.id.toString();
					this.setCachedStatus(entityId, status);
					results.set(entityId, status);
				}
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
			logger.error(`${this.entityType}StatusService`, 'Batch fetch failed', {
				error,
				chunkIndex,
				chunkSize: chunk.length
			});
		}
	}

	public updateStatus(entityId: string, status: T): void {
		this.setCachedStatus(entityId, status);
	}

	public invalidateCache(entityId: string): void {
		this.cache.delete(entityId);
	}

	// Drops every cached verdict and aborts in-flight lookups. Used when the
	// viewer's API key changes: cached provider data belongs to the previous
	// key and may carry clearance-gated fields the new viewer cannot see.
	public clearCache(): void {
		this.cache.clear();
		for (const entry of this.pendingRequests.values()) {
			entry.controller.abort();
		}
		this.pendingRequests.clear();
	}

	// Snapshots and resolves the queued waiters from one shared fetch so late aborts don't reject siblings
	private async runFetch(entityId: string, entry: PendingEntry<T>): Promise<void> {
		try {
			const status = await this.fetchSingle(entityId, { signal: entry.controller.signal });
			const snapshot = [...entry.queue];
			this.pendingRequests.delete(entityId);
			this.setCachedStatus(entityId, status);
			for (const request of snapshot) request.resolve(status);
		} catch (error) {
			const err = asApiError(error);
			const snapshot = [...entry.queue];
			this.pendingRequests.delete(entityId);
			for (const request of snapshot) request.reject(err);
		}
	}
}

export const userStatusService = new EntityStatusService<UserStatus>(
	'user',
	async (id, options) => apiClient.checkUser(id, options),
	async (ids: string[], lookupContext?: string) =>
		apiClient.checkMultipleUsers(ids, { lookupContext })
);

export const groupStatusService = new EntityStatusService<GroupStatus>(
	'group',
	async (id, options) => apiClient.checkGroup(id, options),
	async (ids: string[], lookupContext?: string) =>
		apiClient.checkMultipleGroups(ids, { lookupContext })
);
