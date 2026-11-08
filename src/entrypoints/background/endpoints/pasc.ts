import * as v from 'valibot';
import { API_CONFIG, PASC_FILE_LIMITS } from '@/lib/types/constants';
import type { PascFileDescriptor, PascRecordUpsert, UserStatus } from '@/lib/types/api';
import type { PascAccessLevel } from '@/lib/data/pasc';
import { SETTINGS_KEYS } from '@/lib/types/settings';
import { getStorage } from '@/lib/utils/storage';
import { validateEntityId } from '@/lib/utils/dom/sanitizer';
import { parseUserStatus } from '@/lib/schemas/rotector';
import { sanitizeFilename } from '@/lib/utils/filename';
import { makeHttpRequest } from '../http-client';

const PascClearanceLevelSchema = v.picklist(['0', 'A1', 'A2', 'M1', 'M2']);

// Reads a response body while enforcing a hard byte cap, so a chunked response
// without Content-Length cannot exhaust the worker's memory.
async function readBodyWithLimit(response: Response, limit: number): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel().catch(() => {});
			throw new Error(
				`PASC file download rejected: file exceeds ${String(limit / (1024 * 1024))} MB`
			);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

const PascFileDescriptorSchema = v.object({
	fileId: v.string(),
	name: v.nullish(v.string()),
	size: v.nullish(v.number()),
	access: v.nullish(v.string())
});

function pascFileHeaders(apiKey: string, clientId?: string): Headers {
	const headers = new Headers({ 'X-Auth-Token': apiKey });
	if (clientId) headers.set('X-Client-ID', clientId);
	return headers;
}

