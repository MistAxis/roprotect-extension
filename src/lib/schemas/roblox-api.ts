import * as v from 'valibot';

const ThumbnailStateSchema = v.picklist(['Completed', 'Pending', 'Blocked', 'Error']);

// Roblox responses are still remote input (and can be proxied/mocked), so keep
// element counts and string lengths bounded before anything reaches storage or
// the DOM. Limits are generous relative to what the API actually returns.
const MAX_PAGE_ITEMS = 500;
const MAX_NAME_LENGTH = 256;
const MAX_URL_LENGTH = 2048;
const MAX_CURSOR_LENGTH = 512;
const MAX_MESH_SOURCE_LENGTH = 5_000_000;

const RobloxOutfitSchema = v.object({
	id: v.number(),
	name: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH)),
	isEditable: v.boolean(),
	outfitType: v.pipe(v.string(), v.maxLength(64))
});

const RobloxOutfitsResponseSchema = v.object({
	data: v.pipe(v.array(RobloxOutfitSchema), v.maxLength(MAX_PAGE_ITEMS)),
	paginationToken: v.nullable(v.pipe(v.string(), v.maxLength(MAX_CURSOR_LENGTH)))
});

const RobloxThumbnailItemSchema = v.object({
	targetId: v.number(),
	state: ThumbnailStateSchema,
	imageUrl: v.nullable(v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH)))
});

const RobloxThumbnailResponseSchema = v.object({
	data: v.pipe(v.array(RobloxThumbnailItemSchema), v.maxLength(MAX_PAGE_ITEMS))
});

const RobloxUserBasicSchema = v.object({
	id: v.number(),
	name: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH)),
	displayName: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH))
});

const RobloxUsersByIdResponseSchema = v.object({
	data: v.pipe(v.array(RobloxUserBasicSchema), v.maxLength(MAX_PAGE_ITEMS))
});

const RobloxAvatarThumbnailResponseSchema = v.object({
	data: v.pipe(
		v.array(
			v.object({
				state: v.pipe(v.string(), v.maxLength(64)),
				imageUrl: v.nullable(v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH)))
			})
		),
		v.maxLength(MAX_PAGE_ITEMS)
	)
});

const Vector3Schema = v.object({
	x: v.number(),
	y: v.number(),
	z: v.number()
});

const Roblox3DApiResponseSchema = v.object({
	targetId: v.number(),
	state: ThumbnailStateSchema,
	imageUrl: v.nullable(v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH))),
	version: v.pipe(v.string(), v.maxLength(64))
});

const Roblox3DMetadataRawSchema = v.object({
	camera: v.object({
		position: Vector3Schema,
		direction: Vector3Schema,
		fov: v.number()
	}),
	aabb: v.object({
		min: Vector3Schema,
		max: Vector3Schema
	}),
	mtl: v.pipe(v.string(), v.maxLength(MAX_MESH_SOURCE_LENGTH)),
	obj: v.pipe(v.string(), v.maxLength(MAX_MESH_SOURCE_LENGTH)),
	textures: v.pipe(v.array(v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH))), v.maxLength(1000))
});

const RolesApiResponseSchema = v.object({
	groupId: v.number(),
	roles: v.pipe(
		v.array(
			v.object({
				id: v.number(),
				name: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH)),
				rank: v.number(),
				memberCount: v.number()
			})
		),
		v.maxLength(MAX_PAGE_ITEMS)
	)
});

const GroupErrorBodySchema = v.object({
	errors: v.optional(v.pipe(v.array(v.object({ code: v.number() })), v.maxLength(50)))
});

const MembersResponseSchema = v.object({
	data: v.pipe(
		v.array(
			v.object({
				userId: v.number(),
				username: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH)),
				displayName: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH)),
				hasVerifiedBadge: v.boolean()
			})
		),
		v.maxLength(MAX_PAGE_ITEMS)
	),
	previousPageCursor: v.nullable(v.pipe(v.string(), v.maxLength(MAX_CURSOR_LENGTH))),
	nextPageCursor: v.nullable(v.pipe(v.string(), v.maxLength(MAX_CURSOR_LENGTH)))
});

const UserPresencesResponseSchema = v.object({
	userPresences: v.pipe(
		v.array(
			v.object({
				userPresenceType: v.number(),
				lastLocation: v.pipe(v.string(), v.maxLength(MAX_NAME_LENGTH)),
				userId: v.number()
			})
		),
		v.maxLength(MAX_PAGE_ITEMS)
	)
});

const GroupThumbnailBatchResponseSchema = v.object({
	data: v.pipe(
		v.array(
			v.object({
				targetId: v.number(),
				state: v.pipe(v.string(), v.maxLength(64)),
				imageUrl: v.nullable(v.pipe(v.string(), v.maxLength(MAX_URL_LENGTH)))
			})
		),
		v.maxLength(MAX_PAGE_ITEMS)
	)
});

const UserGroupRolesResponseSchema = v.object({
	data: v.pipe(
		v.array(
			v.object({
				group: v.object({ id: v.number() })
			})
		),
		v.maxLength(MAX_PAGE_ITEMS)
	)
});

export type GroupRole = v.InferOutput<typeof RolesApiResponseSchema>['roles'][number];
export type GroupMember = v.InferOutput<typeof MembersResponseSchema>['data'][number];
export type MembersResponse = v.InferOutput<typeof MembersResponseSchema>;
export type UserPresence = v.InferOutput<
	typeof UserPresencesResponseSchema
>['userPresences'][number];

export const parseRobloxOutfitsResponse = v.parser(RobloxOutfitsResponseSchema);
export const parseRobloxThumbnailResponse = v.parser(RobloxThumbnailResponseSchema);
export const parseRobloxUserBasic = v.parser(RobloxUserBasicSchema);
export const parseRobloxUsersByIdResponse = v.parser(RobloxUsersByIdResponseSchema);
export const parseRobloxAvatarThumbnail = v.parser(RobloxAvatarThumbnailResponseSchema);
export const parseRoblox3DApiResponse = v.parser(Roblox3DApiResponseSchema);
export const parseRoblox3DMetadataRaw = v.parser(Roblox3DMetadataRawSchema);
export const parseRolesApiResponse = v.parser(RolesApiResponseSchema);
export const parseGroupErrorBody = v.parser(GroupErrorBodySchema);
export const parseMembersResponse = v.parser(MembersResponseSchema);
export const parseUserPresencesResponse = v.parser(UserPresencesResponseSchema);
export const parseGroupThumbnailBatchResponse = v.parser(GroupThumbnailBatchResponseSchema);
export const parseUserGroupRolesResponse = v.parser(UserGroupRolesResponseSchema);
