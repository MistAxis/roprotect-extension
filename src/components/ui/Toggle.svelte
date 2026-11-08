<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';

	interface Props {
		checked: boolean;
		disabled?: boolean;
		loading?: boolean;
		onchange: (checked: boolean) => void;
	}

	let { checked, disabled = false, loading = false, onchange }: Props = $props();

	function handleChange(event: Event) {
		if (!(event.target instanceof HTMLInputElement)) {
			return;
		}
		const input = event.target;
		const next = input.checked;
		// Keep the native control in sync with the prop. If the parent rejects the
		// change the prop never updates, which would otherwise leave the hidden
		// checkbox flipped and make the next click report the wrong value.
		input.checked = checked;
		onchange(next);
	}
</script>

<label class="toggle-container" class:loading aria-busy={loading}>
	<input
		class="peer size-0 opacity-0 focus:outline-none"
		aria-checked={checked}
		{checked}
		disabled={disabled || loading}
		onchange={handleChange}
		role="switch"
		type="checkbox"
	/>
	<span class="toggle-switch" class:checked class:disabled class:loading>
		<span class="toggle-handle" class:checked class:disabled class:loading>
			{#if loading}
				<LoaderCircle class="toggle-spinner" size={10} />
			{/if}
		</span>
	</span>
</label>
