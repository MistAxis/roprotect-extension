export const BLUR_SELECTORS = {
	// Friend carousel tiles. The 2026 redesign dropped the old class for a
	// test-id label wrapper; both shapes are marked, but keep them as separate
	// selectors because the reveal-rule builder composes a single selector.
	CAROUSEL_DISPLAY_NAME: '.friends-carousel-display-name',
	CAROUSEL_DISPLAY_NAME_V2: '[data-testid="friends-carousel-tile-labels"] span',

	// Avatar cards
	CARD_DISPLAY_NAME: '.avatar-name',
	CARD_USERNAME: '.avatar-card-label',

	// Profile page
	PROFILE_DISPLAY_NAME: '#profile-header-title-container-name',
	PROFILE_USERNAME: '.stylistic-alts-username',
	PROFILE_DESCRIPTION_STANDARD: '.description-content',
	PROFILE_DESCRIPTION_BTR: '.btr-profile-description',
	PROFILE_DESCRIPTION: '.description-content, .btr-profile-description',
	PROFILE_AVATAR: '.user-profile-header-details-avatar-container .thumbnail-2d-container',

	PROFILE_OUTFIT_2D: '.thumbnail-holder .thumbnail-2d-container',
	PROFILE_OUTFIT_3D: '.thumbnail-holder .thumbnail-3d-container',
	PROFILE_CURRENTLY_WEARING_STANDARD: '.profile-item-card .thumbnail-2d-container',
	PROFILE_CURRENTLY_WEARING_ROVALRA: '.rovalra-item-card .rovalra-item-thumb-container',
	PROFILE_CURRENTLY_WEARING:
		'.profile-item-card .thumbnail-2d-container, .rovalra-item-card .rovalra-item-thumb-container',

	// Avatar selectors
	CAROUSEL_AVATAR: '.friends-carousel-tile .avatar-card-image',
	FRIENDS_LIST_AVATAR: '.list-item.avatar-card .thumbnail-2d-container',
	// Legacy `.avatar-cards` markup plus the 2026 `.player-search-avatar` grid.
	SEARCH_AVATAR: 'li.player-item.avatar-card .thumbnail-2d-container',
	SEARCH_AVATAR_V2: '.player-search-avatar img',

	// Relative selectors
	TILE_CAROUSEL_AVATAR: '.avatar-card-image',
	TILE_THUMBNAIL: '.thumbnail-2d-container',

	// Search results
	SEARCH_DISPLAY_NAME: '.avatar-name-container .avatar-name',
	SEARCH_DISPLAY_NAME_V2: '.player-search-card-name a',
	SEARCH_USERNAME_V2: '.player-search-card-caption > p',

	// Group members carousel
	MEMBER_CAROUSEL_DISPLAY_NAME: '.rotector-member-tile .rotector-member-display-name',
	MEMBER_CAROUSEL_AVATAR: '.rotector-member-tile .rotector-member-avatar',

	// Group configure members
	GROUP_CONFIGURE_DISPLAY_NAME: '.member-info-display-member-column a.text-label-medium',
	GROUP_CONFIGURE_USERNAME: '.member-info-display-member-column a.text-body-small',
	GROUP_CONFIGURE_AVATAR: '.member-info-display-avatar .thumbnail-2d-container',

	// Data attributes for blur state tracking
	BLUR_USER_ID: 'data-blur-user-id',
	BLUR_TYPE: 'data-blur-type',
	BLUR_GROUP: 'data-blur-group',
	BLUR_TITLE: 'title'
} as const;

// Profile blur group identifiers
export const PROFILE_BLUR_GROUPS = {
	HEADER: 'profile-header',
	OUTFIT: 'profile-outfit'
} as const;
