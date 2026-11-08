<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { _ } from 'svelte-i18n';
	import { LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import { createAbortableBatch } from '@/lib/utils/api/abortable-batch';
	import { logger } from '@/lib/utils/logging/logger';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import OverlayPortal from '@/components/overlay/OverlayPortal.svelte';
	import ScanShield from './ScanShield.svelte';
	import {
		scanFriendsForUser,
		type ScanCategory,
		type ScanCounts,
		type ScanProgressDetail
	} from '@/lib/services/rotector/scan-jobs';
	import {
		SCAN_CATEGORY_PRESENTATION,
		SCAN_SEVERITY_ORDER
	} from '@/lib/utils/status/scan-category';
	import {
		beginFriendsScan,
		failFriendsScan,
		finishFriendsScan,
		friendsScanStore,
		recordFriendScanResult,
		resetFriendsScan,
		setFriendsScanFriendIds
	} from '@/lib/stores/friends-scan';
	import { isActionableResult, isPascRecordPresent } from '@/lib/utils/status/status-utils';
	import { STATUS } from '@/lib/types/constants';

	interface Props {
		userId: string;
		isOwnFriends?: boolean;
	}

	let { userId, isOwnFriends = true }: Props = $props();

	let phase = $state<'scanning' | 'complete' | 'error'>('scanning');
	// True only while the spinner is collapsing, right before the shield mounts.
	let collapsing = $state(false);
	const progress = new Tween(0, { duration: 600, easing: cubicOut });
	let counts = new SvelteMap<ScanCategory, number>();
	let providerDetail = $state<ScanProgressDetail | null>(null);
	const scanBatch = createAbortableBatch();

	let open = $state(false);
	let root = $state<HTMLElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	let panelPosition = $state<{ top: number; left: number } | null>(null);
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let hovering = false;

	const PANEL_GAP = 8;
	const VIEWPORT_MARGIN = 8;
	// Long enough to cross the gap between the trigger and the portalled panel.
	const CLOSE_DELAY = 220;

	// Loading -> shield hand-off: the spinner collapses to almost nothing over
	// ~0.4s, then is replaced by the shield, which grows back out of that point.
	// Both states are never mounted together, so only one icon is ever visible.
	const ICON_COLLAPSE_MS = 380;

	const totalCount = $derived.by(() =>
		SCAN_SEVERITY_ORDER.reduce((sum, key) => sum + (counts.get(key) ?? 0), 0)
	);
	const integrationCount = $derived(counts.get('integration') ?? 0);
	const presentCategories = $derived(
		SCAN_SEVERITY_ORDER.filter((key) => (counts.get(key) ?? 0) > 0)
	);

	// Which providers actually put friends in a flagged bucket, so the summary
	// can show where the flags came from. Built from the completed scan snapshot
	// and counts each friend once per provider. A present PASC record is
	// authoritative, matching the verdict logic everywhere else in the UI.
	const providerFlagSources = $derived.by(() => {
		if (phase !== 'complete') return [];

		const sources = new SvelteMap<string, { apiId: string; apiName: string; count: number }>();
		const add = (apiId: string, apiName: string) => {
			const existing = sources.get(apiId);
			if (existing) {
				existing.count += 1;
			} else {
				sources.set(apiId, { apiId, apiName, count: 1 });
			}
		};

		for (const combined of $friendsScanStore.statuses.values()) {
			const pasc = combined.get('system-pasc');
			if (pasc && isPascRecordPresent(pasc) && pasc.data?.flagType !== STATUS.FLAGS.UNKNOWN) {
				if (isActionableResult(pasc)) add(pasc.apiId, pasc.apiName);
				continue;
			}
			for (const result of combined.values()) {
				if (isActionableResult(result)) add(result.apiId, result.apiName);
			}
		}

		return [...sources.values()].toSorted(
			(a, b) => b.count - a.count || a.apiName.localeCompare(b.apiName)
		);
	});

	$effect(() => {
		void startScan();
		return () => {
			scanBatch.abort();
			resetFriendsScan();
		};
	});

	$effect(() => {
		return () => {
			if (closeTimer !== null) clearTimeout(closeTimer);
		};
	});

	// Keep the portalled panel anchored to the trigger. It is positioned with
	// viewport coordinates so Roblox's header overflow can never clip it.
	$effect(() => {
		void open;
		void panel;
		if (!open || !panel) return;

		const frame = requestAnimationFrame(() => updatePanelPosition());
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		void counts.size;
		void presentCategories.length;
		void phase;
		if (!open) return;

		const frame = requestAnimationFrame(() => updatePanelPosition());
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		if (!open) return;

		const onMove = () => updatePanelPosition();
		window.addEventListener('resize', onMove);
		window.addEventListener('scroll', onMove, true);
		return () => {
			window.removeEventListener('resize', onMove);
			window.removeEventListener('scroll', onMove, true);
		};
	});

	$effect(() => {
		if (!open) return;

		function handlePointerDown(event: PointerEvent) {
			const path = event.composedPath();
			if (root && path.includes(root)) return;
			if (panel && path.includes(panel)) return;
			open = false;
		}

		function handleKeydown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			open = false;
		}

		document.addEventListener('pointerdown', handlePointerDown, true);
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
			document.removeEventListener('keydown', handleKeydown);
		};
	});

	function applyCounts(next: ReadonlyMap<ScanCategory, number>) {
		for (const [key, value] of next) counts.set(key, value);
		for (const key of counts.keys()) {
			if (!next.has(key)) counts.delete(key);
		}
	}

	async function startScan() {
		const signal = scanBatch.nextSignal();

		phase = 'scanning';
		collapsing = false;
		void progress.set(0, { duration: 0 });
		counts.clear();
		providerDetail = null;
		beginFriendsScan(userId);

		try {
			const result: ScanCounts = await scanFriendsForUser(
				userId,
				isOwnFriends,
				(pct, detail) => {
					void progress.set(pct);
					if (!detail) return;
					providerDetail = detail;
					if (detail.counts) applyCounts(detail.counts);
				},
				signal,
				{
					onFriendIds: (ids) => setFriendsScanFriendIds(userId, ids),
					onFriendResult: (friendId, category, _fromIntegration, combined) =>
						recordFriendScanResult(userId, friendId, category, combined)
				}
			);
			applyCounts(result);
			finishFriendsScan(userId);
			await progress.set(100);
			if (signal.aborted) return;

			// Let the spinner shrink away before swapping in the shield, so the two
			// icons are never on screen at the same time.
			collapsing = true;
			await new Promise((resolve) => setTimeout(resolve, ICON_COLLAPSE_MS));
			// Abort can happen while the collapse timer runs; TS narrowed the flag
			// from the check above and would otherwise call this condition dead.
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (signal.aborted) return;
			phase = 'complete';
			collapsing = false;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			logger.error('Friends page scan failed', error);
			failFriendsScan(userId);
			collapsing = false;
			phase = 'error';
		}
	}

	function updatePanelPosition() {
		if (!trigger || !panel) return;

		const anchor = trigger.getBoundingClientRect();
		const box = panel.getBoundingClientRect();
		const width = box.width;
		const height = box.height;

		let left = Math.max(
			VIEWPORT_MARGIN,
			Math.min(anchor.left, window.innerWidth - width - VIEWPORT_MARGIN)
		);

		let top = anchor.bottom + PANEL_GAP;
		if (
			top + height > window.innerHeight - VIEWPORT_MARGIN &&
			anchor.top - height - PANEL_GAP >= VIEWPORT_MARGIN
		) {
			top = anchor.top - height - PANEL_GAP;
		}
		top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN));

		panelPosition = { top, left };
	}

	function cancelClose() {
		if (closeTimer === null) return;
		clearTimeout(closeTimer);
		closeTimer = null;
	}

	function scheduleClose() {
		cancelClose();
		if (hovering) return;
		closeTimer = setTimeout(() => {
			closeTimer = null;
			open = false;
		}, CLOSE_DELAY);
	}

	function handleEnter() {
		hovering = true;
		cancelClose();
		open = true;
	}

	function handleLeave() {
		hovering = false;
		scheduleClose();
	}

	function shareOf(count: number): number {
		return totalCount > 0 ? Math.min(100, (count / totalCount) * 100) : 0;
	}
