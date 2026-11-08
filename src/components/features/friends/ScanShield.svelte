<script lang="ts">
	interface Props {
		size?: number;
	}

	let { size = 20 }: Props = $props();

	// Lucide's shield silhouette, rendered solid white so the icon reads as a
	// plain shield instead of a colour-coded fill chart.
	const SHIELD_PATH =
		'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';
</script>

<svg
	class="rotector-friends-scan-shield"
	aria-hidden="true"
	height={size}
	viewBox="0 0 24 24"
	width={size}
	xmlns="http://www.w3.org/2000/svg"
>
	<path d={SHIELD_PATH} fill="#fff" stroke="#fff" stroke-linejoin="round" stroke-width="1.6" />
</svg>

<style>
	.rotector-friends-scan-shield {
		display: block;
		flex-shrink: 0;
	}
</style>
