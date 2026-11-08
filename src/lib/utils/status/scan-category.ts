import type { UserStatus } from '../../types/api';
import type { CombinedStatus, CustomApiResult } from '../../types/custom-api';
import { STATUS } from '../../types/constants';
import type { StatusIconName } from '../icon-mapping';
import {
	calculateStatusBadges,
	pickHighestSeverityCustomFlag,
	pickHighestSeveritySystemResult
} from './status-utils';

export type ScanCategory =
	| 'unsafe'
	| 'redacted'
	| 'mixed'
	| 'pending'
	| 'past'
	| 'provisional'
	| 'queued'
	| 'outfit'
	| 'integration'
	| 'unknown'
	| 'safe';

export type ScanCounts = Map<ScanCategory, number>;

// One bucket per entity, plus whether a custom API was among the sources that flagged them
interface ScanBucket {
	category: ScanCategory | null;
	fromIntegration: boolean;
}

interface ScanCategoryPresentation {
	labelKey: string;
	icon: StatusIconName;
	color: string;
}

export const SCAN_CATEGORY_PRESENTATION: Record<ScanCategory, ScanCategoryPresentation> = {
	unsafe: {
		labelKey: 'tooltip_status_unsafe',
		icon: 'unsafe',
		color: 'var(--color-status-unsafe)'
	},
	redacted: {
		labelKey: 'tooltip_status_redacted',
		icon: 'redacted',
		color: 'var(--color-status-unsafe)'
	},
	mixed: { labelKey: 'tooltip_status_mixed', icon: 'mixed', color: 'var(--color-status-mixed)' },
	pending: {
		labelKey: 'tooltip_status_under_review',
		icon: 'pending',
		color: 'var(--color-status-pending)'
	},
	past: {
		labelKey: 'tooltip_status_past_offender',
		icon: 'past-offender',
		color: 'var(--color-status-past-offender)'
	},
	provisional: {
		labelKey: 'tooltip_status_provisional',
		icon: 'provisional',
		color: 'var(--color-status-safe)'
	},
	queued: {
		labelKey: 'tooltip_status_checking',
		icon: 'checking',
		color: 'var(--color-status-queued)'
	},
	outfit: {
		labelKey: 'tooltip_status_outfit_detected',
		icon: 'outfit',
		color: 'var(--color-status-outfit)'
	},
	integration: {
		labelKey: 'tooltip_status_integration',
		icon: 'integration',
		color: 'var(--color-status-integration)'
	},
	unknown: {
		labelKey: 'tooltip_status_update_required',
		icon: 'unknown',
		color: 'var(--color-status-pending)'
	},
	safe: {
		labelKey: 'tooltip_status_safe',
		icon: 'safe',
		color: 'var(--color-status-safe)'
	}
};

const SCAN_CATEGORY_ORDER = Object.keys(SCAN_CATEGORY_PRESENTATION) as ScanCategory[];

// 'integration' overlaps the severity buckets (a friend can be both Unsafe and an
// integration detection), so it is reported on its own chip and kept out of the totals that
// drive the bar segments
export const SCAN_SEVERITY_ORDER = SCAN_CATEGORY_ORDER.filter((key) => key !== 'integration');

export function flagToCategory(flagType: number): ScanCategory {
	switch (flagType) {
		case STATUS.FLAGS.PENDING: {
			return 'pending';
		}
		case STATUS.FLAGS.UNSAFE: {
			return 'unsafe';
		}
		case STATUS.FLAGS.REDACTED: {
			return 'redacted';
		}
		case STATUS.FLAGS.MIXED: {
			return 'mixed';
		}
		case STATUS.FLAGS.PAST_OFFENDER: {
			return 'past';
		}
		case STATUS.FLAGS.PROVISIONAL: {
			return 'provisional';
		}
		case STATUS.FLAGS.QUEUED: {
			return 'queued';
		}
		case STATUS.FLAGS.SAFE: {
			return 'safe';
		}
		default: {
			return 'unknown';
		}
	}
}

// The system provider whose verdict represents the entity: the most severe one across
// SIGMANET/RAB/TASE, so a clean service cannot mask a detection from a sibling one.
function getSystemApiResult(
	combined: CombinedStatus<UserStatus>
): Pick<CustomApiResult<UserStatus>, 'data' | 'error' | 'loading'> | null {
	const worst = pickHighestSeveritySystemResult(combined);
	if (!worst) return null;
	const result = worst[1];
	return { data: result.data, error: result.error, loading: result.loading };
}

// Picks one bucket per entity, applying outfit/queued overrides. Custom APIs are bucketed by
// the severity they actually reported instead of a single catch-all, but a non-flagged system
// API verdict never masks a partner's detection.
export function combinedResultToCategory(combined: CombinedStatus<UserStatus>): ScanBucket {
	const systemResult = getSystemApiResult(combined);
	const data = systemResult?.data;
	const customFlagType = pickHighestSeverityCustomFlag(combined);
	const customCategory = customFlagType === null ? null : flagToCategory(customFlagType);
	const fromIntegration = customCategory !== null;

	// System APIs unreachable: still surface custom-API detections rather than dropping the
	// entity, which would both hide the only available signal and shrink the scan total.
	if (!data) {
		return { category: customCategory, fromIntegration };
	}

	if (calculateStatusBadges(data).isOutfitOnly && customCategory === null) {
		return { category: 'outfit', fromIntegration };
	}

	const isProcessedQueue = data.flagType === STATUS.FLAGS.QUEUED && data.processed === true;
	const category = isProcessedQueue ? 'safe' : flagToCategory(data.flagType);

	// 'safe' and 'outfit' are both non-flagged verdicts, so a partner's detection outranks
	// them and inherits the severity it reported
	if (customCategory !== null && (category === 'safe' || category === 'outfit')) {
		return { category: customCategory, fromIntegration };
	}

	return { category, fromIntegration };
}
