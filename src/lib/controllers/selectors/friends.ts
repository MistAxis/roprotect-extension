export const FRIENDS_CAROUSEL_SELECTORS = {
	CONTAINER: '.friends-carousel-container',
	HEADER: '.react-friends-carousel-container .container-header.people-list-header',
	// Roblox's "see all" affordance at the right end of the carousel header; the
	// scan panel is mounted after it instead of beside the heading.
	HEADER_CHEVRON: '.icon-chevron-heavy-right',
	TILE: '.friends-carousel-tile',
	// The 2026 carousel dropped .friend-tile-content; the tile itself is the
	// stable anchor for the indicator (the headshot clips its own wrapper).
	TILE_CONTENT: '.friends-carousel-tile',
	PROFILE_LINK: 'a[href*="/users/"]',
	DISPLAY_NAME: '[data-testid="friends-carousel-tile-labels"] span, .friends-carousel-display-name',
	AVATAR_IMG: '.avatar-card-image img'
} as const;

export const FRIENDS_SELECTORS = {
	CONTAINER: '.hlist.avatar-cards',
	CARD: {
		CONTAINER: '.list-item.avatar-card',
		CAPTION: '.avatar-card-caption, .friend-caption, .avatar-card-label',
		DISPLAY_NAME: '.avatar-name',
		USERNAME: '.avatar-name-container + .avatar-card-label',
		AVATAR_IMG: '.thumbnail-2d-container img',
		FULLBODY: '.avatar-card-fullbody'
	},
	NO_RESULTS: '.section-content-off',
	PROFILE_LINK: '.avatar-card-link, .avatar-container > a'
} as const;
