const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// True for `domain` itself and any subdomain. A plain `includes()` check would
// also accept `evilroblox.com` or `roblox.com.attacker.tld`.
export function isHostOrSubdomain(hostname: string, domain: string): boolean {
	const host = hostname.toLowerCase();
	return host === domain || host.endsWith(`.${domain}`);
}

// Returns null for non-positive, NaN, or beyond-safe-integer ids so callers can fail closed
export function sanitizeEntityId(entityId: string | number): string | null {
	const parsed = typeof entityId === 'string' ? Number.parseInt(entityId, 10) : entityId;

	if (Number.isNaN(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) {
		return null;
	}

	return parsed.toString();
}

// Throws on invalid input so background endpoint handlers fail-fast at the boundary
export function validateEntityId(entityId: string | number): string {
	const sanitized = sanitizeEntityId(entityId);
	if (!sanitized) {
		throw new Error('Invalid entity ID');
	}
	return sanitized;
}

// Sanitizes a batch and throws if nothing survives
export function processBatchEntityIds(entityIds: Array<string | number>): string[] {
	const sanitized = entityIds
		.map((id) => sanitizeEntityId(id))
		.filter((id): id is string => id !== null);

	if (sanitized.length === 0) {
		throw new Error('No valid entity IDs provided for batch check');
	}
	return sanitized;
}

// Runs `pattern` against `url` and returns the first capture group as a sanitized entity ID
export function extractIdFromUrl(url: string, pattern: RegExp): string | null {
	const id = pattern.exec(url)?.[1];
	return id ? sanitizeEntityId(id) : null;
}

// Returns null unless the url parses, is http or https, and resolves to a roblox.com host
export function sanitizeUrl(url: string): string | null {
	if (!url) return null;

	try {
		const parsed = new URL(url);

		if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
			return null;
		}

		if (!isHostOrSubdomain(parsed.hostname, 'roblox.com')) {
			return null;
		}

		return parsed.href;
	} catch {
		return null;
	}
}

// Loopback, link-local, and RFC 1918 / RFC 4193 hostnames. Used to keep
// server-supplied image URLs from being pointed at the local network.
const PRIVATE_HOSTNAME_PATTERNS = [
	/^localhost$/,
	/\.localhost$/,
	/\.local$/,
	/\.internal$/,
	/\.home\.arpa$/,
	/^0\./,
	/^10\./,
	/^127\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^::1$/,
	/^f[cd][0-9a-f]{2}:/,
	/^fe80:/
];

export function isPrivateHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replaceAll(/^\[|\]$/g, '');
	return PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(host));
}

// Returns the URL only when it is a public HTTPS URL. Used before the extension
// fetches a URL that came from a server response (avatars, outfit snapshots) so
// a hostile or compromised backend cannot make the background page reach the
// user's router, localhost, or a cloud metadata endpoint.
export function sanitizeRemoteUrl(url: string): string | null {
	if (!url) return null;

	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') return null;
		if (parsed.username || parsed.password) return null;
		if (parsed.port !== '' && parsed.port !== '443') return null;
		if (!parsed.hostname || isPrivateHostname(parsed.hostname)) return null;
		return parsed.href;
	} catch {
		return null;
	}
}

// Only http(s) destinations are safe for a rendered anchor: `javascript:`,
// `data:`, and `blob:` hrefs execute or render attacker content in the
// extension's own origin. Returns null when the URL is not safe to link.
export function sanitizeExternalHref(url: string): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
	} catch {
		return null;
	}
}

export function extractErrorMessage(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: 'An unknown error occurred';

	return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}
