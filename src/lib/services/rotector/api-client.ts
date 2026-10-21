import { API_ACTIONS, PASC_FILE_LIMITS } from '../../types/constants';
import type {
	ApiResponse,
	DiscordSignInPoll,
	DiscordSignInStart,
	ExportResult,
	GroupStatus,
	GroupTrackedUsersResponse,
	MembershipBadgeUpdatePayload,
	MembershipStatus,
	MembershipVerificationChallenge,
	OutfitSnapshotByIdResponse,
	OutfitSnapshotByNameResponse,
	PascFileDescriptor,
	PascRecordUpsert,
	QueueLimitsData,
	QueueResult,
	RequestOptions,
	RobloxUserDiscordLookup,
	TranslationResult,
	UserStatus
} from '../../types/api';
import type { ApiUsage } from '../../types/usage';
import type { PascAccessLevel } from '../../data/pasc';
import { restrictedAccessStore } from '../../stores/restricted-access';
import { getAbortError } from '../../utils/abort';
import { buildResponseError } from '../../utils/api/api-error';
import { getLoggedInUserId } from '../../utils/client-id';
import { get } from 'svelte/store';
import { logger } from '../../utils/logging/logger';

// Extension messaging JSON-serializes payloads, which mangles ArrayBuffers
// into plain objects. File bytes therefore cross as base64 (chunked to avoid
// spread/apply stack limits on large files) and the background decodes them.
function encodeArrayBufferBase64(bytes: ArrayBuffer): string {
	let binary = '';
	const chunk = new Uint8Array(bytes);
	const CHUNK_SIZE = 32_768;
	for (let i = 0; i < chunk.length; i += CHUNK_SIZE) {
		binary += String.fromCharCode(...chunk.subarray(i, i + CHUNK_SIZE));
	}
	return btoa(binary);
}

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

// The background HTTP layer owns retries + Retry-After + safe-method gating
// Stacking retries here on top of that produced MAX_RETRIES² fetches per failure
async function sendMessage<T>(
	action: string,
	data: Record<string, unknown> = {},
	options: RequestOptions = {}
): Promise<T> {
	if (options.signal?.aborted) {
		throw getAbortError(options.signal);
	}

	const clientId = getLoggedInUserId();
	const message = { action, ...(clientId && { clientId }), ...data };
	const response: ApiResponse<T> = await browser.runtime.sendMessage(message);

	if (response.success) {
		return response.data as T;
	}
	throw buildResponseError(response);
}

class RotectorApiClient {
	async checkUser(userId: string | number, options?: RequestOptions): Promise<UserStatus> {
		return sendMessage<UserStatus>(
			API_ACTIONS.CHECK_USER_STATUS,
			{ userId, ...(options?.apiConfig && { apiConfig: options.apiConfig }) },
			options
		);
	}

	async checkGroup(groupId: string | number, options?: RequestOptions): Promise<GroupStatus> {
		return sendMessage<GroupStatus>(API_ACTIONS.CHECK_GROUP_STATUS, { groupId }, options);
	}

	async checkMultipleUsers(
		userIds: Array<string | number>,
		options: RequestOptions = {}
	): Promise<UserStatus[]> {
		return sendMessage<UserStatus[]>(
			API_ACTIONS.CHECK_MULTIPLE_USERS,
			{
				userIds,
				...(options.apiConfig && { apiConfig: options.apiConfig }),
				...(options.lookupContext && { lookupContext: options.lookupContext })
			},
			options
		);
	}

	async checkMultipleGroups(
		groupIds: Array<string | number>,
		options: RequestOptions = {}
	): Promise<GroupStatus[]> {
		return sendMessage<GroupStatus[]>(
			API_ACTIONS.CHECK_MULTIPLE_GROUPS,
			{
				groupIds,
				...(options.lookupContext && { lookupContext: options.lookupContext })
			},
			options
		);
	}

	async getGroupTrackedUsers(
		groupId: string | number,
		cursor?: string,
		limit = 24,
		active?: 'true' | 'false'
	): Promise<GroupTrackedUsersResponse> {
		return sendMessage<GroupTrackedUsersResponse>(API_ACTIONS.GET_GROUP_TRACKED_USERS, {
			groupId,
			cursor,
			limit,
			active
		});
	}

