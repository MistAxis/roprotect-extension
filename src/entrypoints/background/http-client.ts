import { API_CONFIG } from '@/lib/types/constants';
import { SETTINGS_KEYS } from '@/lib/types/settings';
import type { CustomApiConfig } from '@/lib/types/custom-api';
import { buildCustomApiAuthHeaders } from '@/lib/utils/api/api-auth';
import { logger } from '@/lib/utils/logging/logger';
import { type ApiError, asApiError, buildHttpError } from '@/lib/utils/api/api-error';
import { getStorage } from '@/lib/utils/storage';
import { getInstallationId } from '@/lib/utils/installation-id';
import { getCachedDeviceFingerprint } from '@/lib/utils/device-fingerprint';
import { markSessionRestricted } from '@/lib/stores/session-state';

type BearerOverride =
	| { kind: 'membership' } // use X-Auth-Token (membership key) as Authorization
	| { kind: 'none' }; // omit Authorization entirely

// JSON responses are held in memory in full, so cap them before parsing.
const MAX_JSON_RESPONSE_CHARS = 8_000_000;

async function getApiKey(): Promise<string | null> {
	try {
		return (await getStorage<string>('sync', SETTINGS_KEYS.API_KEY, '')) || null;
	} catch (error) {
		logger.error('Background: Failed to get API key:', error);
		return null;
	}
}

function computeRetryDelay(error: ApiError, baseDelay: number, attempt: number): number {
	// Server-supplied reset times are untrusted; clamp so a bogus header cannot
	// stall the caller for hours.
	const delay = error.rateLimitReset
		? error.rateLimitReset * 1000 - Date.now() + 500
		: baseDelay * attempt;
	return Math.min(Math.max(delay, 0), 60_000);
}

function isRetryableError(error: ApiError): boolean {
	const status = error.status;

	if (status) {
		if (status === 429 || (status >= 500 && status < 600)) {
			return true;
		}
		if (status === 408) {
			return true;
		}
	}

	return error instanceof TypeError || status === 0;
}

interface HttpRequestOptions<T = unknown> extends RequestInit {
	timeout?: number | undefined;
	maxRetries?: number | undefined;
	retryDelay?: number | undefined;
	customApi?: CustomApiConfig | undefined;
	clientId?: string | undefined;
	lookupContext?: string | undefined;
	readPrimary?: boolean | undefined;
	rawResponse?: boolean | undefined;
	parse?: ((payload: unknown) => T) | undefined;
	// When set, the response is handed off raw and the JSON parse / envelope
	// unwrap path is skipped entirely. Used for non-JSON responses (file
	// downloads). Implies maxRetries=1 because partial downloads aren't retryable.
	parseResponse?: ((response: Response) => Promise<T>) | undefined;
	// Auth bearer policy. Default also uses the membership key, which the API
	// accepts interchangeably with X-Auth-Token.
	bearerOverride?: BearerOverride | undefined;
}

interface RotectorHeaderOptions {
	clientId: string | undefined;
	lookupContext: string | undefined;
	readPrimary: boolean | undefined;
	bearerOverride: BearerOverride | undefined;
}

function resolveBearer(override: BearerOverride | undefined, apiKey: string | null): string | null {
	if (override?.kind === 'none') return null;
	return apiKey;
}

async function buildRotectorHeaders(
	headers: Headers,
	{ clientId, lookupContext, readPrimary, bearerOverride }: RotectorHeaderOptions
): Promise<void> {
	const rawApiKey = await getApiKey();
	const apiKey = rawApiKey?.trim() ?? null;
	if (apiKey) {
		headers.set('X-Auth-Token', apiKey);
	}

	const bearer = resolveBearer(bearerOverride, apiKey);
	if (bearer) {
		headers.set('Authorization', `Bearer ${bearer}`);
	}

	headers.set('X-Installation-ID', await getInstallationId());

	const deviceFingerprint = await getCachedDeviceFingerprint();
	if (deviceFingerprint) {
		headers.set('X-Device-FP', deviceFingerprint);
	}

	if (clientId) {
		headers.set('X-Client-ID', clientId);
	}

	if (lookupContext) {
		headers.set('X-Lookup-Context', lookupContext);
	}

	if (readPrimary) {
		headers.set('X-Read-Primary', 'true');
	}
}

