<script lang="ts">
	import { _ } from 'svelte-i18n';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import {
		SCAN_CATEGORY_PRESENTATION,
		SCAN_SEVERITY_ORDER,
		type ScanCategory
	} from '@/lib/utils/status/scan-category';
	import {
		friendsScanStore,
		selectedFriendsCategory,
		toggleSelectedFriendsCategory
	} from '@/lib/stores/friends-scan';

	// Safe is already covered by Roblox's All chip, so it does not need a tag.
	// Every other category only appears when at least one scanned friend falls
	// into it.
	const FILTER_CATEGORIES = SCAN_SEVERITY_ORDER.filter((category) => category !== 'safe');

	let root = $state<HTMLDivElement | null>(null);

	const counts = $derived.by(() => {
		const next: Partial<Record<ScanCategory, number>> = {};
		for (const category of $friendsScanStore.categories.values()) {
			next[category] = (next[category] ?? 0) + 1;
		}
		return next;
	});

	const visibleCategories = $derived.by<ScanCategory[]>(() =>
		FILTER_CATEGORIES.filter((category) => (counts[category] ?? 0) > 0)
	);

	function isSelected(category: ScanCategory): boolean {
		return $selectedFriendsCategory === category;
	}

	// A tag chip and a native All/Trusted chip must never both read as selected:
	// Roblox paints its selected chip white, so while a tag is active we push
	// the native chip back to its unselected surface (see friends-filter.css).
	$effect(() => {
		const element = root;
		if (!element) return;
		const container = element.closest<HTMLElement>('.chip-filters-container');
		if (!container) return;

		container.classList.toggle(
			'rotector-friends-chip-row-tag-active',
			$selectedFriendsCategory !== null
		);

		return () => container.classList.remove('rotector-friends-chip-row-tag-active');
	});

	// Mirrors Roblox's own chip implementation (rQ in the Friends bundle): the
	// same base utilities, native normal/selected color pair, and state layer.
	function chipClass(category: ScanCategory): string {
		const variant = isSelected(category)
			? 'bg-inverse-surface-0 content-inverse-emphasis'
			: 'bg-shift-300 content-action-utility';

		return `relative clip group/interactable focus-visible:outline-focus disabled:outline-none cursor-pointer flex justify-center items-center radius-circle stroke-none padding-left-medium padding-right-medium height-800 text-label-medium ${variant}`;
	}

	// If a re-scan moves the last matching friend out of the active tag, clear
	// the filter instead of leaving the page showing an empty grid with no chip
	// left to click.
	$effect(() => {
		const selected = $selectedFriendsCategory;
		if (selected !== null && !visibleCategories.includes(selected)) {
			selectedFriendsCategory.set(null);
		}
	});

	// Roblox's own All/Trusted chips live in the same row. Clicking either one
	// is a request to leave the tag filter, just like clicking All on the page.
	$effect(() => {
		const element = root;
		if (!element) return;
		const container = element.closest<HTMLElement>('.chip-filters-container');
		if (!container) return;

		container.classList.add('rotector-friends-chip-row');

		const handleClick = (event: Event) => {
			if (!(event.target instanceof Element)) return;
			const chip = event.target.closest('button');
			if (!chip || element.contains(chip)) return;
			// The scan summary trigger shares this row; opening it is not a
			// request to clear the active tag.
			if (chip.closest('.rotector-friends-scan-host')) return;
			selectedFriendsCategory.set(null);
		};

		container.addEventListener('click', handleClick);
		return () => {
			container.removeEventListener('click', handleClick);
			container.classList.remove('rotector-friends-chip-row');
		};
	});
</script>

{#if visibleCategories.length > 0}
	<div
		bind:this={root}
		class="rotector-friends-tag-filters"
		aria-label={$_('friends_tag_filter_aria')}
		role="group"
	>
		{#each visibleCategories as category (category)}
			{@const presentation = SCAN_CATEGORY_PRESENTATION[category]}
			<button
				class={chipClass(category)}
				aria-pressed={isSelected(category)}
				onclick={() => toggleSelectedFriendsCategory(category)}
				type="button"
			>
				<div
					class="absolute inset-[0] transition-colors group-hover/interactable:bg-(--color-state-hover) group-active/interactable:bg-(--color-state-press) group-disabled/interactable:bg-none"
					aria-hidden="true"
					data-testid="foundation-web-state-layer"
				></div>
				<span class="rotector-friends-tag-icon">
					<StatusIcon
						name={presentation.icon}
						color={presentation.color}
						size={16}
						strokeWidth={2.5}
					/>
				</span>
				<span class="rotector-friends-tag-label padding-y-xsmall text-no-wrap text-truncate-end">
					{$_(presentation.labelKey)}
				</span>
			</button>
		{/each}
	</div>
{/if}
