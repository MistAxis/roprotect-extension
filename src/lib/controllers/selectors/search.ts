// Roblox's 2026 player-search redesign renders circular avatar headshots in an
// article-based grid. Keep the legacy card selectors during the rollout, since
// Roblox still serves the old .avatar-cards markup to some cohorts.
export const SEARCH_SELECTORS = {
	CONTAINER: 'ul.search-result.avatar-cards, .player-search-results-grid',
	CARD: {
		CONTAINER: 'li.player-item.avatar-card, article.player-search-card',
		CAPTION: '.avatar-card-caption, .player-search-card-caption',
		DISPLAY_NAME: '.avatar-name-container .avatar-name, .player-search-card-name a',
		USERNAME: '.avatar-name-container + .avatar-card-label, .player-search-card-caption > p',
		AVATAR_IMG: '.thumbnail-2d-container img, .player-search-avatar-clip img',
		FULLBODY: '.avatar-card-fullbody, .player-search-avatar'
	},
	FRIEND_BUTTON: '.btn-control-md, .mobile-card-btn, .player-search-action-parity',
	NO_RESULTS: '.section-content-off.no-results',
	PROFILE_LINK: 'a.avatar-card-link, .player-search-profile-link'
} as const;
