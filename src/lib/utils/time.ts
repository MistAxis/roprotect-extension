import { get } from 'svelte/store';
import { locale } from 'svelte-i18n';

// The Intl locale for user-facing dates/times. Follows the extension's selected
// locale (svelte-i18n) instead of the Roblox page or the browser UI language,
// and falls back to the runtime default when i18n has not initialised yet.
function intlLocale(): string | undefined {
	try {
		return get(locale) ?? undefined;
	} catch {
		return undefined;
	}
}

// Timestamp is seconds, returns whole calendar days using local-midnight boundaries
export function getDaysSinceTimestamp(timestamp: number): number {
	if (!timestamp) return 0;

	const date = new Date(timestamp * 1000);
	if (Number.isNaN(date.getTime())) return 0;

	const now = new Date();

	// Compare the calendar dates through UTC. Subtracting local midnights and
	// dividing by 24h undercounts by one on DST transition days.
	const dateOnly = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const nowOnly = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

	return Math.max(0, Math.round((nowOnly - dateOnly) / (1000 * 60 * 60 * 24)));
}

// Input is in seconds
export function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp * 1000);
	if (Number.isNaN(date.getTime())) return 'unknown time';

	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	// `narrow` keeps English at the existing "3d ago"/"5m ago" length while
	// rendering a proper localized phrase for other locales.
	const relative = new Intl.RelativeTimeFormat(intlLocale(), {
		numeric: 'auto',
		style: 'narrow'
	});

	if (diffMs < 60_000) return relative.format(0, 'second');

	const diffMinutes = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMinutes < 60) return relative.format(-diffMinutes, 'minute');
	if (diffHours < 24) return relative.format(-diffHours, 'hour');
	if (diffDays < 7) return relative.format(-diffDays, 'day');
	return formatShortDate(timestamp) ?? 'unknown time';
}

// Both timestamps in seconds
export function getProcessingDuration(queuedAt: number, processedAt: number): string {
	if (!queuedAt || !processedAt || processedAt <= queuedAt) return '';

	const durationSeconds = processedAt - queuedAt;
	const durationMinutes = Math.floor(durationSeconds / 60);
	const durationHours = Math.floor(durationMinutes / 60);

	if (durationSeconds < 60) return durationSeconds === 1 ? '1s' : `${String(durationSeconds)}s`;
	if (durationMinutes < 60) return durationMinutes === 1 ? '1m' : `${String(durationMinutes)}m`;
	const remainingMinutes = durationMinutes % 60;
	if (remainingMinutes === 0) return durationHours === 1 ? '1h' : `${String(durationHours)}h`;
	return `${String(durationHours)}h ${String(remainingMinutes)}m`;
}

// Timestamp is seconds, returns short form like 5m or 2h 10m versus current time
export function getDurationSince(timestamp: number): string {
	const now = Math.floor(Date.now() / 1000);
	return getProcessingDuration(timestamp, now);
}

export function formatShortDate(timestamp: number | null): string | null {
	if (!timestamp) return null;
	const date = new Date(timestamp * 1000);
	if (Number.isNaN(date.getTime())) return null;

	const now = new Date();
	const dateYear = date.getFullYear();
	const currentYear = now.getFullYear();

	return date.toLocaleDateString(intlLocale(), {
		month: 'short',
		day: 'numeric',
		year: dateYear === currentYear ? undefined : 'numeric'
	});
}

export function formatExactTimestamp(timestamp: number): string {
	const date = new Date(timestamp * 1000);
	if (Number.isNaN(date.getTime())) return 'unknown time';

	return date.toLocaleString(intlLocale(), {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

export function formatDurationMs(ms: number): string {
	if (ms < 1) return '<1ms';
	if (ms < 1000) return `${ms.toFixed(1)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTimeOfDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(11, 19);
}
