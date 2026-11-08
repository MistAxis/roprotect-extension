<script lang="ts">
	import { _ } from 'svelte-i18n';
	import type { EntityStatus, UserStatus } from '@/lib/types/api';
	import type { CombinedStatus } from '@/lib/types/custom-api';
	import { ENTITY_TYPES } from '@/lib/types/constants';
	import { logger } from '@/lib/utils/logging/logger';
	import { sanitizeEntityId } from '@/lib/utils/dom/sanitizer';
	import { getStatusConfig } from '@/lib/utils/status/status-config';
	import CanvasText from '@/components/ui/CanvasText.svelte';
	import { groupStatusService, userStatusService } from '@/lib/services/rotector/entity-status';
	import { countCustomApiFlags } from '@/lib/services/rotector/unified-query';
	import { restrictedAccessStore } from '@/lib/stores/restricted-access';
	import { getLoggedInUserId } from '@/lib/utils/client-id';
	import { openOutfitViewer } from '@/lib/stores/outfit-viewer';
	import { reportFirstDetectionIfEligible } from '@/lib/stores/first-detection';
	import {
		getBadgeStackClasses,
		getRotectorMembershipBadge,
		getRotectorOutfitEvidence
	} from '@/lib/utils/status/status-projection';
	import { getSystemApiSummary, pickCustomApiFallback } from '@/lib/utils/status/status-utils';
	import { Flag, Hourglass } from '@lucide/svelte';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';

	import MembershipIcon from '@/components/ui/membership/MembershipIcon.svelte';
	import { designKey, tierOf } from '@/lib/utils/membership-designs';
	import Tooltip from './Tooltip.svelte';
	import OverlayPortal from '@/components/overlay/OverlayPortal.svelte';

	interface Props {
		entityId: string;
		entityType: 'user' | 'group';
		entityStatus?: CombinedStatus | null | undefined;
		error?: string | null | undefined;
		showText?: boolean | undefined;
		skipAutoFetch?: boolean | undefined;
		suppressMembershipBadge?: boolean | undefined;
		onClick?: ((entityId: string) => void) | undefined;
		onQueue?:
			| ((entityId: string, isReprocess?: boolean, status?: EntityStatus | null) => void)
			| undefined;
		onStatusUpdate?: ((status: UserStatus) => void) | undefined;
		userUsername?: string | undefined;
		userDisplayName?: string | undefined;
		userAvatarUrl?: string | undefined;
	}

	let {
		entityId,
		entityType,
		entityStatus = null,
		error = null,
		showText = true,
		skipAutoFetch = false,
		suppressMembershipBadge = false,
		onClick,
		onQueue,
		onStatusUpdate,
		userUsername,
		userDisplayName,
		userAvatarUrl
	}: Props = $props();

	let container = $state<HTMLElement>();
	let showPreviewTooltip = $state(false);
	let showExpandedTooltip = $state(false);
	let isTooltipHovered = $state(false);
	let showBadgeExpansion = $state(false);

	let cachedStatus = $state<EntityStatus | null>(null);
	let hoverTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	const statusService = $derived(
		entityType === ENTITY_TYPES.USER ? userStatusService : groupStatusService
	);

	const sanitizedEntityId = $derived(sanitizeEntityId(entityId) || '');

	const isRestricted = $derived($restrictedAccessStore.isRestricted);

	const isSelfLookup = $derived.by(() => {
		if (entityType !== ENTITY_TYPES.USER) return false;
		const clientId = getLoggedInUserId();
		const targetId = sanitizeEntityId(entityId);
		return clientId !== null && targetId !== null && clientId === targetId;
	});

	// RoProtect is three separate services, so resolve them as a group and let the most severe
	// verdict stand. Reading the old single 'system-roprotect' entry always missed every provider,
	// which left this indicator on "Checking..." forever.
	const systemSummary = $derived(getSystemApiSummary(entityStatus));

	const statusConfig = $derived.by(() => {
		if (!entityStatus) {
			return getStatusConfig(cachedStatus, cachedStatus, !cachedStatus, null, entityType);
		}

		const rotectorStatus = systemSummary.data ?? cachedStatus;
		const rotectorLoading = systemSummary.loading;
		const rotectorError = systemSummary.error;
		const effectiveError = rotectorError || error;

		// An unreachable or not-yet-answered Rotector makes getStatusConfig render the generic
		// "Unknown" indicator, hiding a verdict a custom API already returned. Prefer that
		// provider's flagType instead so the icon, colour, and label mirror what it reported.
		// Skipped when the caller supplied its own error so entity-level failures (restricted
		// access) keep winning over partial third-party data.
		if (!error && (effectiveError !== null || !rotectorStatus)) {
			const fallback = pickCustomApiFallback(entityStatus);
			if (fallback?.data) {
				return getStatusConfig(fallback.data, null, false, null, entityType);
			}
		}

		return getStatusConfig(
			rotectorStatus,
			cachedStatus,
			rotectorLoading,
			effectiveError,
			entityType
		);
	});

	const isGroup = $derived(entityType === ENTITY_TYPES.GROUP);

	const flaggedOutfits = $derived(isGroup ? null : getRotectorOutfitEvidence(entityStatus));

	const customApiFlagCount = $derived(entityStatus ? countCustomApiFlags(entityStatus) : 0);

	const membershipBadge = $derived(
		!isGroup && !suppressMembershipBadge ? getRotectorMembershipBadge(entityStatus) : null
	);
	const membershipTier = $derived(membershipBadge ? tierOf(membershipBadge.tier) : null);
	const membershipIconKey = $derived(
		membershipBadge && membershipTier
			? designKey(membershipBadge.iconDesign, membershipTier, 'icon')
			: null
	);

	const badgeStackClasses = $derived(
		getBadgeStackClasses({
			isGroup,
			isReportable: statusConfig.isReportable,
			isQueued: statusConfig.isQueued,
			customApiFlagCount,
			hasMembership: membershipBadge !== null
		})
	);

	const hasData = $derived(!!(systemSummary.data ?? cachedStatus));
	const anyApiHasData = $derived(
		!!entityStatus && [...entityStatus.values()].some((result) => !!result.data)
	);
	const anyApiErrored = $derived(
		!!entityStatus && [...entityStatus.values()].some((result) => !!result.error)
	);
	// An unreachable Rotector lookup must not hide a flag a custom API already returned, so
	// the tooltip stays reachable as soon as any API has data or has settled with an error.
	const tooltipBlocked = $derived(
		!anyApiHasData &&
			!anyApiErrored &&
			(systemSummary.loading || (!hasData && !error && !isRestricted && !isSelfLookup))
	);

	function handleClick(event: MouseEvent | KeyboardEvent) {
		event.preventDefault();
		event.stopPropagation();

		if (tooltipBlocked) return;

		logger.userAction('status_indicator_clicked', { entityId: sanitizedEntityId, entityType });

		onClick?.(sanitizedEntityId);

		showPreviewTooltip = false;
		showExpandedTooltip = true;
		showBadgeExpansion = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			handleClick(event);
		}
	}

	function clearHoverTimeout() {
		if (hoverTimeout) {
			clearTimeout(hoverTimeout);
			hoverTimeout = null;
		}
	}

	// If the indicator unmounts within the 150ms hover debounce, clear the pending
	// timeout so it doesn't fire post-unmount and write to dead state
	$effect(() => clearHoverTimeout);

	function handleMouseEnter() {
		if (!showExpandedTooltip) {
			showBadgeExpansion = true;
		}

		if (tooltipBlocked || showExpandedTooltip) return;

		clearHoverTimeout();

		hoverTimeout = setTimeout(() => {
			if (!showExpandedTooltip) {
				showPreviewTooltip = true;
			}
		}, 150);
	}

	function handleMouseLeave() {
		clearHoverTimeout();

		requestAnimationFrame(() => {
			if (!isTooltipHovered) {
				showPreviewTooltip = false;
				showBadgeExpansion = false;
			}
		});
	}

	function handleTooltipMouseEnter() {
		isTooltipHovered = true;
	}

	function handleTooltipMouseLeave() {
		isTooltipHovered = false;
		showPreviewTooltip = false;
		showBadgeExpansion = false;
	}

	function handleQueue(isReprocess = false) {
		onQueue?.(sanitizedEntityId, isReprocess, systemSummary.data ?? cachedStatus);
	}

	function handleExpandedQueue(isReprocess = false, tooltipStatus: EntityStatus | null = null) {
		onQueue?.(sanitizedEntityId, isReprocess, tooltipStatus);
		showExpandedTooltip = false;
	}

	function closeExpandedTooltip() {
		showExpandedTooltip = false;
		showBadgeExpansion = false;
	}

	function handleViewOutfits() {
		openOutfitViewer(entityId, flaggedOutfits ?? []);
	}

	$effect(() => {
		if (!sanitizedEntityId) return;
		if (isRestricted && !isSelfLookup) return;
		if (systemSummary.data || systemSummary.loading || error || skipAutoFetch) return;

		void statusService.getOrFetch(sanitizedEntityId).then((result) => {
			if (result) cachedStatus = result;
		});
	});

	$effect(() => {
		reportFirstDetectionIfEligible({
			entityType,
			userId: sanitizedEntityId,
			isSelfLookup,
			flagType: (systemSummary.data ?? cachedStatus)?.flagType
		});
	});

	$effect(() => {
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				if (showExpandedTooltip) {
					showExpandedTooltip = false;
				} else if (showPreviewTooltip) {
					showPreviewTooltip = false;
				}
			}
		};

		if (showPreviewTooltip || showExpandedTooltip) {
			document.addEventListener('keydown', handleEscape);
			return () => {
				document.removeEventListener('keydown', handleEscape);
			};
		}
		return () => {};
	});
