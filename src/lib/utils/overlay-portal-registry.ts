// Module-level singleton holding the shadow root container element. Registered
// once during content-script init by createShadowRootUi and read by OverlayPortal
// when teleporting modal/tooltip DOM into the shadow root.
let overlayContainer: HTMLElement | null = null;

export function registerOverlayContainer(container: HTMLElement): void {
	overlayContainer = container;
}

// Clears the registration when the shadow root is torn down (navigation to an
// unsupported page, gate close, tab teardown). Without it, a late-mounting
// portal appends into a detached tree and disappears.
export function unregisterOverlayContainer(container?: HTMLElement): void {
	if (container && overlayContainer !== container) return;
	overlayContainer = null;
}

export function getOverlayContainer(): HTMLElement | null {
	return overlayContainer;
}
