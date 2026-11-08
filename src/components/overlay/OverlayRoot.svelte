<script lang="ts">
	import { get } from 'svelte/store';
	import ChangelogModal from '@/components/changelog/ChangelogModal.svelte';
	import OnboardingManager from '@/components/onboarding/OnboardingManager.svelte';
	import ApiKeyEntryModal from '@/components/legal/ApiKeyEntryModal.svelte';
	import OutfitViewerModal from '@/components/features/outfit/OutfitViewerModal.svelte';
	import FirstDetectionModal from '@/components/features/profile/FirstDetectionModal.svelte';
	import RestrictionNoticeModal from '@/components/features/report/RestrictionNoticeModal.svelte';
	import ReviewPromptModal from '@/components/features/review-prompt/ReviewPromptModal.svelte';
	import Toast from '@/components/ui/Toast.svelte';
	import { shouldShowChangelogModal } from '@/lib/stores/changelog';
	import { shouldShowApiKeyModal } from '@/lib/stores/legal';
	import { shouldShowOnboarding } from '@/lib/stores/onboarding';
	import { shouldShowFirstDetection } from '@/lib/stores/first-detection';
	import { shouldShowRestrictionNotice } from '@/lib/stores/restricted-access';
	import { loadReviewPromptState, shouldShowReviewPrompt } from '@/lib/stores/review-prompt';

	import { closeOutfitViewer, outfitViewerRequest } from '@/lib/stores/outfit-viewer';
	import { logger } from '@/lib/utils/logging/logger';
	import { getStorage, removeStorage } from '@/lib/utils/storage';

	const showChangelog = get(shouldShowChangelogModal);

	async function checkPopupRequests() {
		const [replayRequested, legalRequested] = await Promise.all([
			getStorage<boolean>('local', 'onboardingReplayRequested', false),
			getStorage<boolean>('local', 'legalReviewRequested', false)
		]);
		const toRemove: string[] = [];
		if (replayRequested) {
			toRemove.push('onboardingReplayRequested');
			logger.debug('Onboarding replay triggered from popup');
		}
		if (legalRequested) {
			toRemove.push('legalReviewRequested');
			logger.debug('Legal review triggered from popup');
		}
		if (toRemove.length > 0) await removeStorage('local', toRemove);
	}

	void checkPopupRequests();
	void loadReviewPromptState();
</script>

{#if $shouldShowOnboarding}
	<OnboardingManager />
{:else if $shouldShowApiKeyModal}
	<ApiKeyEntryModal
		onClose={() => logger.debug('API key modal closed')}
		onSuccess={() => logger.debug('API key validated successfully')}
	/>
{/if}

{#if showChangelog}
	<ChangelogModal onClose={() => logger.debug('Changelog modal closed')} />
{/if}

{#if $shouldShowRestrictionNotice}
	<RestrictionNoticeModal />
{/if}

{#if $shouldShowFirstDetection}
	<FirstDetectionModal />
{/if}

{#if $shouldShowReviewPrompt}
	<ReviewPromptModal />
{/if}

{#if $outfitViewerRequest}
	<OutfitViewerModal
		flaggedOutfits={$outfitViewerRequest.flaggedOutfits}
		onClose={closeOutfitViewer}
		userId={$outfitViewerRequest.userId}
	/>
{/if}

<Toast />
