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
const PRIVATE_IPV4_PATTERNS = [
	/^0\./,
	/^10\./,
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
	/^127\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.0\.[02]\./,
	/^192\.168\./,
	/^198\.1[89]\./
];

const PRIVATE_HOSTNAME_PATTERNS = [
	/^localhost$/,
	/\.localhost$/,
	/\.local$/,
	/\.internal$/,
	/\.home\.arpa$/,
	/^::1$/,
	// Unspecified address: connecting to [::] reaches loopback on most stacks.
	/^::$/,
	// Unique-local fc00::/7 and link-local fe80::/10.
	/^f[cd][0-9a-f]{2}:/,
	/^fe[89ab][0-9a-f]?:/
];

// IPv4 addresses embedded in an IPv6 address: IPv4-mapped (::ffff:) and the
// NAT64 well-known/local-use prefixes, which a resolver can turn into a
// connection to the embedded IPv4 destination. WHATWG URL parsing rewrites the
// dotted form to two hex groups, so both shapes have to be handled.
const IPV4_EMBEDDING_PREFIXES = ['::ffff:', '64:ff9b::', '64:ff9b:1::'];

function embeddedIpv4(host: string): string | null {
	for (const prefix of IPV4_EMBEDDING_PREFIXES) {
		if (!host.startsWith(prefix)) continue;
		const rest = host.slice(prefix.length);

		const dotted = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(rest);
		if (dotted?.[1]) return dotted[1];

		const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
		if (hex?.[1] && hex[2] !== undefined) {
			const high = Number.parseInt(hex[1], 16);
			const low = Number.parseInt(hex[2], 16);
			return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
		}
	}
	return null;
}

function isPrivateIpv4(host: string): boolean {
	return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host));
}

export function isPrivateHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replaceAll(/^\[|\]$/g, '');

	const embedded = embeddedIpv4(host);
	if (embedded !== null) return isPrivateIpv4(embedded);

	return isPrivateIpv4(host) || PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(host));
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