</script>

<button
	bind:this={container}
	class="status-container"
	class:badge-expanded={showBadgeExpansion}
	aria-label={$_('status_indicator_aria_label', {
		values: {
			0: statusConfig.categoryLabel
				? `${statusConfig.textContent}, ${statusConfig.categoryLabel}`
				: statusConfig.textContent
		}
	})}
	data-status-flag={systemSummary.data?.flagType}
	data-user-id={sanitizedEntityId}
	onclick={handleClick}
	onkeydown={handleKeydown}
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
	title={undefined}
	type="button"
>
	<span
		class="status-icon-wrapper"
		class:animate-spin-loading={statusConfig.iconName === 'loading'}
	>
		<StatusIcon
			name={statusConfig.iconName}
			class="status-icon-base"
			color={statusConfig.iconColor}
		/>
	</span>

	<span class="rotector-badge-container">
		{#if !isGroup && statusConfig.isReportable}
			<span class="reportable-badge {badgeStackClasses['reportable']}">
				<Flag size={10} strokeWidth={2.5} />
			</span>
		{/if}

		{#if statusConfig.isQueued}
			<span class="queue-badge {badgeStackClasses['queue']}">
				<Hourglass size={8} strokeWidth={2.5} />
			</span>
		{/if}

		{#if customApiFlagCount > 0}
			<span class="integration-badge {badgeStackClasses['integration']}">
				{customApiFlagCount}
			</span>
		{/if}

		{#if membershipBadge && membershipIconKey}
			<span class="membership-stack-badge tier-{membershipTier} {badgeStackClasses['membership']}">
				<MembershipIcon iconKey={membershipIconKey} size={10} />
			</span>
		{/if}
	</span>

	{#if showText}
		<span class={statusConfig.textClass}>
			<CanvasText text={statusConfig.textContent} />
			{#if statusConfig.categoryLabel}
				<span class="status-text-category">
					<CanvasText text="·" />
				</span>
				<span class="status-text-category">
					<CanvasText text={statusConfig.categoryLabel} />
				</span>
			{/if}
		</span>
	{/if}
</button>

{#if showPreviewTooltip && container}
	<OverlayPortal>
		<Tooltip
			anchorElement={container}
			{entityType}
			{error}
			mode="preview"
			onClose={() => (showPreviewTooltip = false)}
			onExpand={() => {
				showPreviewTooltip = false;
				showExpandedTooltip = true;
			}}
			onMouseEnter={handleTooltipMouseEnter}
			onMouseLeave={handleTooltipMouseLeave}
			onQueue={handleQueue}
			{onStatusUpdate}
			onViewOutfits={isGroup ? undefined : handleViewOutfits}
			{userAvatarUrl}
			{userDisplayName}
			userId={entityId}
			userStatus={entityStatus}
			{userUsername}
		/>
	</OverlayPortal>
{/if}

{#if showExpandedTooltip && container}
	<OverlayPortal>
		<Tooltip
			anchorElement={container}
			{entityType}
			{error}
			mode="expanded"
			onClose={closeExpandedTooltip}
			onQueue={handleExpandedQueue}
			{onStatusUpdate}
			onViewOutfits={isGroup ? undefined : handleViewOutfits}
			{userAvatarUrl}
			{userDisplayName}
			userId={entityId}
			userStatus={entityStatus}
			{userUsername}
		/>
	</OverlayPortal>
{/if}