function normalizeFetchError(error: unknown, timeout: number): ApiError {
	if (error instanceof Error && error.name === 'AbortError') {
		return Object.assign(new Error(`Request timeout (${String(timeout)}ms)`), { status: 408 });
	}

	if (error instanceof TypeError && !('status' in error)) {
		return Object.assign(
			new Error('Unable to connect. Check your internet connection and try again.'),
			{ status: 0 }
		);
	}

	return asApiError(error);
}

async function prepareHeaders(
	fetchHeaders: HeadersInit | undefined,
	customApi: CustomApiConfig | undefined,
	rotectorOpts: RotectorHeaderOptions
): Promise<Headers> {
	const headers = new Headers({
		'Content-Type': 'application/json',
		Accept: 'application/json'
	});

	if (fetchHeaders) {
		for (const [key, value] of new Headers(fetchHeaders).entries()) {
			headers.set(key, value);
		}
	}

	if (customApi) {
		const authHeaders = buildCustomApiAuthHeaders(customApi);
		for (const [name, value] of Object.entries(authHeaders)) {
			headers.set(name, value);
		}
	} else {
		await buildRotectorHeaders(headers, rotectorOpts);
	}

	return headers;
}

async function maybeWaitForRateLimit(headers: Headers): Promise<void> {
	const remaining = headers.get('X-RateLimit-Remaining');
	const reset = headers.get('X-RateLimit-Reset');
	if (remaining === null || reset === null) return;
	if (Number(remaining) > 0) return;

	// Clamp: an attacker-controlled reset value would otherwise park this
	// request for years.
	const waitMs = Math.min(Math.max(Number(reset) * 1000 - Date.now() + 500, 0), 60_000);
	if (waitMs > 0) {
		logger.debug(`Rate limit exhausted, waiting ${String(waitMs)}ms for reset`);
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}
}

// Returns retry delay in ms or null when not retryable
function decideRetry(
	error: ApiError,
	attempt: number,
	maxRetries: number,
	retryDelay: number,
	isSafeMethod: boolean
): number | null {
	if (attempt >= maxRetries || !isRetryableError(error)) return null;
	const isRateLimited = error.status === 429;
	const isNetworkFailure = error.status === 0;
	if (!isSafeMethod && !isRateLimited && !isNetworkFailure) return null;
	return computeRetryDelay(error, retryDelay, attempt);
}

// Strip the Rotector success envelope (unless rawResponse) and run the optional
// parser. Custom APIs pass `rawResponse: true` and unwrap their own envelope in
// the parse hook so http-client stays envelope-agnostic.
function finalizePayload<T>(
	data: unknown,
	rawResponse: boolean,
	parse: ((payload: unknown) => T) | undefined
): T {
	let payload = data;
	if (!rawResponse) {
		if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
			throw new Error('Invalid response: missing data field');
		}
		payload = payload.data;
	}
	return parse ? parse(payload) : (payload as T);
}

async function handleRotectorForbidden(error: ApiError, endpoint: string): Promise<void> {
	const isMembershipEndpoint = endpoint.startsWith('/v1/extension/membership/');
	if (error.status !== 403 || isMembershipEndpoint) return;

	if (error.message.includes('Access denied')) {
		await markSessionRestricted();
	}
}

