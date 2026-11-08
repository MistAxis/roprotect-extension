<script lang="ts">
	import type { Snippet } from 'svelte';
	import { sanitizeExternalHref } from '@/lib/utils/dom/sanitizer';

	interface Props {
		href: string;
		class?: string;
		title?: string;
		'aria-label'?: string;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let {
		href,
		class: className,
		title,
		'aria-label': ariaLabel,
		onclick,
		children
	}: Props = $props();

	// `href` can originate from a server response in some call sites; never let a
	// non-http(s) scheme reach the DOM as a clickable link.
	const safeHref = $derived(sanitizeExternalHref(href) ?? undefined);
</script>

<a
	class={className}
	aria-disabled={safeHref ? undefined : 'true'}
	aria-label={ariaLabel}
	href={safeHref}
	{onclick}
	rel="noopener noreferrer"
	target="_blank"
	{title}
>
	{@render children()}
</a>
