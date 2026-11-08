<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { FileText } from '@lucide/svelte';
	import SiDiscord from '@icons-pack/svelte-simple-icons/icons/SiDiscord';
	import SiGithub from '@icons-pack/svelte-simple-icons/icons/SiGithub';
	import ExtLink from '@/components/ui/ExtLink.svelte';
</script>

<div class="footer-container">
	<div class="footer-link-row">
		<ExtLink
			class="footer-link"
			aria-label={$_('footer_discord')}
			href="https://discord.gg/ZwJbrWHPVz"
		>
			<SiDiscord class="footer-link-icon" size={17} />
			<span class="footer-link-tooltip">{$_('footer_discord')}</span>
		</ExtLink>
		<ExtLink
			class="footer-link"
			aria-label={$_('footer_github')}
			href="https://github.com/ItsTato/roprotect-extension"
		>
			<SiGithub class="footer-link-icon" size={17} />
			<span class="footer-link-tooltip">{$_('footer_github')}</span>
		</ExtLink>
		<ExtLink
			class="footer-link"
			aria-label={$_('footer_docs')}
			href="https://roprotect.tlet.xyz/docs"
		>
			<FileText class="footer-link-icon" size={17} />
			<span class="footer-link-tooltip">{$_('footer_docs')}</span>
		</ExtLink>
	</div>
</div>