// Owns retries, Retry-After honoring, safe-method gating, envelope unwrapping, and Rotector restricted-access detection
export async function makeHttpRequest<T = unknown>(
	endpoint: string,
	options: HttpRequestOptions<T> = {}
): Promise<T> {
	const startTime = Date.now();
	const {
		timeout = API_CONFIG.TIMEOUT,
		maxRetries = API_CONFIG.MAX_RETRIES,
		retryDelay = API_CONFIG.RETRY_DELAY,
		customApi,
		clientId,
		lookupContext,
		readPrimary,
		rawResponse = false,
		parse,
		parseResponse,
		bearerOverride,
		...fetchOptions
	} = options;

	const effectiveMaxRetries = parseResponse ? 1 : maxRetries;

	const isCustomApi = !!customApi;
	const url = isCustomApi ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`;

	logger.debug('[http-client] makeHttpRequest started', {
		endpoint,
		isCustomApi,
		url,
		method: (fetchOptions.method ?? 'GET').toUpperCase(),
		timeout,
		maxRetries: effectiveMaxRetries,
		rawResponse,
		hasParse: !!parse,
		hasParseResponse: !!parseResponse,
		baseUrl: API_CONFIG.BASE_URL
	});

	const headers = await prepareHeaders(fetchOptions.headers, customApi, {
		clientId,
		lookupContext,
		readPrimary,
		bearerOverride
	});

	const method = (fetchOptions.method ?? 'GET').toUpperCase();
	const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

	logger.debug('[http-client] Request headers prepared', {
		url,
		method,
		hasAuth: headers.has('Authorization'),
		hasXAuthToken: headers.has('X-Auth-Token'),
		headerKeys: [...headers.keys()]
	});

	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			logger.debug('[http-client] Request timeout triggered', { attempt, timeout });
			controller.abort();
		}, timeout);
		const requestOptions: RequestInit = {
			...fetchOptions,
			headers,
			// Don't hand third-party APIs (or anyone a redirect points at) the
			// extension's origin/id through Referer.
			referrerPolicy: 'no-referrer',
			signal: controller.signal
		};

		try {
			logger.debug('[http-client] Fetch attempt starting', { attempt, url, method });

			const fetchStartTime = Date.now();
			const response = await fetch(url, requestOptions);
			const fetchDuration = Date.now() - fetchStartTime;
			const totalDuration = Date.now() - startTime;

			logger.debug('[http-client] Fetch completed', {
				attempt,
				url,
				status: response.status,
				statusText: response.statusText,
				ok: response.ok,
				fetchDuration,
				totalDuration,
				responseHeaders: [...response.headers.keys()]
			});

			if (!response.ok) {
				logger.warn('[http-client] Response not ok, building error', {
					attempt,
					status: response.status,
					statusText: response.statusText
				});
				throw await buildHttpError(response);
			}

			if (parseResponse) {
				logger.debug('[http-client] Using parseResponse handler');
				const result = await parseResponse(response);
				logger.apiCall(method, url, response.status, totalDuration);
				return result;
			}

			if (response.status === 204) {
				logger.apiCall(method, url, response.status, totalDuration);
				return null as T;
			}

			logger.debug('[http-client] Parsing JSON response');
			const jsonStartTime = Date.now();
			// Cap the body before parsing: a hostile provider or a compromised
			// backend could otherwise stream an unbounded JSON document into the
			// background worker's heap.
			const bodyText = await response.text();
			if (bodyText.length > MAX_JSON_RESPONSE_CHARS) {
				throw new Error('Response body is too large');
			}
			let data: unknown;
			try {
				data = JSON.parse(bodyText) as unknown;
			} catch {
				throw new Error('Invalid JSON response');
			}
			const jsonDuration = Date.now() - jsonStartTime;
			logger.debug('[http-client] JSON parsed', {
				jsonDuration,
				dataType: typeof data,
				isNull: data === null,
				keys: data && typeof data === 'object' ? Object.keys(data) : null
			});

			logger.apiCall(method, url, response.status, totalDuration);

			await maybeWaitForRateLimit(response.headers);

			logger.debug('[http-client] Finalizing payload');
			return finalizePayload(data, rawResponse, parse);
		} catch (error) {
			lastError = normalizeFetchError(error, timeout);
			const lastErrorRecord = lastError as Record<string, unknown> | Error;
			const errorDuration = Date.now() - startTime;

			logger.error('[http-client] Request error caught', {
				attempt,
				url,
				errorName: error instanceof Error ? error.name : 'Unknown',
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
				normalizedError: {
					message: lastError.message,
					status: lastErrorRecord instanceof Error ? undefined : lastErrorRecord['status'],
					code: lastErrorRecord instanceof Error ? undefined : lastErrorRecord['code'],
					type: lastErrorRecord instanceof Error ? undefined : lastErrorRecord['type']
				},
				duration: errorDuration
			});

			const delay = decideRetry(lastError, attempt, effectiveMaxRetries, retryDelay, isSafeMethod);
			if (delay !== null) {
				logger.debug('[http-client] Retrying', { attempt, delay });
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}

			if (!isCustomApi) {
				await handleRotectorForbidden(lastError, endpoint);
			}

			break;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	logger.error('[http-client] All retries exhausted, throwing final error', {
		url,
		lastError: lastError?.message,
		lastErrorStatus:
			lastError && !('message' in lastError)
				? (lastError as Record<string, unknown>)['status']
				: undefined
	});

	throw lastError ?? new Error('API error. Please try again later.');
}
