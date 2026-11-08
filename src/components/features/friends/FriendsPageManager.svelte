<script lang="ts">
	import { mount, unmount } from 'svelte';
	import { waitForElement } from '@/lib/utils/dom/element-waiter';
	import { COMPONENT_CLASSES, PAGE_TYPES } from '@/lib/types/constants';
	import { FRIENDS_SELECTORS } from '@/lib/controllers/selectors/friends';
	import { getLoggedInUserId } from '@/lib/utils/client-id';
	import { getFriendsListTab, normalizePathname } from '@/lib/utils/dom/page-detection';
	import { extractIdFromUrl } from '@/lib/utils/dom/sanitizer';
	import { resetFriendsScan, selectedFriendsCategory } from '@/lib/stores/friends-scan';
	import UserListManager from '../lists/UserListManager.svelte';
	import FriendsScanPanel from './FriendsScanPanel.svelte';
	import FriendsTagFilters from './FriendsTagFilters.svelte';
	import FriendsFilteredView from './FriendsFilteredView.svelte';

	interface Props {
		onMount?: (cleanup: () => void) => void;
	}

	let { onMount }: Props = $props();

	let showFriendsList = $state(false);
	let scanBarContainer: HTMLElement | null = null;
	let scanBarCleanup: (() => void) | null = null;
	let scanBarSetupInFlight = false;
	let syntheticChipRow: HTMLElement | null = null;
	let tagFiltersHost: HTMLElement | null = null;
	let tagFiltersComponent: ReturnType<typeof mount> | null = null;
	let filteredHost: HTMLElement | null = null;
	let filteredComponent: ReturnType<typeof mount> | null = null;
	let hiddenNativeElements: HTMLElement[] = [];

	$effect(() => {
		void waitForElement(FRIENDS_SELECTORS.CONTAINER).then((r) => {
			if (r.success) showFriendsList = true;
		});
		void setupScanBar();
		onMount?.(cleanup);

		globalThis.addEventListener('hashchange', handleHashChange);

		return () => {
			globalThis.removeEventListener('hashchange', handleHashChange);
			cleanup();
		};
	});

	// Selecting a tag swaps the native page list for a grid of the matching
	// friends, leaving Roblox's own cards and pager hidden underneath. Clearing
	// the tag restores them untouched.
	$effect(() => {
		if ($selectedFriendsCategory === null) {
			clearFilteredView();
			return;
		}
		if (!showFriendsList) return;
		setupFilteredView();
	});

	function handleHashChange() {
		if (isFriendsTab() && !scanBarContainer) {
			void setupScanBar();
		} else if (!isFriendsTab() && scanBarContainer) {
			cleanupScanBar();
		}
	}

	function getUserIdFromUrl(): string | null {
		const pathname = normalizePathname(globalThis.location.pathname);
		const userId = extractIdFromUrl(pathname, /\/users\/(\d+)\/friends/);
		if (userId) return userId;
		if (pathname === '/users/friends' || pathname === '/users/friends/') {
			return getLoggedInUserId();
		}
		return null;
	}

	function isFriendsTab(): boolean {
		return getFriendsListTab() === 'friends';
	}

	async function setupScanBar() {
		if (!isFriendsTab()) return;
		if (scanBarContainer || scanBarSetupInFlight) return;

		const userId = getUserIdFromUrl();
		if (!userId) return;

		scanBarSetupInFlight = true;
		try {
			const headerResult = await waitForElement('.friends-content .container-header');
			if (!headerResult.success) return;

			const header = headerResult.element;

			const container = document.createElement('span');
			container.className = COMPONENT_CLASSES.FRIENDS_SCAN_HOST;

			// Prefer Roblox's chip filter row so the trigger lines up with the
			// friends-page filters; fall back to the search field wrapper on
			// third-party reshuffles (Roseal) that move the header around.
			const chipFilters = await resolveChipFiltersRow(header);
			if (chipFilters) {
				chipFilters.insertBefore(container, chipFilters.firstElementChild);
				mountTagFilters(chipFilters);
			} else {
				// Roseal restructures the header, so resolve the search field's own
				// wrapper first and only fall back to the filter block when it is absent.
				const searchField =
					header.querySelector('input[type="search"]') ??
					header.querySelector('.friends-filter input') ??
					header.querySelector('input:not([type="hidden"])');
				const searchBar =
					searchField?.closest('.friends-filter, .search-bar, .input-group, form, div') ??
					header.querySelector('.friends-filter') ??
					header.querySelector('.friends-left');
				if (!searchBar?.parentNode) return;
				searchBar.parentNode.insertBefore(container, searchBar);
				mountTagFilters(searchBar.parentNode as Element, container);
			}
			scanBarContainer = container;

			const component = mount(FriendsScanPanel, {
				target: container,
				props: { userId, isOwnFriends: userId === getLoggedInUserId() }
			});

			scanBarCleanup = () => {
				void unmount(component);
			};
		} finally {
			scanBarSetupInFlight = false;
		}
	}

	// Roblox only renders its All/Trusted chip row when the current user is
	// looking at their own friends list (and the trusted-friends hub is on).
	// Another user's list has no row at all, so the trigger and tag chips would
	// otherwise be dropped into the search field's row. Recreate the chip row
	// with Roblox's own class so it inherits the native column layout, gap and
	// margins and sits under the search field exactly like it does on our own.
	async function resolveChipFiltersRow(header: Element): Promise<Element | null> {
		const nativeRow = header.querySelector<HTMLElement>('.chip-filters-container');
		if (nativeRow) return nativeRow;

		// The header exists before Roblox renders its chip row, so give React
		// the same window the previous implementation did before deciding the
		// row will never appear (which is always the case on another user's
		// list). Appending too early means React replaces the header contents
		// and our trigger never shows up.
		const chipResult = await waitForElement('.friends-content .chip-filters-container', {
			maxRetries: 8,
			baseDelay: 100,
			maxDelay: 400
		});
		if (chipResult.success) return chipResult.element;

		// Roseal splits the header into left/right columns; keep using its
		// search-field fallback rather than appending into a reshuffled header.
		if (header.querySelector('.friends-left, .friends-right')) return null;
		if (!header.querySelector('.friends-subtitle')) return null;

		const row = document.createElement('div');
		row.className = 'chip-filters-container rotector-friends-chip-row';
		header.append(row);
		syntheticChipRow = row;
		return row;
	}

	function mountTagFilters(parent: Element, after?: Element) {
		if (tagFiltersHost) return;

		const host = document.createElement('span');
		host.className = COMPONENT_CLASSES.FRIENDS_TAG_FILTERS_HOST;

		if (after) {
			after.after(host);
		} else {
			parent.append(host);
		}

		tagFiltersHost = host;
		tagFiltersComponent = mount(FriendsTagFilters, { target: host });
	}

	function unmountTagFilters() {
		if (tagFiltersComponent) {
			void unmount(tagFiltersComponent);
			tagFiltersComponent = null;
		}
		if (tagFiltersHost) {
			tagFiltersHost.remove();
			tagFiltersHost = null;
		}
	}

	// Hides Roblox's card list and pager without removing them, so the React
	// tree stays intact and clearing the filter restores the exact same view.
	function setupFilteredView() {
		if (filteredHost) return;

		const nativeList = document.querySelector<HTMLElement>(
			`.friends-content ${FRIENDS_SELECTORS.CONTAINER}`
		);
		if (!nativeList) return;

		const content = nativeList.closest('.friends-content');
		const scope = content?.parentElement ?? nativeList.parentElement;
		if (!scope) return;

		hiddenNativeElements = [];
		for (const element of [nativeList, ...scope.querySelectorAll<HTMLElement>('.pager-holder')]) {
			if (element.hidden) continue;
			element.hidden = true;
			hiddenNativeElements.push(element);
		}

		const host = document.createElement('div');
		host.className = 'rotector-friends-filtered-host';
		nativeList.after(host);
		filteredHost = host;
		filteredComponent = mount(FriendsFilteredView, { target: host });
	}

	function clearFilteredView() {
		if (filteredComponent) {
			void unmount(filteredComponent);
			filteredComponent = null;
		}
		if (filteredHost) {
			filteredHost.remove();
			filteredHost = null;
		}
		for (const element of hiddenNativeElements) {
			element.hidden = false;
		}
		hiddenNativeElements = [];
	}

	function cleanupScanBar() {
		if (scanBarCleanup) {
			scanBarCleanup();
			scanBarCleanup = null;
		}
		if (scanBarContainer) {
			scanBarContainer.remove();
			scanBarContainer = null;
		}
		unmountTagFilters();
		if (syntheticChipRow) {
			syntheticChipRow.remove();
			syntheticChipRow = null;
		}
		clearFilteredView();
		resetFriendsScan();
	}

	function cleanup() {
		cleanupScanBar();
		showFriendsList = false;
	}
</script>

{#if showFriendsList}
	<UserListManager pageType={PAGE_TYPES.FRIENDS_LIST} />
{/if}