	async queueUser(
		userId: string | number,
		outfitNames: string[] = [],
		outfitIds: number[] = [],
		inappropriateProfile = false,
		inappropriateFriends = false,
		inappropriateGroups = false,
		captchaToken?: string
	): Promise<QueueResult> {
		const { isRestricted } = get(restrictedAccessStore);
		if (isRestricted) {
			const loggedInUserId = getLoggedInUserId();
			if (loggedInUserId !== userId.toString()) {
				throw new Error('Cannot queue users while access is restricted');
			}
		}

		return sendMessage<QueueResult>(API_ACTIONS.QUEUE_USER, {
			userId,
			outfitNames,
			outfitIds,
			inappropriateProfile,
			inappropriateFriends,
			inappropriateGroups,
			captchaToken
		});
	}

	async getQueueLimits(): Promise<QueueLimitsData> {
		return sendMessage<QueueLimitsData>(API_ACTIONS.GET_QUEUE_LIMITS, {});
	}

	async getUsage(): Promise<ApiUsage> {
		return sendMessage<ApiUsage>(API_ACTIONS.GET_USAGE, {});
	}

	async getMembershipStatus(): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(API_ACTIONS.EXTENSION_GET_MEMBERSHIP_STATUS, {});
	}

	async updateMembershipBadge(payload: MembershipBadgeUpdatePayload): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(
			API_ACTIONS.EXTENSION_UPDATE_MEMBERSHIP_BADGE,
			payload as Record<string, unknown>
		);
	}

	async clearMembershipBadge(): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(API_ACTIONS.EXTENSION_CLEAR_MEMBERSHIP_BADGE, {});
	}

	async getMembershipVerification(robloxUserId: number): Promise<MembershipVerificationChallenge> {
		return sendMessage<MembershipVerificationChallenge>(
			API_ACTIONS.EXTENSION_GET_MEMBERSHIP_VERIFICATION,
			{ robloxUserId }
		);
	}

	async confirmMembershipVerification(robloxUserId: number): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(API_ACTIONS.EXTENSION_CONFIRM_MEMBERSHIP_VERIFICATION, {
			robloxUserId
		});
	}

	async translateTexts(
		texts: string[],
		targetLanguage: string,
		sourceLanguage = 'en'
	): Promise<TranslationResult> {
		return sendMessage<TranslationResult>(API_ACTIONS.TRANSLATE_TEXT, {
			texts,
			targetLanguage,
			sourceLanguage
		});
	}

	async exportGroupTrackedUsers(
		groupId: string | number,
		format: 'json' | 'csv',
		columns: string[],
		sort: string,
		order: 'asc' | 'desc'
	): Promise<ExportResult> {
		return sendMessage<ExportResult>(API_ACTIONS.EXPORT_GROUP_TRACKED_USERS, {
			groupId,
			exportFormat: format,
			exportColumns: columns,
			exportSort: sort,
			exportOrder: order
		});
	}

	async lookupRobloxUserDiscord(userId: string | number): Promise<RobloxUserDiscordLookup> {
		return sendMessage<RobloxUserDiscordLookup>(API_ACTIONS.LOOKUP_ROBLOX_USER_DISCORD, {
			userId
		});
	}

	async lookupQuarry(ids: string[]): Promise<Record<string, string[] | null>> {
		return sendMessage<Record<string, string[] | null>>(API_ACTIONS.LOOKUP_QUARRY, { ids });
	}

	async lookupOutfitsByName(
		userId: string | number,
		names: string[]
	): Promise<OutfitSnapshotByNameResponse> {
		return sendMessage<OutfitSnapshotByNameResponse>(API_ACTIONS.LOOKUP_OUTFITS_BY_NAME, {
			userId,
			names
		});
	}

	async lookupOutfitsById(
		userId: string | number,
		ids: string[]
	): Promise<OutfitSnapshotByIdResponse> {
		return sendMessage<OutfitSnapshotByIdResponse>(API_ACTIONS.LOOKUP_OUTFITS_BY_ID, {
			userId,
			ids
		});
	}

	async fetchOutfitImages(imageUrls: string[]): Promise<Array<string | null>> {
		return sendMessage<Array<string | null>>(API_ACTIONS.FETCH_OUTFIT_IMAGES, {
			imageUrls
		});
	}

	async getPascClearance(): Promise<PascAccessLevel> {
		return sendMessage<PascAccessLevel>(API_ACTIONS.GET_PASC_CLEARANCE, {});
	}

	async upsertPascRecord(userId: string | number, record: PascRecordUpsert): Promise<UserStatus> {
		return sendMessage<UserStatus>(API_ACTIONS.PASC_UPSERT_RECORD, {
			userId,
			record: record as unknown as Record<string, unknown>
		});
	}

	async uploadPascFile(
		userId: string | number,
		filename: string,
		bytes: ArrayBuffer,
		contentType?: string,
		access?: string
	): Promise<PascFileDescriptor> {
		// Check before base64 encoding: the expansion is what would blow the
		// messaging limit (and briefly triple the file in memory).
		if (bytes.byteLength > PASC_FILE_LIMITS.MAX_BYTES) {
			throw new Error(
				`File is too large (max ${String(PASC_FILE_LIMITS.MAX_BYTES / (1024 * 1024))} MB)`
			);
		}
		return sendMessage<PascFileDescriptor>(API_ACTIONS.PASC_UPLOAD_FILE, {
			userId,
			filename,
			bytesBase64: encodeArrayBufferBase64(bytes),
			...(contentType !== undefined && { contentType }),
			...(access !== undefined && { access })
		});
	}

	async downloadPascFile(
		userId: string | number,
		fileId: string
	): Promise<{ bytes: ArrayBuffer; contentType: string; filename: string }> {
		const result = await sendMessage<{
			bytesBase64: string;
			contentType: string;
			filename: string;
		}>(API_ACTIONS.PASC_DOWNLOAD_FILE, { userId, fileId });
		return {
			bytes: decodeBase64ToArrayBuffer(result.bytesBase64),
			contentType: result.contentType,
			filename: result.filename
		};
	}

	async deletePascFile(userId: string | number, fileId: string): Promise<{ deleted: string }> {
		return sendMessage<{ deleted: string }>(API_ACTIONS.PASC_DELETE_FILE, {
			userId,
			fileId
		});
	}

	async requestPascReview(
		userId: string | number,
		kind: 'report' | 'recheck',
		context: {
			displayName?: string;
			username?: string;
			flag?: string;
			referralProvider?: string;
			referralFlag?: string;
			verdicts?: Array<{ provider: string; flag: string; detail: string }>;
			comment?: string;
		} = {}
	): Promise<{ requested: string; user_id: number }> {
		return sendMessage<{ requested: string; user_id: number }>(API_ACTIONS.PASC_REQUEST_REVIEW, {
			userId,
			kind,
			...(context.displayName !== undefined && { displayName: context.displayName }),
			...(context.username !== undefined && { username: context.username }),
			...(context.flag !== undefined && { flag: context.flag }),
			...(context.referralProvider !== undefined && {
				referralProvider: context.referralProvider
			}),
			...(context.referralFlag !== undefined && { referralFlag: context.referralFlag }),
			...(context.verdicts !== undefined && { verdicts: context.verdicts }),
			...(context.comment !== undefined && { comment: context.comment })
		});
	}

	async whoami(apiKey: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
		logger.debug('[apiClient] whoami called', {
			apiKeyPrefix: `${apiKey.slice(0, 8)}...`,
			apiKeyLength: apiKey.length
		});
		const result = await sendMessage<{ success: boolean; data?: unknown; error?: string }>(
			API_ACTIONS.API_WHOAMI,
			{ apiKey }
		);
		logger.debug('[apiClient] whoami response', {
			success: result.success,
			hasError: !!result.error,
			hasData: !!result.data,
			error: result.error
		});
		return result;
	}

	async startDiscordSignIn(): Promise<DiscordSignInStart> {
		return sendMessage<DiscordSignInStart>(API_ACTIONS.OAUTH_START, {});
	}

	async pollDiscordSignIn(pair: string): Promise<DiscordSignInPoll> {
		return sendMessage<DiscordSignInPoll>(API_ACTIONS.OAUTH_POLL, { pair });
	}
}

export const apiClient = new RotectorApiClient();
