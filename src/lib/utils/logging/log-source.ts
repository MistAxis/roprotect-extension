import { LOG_SOURCES, type LogSource } from '../../types/developer-logs';

export const IS_DEV = import.meta.env.USE_DEV_API === 'true';

export function getLogSource(): LogSource {
	if (typeof document === 'undefined') {
		return LOG_SOURCES.BACKGROUND;
	}

	if (globalThis.location.hostname.includes('roblox.com')) {
		return LOG_SOURCES.CONTENT;
	}

	return LOG_SOURCES.POPUP;
}

// Returns a structured-clone-safe copy of value so log entries survive browser.storage.local.set on Firefox
// Stored logs are user-exportable, so URLs lose their query/fragment (which
// carry search terms, ids and session tokens) and values under credential-ish
// keys never leave the extension.
const SENSITIVE_KEY_PATTERN =
	/api[-_]?key|token|passw|secret|authorization|cookie|session|captcha|fingerprint|installation/i;

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export function redactUrlForLog(value: string): string {
	if (!ABSOLUTE_URL_PATTERN.test(value)) return value;
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return '[invalid URL]';
	}
}

function normalizeForClone(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'function') return '[Function]';
	if (typeof value === 'symbol') return value.toString();
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'string') return redactUrlForLog(value);
	if (typeof value !== 'object') return value;

	if (seen.has(value)) return '[Circular]';
	seen.add(value);

	if (value instanceof Error) {
		const out: Record<string, unknown> = {
			name: value.name,
			message: value.message,
			stack: value.stack
		};
		for (const [k, v] of Object.entries(value)) {
			if (k in out) continue;
			out[k] = normalizeForClone(v, seen);
		}
		return out;
	}
	if (typeof Node !== 'undefined' && value instanceof Node) {
		return `[Node: ${value.nodeName}]`;
	}
	if (Array.isArray(value)) {
		return value.map((v) => normalizeForClone(v, seen));
	}

	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] =
			SENSITIVE_KEY_PATTERN.test(k) && v !== null && v !== undefined
				? '[redacted]'
				: normalizeForClone(v, seen);
	}
	return out;
}

// Same redaction pass used at write time, exposed for code that formats stored
// entries (older entries may predate the write-time redaction).
export function sanitizeLogValue(value: unknown): unknown {
	return normalizeForClone(value, new WeakSet());
}

// Stringifies and truncates an arbitrary log payload, returning a clone-safe value for storage IPC
export function truncateForLog(data: unknown, maxLength: number): unknown {
	const normalized = normalizeForClone(data, new WeakSet());
	if (normalized === undefined) return undefined;
	const json = JSON.stringify(normalized);
	if (json.length > maxLength) {
		return { _truncated: true, preview: `${json.slice(0, maxLength)}...` };
	}
	return normalized;
}
