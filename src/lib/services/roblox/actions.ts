import { ROBLOX_API } from '../../types/constants';
import { validateEntityId } from '../../utils/dom/sanitizer';

const BLOCK_USER_ENDPOINT = `${ROBLOX_API.APIS}/user-blocking-api/v1/users`;

// Block a Roblox user via the user-blocking API. Handles Roblox's CSRF flow by retrying
// once with the X-CSRF-TOKEN header returned from the initial 403 response.
export async function blockUser(userId: string | number): Promise<void> {
	// The id is interpolated into a request path, so reject anything that is not
	// a plain positive integer before it can add segments or a query string.
	const safeUserId = validateEntityId(userId);
	const url = `${BLOCK_USER_ENDPOINT}/${safeUserId}/block-user`;

	const send = async (token?: string) => {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (token) headers['X-CSRF-TOKEN'] = token;
		return fetch(url, { method: 'POST', credentials: 'include', headers, body: '{}' });
	};

	let response = await send();

	if (response.status === 403) {
		const token = response.headers.get('X-CSRF-TOKEN');
		if (!token) {
			throw new Error('Block failed: CSRF token missing from 403 response');
		}
		response = await send(token);
	}

	if (!response.ok) {
		throw new Error(`Block failed: HTTP ${String(response.status)}`);
	}
}
