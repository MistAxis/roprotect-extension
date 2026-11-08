<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { _ } from 'svelte-i18n';
	import type { UserPresence } from '@/lib/schemas/roblox-api';
	import type { UserInfo } from '@/lib/services/roblox/users';
	import { getUsersInfoBatch } from '@/lib/services/roblox/users';
	import { getUserPresences } from '@/lib/services/roblox/groups';
	import { logger } from '@/lib/utils/logging/logger';
	import { friendsScanStore, selectedFriendsCategory } from '@/lib/stores/friends-scan';
	import FriendCard from './FriendCard.svelte';

	// Matches the native desktop grid, so paging through a filtered list feels
	// the same as paging through the unfiltered friends list.
	const PAGE_SIZE = 18;

	const infoById = new SvelteMap<number, UserInfo | null>();
	const presenceById = new SvelteMap<number, UserPresence>();

	let page = $state(1);
	let lastRequestedIds = '';

	const matchingIds = $derived.by(() => {
		const category = $selectedFriendsCategory;
		if (category === null) return [] as string[];
		const scan = $friendsScanStore;
		return scan.friendIds.filter((id) => scan.categories.get(id) === category);
	});

	const totalPages = $derived(Math.max(1, Math.ceil(matchingIds.length / PAGE_SIZE)));

	const pageIds = $derived(matchingIds.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	$effect(() => {
		void $selectedFriendsCategory;
		page = 1;
	});

	$effect(() => {
		if (page > totalPages) page = totalPages;
	});

	// Only the current page needs profile data and presence, so changing pages
	// never loads the whole matching set at once.
	$effect(() => {
		const ids = pageIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
		if (ids.length === 0) return;

		// The scan publishes as friends resolve, which recomputes pageIds even
		// when the visible page is unchanged. Never re-hit presence just because
		// an unrelated friend got a tag.
		const signature = ids.join(',');
		if (signature === lastRequestedIds) return;
		lastRequestedIds = signature;

		const request = { cancelled: false };

		void (async () => {
			try {
				const infos = await getUsersInfoBatch(ids);
				if (request.cancelled) return;
				for (const [id, info] of infos) infoById.set(id, info);
			} catch (error) {
				logger.warn('Failed to load filtered friend profiles:', error);
			}

			try {
				const presences = await getUserPresences(ids);
				if (request.cancelled) return;
				for (const [id, presence] of presences) presenceById.set(id, presence);
			} catch (error) {
				logger.warn('Failed to load filtered friend presences:', error);
			}
		})();

		return () => {
			request.cancelled = true;
		};
	});
</script>

{#if matchingIds.length > 0}
	<ul class="avatar-cards rotector-friends-filter-cards">
		{#each pageIds as userId (userId)}
			<FriendCard
				info={infoById.get(Number(userId)) ?? null}
				presence={presenceById.get(Number(userId)) ?? null}
				status={$friendsScanStore.statuses.get(userId) ?? null}
				{userId}
			/>
		{/each}
	</ul>

	{#if totalPages > 1}
		<div class="pager-holder rotector-friends-filter-pager">
			<ul class="pager">
				<li class="pager-prev">
					<button
						class="rotector-friends-filter-pager-btn"
						aria-label={$_('friends_tag_filter_prev_page')}
						disabled={page === 1}
						onclick={() => (page -= 1)}
						type="button"
					>
						<span class="icon-left"></span>
					</button>
				</li>
				<li class="pager-cur">
					<span>{page} / {totalPages}</span>
				</li>
				<li class="pager-next">
					<button
						class="rotector-friends-filter-pager-btn"
						aria-label={$_('friends_tag_filter_next_page')}
						disabled={page === totalPages}
						onclick={() => (page += 1)}
						type="button"
					>
						<span class="icon-right"></span>
					</button>
				</li>
			</ul>
		</div>
	{/if}
{/if}
