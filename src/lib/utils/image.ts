import { sanitizeRemoteUrl } from './dom/sanitizer';

// Inline images are held in memory and can be produced by any configured
// provider, so cap both what we request and what we accept.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Fetch an image URL and encode as a base64 data URL
// Chunks the buffer through String.fromCharCode to dodge stack overflows
// on large images that would otherwise blow `apply()`
export async function fetchImageAsDataUrl(url: string): Promise<string> {
	// The URL may come from an API response; refuse loopback/private targets and
	// plaintext transports before the request leaves the extension.
	const safeUrl = sanitizeRemoteUrl(url);
	if (!safeUrl) {
		throw new Error('Image URL rejected: only public HTTPS URLs are allowed');
	}

	// `redirect: 'error'`: a 30x from a public host could otherwise send the
	// request to loopback/metadata addresses that the initial URL check cannot
	// see. Callers already treat a failed inline as non-fatal.
	const response = await fetch(safeUrl, { redirect: 'error' });
	if (!response.ok) {
		throw new Error(`Image fetch failed with status ${String(response.status)}`);
	}

	const declaredLength = Number(response.headers.get('content-length') ?? '0');
	if (declaredLength > MAX_IMAGE_BYTES) {
		throw new Error('Image fetch rejected: image exceeds the size limit');
	}

	const buffer = await response.arrayBuffer();
	if (buffer.byteLength > MAX_IMAGE_BYTES) {
		throw new Error('Image fetch rejected: image exceeds the size limit');
	}
	const bytes = new Uint8Array(buffer);

	const chunkSize = 0x80_00;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}

	// Trust the response MIME so non-webp sources (Discord serves png/gif) keep
	// their real type. Allowlist raster formats only: an SVG data URL is markup
	// and should never be treated as a trusted inline image. Roblox's page CSP
	// allows `img-src data:` but not cdn.discordapp.com, so images destined for
	// the tooltip have to travel inline as data URLs rather than be fetched by
	// the page.
	const ALLOWED_IMAGE_MIMES = new Set([
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'image/avif'
	]);
	const rawMime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
	const mimeType = rawMime && ALLOWED_IMAGE_MIMES.has(rawMime) ? rawMime : 'image/webp';

	return `data:${mimeType};base64,${btoa(binary)}`;
}
