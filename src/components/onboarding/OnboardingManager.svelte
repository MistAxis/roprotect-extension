<script lang="ts">
	import {
		completeOnboarding,
		dismissOnboarding,
		isOnboardingReplay
	} from '@/lib/stores/onboarding';
	import { applyAgePreset } from '@/lib/stores/settings';
	import { AGE_PRESETS } from '@/lib/types/settings';
	import WelcomeModal from './WelcomeModal.svelte';
	import LanguageModal from './LanguageModal.svelte';
	import PresetModal from './PresetModal.svelte';
	import GuideModal from './GuideModal.svelte';
	import FinishModal from './FinishModal.svelte';

	type OnboardingStep = 'welcome' | 'language' | 'preset' | 'guide' | 'finish';

	let currentStep = $state<OnboardingStep>(isOnboardingReplay() ? 'guide' : 'welcome');

	// Explicit "skip setup" from the welcome step: complete onboarding with the
	// adult preset, which is the current default configuration.
	async function handleSkip() {
		await applyAgePreset(AGE_PRESETS.ADULT);
		await completeOnboarding();
	}

	// Closing a later step (X/Escape/backdrop) is a dismissal, not a choice:
	// completing must not rewrite blur/cipher preferences the user already has
	// (a replay always starts at the guide step).
	async function handleDismiss() {
		await completeOnboarding();
	}
</script>

{#if currentStep === 'welcome'}
	<WelcomeModal
		onContinue={() => (currentStep = 'language')}
		onDismiss={dismissOnboarding}
		onSkip={handleSkip}
	/>
{:else if currentStep === 'language'}
	<LanguageModal onContinue={() => (currentStep = 'preset')} onDismiss={handleDismiss} />
{:else if currentStep === 'preset'}
	<PresetModal onContinue={() => (currentStep = 'guide')} onDismiss={handleDismiss} />
{:else if currentStep === 'guide'}
	<GuideModal onDismiss={handleDismiss} onFinish={() => (currentStep = 'finish')} />
{:else if currentStep === 'finish'}
	<FinishModal onFinish={completeOnboarding} />
{/if}
