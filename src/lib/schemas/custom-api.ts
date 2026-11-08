import * as v from 'valibot';
import { STATUS } from '../types/constants';
import type { CustomApiAuthHeaderType } from '../types/custom-api';

const KNOWN_FLAGS = Object.values(STATUS.FLAGS);

const TaseDetectionTypeSchema = v.object({
	id: v.nullish(v.pipe(v.string(), v.maxLength(64))),
	name: v.pipe(v.string(), v.maxLength(128)),
	summary: v.nullish(v.pipe(v.string(), v.maxLength(1000)))
});

const TaseGuildDetectionSchema = v.object({
	category: v.nullish(v.union([v.number(), v.pipe(v.string(), v.maxLength(64))])),
	firstSeenAt: v.nullish(v.number()),
	flag_type: v.picklist(['unsafe', 'past_offender']),
	guildId: v.pipe(v.string(), v.maxLength(32)),
	guildName: v.nullish(v.pipe(v.string(), v.maxLength(128))),
	lastSeenAt: v.nullish(v.number()),
	score: v.nullish(v.number()),
	types: v.nullish(v.pipe(v.array(TaseDetectionTypeSchema), v.maxLength(20))),
	versions: v.nullish(v.pipe(v.array(v.number()), v.maxLength(20)))
});

const TaseDiscordAccountSchema = v.object({
	detectedGuilds: v.pipe(v.array(TaseGuildDetectionSchema), v.maxLength(100))
});

const TaseUserRecordSchema = v.object({
	badges: v.nullish(
		v.pipe(
			v.array(
				v.object({
					text: v.pipe(v.string(), v.maxLength(128)),
					color: v.nullish(v.pipe(v.string(), v.maxLength(64))),
					textColor: v.nullish(v.pipe(v.string(), v.maxLength(64)))
				})
			),
			v.maxLength(10)
		)
	),
	category: v.nullish(v.union([v.number(), v.pipe(v.string(), v.maxLength(64))])),
	confidence: v.nullish(v.number()),
	detections: v.record(v.pipe(v.string(), v.maxLength(32)), TaseDiscordAccountSchema),
	engineVersion: v.nullish(v.pipe(v.string(), v.maxLength(64))),
	firstSeenAt: v.nullish(v.number()),
	flagType: v.fallback(v.picklist(KNOWN_FLAGS), STATUS.FLAGS.UNKNOWN),
	id: v.number(),
	isLocked: v.nullish(v.boolean()),
	isReportable: v.nullish(v.boolean()),
	lastSeenAt: v.nullish(v.number()),
	lastUpdated: v.nullish(v.number()),
	reasons: v.nullish(v.record(v.string(), v.unknown())),
	reviewer: v.nullish(
		v.object({
			username: v.pipe(v.string(), v.maxLength(128)),
			displayName: v.pipe(v.string(), v.maxLength(128))
		})
	),
	versionCompatibility: v.nullish(v.picklist(['current', 'compatible', 'outdated', 'unknown']))
});

// Every field is optional: the avatar batch route omits `avatarHash` for users
// with a default avatar and omits `username`/`globalName`/`displayName` entirely
// when Discord has no cached profile for that id. A single missing key must not
// fail the whole map, otherwise every account in the tooltip loses its avatar.
const DiscordAvatarSchema = v.object({
	avatarHash: v.nullish(v.pipe(v.string(), v.maxLength(128))),
	avatarUrl: v.nullish(v.pipe(v.string(), v.maxLength(2048))),
	isAnimated: v.nullish(v.boolean()),
	userId: v.nullish(v.pipe(v.string(), v.maxLength(32))),
	username: v.nullish(v.pipe(v.string(), v.maxLength(128))),
	globalName: v.nullish(v.pipe(v.string(), v.maxLength(128))),
	displayName: v.nullish(v.pipe(v.string(), v.maxLength(128))),
	// Not part of the API payload: filled in by the background so the tooltip can
	// render the avatar despite roblox.com's CSP blocking cdn.discordapp.com.
	avatarDataUrl: v.optional(v.nullish(v.pipe(v.string(), v.maxLength(1_000_000))))
});

const AUTH_HEADER_TYPES: readonly CustomApiAuthHeaderType[] = [
	'x-auth-token',
	'authorization-bearer',
	'authorization-plain'
];

