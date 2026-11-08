<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { _ } from 'svelte-i18n';
	import { createAbortableBatch } from '@/lib/utils/api/abortable-batch';
	import { logger } from '@/lib/utils/logging/logger';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import type {
		ScanCategory,
		ScanCounts,
		ScanProgressCallback,
		ScanProgressDetail
	} from '@/lib/services/rotector/scan-jobs';
	import {
		SCAN_CATEGORY_PRESENTATION,
		SCAN_SEVERITY_ORDER
	} from '@/lib/utils/status/scan-category';

	interface Props {
		scan: (onProgress: ScanProgressCallback, signal: AbortSignal) => Promise<ScanCounts>;
		label: string;
	}

	let { scan, label }: Props = $props();

	let phase = $state<'scanning' | 'complete' | 'error'>('scanning');
	const progress = new Tween(0, { duration: 600, easing: cubicOut });
	let counts = new SvelteMap<ScanCategory, number>();
	let providerDetail = $state<ScanProgressDetail | null>(null);
	const scanBatch = createAbortableBatch();

	const totalCount = $derived.by(() =>
		SCAN_SEVERITY_ORDER.reduce((sum, key) => sum + (counts.get(key) ?? 0), 0)
	);
	const integrationCount = $derived(counts.get('integration') ?? 0);

	$effect(() => {
		void startScan();
		return () => scanBatch.abort();
	});

	async function startScan() {
		const signal = scanBatch.nextSignal();

		phase = 'scanning';
		void progress.set(0, { duration: 0 });
		counts.clear();
		providerDetail = null;

		try {
			const result = await scan((pct, detail) => {
				void progress.set(pct);
				if (detail) providerDetail = detail;
			}, signal);
			for (const [k, v] of result) counts.set(k, v);
			await progress.set(100);
			if (signal.aborted) return;
			phase = 'complete';
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			logger.error(`Scan failed (${label})`, error);
			phase = 'error';
		}
	}
</script>

{#if phase === 'scanning'}
	<span class="rotector-scan-progress-wrapper">
		<span
			class="rotector-scan-progress"
			aria-label={$_('scan_progress_aria')}
			aria-valuemax="100"
			aria-valuemin="0"
			aria-valuenow={Math.round(progress.current)}
			role="progressbar"
		>
			<span style:width="{Math.round(progress.current)}%" class="rotector-scan-progress-fill"
			></span>
		</span>
		<span class="rotector-scan-progress-text">{Math.round(progress.current)}%</span>
		{#if providerDetail && providerDetail.providers.length > 0}
			<span class="rotector-scan-progress-detail" aria-hidden="true">
				{#each providerDetail.providers as p (p.apiId)}
					<span class="rotector-scan-provider-chip" title={p.apiName}>
						{#if p.logoUrl}
							<img
								class="rotector-scan-provider-logo"
								alt=""
								height="14"
								onerror={(event) => {
									const img = event.currentTarget as HTMLImageElement;
									// Dedicated readout asset missing (e.g. not shipped yet):
									// fall back to the provider's own logo once.
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
			</span>
		{/if}
	</span>
{:else if phase === 'complete'}
	<span class="rotector-scan-results">
		{#if totalCount === 0 && integrationCount === 0}
			<span class="rotector-scan-chip rotector-scan-chip-empty">
				{$_('scan_complete_empty')}
			</span>
		{:else}
			<span class="rotector-scan-bar">
				{#each SCAN_SEVERITY_ORDER as key (key)}
					{@const count = counts.get(key) ?? 0}
					{#if count > 0}
						<span
							style:background-color={SCAN_CATEGORY_PRESENTATION[key].color}
							style:width="{(count / totalCount) * 100}%"
							class="rotector-scan-segment"
						></span>
					{/if}
				{/each}
			</span>
			<span class="rotector-scan-chips" aria-label={$_('scan_summary_aria')} role="group">
				{#each SCAN_SEVERITY_ORDER as key (key)}
					{@const count = counts.get(key) ?? 0}
					{@const presentation = SCAN_CATEGORY_PRESENTATION[key]}
					{#if count > 0}
						<span
							style:color={presentation.color}
							class="rotector-scan-chip"
							aria-label={$_('scan_chip_aria', {
								values: { count, label: $_(presentation.labelKey) }
							})}
							title={$_(presentation.labelKey)}
						>
							<StatusIcon
								name={presentation.icon}
								color={presentation.color}
								size={13}
								strokeWidth={2.5}
							/>
							{count}
						</span>
					{/if}
				{/each}
				{#if integrationCount > 0}
					<span
						style:color={SCAN_CATEGORY_PRESENTATION.integration.color}
						class="rotector-scan-chip rotector-scan-chip-integration"
						aria-label={$_('scan_chip_aria', {
							values: {
								count: integrationCount,
								label: $_('tooltip_status_integration')
							}
						})}
						title={$_('tooltip_status_integration')}
					>
						<StatusIcon
							name={SCAN_CATEGORY_PRESENTATION.integration.icon}
							color={SCAN_CATEGORY_PRESENTATION.integration.color}
							size={13}
							strokeWidth={2.5}
						/>
						{integrationCount}
					</span>
				{/if}
			</span>
		{/if}
	</span>
{:else if phase === 'error'}
	<span class="rotector-scan-error" role="alert">
		{$_('scan_error_retry')}
		<button class="rotector-scan-retry" onclick={() => void startScan()} type="button">
			{$_('scan_error_retry_action')}
		</button>
	</span>
{/if}
