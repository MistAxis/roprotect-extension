<script lang="ts" module>
	// Shared across every Modal instance so only the top-most dialog handles Escape.
	const modalStack: number[] = [];
	let nextModalId = 0;

	function allocateModalId(): number {
		return ++nextModalId;
	}
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import OverlayPortal from '@/components/overlay/OverlayPortal.svelte';
	import { CircleCheckBig, CircleX, Info, TriangleAlert, X } from '@lucide/svelte';

	type ModalStatus = 'info' | 'warning' | 'success' | 'error';
	type ModalSize = 'normal' | 'small' | 'wide' | 'narrow';

	interface ModalProps {
		isOpen: boolean;
		title: string;
		ariaLabel?: string;
		status?: ModalStatus;
		size?: ModalSize;
		showStatusChip?: boolean;
		showCancel?: boolean;
		showConfirm?: boolean;
		showClose?: boolean;
		closeOnOverlayClick?: boolean;
		confirmText?: string;
		cancelText?: string;
		confirmDanger?: boolean;
		confirmDisabled?: boolean;
		onClose?: () => void;
		/** Return `false` (or a rejected promise) to keep the dialog open. */
		onConfirm?: () => unknown;
		onCancel?: () => void;
		children: import('svelte').Snippet;
		actions?: import('svelte').Snippet;
		headerContent?: import('svelte').Snippet;
	}

	let {
		isOpen = $bindable(),
		title,
		ariaLabel,
		status,
		size = 'normal',
		showStatusChip = true,
		showCancel = true,
		showConfirm = true,
		showClose = true,
		closeOnOverlayClick = true,
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		confirmDanger = false,
		confirmDisabled = false,
		onClose,
		onConfirm,
		onCancel,
		children,
		actions,
		headerContent
	}: ModalProps = $props();

	const POPUP_CLASS = {
		normal: 'modal-popup',
		small: 'modal-popup-small',
		wide: 'modal-popup-wide',
		narrow: 'modal-popup-narrow'
	} as const;

	const headingId = `modal-title-${Math.random().toString(36).slice(2)}`;

	let isClosing = $state(false);
	let isConfirming = $state(false);
	let overlayElement = $state<HTMLDivElement>();
	let popupElement = $state<HTMLDivElement>();
	let closeButtonEl = $state<HTMLButtonElement>();
	let previouslyFocusedElement = $state<HTMLElement | null>(null);

	const popupClass = $derived(POPUP_CLASS[size]);
	const renderStatusChip = $derived(showStatusChip && status !== undefined);

	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	// Only the top-most mounted modal reacts to Escape, otherwise one press would
	// dismiss every stacked dialog (changelog over review prompt, etc.).
	const modalId = allocateModalId();

	async function closeModal(result?: boolean) {
		// A double click would otherwise schedule two timers and fire onConfirm twice.
		if (isClosing || isConfirming) return;

		// Run the confirm action before hiding the dialog so a validation failure or
		// a failed save can keep it open with its errors still visible.
		if (result === true && onConfirm) {
			isConfirming = true;
			let shouldClose: boolean;
			try {
				const outcome = await onConfirm();
				shouldClose = outcome !== false;
			} catch {
				shouldClose = false;
			} finally {
				isConfirming = false;
			}
			if (!shouldClose) return;
		}

		isClosing = true;
		closeTimer = setTimeout(() => {
			closeTimer = null;
			isOpen = false;
			isClosing = false;
			if (result === false) onCancel?.();
			onClose?.();
			previouslyFocusedElement?.focus();
		}, 250);
	}

	onDestroy(() => {
		if (closeTimer) clearTimeout(closeTimer);
		const index = modalStack.indexOf(modalId);
		if (index !== -1) modalStack.splice(index, 1);
	});

	function handleEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && isOpen && showClose && modalStack.at(-1) === modalId) {
			void closeModal(false);
		}
	}

	function handleOverlayClick(e: MouseEvent) {
		const target = e.composedPath()[0];
		if (target === overlayElement && showClose && closeOnOverlayClick) {
			void closeModal(false);
		}
	}

	// Focus trap restricted to popup contents
	function trapFocus(e: KeyboardEvent) {
		if (e.key !== 'Tab' || !popupElement) return;
		const focusable = [
			...popupElement.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) {
			e.preventDefault();
			popupElement.focus();
			return;
		}
		const root = popupElement.getRootNode() as Document | ShadowRoot;
		const active = root.activeElement instanceof HTMLElement ? root.activeElement : null;

		// Focus on the dialog itself (or anything outside it) must be pulled back in,
		// otherwise Tab walks into the page behind the modal.
		if (!active || !popupElement.contains(active)) {
			e.preventDefault();
			(e.shiftKey ? last : first).focus();
			return;
		}

		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		if (isOpen) {
			modalStack.push(modalId);
			// Elements portaled into the content-script shadow root make
			// document.activeElement the host, so look one level deeper.
			const active = document.activeElement;
			const innerActive = active?.shadowRoot?.activeElement ?? active;
			previouslyFocusedElement = innerActive instanceof HTMLElement ? innerActive : null;
			document.addEventListener('keydown', handleEscape);
			requestAnimationFrame(() => {
				if (overlayElement) {
					overlayElement.classList.add('visible');
				}
				if (showClose && closeButtonEl) {
					closeButtonEl.focus();
				} else if (popupElement) {
					popupElement.focus();
				}
			});
			return () => {
				document.removeEventListener('keydown', handleEscape);
				const index = modalStack.indexOf(modalId);
				if (index !== -1) modalStack.splice(index, 1);
			};
		}
		return () => {};
	});
