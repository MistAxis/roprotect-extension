import { logger } from '@/lib/utils/logging/logger';
import { startTrace } from '@/lib/utils/logging/perf-tracer';
import { TRACE_CATEGORIES } from '@/lib/types/performance';
import { metricsCollector } from '@/lib/utils/logging/metrics-collector';
import { sanitizeEntityId, sanitizeUrl } from '@/lib/utils/dom/sanitizer';
import { detectPageType, stripHash } from '@/lib/utils/dom/page-detection';
import { COMPONENT_CLASSES, PAGE_TYPES } from '@/lib/types/constants';
import { SETTINGS_KEYS } from '@/lib/types/settings';
import type { PageType } from '@/lib/types/api';
import type { PageController } from './PageController';
import { SimplePageController } from './SimplePageController';
import { ProfilePageController } from './ProfilePageController';
import { GroupsPageController } from './GroupsPageController';
import { ReportPageController } from './ReportPageController';
import HomePageManager from '@/components/features/home/HomePageManager.svelte';
import FriendsPageManager from '@/components/features/friends/FriendsPageManager.svelte';
import SearchPageManager from '@/components/features/search/SearchPageManager.svelte';
import GroupConfigurePageManager from '@/components/features/groups/GroupConfigurePageManager.svelte';

export class PageControllerManager {
	private currentController: PageController | null = null;
	private readonly controllers = new Map<
		PageType,
		(pageType: PageType, url: string) => PageController
	>();
	private currentUrl: string | null = null;
	private navigationRunning = false;
	private pendingNavigation: string | null = null;
	private generation = 0;

	constructor() {
		this.controllers.set(
			PAGE_TYPES.HOME,
			(pt, url) =>
				new SimplePageController(pt, url, {
					settingsKey: SETTINGS_KEYS.HOME_CHECK_ENABLED,
					component: HomePageManager,
					containerClass: COMPONENT_CLASSES.HOME_CAROUSEL_MANAGER,
					getProps: () => ({})
				})
		);
		this.controllers.set(
			PAGE_TYPES.FRIENDS_LIST,
			(pt, url) =>
				new SimplePageController(pt, url, {
					settingsKey: SETTINGS_KEYS.FRIENDS_CHECK_ENABLED,
					component: FriendsPageManager,
					containerClass: COMPONENT_CLASSES.FRIENDS_MANAGER,
					getProps: () => ({})
				})
		);
		this.controllers.set(
			PAGE_TYPES.FRIENDS_CAROUSEL,
			(pt, url) =>
				new SimplePageController(pt, url, {
					settingsKey: SETTINGS_KEYS.FRIENDS_CHECK_ENABLED,
					component: FriendsPageManager,
					containerClass: COMPONENT_CLASSES.FRIENDS_MANAGER,
					getProps: () => ({})
				})
		);
		this.controllers.set(
			PAGE_TYPES.SEARCH_USER,
			(pt, url) =>
				new SimplePageController(pt, url, {
					settingsKey: SETTINGS_KEYS.SEARCH_CHECK_ENABLED,
					component: SearchPageManager,
					containerClass: COMPONENT_CLASSES.SEARCH_MANAGER,
					getProps: () => ({})
				})
		);
		this.controllers.set(
			PAGE_TYPES.GROUP_CONFIGURE_MEMBERS,
			(pt, url) =>
				new SimplePageController(pt, url, {
					settingsKey: SETTINGS_KEYS.GROUPS_CHECK_ENABLED,
					component: GroupConfigurePageManager,
					containerClass: COMPONENT_CLASSES.GROUP_CONFIGURE_MANAGER,
					getProps: () => {
						const params = new URLSearchParams(globalThis.location.search);
						const id = params.get('id');
						return { groupId: id ? (sanitizeEntityId(id) ?? null) : null };
					}
				})
		);

		this.controllers.set(PAGE_TYPES.PROFILE, (pt, url) => new ProfilePageController(pt, url));
		this.controllers.set(PAGE_TYPES.MEMBERS, (pt, url) => new GroupsPageController(pt, url));
		this.controllers.set(PAGE_TYPES.REPORT, (pt, url) => new ReportPageController(pt, url));
	}

	async handleNavigation(url: string): Promise<void> {
		// Keep only the latest URL. A slow activation must never finish after a
		// newer navigation and mount a controller for the stale page.
		this.pendingNavigation = url;
		if (this.navigationRunning) return;

		this.navigationRunning = true;
		try {
			while (this.pendingNavigation !== null) {
				const nextUrl = this.pendingNavigation;
				this.pendingNavigation = null;
				await this.navigate(nextUrl, this.generation);
			}
		} finally {
			this.navigationRunning = false;
		}
	}

	// Tears the active controller down without starting another navigation.
	// Used when the content-script feature gate closes. Bumping the generation
	// invalidates an in-flight navigation so it cannot mount afterwards.
	async deactivate(): Promise<void> {
		this.generation++;
		this.pendingNavigation = null;
		await this.cleanupCurrentController();
	}

	private async navigate(url: string, generation: number): Promise<void> {
		const endTrace = startTrace(TRACE_CATEGORIES.CONTROLLER, 'handleNavigation', { url });
		try {
			const sanitizedUrl = sanitizeUrl(url);
			if (!sanitizedUrl) {
				logger.warn('Invalid URL provided to handleNavigation');
				return;
			}
			if (generation !== this.generation) return;

			const pageType = detectPageType(sanitizedUrl);

			await (pageType && this.controllers.has(pageType)
				? this.switchToController(pageType, sanitizedUrl, generation)
				: this.cleanupCurrentController());
		} catch (error) {
			logger.error('Failed to handle navigation:', error, { url });
		} finally {
			endTrace();
			metricsCollector.takeSnapshot('navigation');
		}
	}

	private async switchToController(
		pageType: PageType,
		url: string,
		generation: number
	): Promise<void> {
		const endTrace = startTrace(TRACE_CATEGORIES.CONTROLLER, 'switchToController', { pageType });
		try {
			if (generation !== this.generation) return;

			if (
				this.currentController &&
				(this.currentController.pageType !== pageType ||
					stripHash(this.currentUrl ?? '') !== stripHash(url))
			) {
				await this.cleanupCurrentController();
			}
			if (generation !== this.generation) return;

			if (!this.currentController) {
				const factory = this.controllers.get(pageType);
				if (!factory) {
					logger.error(`No controller factory found for page type: ${pageType}`);
					return;
				}

				this.currentController = factory(pageType, url);
				this.currentUrl = url;
			}

			await this.currentController.initialize();

			// Deactivated while initialize() was running: remove what it mounted.
			if (generation !== this.generation) await this.cleanupCurrentController();
		} catch (error) {
			logger.error(`Failed to switch to controller for ${pageType}:`, error);
			await this.cleanupCurrentController();
		} finally {
			endTrace();
		}
	}

	private async cleanupCurrentController(): Promise<void> {
		// Capture the instance: a cleanup can be in flight while a newer
		// navigation mounts its controller, and the late `finally` must not clear
		// (and then leak) that newer controller.
		const controller = this.currentController;
		if (!controller) return;

		try {
			await controller.cleanup();
			logger.debug(`Cleaned up controller for ${controller.pageType}`);
		} catch (error) {
			logger.error('Failed to cleanup current controller:', error);
		} finally {
			if (this.currentController === controller) {
				this.currentController = null;
				this.currentUrl = null;
			}
		}
	}
}
