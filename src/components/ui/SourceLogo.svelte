<script lang="ts">
	import { getAssetUrl } from '@/lib/utils/assets';
	import { themeManager } from '@/lib/utils/theme';

	interface Props {
		source: 'rotector' | 'rab' | 'tase' | 'okappiki';
		class?: string;
	}

	let { source, class: className }: Props = $props();

	const LOGOS = {
		rotector: {
			light: getAssetUrl('/assets/sources/rotector-light.webp'),
			dark: getAssetUrl('/assets/sources/rotector-dark.webp')
		},
		rab: {
			light: getAssetUrl('/assets/sources/rab-light.webp'),
			dark: getAssetUrl('/assets/sources/rab-dark.webp')
		},
		tase: {
			light: getAssetUrl('/assets/sources/tase-light.webp'),
			dark: getAssetUrl('/assets/sources/tase-dark.webp')
		},
		okappiki: {
			light: getAssetUrl('/assets/sources/okappiki-light.webp'),
			dark: getAssetUrl('/assets/sources/okappiki-dark.webp')
		}
	} as const;

	const NAMES = {
		rotector: 'RoProtect',
		rab: 'RAB',
		tase: 'TASE',
		okappiki: 'Okappiki'
	} as const;

	const effectiveTheme = themeManager.effectiveTheme;
	const logoUrl = $derived($effectiveTheme === 'dark' ? LOGOS[source].dark : LOGOS[source].light);
</script>

<img class={className} alt={NAMES[source]} src={logoUrl} />