</script>

{#if isOpen}
	<OverlayPortal>
		<!--
			Modal overlay (backdrop) is intentionally mouse-only per ARIA best practices.
			Keyboard users dismiss via Escape key or dialog buttons (focus trapped inside).
		-->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={overlayElement}
			class="modal-overlay"
			class:closing={isClosing}
			onclick={handleOverlayClick}
		>
			<div
				bind:this={popupElement}
				class={popupClass}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabel ? undefined : headingId}
				aria-modal="true"
				onkeydown={trapFocus}
				role="dialog"
				tabindex="-1"
			>
				<div class="modal-header">
					{#if headerContent}
						{@render headerContent()}
					{/if}
					{#if renderStatusChip}
						<span
							class="modal-status-chip"
							class:modal-status-chip-error={status === 'error'}
							class:modal-status-chip-info={status === 'info'}
							class:modal-status-chip-success={status === 'success'}
							class:modal-status-chip-warning={status === 'warning'}
							aria-hidden="true"
						>
							{#if status === 'warning'}
								<TriangleAlert class="modal-status-chip-icon" size={15} strokeWidth={2.25} />
							{:else if status === 'success'}
								<CircleCheckBig class="modal-status-chip-icon" size={15} strokeWidth={2.25} />
							{:else if status === 'error'}
								<CircleX class="modal-status-chip-icon" size={15} strokeWidth={2.25} />
							{:else}
								<Info class="modal-status-chip-icon" size={15} strokeWidth={2.25} />
							{/if}
						</span>
					{/if}
					<h3 id={headingId} class="modal-title">
						{title}
					</h3>
					{#if showClose}
						<button
							bind:this={closeButtonEl}
							class="modal-close"
							aria-label="Close dialog"
							onclick={() => void closeModal(false)}
							type="button"
						>
							<X aria-hidden="true" size={18} />
						</button>
					{/if}
				</div>

				<div class="modal-divider"></div>

				<div class="modal-content">
					{@render children()}
				</div>

				{#if actions ?? (showCancel || showConfirm)}
					<div class="modal-divider"></div>
					<div class="modal-actions">
						{#if actions}
							{@render actions()}
						{:else}
							{#if showCancel}
								<button
									class="modal-button-cancel"
									onclick={() => void closeModal(false)}
									type="button"
								>
									{cancelText}
								</button>
							{/if}
							{#if showConfirm}
								<button
									class={confirmDanger ? 'modal-button-danger' : 'modal-button-primary'}
									disabled={confirmDisabled || isConfirming}
									onclick={() => void closeModal(true)}
									type="button"
								>
									{confirmText}
								</button>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</OverlayPortal>
{/if}