// Raw file fetches cannot use makeHttpRequest (multipart/binary bodies), so
// they carry their own explicit timeout and client id. A hung upload/download
// must fail instead of leaving the modal stuck on "Uploading...".
async function fetchPascFile(
	url: string,
	apiKey: string,
	init: RequestInit,
	clientId?: string
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), PASC_FILE_LIMITS.TIMEOUT);
	try {
		return await fetch(url, {
			...init,
			headers: pascFileHeaders(apiKey, clientId),
			signal: controller.signal
		});
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(`PASC file request timed out after ${String(PASC_FILE_LIMITS.TIMEOUT)}ms`, {
				cause: error
			});
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

// Viewer's PASC access level, resolved server-side from identity. Proxied: the
// extension calls RoProtect only, never the PASC service directly.
export async function getPascClearance(clientId?: string): Promise<PascAccessLevel> {
	return makeHttpRequest(API_CONFIG.ENDPOINTS.PASC_CLEARANCE, {
		method: 'GET',
		clientId,
		// Bare envelope (like apiWhoami): the shared unwrapper would strip the
		// outer object before parse ever sees success/error, so unwrap here.
		rawResponse: true,
		parse: (payload) => {
			const parsed = payload as {
				success?: boolean;
				data?: { level?: unknown };
				error?: unknown;
			};
			if (!parsed.success) {
				throw new Error(
					typeof parsed.error === 'string' && parsed.error
						? parsed.error
						: 'PASC clearance lookup failed'
				);
			}
			return v.parse(PascClearanceLevelSchema, parsed.data?.level);
		}
	});
}

// Record upsert (create or replace), M1+ enforced twice server-side. Returns
// the saved record in lookup shape.
export async function upsertPascRecord(
	userId: string | number,
	record: PascRecordUpsert,
	clientId?: string
): Promise<UserStatus> {
	const sanitizedUserId = validateEntityId(userId);
	return makeHttpRequest(`${API_CONFIG.ENDPOINTS.PASC_RECORD}/${sanitizedUserId}`, {
		method: 'PUT',
		body: JSON.stringify(record),
		clientId,
		// Bare envelope (like apiWhoami): contract failures carry no `data`
		// field, so the shared unwrapper would mask the server's message.
		rawResponse: true,
		parse: (payload) => {
			const parsed = payload as {
				success?: boolean;
				data?: unknown;
				error?: unknown;
			};
			if (!parsed.success) {
				throw new Error(
					typeof parsed.error === 'string' && parsed.error
						? parsed.error
						: 'PASC record update failed'
				);
			}
			return parseUserStatus(parsed.data);
		}
	});
}

// Case-file upload. Multipart through the background (content scripts cannot
// set the auth headers the proxy requires). Returns the stored descriptor.
export async function uploadPascFile(
	userId: string | number,
	filename: string,
	bytesBase64: string,
	contentType: string | undefined,
	access: string | undefined,
	clientId?: string
): Promise<PascFileDescriptor> {
	const sanitizedUserId = validateEntityId(userId);
	if (bytesBase64.length > PASC_FILE_LIMITS.MAX_BASE64_LENGTH) {
		throw new Error(
			`PASC file upload rejected: file exceeds ${String(PASC_FILE_LIMITS.MAX_BYTES / (1024 * 1024))} MB`
		);
	}
	if (contentType !== undefined && contentType.length > PASC_FILE_LIMITS.MAX_CONTENT_TYPE_LENGTH) {
		throw new Error('PASC file upload rejected: invalid content type');
	}
	const storedApiKey = await getStorage<string>('sync', SETTINGS_KEYS.API_KEY, '');
	const apiKey = storedApiKey.trim();
	if (!apiKey) throw new Error('No API key configured');

	const binary = atob(bytesBase64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	const form = new FormData();
	form.append(
		'file',
		new Blob([bytes], { type: contentType || 'application/octet-stream' }),
		sanitizeFilename(filename, 'upload')
	);
	if (access) form.append('access', access);

	// Raw fetch (not makeHttpRequest): multipart needs the browser-generated
	// boundary content type, which the JSON-oriented client would overwrite.
	const response = await fetchPascFile(
		`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PASC_RECORD}/${sanitizedUserId}/files`,
		apiKey,
		{ method: 'POST', body: form },
		clientId
	);
	let payload: { success?: boolean; data?: unknown; error?: unknown } = {};
	try {
		payload = (await response.json()) as typeof payload;
	} catch {
		// Non-JSON body: fall through to the HTTP-status error below.
	}
	if (!response.ok || !payload.success) {
		throw new Error(
			typeof payload.error === 'string' && payload.error
				? payload.error
				: `PASC file upload failed (HTTP ${String(response.status)})`
		);
	}
	const descriptor = v.parse(PascFileDescriptorSchema, payload.data);
	return {
		fileId: descriptor.fileId,
		name: sanitizeFilename(descriptor.name ?? filename, 'upload'),
		size: descriptor.size ?? bytes.byteLength,
		access: descriptor.access ?? access ?? null
	};
}

export interface PascDownloadedFile {
	bytesBase64: string;
	contentType: string;
	filename: string;
}

// Case-file download. Raw fetch through the background so the auth header
// stays out of content scripts. Bytes cross messaging as base64 (see upload).
export async function downloadPascFile(
	userId: string | number,
	fileId: string,
	clientId?: string
): Promise<PascDownloadedFile> {
	const sanitizedUserId = validateEntityId(userId);
	const storedApiKey = await getStorage<string>('sync', SETTINGS_KEYS.API_KEY, '');
	const apiKey = storedApiKey.trim();
	if (!apiKey) throw new Error('No API key configured');

	const response = await fetchPascFile(
		`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PASC_RECORD}/${sanitizedUserId}/files/${encodeURIComponent(fileId)}`,
		apiKey,
		{ method: 'GET' },
		clientId
	);
	if (!response.ok) {
		let detail = `PASC file download failed (HTTP ${String(response.status)})`;
		try {
			const failure = (await response.json()) as { error?: unknown };
			if (typeof failure.error === 'string' && failure.error) detail = failure.error;
		} catch {
			// Non-JSON failure body: keep the HTTP status detail.
		}
		throw new Error(detail);
	}
	const declaredLength = Number(response.headers.get('Content-Length') ?? '0');
	if (declaredLength > PASC_FILE_LIMITS.MAX_BYTES) {
		throw new Error(
			`PASC file download rejected: file exceeds ${String(PASC_FILE_LIMITS.MAX_BYTES / (1024 * 1024))} MB`
		);
	}
	const view = await readBodyWithLimit(response, PASC_FILE_LIMITS.MAX_BYTES);
	let binary = '';
	for (let i = 0; i < view.length; i += 32_768) {
		binary += String.fromCharCode(...view.subarray(i, i + 32_768));
	}
	const disposition = response.headers.get('Content-Disposition') ?? '';
	return {
		bytesBase64: btoa(binary),
		contentType: response.headers.get('Content-Type') || 'application/octet-stream',
		filename: sanitizeFilename(filenameFromDisposition(disposition, fileId), 'download')
	};
}

function filenameFromDisposition(disposition: string, fallback: string): string {
	const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;\s]+)/.exec(disposition);
	const raw = match?.[1] ?? match?.[2] ?? match?.[3];
	if (!raw) return fallback;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

// Case-file delete (M1+ enforced proxy-side). Returns on success; throws on
// missing file or refusal so the caller can surface the message.
export async function deletePascFile(
	userId: string | number,
	fileId: string,
	clientId?: string
): Promise<{ deleted: string }> {
	const sanitizedUserId = validateEntityId(userId);
	const storedApiKey = await getStorage<string>('sync', SETTINGS_KEYS.API_KEY, '');
	const apiKey = storedApiKey.trim();
	if (!apiKey) throw new Error('No API key configured');

	const response = await fetchPascFile(
		`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PASC_RECORD}/${sanitizedUserId}/files/${encodeURIComponent(fileId)}`,
		apiKey,
		{ method: 'DELETE' },
		clientId
	);
	let payload: {
		success?: boolean;
		data?: { deleted?: unknown };
		error?: unknown;
	} = {};
	try {
		payload = (await response.json()) as typeof payload;
	} catch {
		// Non-JSON body: fall through to the HTTP-status error below.
	}
	if (!response.ok || !payload.success) {
		throw new Error(
			typeof payload.error === 'string' && payload.error
				? payload.error
				: `PASC file delete failed (HTTP ${String(response.status)})`
		);
	}
	return {
		deleted: typeof payload.data?.deleted === 'string' ? payload.data.deleted : fileId
	};
}

export interface PascReviewContext {
	displayName?: string | undefined;
	username?: string | undefined;
	flag?: string | undefined;
	referralProvider?: string | undefined;
	referralFlag?: string | undefined;
	verdicts?: Array<{ provider: string; flag: string; detail: string }> | undefined;
	comment?: string | undefined;
}

// Moderator review request (report / recheck). The proxy posts to Discord
// server-side, so the webhook URL never reaches the extension. Clearance
// gates (0+ for reports, A1+ for rechecks) are enforced proxy-side.
export async function requestPascReview(
	userId: string | number,
	kind: 'report' | 'recheck',
	context: PascReviewContext,
	clientId?: string
): Promise<{ requested: string; user_id: number }> {
	const sanitizedUserId = validateEntityId(userId);
	return makeHttpRequest(API_CONFIG.ENDPOINTS.PASC_REVIEW_REQUESTS, {
		method: 'POST',
		body: JSON.stringify({
			userId: sanitizedUserId,
			kind,
			displayName: context.displayName ?? '',
			username: context.username ?? '',
			flag: context.flag ?? '',
			referralProvider: context.referralProvider ?? '',
			referralFlag: context.referralFlag ?? '',
			verdicts: context.verdicts ?? [],
			comment: context.comment ?? ''
		}),
		clientId,
		rawResponse: true,
		parse: (payload) => {
			const parsed = payload as {
				success?: boolean;
				data?: { requested?: unknown; user_id?: unknown };
				error?: unknown;
			};
			const data = parsed.success ? parsed.data : undefined;
			if (!data) {
				throw new Error(
					typeof parsed.error === 'string' && parsed.error
						? parsed.error
						: 'PASC review request failed'
				);
			}
			if (typeof data.requested !== 'string' || typeof data.user_id !== 'number') {
				throw new TypeError('PASC review request failed: unexpected response');
			}
			return { requested: data.requested, user_id: data.user_id };
		}
	});
}