const REASON_FORMATS = ['numeric', 'string'] as const;

const CustomApiBadgeSchema = v.object({
	text: v.pipe(v.string('Badge: text must be string'), v.maxLength(128)),
	// Some providers (RAB, TASE) omit color/textColor on badges. Use nullish
	// to accept missing keys AND explicit null without failing.
	color: v.nullish(v.pipe(v.string('Badge: color must be string'), v.maxLength(64))),
	textColor: v.nullish(v.pipe(v.string('Badge: textColor must be string'), v.maxLength(64)))
});

const MembershipBadgeSchema = v.object({
	tier: v.picklist([1, 2, 3]),
	badgeDesign: v.number(),
	iconDesign: v.number(),
	textDesign: v.number()
});

const UserStatusResponseSchema = v.object({
	id: v.number('Missing or invalid "id" field (must be number)'),
	flagType: v.fallback(
		v.picklist(
			KNOWN_FLAGS,
			`Missing or invalid "flagType" field (must be one of ${KNOWN_FLAGS.join(', ')})`
		),
		STATUS.FLAGS.UNKNOWN
	),
	// Some providers send category as string; coerce to number. Optional in both schemas.
	category: v.optional(v.pipe(v.union([v.number(), v.string()]), v.transform(Number))),
	confidence: v.optional(v.number('Invalid "confidence" field (must be number if present)'), 0),
	// A record with no reasons omits the key entirely, and the contract also permits an
	// explicit null, so normalise both to an empty object. The `optional` default covers
	// the absent case, the transform covers an explicit null, and doing it at the parse
	// boundary keeps downstream projection free of per-access null checks.
	reasons: v.pipe(
		v.optional(v.nullish(v.record(v.string(), v.unknown(), 'Invalid "reasons" field')), {}),
		v.transform((value) => value ?? {})
	),
	badges: v.optional(
		v.pipe(
			v.array(CustomApiBadgeSchema, 'Invalid "badges" field (must be array)'),
			v.maxLength(3, 'Too many badges (maximum 3 allowed)')
		)
	),
	// TASE V2 specific fields
	detections: v.optional(v.record(v.pipe(v.string(), v.maxLength(32)), TaseDiscordAccountSchema)),
	firstSeenAt: v.nullish(v.number()),
	lastSeenAt: v.nullish(v.number()),
	lastUpdated: v.nullish(v.number()),
	engineVersion: v.nullish(v.pipe(v.string(), v.maxLength(64))),
	isLocked: v.nullish(v.boolean()),
	isReportable: v.nullish(v.boolean()),
	versionCompatibility: v.nullish(v.picklist(['current', 'compatible', 'outdated', 'unknown'])),
	// Queue lifecycle + PASC record-presence markers. These are part of the same
	// status contract as the core schema; dropping them here made processed
	// users look permanently queued and hid PASC records from the authoritative
	// verdict logic.
	queuedAt: v.optional(v.number()),
	processed: v.optional(v.boolean()),
	processedAt: v.optional(v.number()),
	pascRecordPresent: v.optional(v.boolean()),
	pascMissing: v.optional(v.boolean()),
	membershipBadge: v.optional(MembershipBadgeSchema),
	reviewer: v.nullish(
		v.object({
			username: v.string(),
			displayName: v.string()
		})
	)
});

export const CustomApiResponseEnvelopeSchema = v.variant('success', [
	v.object({ success: v.literal(true), data: v.unknown() }),
	v.object({
		success: v.literal(false),
		error: v.optional(v.pipe(v.string(), v.maxLength(2000)))
	})
]);

const MAX_URL_LENGTH = 2048;
const MAX_DATA_URL_LENGTH = 512_000;

