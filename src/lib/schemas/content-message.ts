import * as v from 'valibot';
import { API_ACTIONS, CAPTCHA_MESSAGES, PASC_FILE_LIMITS } from '@/lib/types/constants';
import { PersistedCustomApiSchema } from './custom-api';

const UserId = v.union([v.string(), v.number()]);
// `nullish`, not just `optional`: callers that spread an absent logged-in id
// (e.g. `{ clientId: getLoggedInUserId() }`) send an explicit null. Rejecting
// that fails the whole message, so the background never replies and the caller
// hangs on a silent "Receiving end does not exist".
const ClientId = v.optional(v.nullish(v.string()));

const QueueDataSchema = v.object({
	userId: v.string(),
	outfitNames: v.array(v.string()),
	outfitIds: v.optional(v.array(v.number())),
	inappropriateProfile: v.boolean(),
	inappropriateFriends: v.boolean(),
	inappropriateGroups: v.boolean()
});

const CaptchaStartMessageSchema = v.object({
	type: v.literal(CAPTCHA_MESSAGES.CAPTCHA_START),
	sessionId: v.string(),
	queueData: QueueDataSchema
});

const ContentMessageSchema = v.variant('action', [
	v.object({
		action: v.literal(API_ACTIONS.CHECK_USER_STATUS),
		userId: UserId,
		apiConfig: v.optional(PersistedCustomApiSchema),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.API_WHOAMI),
		apiKey: v.string(),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.OAUTH_START),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.OAUTH_POLL),
		pair: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.CHECK_GROUP_STATUS),
		groupId: UserId,
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.CHECK_MULTIPLE_USERS),
		userIds: v.array(UserId),
		apiConfig: v.optional(PersistedCustomApiSchema),
		lookupContext: v.optional(v.string()),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.CHECK_MULTIPLE_GROUPS),
		groupIds: v.array(UserId),
		lookupContext: v.optional(v.string()),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.GET_GROUP_TRACKED_USERS),
		groupId: UserId,
		cursor: v.optional(v.string()),
		limit: v.optional(v.number()),
		active: v.optional(v.picklist(['true', 'false'])),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.QUEUE_USER),
		userId: UserId,
		outfitNames: v.optional(v.array(v.string())),
		outfitIds: v.optional(v.array(v.number())),
		inappropriateProfile: v.optional(v.boolean()),
		inappropriateFriends: v.optional(v.boolean()),
		inappropriateGroups: v.optional(v.boolean()),
		captchaToken: v.optional(v.string()),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.GET_QUEUE_LIMITS),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.GET_USAGE),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.EXTENSION_GET_MEMBERSHIP_STATUS),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.EXTENSION_UPDATE_MEMBERSHIP_BADGE),
		badgeDesign: v.optional(v.number()),
		iconDesign: v.optional(v.number()),
		textDesign: v.optional(v.number()),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.EXTENSION_CLEAR_MEMBERSHIP_BADGE),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.EXTENSION_GET_MEMBERSHIP_VERIFICATION),
		robloxUserId: v.pipe(v.number(), v.minValue(1)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.EXTENSION_CONFIRM_MEMBERSHIP_VERIFICATION),
		robloxUserId: v.pipe(v.number(), v.minValue(1)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.LOOKUP_ROBLOX_USER_DISCORD),
		userId: UserId,
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.LOOKUP_QUARRY),
		ids: v.pipe(
			v.array(v.pipe(v.string(), v.regex(/^\d{5,25}$/))),
			v.minLength(1),
			v.maxLength(500)
		),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.LOOKUP_OUTFITS_BY_NAME),
		userId: UserId,
		names: v.pipe(v.array(v.string()), v.minLength(1)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.LOOKUP_OUTFITS_BY_ID),
		userId: UserId,
		ids: v.pipe(v.array(v.string()), v.minLength(1)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.FETCH_OUTFIT_IMAGES),
		imageUrls: v.pipe(v.array(v.string()), v.minLength(1)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.EXPORT_GROUP_TRACKED_USERS),
		groupId: UserId,
		exportFormat: v.picklist(['json', 'csv']),
		exportColumns: v.pipe(v.array(v.string()), v.minLength(1)),
		exportSort: v.string(),
		exportOrder: v.picklist(['asc', 'desc']),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.TRANSLATE_TEXT),
		texts: v.pipe(v.array(v.string()), v.minLength(1)),
		targetLanguage: v.string(),
		sourceLanguage: v.optional(v.string()),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.HAS_TRANSLATE_PERMISSION),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.REQUEST_TRANSLATE_PERMISSION),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.GET_DISCORD_AVATARS),
		discordUserIds: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(100)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.GET_PASC_CLEARANCE),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.PASC_UPSERT_RECORD),
		userId: UserId,
		record: v.strictObject({
			flag: v.number(),
			accessLevel: v.optional(v.string()),
			publicNote: v.optional(v.string()),
			publicNoteLevel: v.optional(v.string()),
			internalReview: v.optional(v.string()),
			reviewer: v.optional(v.string())
		}),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.PASC_UPLOAD_FILE),
		userId: UserId,
		filename: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
		contentType: v.optional(
			v.pipe(v.string(), v.maxLength(PASC_FILE_LIMITS.MAX_CONTENT_TYPE_LENGTH))
		),
		access: v.optional(v.picklist(['0', 'A1', 'A2', 'M1', 'M2'])),
		// Base64, not ArrayBuffer: extension messaging JSON-serializes the
		// payload, so an ArrayBuffer arrives as a plain Object and fails
		// `v.instance(ArrayBuffer)`. The sender encodes, background decodes.
		// The length cap is the base64 expansion of the byte cap, so an
		// oversized file is rejected before the background allocates it.
		bytesBase64: v.pipe(
			v.string(),
			v.minLength(1),
			v.maxLength(PASC_FILE_LIMITS.MAX_BASE64_LENGTH)
		),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.PASC_DOWNLOAD_FILE),
		userId: UserId,
		fileId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.PASC_DELETE_FILE),
		userId: UserId,
		fileId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
		clientId: ClientId
	}),
	v.object({
		action: v.literal(API_ACTIONS.PASC_REQUEST_REVIEW),
		userId: UserId,
		kind: v.picklist(['report', 'recheck']),
		comment: v.optional(v.pipe(v.string(), v.maxLength(280))),
		displayName: v.optional(v.pipe(v.string(), v.maxLength(128))),
		username: v.optional(v.pipe(v.string(), v.maxLength(128))),
		flag: v.optional(v.pipe(v.string(), v.maxLength(32))),
		referralProvider: v.optional(v.pipe(v.string(), v.maxLength(32))),
		referralFlag: v.optional(v.pipe(v.string(), v.maxLength(32))),
		verdicts: v.optional(
			v.array(
				v.object({
					provider: v.pipe(v.string(), v.maxLength(32)),
					flag: v.pipe(v.string(), v.maxLength(32)),
					detail: v.pipe(v.string(), v.maxLength(256))
				})
			)
		),
		clientId: ClientId
	})
]);

export type ContentMessage = v.InferOutput<typeof ContentMessageSchema>;
export type CaptchaStartMessage = v.InferOutput<typeof CaptchaStartMessageSchema>;

export const safeParseContentMessage = v.safeParser(ContentMessageSchema);
export const safeParseCaptchaStartMessage = v.safeParser(CaptchaStartMessageSchema);
