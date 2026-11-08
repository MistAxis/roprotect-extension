// Focus management for dialogs. Svelte action: moves focus into the dialog on
// mount, keeps Tab cycling inside it, and restores the previous focus on
// destroy. Escape is handled by the dialog itself so it can run its own
// unsaved-changes logic before closing.

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(node: HTMLElement): HTMLElement[] {
	const root = node.getRootNode();
	const active =
		root instanceof Document || root instanceof ShadowRoot
			? root.activeElement
			: document.activeElement;
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		// offsetParent is null for position:fixed controls, so use box presence.
		(element) => element.getClientRects().length > 0 || element === active
	);
}

export function trapFocus(node: HTMLElement): { destroy: () => void } {
	// Dialogs are portaled into the content-script shadow root, where
	// document.activeElement is the shadow host rather than the focused control.
	function activeElement(): Element | null {
		const root = node.getRootNode();
		return root instanceof ShadowRoot || root instanceof Document
			? (root.activeElement ?? document.activeElement)
			: document.activeElement;
	}

	const previouslyFocused = activeElement();

	const focusFirst = (): void => {
		const first = focusableElements(node)[0];
		if (first) {
			first.focus();
		} else {
			node.focus();
		}
	};

	const handleKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Tab') return;

		const focusable = focusableElements(node);
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}

		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) return;

		const active = activeElement();
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	};

	node.addEventListener('keydown', handleKeydown);
	// Defer so an ancestor that also focuses on mount cannot steal it back.
	queueMicrotask(focusFirst);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
			if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
				previouslyFocused.focus();
			}
		}
	};
}
