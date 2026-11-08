<script lang="ts">
	import HelpIndicator from './HelpIndicator.svelte';

	interface Props {
		label: string;
		value: number;
		min?: number | undefined;
		max?: number | undefined;
		step?: number | undefined;
		helpText?: string | undefined;
		onChange: (value: number) => void;
	}

	let {
		label,
		value = $bindable(),
		min = 1,
		max = 100,
		step = 1,
		helpText,
		onChange
	}: Props = $props();

	function handleInput(event: Event) {
		if (!(event.target instanceof HTMLInputElement)) return;
		const raw = event.target.value.trim();
		if (raw === '') return;
		const parsed = Number.parseInt(raw, 10);
		if (Number.isNaN(parsed)) return;
		// Let the user type through out-of-range intermediates ("1" before "12");
		// the value is clamped and committed on blur.
		if (parsed < min || parsed > max) return;
		value = parsed;
		onChange(parsed);
	}

	function handleBlur(event: FocusEvent) {
		if (!(event.target instanceof HTMLInputElement)) return;
		const input = event.target;
		const parsed = Number.parseInt(input.value, 10);
		const next = Math.max(min, Math.min(max, Number.isNaN(parsed) ? value : parsed));
		if (next !== value) {
			value = next;
			onChange(next);
		}
		input.value = String(next);
	}
</script>

<div class="number-input-container">
	<div class="number-input-label">
		<span>{label}</span>
		{#if helpText}
			<HelpIndicator text={helpText} />
		{/if}
	</div>
	<div class="number-input-wrapper">
		<input
			class="number-input"
			aria-label={label}
			{max}
			{min}
			onblur={handleBlur}
			oninput={handleInput}
			{step}
			type="number"
			{value}
		/>
		<span class="number-input-range">({min}-{max})</span>
	</div>
</div>
