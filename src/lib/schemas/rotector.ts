import * as v from 'valibot';
import { STATUS } from '../types/constants';
import { NullableString, NullableStringArray } from './common';

const USER_FLAG_VALUES = Object.values(STATUS.FLAGS);
const GROUP_FLAG_VALUES = [
	STATUS.FLAGS.SAFE,
	STATUS.FLAGS.PENDING,
	STATUS.FLAGS.UNSAFE,
	STATUS.FLAGS.QUEUED,
	STATUS.FLAGS.MIXED,
	STATUS.FLAGS.PAST_OFFENDER,
	STATUS.FLAGS.UNKNOWN
];

export const ReviewerInfoSchema = v.object({
	username: v.optional(v.pipe(v.string(), v.maxLength(128))),
	displayName: v.optional(v.pipe(v.string(), v.maxLength(128)))
});

export const ReasonSchema = v.object({
	confidence: v.number(),
	message: v.optional(v.pipe(v.string(), v.maxLength(2000))),
	evidence: v.optional(NullableStringArray)
});

const MembershipBadgeSchema = v.object({
	tier: v.picklist([1, 2, 3]),
	badgeDesign: v.number(),
	iconDesign: v.number(),
	textDesign: v.number()
});

const VersionCompatibilitySchema = v.picklist(['current', 'compatible', 'outdated', 'unknown']);

const UserStatusBaseSchema = v.object({
	id: v.number(),
	flagType: v.fallback(v.picklist(USER_FLAG_VALUES), STATUS.FLAGS.UNKNOWN),
	category: v.optional(v.number()),
	confidence: v.optional(v.number(), 0),
	reasons: v.optional(v.record(v.pipe(v.string(), v.maxLength(64)), ReasonSchema), () => ({})),
	reviewer: v.optional(ReviewerInfoSchema),
	engineVersion: v.optional(v.pipe(v.string(), v.maxLength(64))),
	versionCompatibility: v.optional(VersionCompatibilitySchema),
	isReportable: v.optional(v.boolean()),
	queuedAt: v.optional(v.number()),
	processed: v.optional(v.boolean()),
	processedAt: v.optional(v.number()),
	lastUpdated: v.optional(v.number()),
	// Explicit PASC record-presence marker. The PASC proxy may add either flag;
	// when present it wins over the badge-text heuristic in status-utils.
	pascRecordPresent: v.optional(v.boolean()),
	pascMissing: v.optional(v.boolean()),
	badges: v.optional(
		v.pipe(
			v.array(
				v.object({
					text: v.pipe(v.string(), v.maxLength(128)),
					color: v.optional(v.pipe(v.string(), v.maxLength(64))),
					textColor: v.optional(v.pipe(v.string(), v.maxLength(64)))
				})
			),
			v.maxLength(10)
		)
	),
	membershipBadge: v.optional(MembershipBadgeSchema)
});

const GroupStatusBaseSchema = v.object({
	id: v.number(),
	flagType: v.fallback(v.picklist(GROUP_FLAG_VALUES), STATUS.FLAGS.UNKNOWN),
	confidence: v.optional(v.number(), 0),
	reasons: v.optional(v.record(v.pipe(v.string(), v.maxLength(64)), ReasonSchema), () => ({}))
});

export const UserStatusSchema = v.pipe(UserStatusBaseSchema, v.brand('UserStatus'));
export const GroupStatusSchema = v.pipe(GroupStatusBaseSchema, v.brand('GroupStatus'));

export const QueueStatusItemSchema = v.object({
	queued: v.boolean(),
	queued_at: v.optional(v.number(), 0),
	processed: v.optional(v.boolean(), false),
	processed_at: v.optional(v.nullable(v.number()), null),
	processing: v.optional(v.boolean(), false),
	flagged: v.optional(v.boolean(), false)
});

const OutfitLimitsSchema = v.object({
	current_usage: v.number(),
	limit: v.number(),
	remaining: v.number()
});

export const QueueLimitsSchema = v.object({
	current_usage: v.number(),
	limit: v.number(),
	remaining: v.number(),
	has_api_key: v.boolean(),
	reset_time: v.number(),
	outfit: OutfitLimitsSchema
});

export const QueueResultSchema = v.variant('success', [
	v.object({
		success: v.literal(true),
		data: v.object({ queued: v.number() })
	}),
	v.object({
		success: v.literal(false),
		error: v.optional(v.pipe(v.string(), v.maxLength(2000))),
		requestId: v.optional(v.pipe(v.string(), v.maxLength(128))),
		code: v.optional(v.pipe(v.string(), v.maxLength(64))),
		type: v.optional(v.pipe(v.string(), v.maxLength(64)))
	})
]);

