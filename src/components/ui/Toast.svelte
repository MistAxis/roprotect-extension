<script lang="ts">
	import { toast, dismissToast } from '@/lib/stores/toast';
	import { CircleCheckBig, CircleX, Info, TriangleAlert, X } from '@lucide/svelte';

	const icons = { success: CircleCheckBig, error: CircleX, warning: TriangleAlert, info: Info };

	let isExiting = $state(false);
	let exitTimer: ReturnType<typeof setTimeout> | null = null;
	const toastKey = $derived($toast ? `${$toast.type}:${$toast.message}` : null);

	// A new toast must cancel any in-flight exit so it does not inherit the fade
	// or get dismissed by the previous toast's timer.
	$effect(() => {
		void toastKey;
		isExiting = false;
		if (exitTimer) {
			clearTimeout(exitTimer);
			exitTimer = null;
		}
		return () => {
			if (exitTimer) {
				clearTimeout(exitTimer);
				exitTimer = null;
			}
		};
	});

	function handleDismiss(): void {
		const dismissedKey = toastKey;
		isExiting = true;
		exitTimer = setTimeout(() => {
			exitTimer = null;
			if (toastKey === dismissedKey) dismissToast();
			isExiting = false;
		}, 200);
	}
</script>

{#if $toast}
	{@const Icon = icons[$toast.type]}
	<div
		class="toast-container"
		class:toast-error={$toast.type === 'error'}
		class:toast-exiting={isExiting}
		class:toast-info={$toast.type === 'info'}
		class:toast-success={$toast.type === 'success'}
		class:toast-warning={$toast.type === 'warning'}
		aria-live="polite"
		role="alert"
	>
		<div class="toast-icon">
			<Icon size={18} strokeWidth={2.5} />
		</div>
		<span class="toast-message">{$toast.message}</span>
		<button class="toast-dismiss" aria-label="Dismiss" onclick={handleDismiss} type="button">
			<X size={14} strokeWidth={2} />
		</button>

		{#if $toast.type === 'success' || $toast.type === 'info'}
			<div class="toast-progress"></div>
		{/if}
	</div>
{/if}