</script>

<div
	bind:this={root}
	class="rotector-friends-scan"
	aria-label={$_('friends_scan_title')}
	onmouseenter={handleEnter}
	onmouseleave={handleLeave}
	role="group"
>
	<button
		bind:this={trigger}
		class="rotector-friends-scan-trigger"
		aria-controls="rotector-friends-scan-panel"
		aria-expanded={open}
		aria-label={$_('friends_scan_title')}
		onblur={scheduleClose}
		onclick={handleEnter}
		onfocus={handleEnter}
		type="button"
	>
		{#if phase === 'scanning'}
			<span
				class="rotector-friends-scan-icon"
				class:rotector-friends-scan-icon-collapsing={collapsing}
			>
				<LoaderCircle class="rotector-friends-scan-spinner" size={20} strokeWidth={3} />
			</span>
		{:else if phase === 'error'}
			<TriangleAlert class="rotector-friends-scan-error-icon" size={20} strokeWidth={2.5} />
		{:else}
			<span class="rotector-friends-scan-icon rotector-friends-scan-icon-appearing">
				<ScanShield />
			</span>
		{/if}
	</button>

	<OverlayPortal>
		<div
			bind:this={panel}
			id="rotector-friends-scan-panel"
			style:top={panelPosition ? `${String(panelPosition.top)}px` : '-9999px'}
			style:left={panelPosition ? `${String(panelPosition.left)}px` : '-9999px'}
			class="rotector-friends-scan-panel"
			class:is-open={open}
			aria-label={$_('friends_scan_title')}
			onmouseenter={handleEnter}
			onmouseleave={handleLeave}
			role="tooltip"
		>
			<div class="rotector-friends-scan-panel-header">
				<span class="rotector-friends-scan-panel-title">{$_('friends_scan_title')}</span>
				{#if phase === 'scanning'}
					<span class="rotector-friends-scan-panel-percent">
						{Math.round(progress.current)}%
					</span>
				{:else if phase === 'complete'}
					<span class="rotector-friends-scan-panel-meta">
						{totalCount}
						{$_('usage_users_scanned')}
					</span>
				{/if}
			</div>

			{#if phase === 'scanning'}
				<div class="rotector-friends-scan-progress-row">
					<span
						class="rotector-friends-scan-progress"
						aria-label={$_('scan_progress_aria')}
						aria-valuemax="100"
						aria-valuemin="0"
						aria-valuenow={Math.round(progress.current)}
						role="progressbar"
					>
						<span
							style:width="{Math.round(progress.current)}%"
							class="rotector-friends-scan-progress-fill"
						></span>
					</span>
				</div>
				{#if providerDetail && providerDetail.providers.length > 0}
					<div class="rotector-friends-scan-providers">
						{#each providerDetail.providers as p (p.apiId)}
							<span class="rotector-scan-provider-chip" title={p.apiName}>
								{#if p.logoUrl}
									<img
										class="rotector-scan-provider-logo"
										alt=""
										height="14"
										onerror={(event) => {
											const img = event.currentTarget as HTMLImageElement;
											if (p.fallbackLogoUrl && img.src !== p.fallbackLogoUrl) {
												img.src = p.fallbackLogoUrl;
											}
										}}
										src={p.logoUrl}
										width="14"
									/>
								{/if}
								{`${String(p.resolved)}/${String(providerDetail?.total ?? 0)}`}
							</span>
						{/each}
					</div>
				{/if}
			{:else if phase === 'error'}
				<div class="rotector-friends-scan-error" role="alert">
					<span>{$_('scan_error_retry')}</span>
					<button
						class="rotector-friends-scan-retry"
						onclick={() => void startScan()}
						type="button"
					>
						{$_('scan_error_retry_action')}
					</button>
				</div>
			{:else if totalCount === 0 && integrationCount === 0}
				<p class="rotector-friends-scan-empty">{$_('scan_complete_empty')}</p>
			{:else}
				{#if totalCount > 0}
					<div
						class="rotector-friends-scan-distribution"
						aria-label={$_('scan_summary_aria')}
						role="img"
					>
						{#each presentCategories as key (key)}
							{@const count = counts.get(key) ?? 0}
							<span
								style:background-color={SCAN_CATEGORY_PRESENTATION[key].color}
								style:width="{shareOf(count)}%"
								class="rotector-friends-scan-distribution-segment"
							></span>
						{/each}
					</div>
				{/if}

				<div class="rotector-friends-scan-rows" aria-label={$_('scan_summary_aria')} role="group">
					{#each presentCategories as key (key)}
						{@const presentation = SCAN_CATEGORY_PRESENTATION[key]}
						{@const count = counts.get(key) ?? 0}
						<div class="rotector-friends-scan-row">
							<StatusIcon
								name={presentation.icon}
								color={presentation.color}
								size={13}
								strokeWidth={2.5}
							/>
							<span class="rotector-friends-scan-row-label">{$_(presentation.labelKey)}</span>
							<span class="rotector-friends-scan-row-share">{Math.round(shareOf(count))}%</span>
							<span class="rotector-friends-scan-row-count">{count}</span>
						</div>
					{/each}

					{#if integrationCount > 0}
						<div class="rotector-friends-scan-row rotector-friends-scan-row-integration">
							<StatusIcon
								name={SCAN_CATEGORY_PRESENTATION.integration.icon}
								color={SCAN_CATEGORY_PRESENTATION.integration.color}
								size={13}
								strokeWidth={2.5}
							/>
							<span class="rotector-friends-scan-row-label">
								{$_('tooltip_status_integration')}
							</span>
							<span class="rotector-friends-scan-row-share"
								>{Math.round(shareOf(integrationCount))}%</span
							>
							<span class="rotector-friends-scan-row-count">{integrationCount}</span>
						</div>
					{/if}
				</div>

				{#if providerFlagSources.length > 0}
					<div
						class="rotector-friends-scan-sources"
						aria-label={$_('pasc_provider_verdicts')}
						role="group"
					>
						<span class="rotector-friends-scan-sources-title">{$_('pasc_provider_verdicts')}</span>
						<div class="rotector-friends-scan-sources-list">
							{#each providerFlagSources as source (source.apiId)}
								<span class="rotector-friends-scan-source">
									<span class="rotector-friends-scan-source-name">{source.apiName}</span>
									<span class="rotector-friends-scan-source-count">{source.count}</span>
								</span>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</OverlayPortal>
</div>