export const TrackedUserSchema = v.object({
	id: v.number(),
	name: v.pipe(v.string(), v.maxLength(128)),
	displayName: v.pipe(v.string(), v.maxLength(128)),
	thumbnailUrl: NullableString,
	isActive: v.boolean()
});

export const GroupTrackedUsersSchema = v.object({
	users: v.pipe(v.array(TrackedUserSchema), v.maxLength(100)),
	totalCount: v.number(),
	nextCursor: v.nullable(v.pipe(v.string(), v.maxLength(256))),
	hasMore: v.boolean()
});

const DiscordServerInfoSchema = v.object({
	serverId: v.pipe(v.string(), v.maxLength(32)),
	serverName: v.pipe(v.string(), v.maxLength(128)),
	joinedAt: v.nullable(v.number()),
	updatedAt: v.nullable(v.number()),
	firstSeenAt: v.number(),
	isTase: v.boolean(),
	inGracePeriod: v.boolean()
});

export const RobloxAltAccountSchema = v.object({
	robloxUserId: v.number(),
	robloxUsername: v.pipe(v.string(), v.maxLength(128)),
	detectedAt: v.number(),
	updatedAt: v.number(),
	sources: v.pipe(v.array(v.number()), v.maxLength(50))
});

export const DiscordAccountInfoSchema = v.object({
	id: v.pipe(v.string(), v.maxLength(32)),
	detectedAt: v.nullable(v.number()),
	updatedAt: v.nullable(v.number()),
	servers: v.pipe(v.array(DiscordServerInfoSchema), v.maxLength(100)),
	sources: v.pipe(v.array(v.number()), v.maxLength(50))
});

export const RobloxUserDiscordLookupSchema = v.object({
	robloxUserId: v.number(),
	discordAccounts: v.pipe(v.array(DiscordAccountInfoSchema), v.maxLength(20)),
	altAccounts: v.pipe(v.array(RobloxAltAccountSchema), v.maxLength(50))
});

const OutfitSnapshotByNameRawSchema = v.object({
	results: v.pipe(
		v.array(
			v.object({
				name: v.pipe(v.string(), v.maxLength(128)),
				urls: v.pipe(v.array(v.pipe(v.string(), v.maxLength(2048))), v.maxLength(50))
			})
		),
		v.maxLength(100)
	)
});

const OutfitSnapshotByIdRawSchema = v.object({
	results: v.pipe(
		v.array(
			v.object({
				outfitId: v.pipe(v.string(), v.maxLength(32)),
				urls: v.pipe(v.array(v.pipe(v.string(), v.maxLength(2048))), v.maxLength(50))
			})
		),
		v.maxLength(100)
	)
});

export const MembershipStatusSchema = v.object({
	tier: v.picklist([1, 2, 3]),
	tierName: v.picklist(['Supporter', 'Patron', 'Benefactor']),
	associatedRobloxUserId: v.number(),
	badgeDesign: v.number(),
	iconDesign: v.number(),
	textDesign: v.number(),
	queueLimit: v.number(),
	outfitLimit: v.number(),
	rateLimit: v.number(),
	createdAt: v.number(),
	updatedAt: v.number()
});

export const MembershipVerificationChallengeSchema = v.object({
	robloxUserId: v.number(),
	phrase: v.pipe(v.string(), v.maxLength(256)),
	instructions: v.pipe(v.string(), v.maxLength(2000))
});

export const parseUserStatus = v.parser(UserStatusSchema);
export const parseUserStatusMap = v.parser(v.record(v.string(), UserStatusSchema));
export const parseGroupStatus = v.parser(GroupStatusSchema);
export const parseGroupStatusMap = v.parser(v.record(v.string(), GroupStatusSchema));
export const parseQueueResult = v.parser(QueueResultSchema);
export const parseQueueLimits = v.parser(QueueLimitsSchema);
export const parseQueueStatusResponse = v.parser(v.record(v.string(), QueueStatusItemSchema));
export const parseGroupTrackedUsers = v.parser(GroupTrackedUsersSchema);
export const parseRobloxUserDiscordLookup = v.parser(RobloxUserDiscordLookupSchema);
export const parseOutfitSnapshotByName = v.parser(OutfitSnapshotByNameRawSchema);
export const parseOutfitSnapshotById = v.parser(OutfitSnapshotByIdRawSchema);
export const parseMembershipStatus = v.parser(MembershipStatusSchema);
export const parseMembershipVerificationChallenge = v.parser(MembershipVerificationChallengeSchema);