const ImportedApiConfigSchema = v.object({
	name: v.pipe(
		v.string('Missing or invalid "name" field'),
		v.minLength(1, 'Name must be between 1 and 12 characters'),
		v.maxLength(12, 'Name must be between 1 and 12 characters')
	),
	singleUrl: v.pipe(
		v.string('Missing or invalid "singleUrl" field'),
		v.startsWith('https://', 'Single URL must use HTTPS protocol'),
		v.includes('{userId}', 'Single URL must contain {userId} placeholder'),
		v.maxLength(MAX_URL_LENGTH, `Single URL must be at most ${String(MAX_URL_LENGTH)} characters`)
	),
	batchUrl: v.pipe(
		v.string('Missing or invalid "batchUrl" field'),
		v.startsWith('https://', 'Batch URL must use HTTPS protocol'),
		v.maxLength(MAX_URL_LENGTH, `Batch URL must be at most ${String(MAX_URL_LENGTH)} characters`)
	),
	enabled: v.boolean('Missing or invalid "enabled" field'),
	timeout: v.pipe(
		v.number('Missing or invalid "timeout" field'),
		v.minValue(1000, 'Timeout must be between 1000 and 60000 milliseconds'),
		v.maxValue(60_000, 'Timeout must be between 1000 and 60000 milliseconds')
	),
	reasonFormat: v.optional(
		v.picklist(REASON_FORMATS, 'reasonFormat must be "numeric" or "string"')
	),
	landscapeImageDataUrl: v.optional(
		v.pipe(
			v.string('landscapeImageDataUrl must be a string'),
			v.regex(
				/^(data:image\/|chrome-extension:\/\/|moz-extension:\/\/)/,
				'landscapeImageDataUrl must be a data:image/, chrome-extension://, or moz-extension:// URL'
			),
			v.maxLength(MAX_DATA_URL_LENGTH)
		)
	),
	authHeaderType: v.optional(
		v.picklist(
			AUTH_HEADER_TYPES,
			'authHeaderType must be one of x-auth-token, authorization-bearer, authorization-plain'
		)
	)
});

// This schema also gates `apiConfig` arriving inside a content-script message,
// so every field a page script could control is capped. The URL rules are the
// same ones the import path enforces: HTTPS only, and the single-user URL has
// to carry the placeholder the client substitutes.
export const PersistedCustomApiSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	name: v.pipe(v.string(), v.maxLength(64)),
	singleUrl: v.pipe(
		v.string(),
		v.startsWith('https://'),
		v.includes('{userId}'),
		v.maxLength(MAX_URL_LENGTH)
	),
	batchUrl: v.pipe(v.string(), v.startsWith('https://'), v.maxLength(MAX_URL_LENGTH)),
	enabled: v.boolean(),
	timeout: v.pipe(v.number(), v.minValue(1000), v.maxValue(60_000)),
	order: v.number(),
	createdAt: v.number(),
	lastTested: v.optional(v.number()),
	lastTestSuccess: v.optional(v.boolean()),
	isSystem: v.optional(v.boolean()),
	reasonFormat: v.optional(v.picklist(REASON_FORMATS)),
	landscapeImageDataUrl: v.optional(
		v.pipe(
			v.string(),
			v.regex(
				/^(data:image\/|chrome-extension:\/\/|moz-extension:\/\/)/,
				'landscapeImageDataUrl must be a data:image/, chrome-extension://, or moz-extension:// URL'
			),
			v.maxLength(MAX_DATA_URL_LENGTH)
		)
	),
	apiKey: v.optional(v.pipe(v.string(), v.maxLength(512))),
	authHeaderType: v.optional(v.picklist(AUTH_HEADER_TYPES))
});

export type ImportedApiConfig = v.InferOutput<typeof ImportedApiConfigSchema>;
export type TaseUserRecord = v.InferOutput<typeof TaseUserRecordSchema>;
export type TaseDiscordAccount = v.InferOutput<typeof TaseDiscordAccountSchema>;
export type TaseGuildDetection = v.InferOutput<typeof TaseGuildDetectionSchema>;
export type TaseDetectionType = v.InferOutput<typeof TaseDetectionTypeSchema>;
export type DiscordAvatar = v.InferOutput<typeof DiscordAvatarSchema>;

export const parseUserStatusResponse = v.parser(UserStatusResponseSchema);
export const parseImportedApiConfig = v.parser(ImportedApiConfigSchema);
export const parseTaseUserRecord = v.parser(TaseUserRecordSchema);
export const parseDiscordAvatar = v.parser(DiscordAvatarSchema);
export const parseDiscordAvatarMap = v.parser(v.record(v.string(), DiscordAvatarSchema));
