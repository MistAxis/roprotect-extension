<script lang="ts">
	import type { UserStatus } from '@/lib/types/api';
	import type { CombinedStatus } from '@/lib/types/custom-api';
	import type { UserPresence } from '@/lib/schemas/roblox-api';
	import type { UserInfo } from '@/lib/services/roblox/users';
	import { COMPONENT_CLASSES, ENTITY_TYPES, PAGE_TYPES } from '@/lib/types/constants';
	import {
		markUserElementForBlur,
		resetElementBlur,
		revealUserElement
	} from '@/lib/services/blur/service';
	import { updateFriendScanStatus } from '@/lib/stores/friends-scan';
	import StatusIndicator from '../../status/StatusIndicator.svelte';

	interface Props {
		userId: string;
		info: UserInfo | null;
		status?: CombinedStatus<UserStatus> | null;
		presence?: UserPresence | null;
	}

	let { userId, info, status = null, presence = null }: Props = $props();

	const profileUrl = $derived(`/users/${userId}/profile`);

	const PRESENCE_CLASSES: Record<number, string> = {
		0: 'offline',
		1: 'online',
		2: 'game',
		3: 'studio'
	};

	let card = $state<HTMLLIElement | null>(null);

	const displayName = $derived(info?.displayName || info?.username || `User ${userId}`);
	const username = $derived(info?.username || userId);
	const presenceClass = $derived(
		presence ? (PRESENCE_CLASSES[presence.userPresenceType] ?? 'offline') : 'offline'
	);

	// The native friends list applies blur here too, so a filtered card should
	// behave exactly like the card Roblox would have rendered for this friend.
	$effect(() => {
		if (!card) return;
		resetElementBlur(card);
		markUserElementForBlur(card, userId, PAGE_TYPES.FRIENDS_LIST);
		if (status) revealUserElement(card, status);
	});

	function handleStatusUpdate(next: UserStatus): void {
		updateFriendScanStatus(userId, next);
	}
</script>

<li bind:this={card} class="avatar-card list-item">
	<div class="avatar-card-container">
		<div class="avatar-card-content">
			<div
				style:position="relative"
				class="avatar avatar-card-fullbody"
				data-testid="avatar-card-container"
			>
				<a class="avatar-card-link" data-testid="avatar-card-link" href={profileUrl}>
					<span style:float="left" class="thumbnail-2d-container avatar-card-image overflow-hidden">
						{#if info?.thumbnailUrl}
							<img style:width="100%" style:height="100%" alt="" src={info.thumbnailUrl} />
						{/if}
					</span>
				</a>
				<div class="avatar-status">
					<span class={`icon-${presenceClass}`}></span>
				</div>
				<div
					class={`${COMPONENT_CLASSES.STATUS_CONTAINER} ${COMPONENT_CLASSES.STATUS_POSITIONED_ABSOLUTE}`}
				>
					<StatusIndicator
						entityId={userId}
						entityStatus={status}
						entityType={ENTITY_TYPES.USER}
						onStatusUpdate={handleStatusUpdate}
						showText={false}
						skipAutoFetch={true}
						userAvatarUrl={info?.thumbnailUrl ?? undefined}
						userDisplayName={displayName}
						userUsername={username}
					/>
				</div>
			</div>
			<div class="avatar-card-caption">
				<span>
					<div class="avatar-name-container">
						<a class="text-overflow avatar-name" href={profileUrl}>{displayName}</a>
					</div>
					<div class="avatar-card-label">@{username}</div>
				</span>
			</div>
		</div>
	</div>
</li>
