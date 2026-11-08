// In-flight dedupe + TTL cache. Multiple concurrent calls for the same key share
// one fetch and subsequent calls within the TTL window return the cached value
// `getTTL` is read on every access so consumers can honor a settings-driven TTL
//
// Note: services/rotector/entity-status.ts intentionally hand-rolls its own
// dedupe queue rather than composing this class. It needs (a) abort coordination
// where the shared fetch is only cancelled when *every* waiter has aborted, and
// (b) a batched-fetch path that fans many keys into a single chunked request.
// Neither fits the single-fetcher contract here.
export class DedupeCache<K, V> {
	private cache = new Map<K, { value: V; timestamp: number }>();
	private pending = new Map<K, Promise<V>>();
	private getTTL: () => number;

	// Browsing many profiles would otherwise grow these maps for the life of the
	// content script. Evict the oldest insertion once the cap is reached.
	private static readonly MAX_ENTRIES = 1000;

	constructor(getTTL: () => number) {
		this.getTTL = getTTL;
	}

	private evictIfNeeded(): void {
		while (this.cache.size > DedupeCache.MAX_ENTRIES) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
		}
	}

	async get(key: K, fetcher: () => Promise<V>): Promise<V> {
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.timestamp < this.getTTL()) return cached.value;

		const inflight = this.pending.get(key);
		if (inflight) return inflight;

		const promise = fetcher();
		this.pending.set(key, promise);
		try {
			const value = await promise;
			// Only cache if we're still the in-flight entry because a concurrent set() would
			// have deleted pending and written a fresher value we shouldn't clobber
			if (this.pending.get(key) === promise) {
				this.cache.set(key, { value, timestamp: Date.now() });
				this.evictIfNeeded();
			}
			return value;
		} finally {
			if (this.pending.get(key) === promise) {
				this.pending.delete(key);
			}
		}
	}

	// Write-through: store value directly without firing the fetcher
	set(key: K, value: V): void {
		this.cache.set(key, { value, timestamp: Date.now() });
		this.pending.delete(key);
		this.evictIfNeeded();
	}

	invalidate(key: K): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}
}
