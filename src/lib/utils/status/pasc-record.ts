import type { CombinedStatus } from '../../types/custom-api';
import type { UserStatus } from '../../types/api';
import {
	NUMERIC_TO_PASC_FLAG,
	PASC_ACCESS_RANK,
	PASC_FLAG_LABELS,
	type PascAccessLevel,
	type PascCaseFile,
	type PascFlag,
	type PascProviderVerdict,
	type PascRecord,
	type PascReferral
} from '../../data/pasc';
import { PASC_MISSING_BADGE, pickHighestSeveritySystemResult } from './status-utils';
import { STATUS } from '../../types/constants';

// Maps a real system-pasc lookup result onto the PASC tab view model.
// Three outcomes (mirroring the proxy contract):
// - full record → PascRecord with accessLevel set;
// - flag-only (gated) record → PascRecord with accessLevel null (verdict row
//   renders, details do not, no level is named);
// - miss ("PASC - Not in database") → null (the tab renders the referral).

const ACCESS_BADGE = /^Access (0|A1|A2|M1|M2)$/;
const FILE_LEVEL_SUFFIX = /^(.*)\s+\[(0|A1|A2|M1|M2)\]$/;
// Proxy lookup adapter format: "<fileId> <name> [<level>]". Upstream ids are
// uuid hex (no spaces), so the match is constrained to that shape: legacy
// entries without an id fall through to fileId null (no download/delete).
const FILE_ID_PREFIX = /^([0-9a-fA-F]{32}) (.*)$/;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']);

export function pascFileKind(name: string): PascCaseFile['kind'] {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	if (ext === 'md' || ext === 'markdown') return 'markdown';
	if (IMAGE_EXTENSIONS.has(ext)) return 'image';
	return 'other';
}

function mapFile(entry: string, fallbackLevel: PascAccessLevel, index: number): PascCaseFile {
	const levelMatch = FILE_LEVEL_SUFFIX.exec(entry);
	const withoutLevel = (levelMatch?.[1] ?? entry).trim();
	const idMatch = FILE_ID_PREFIX.exec(withoutLevel);
	const fileId = idMatch?.[1] ?? null;
	const name = (idMatch?.[2] ?? withoutLevel).trim() || `file-${String(index + 1)}`;
	return {
		id: `file:${String(index)}:${name}`,
		name,
		kind: pascFileKind(name),
		accessLevel: (levelMatch?.[2] as PascAccessLevel | undefined) ?? fallbackLevel,
		sizeLabel: '',
		fileId
	};
}

const DETAIL_REASON_KEYS = ['PASC Finding', 'Internal Review', 'Case Files'] as const;

function fileAccessLevel(entry: string, fallback: PascAccessLevel): PascAccessLevel {
	return (FILE_LEVEL_SUFFIX.exec(entry)?.[2] as PascAccessLevel | undefined) ?? fallback;
}

// Defense in depth for data the proxy should already have filtered. The proxy
// enforces clearance server-side, but if it ever over-returns (or a future
// proxy change stops filtering), a lower-clearance viewer must not retain case
// details in memory or in the shared status caches. Keeps the access badge so
// the tab can still say which clearance is required.
export function sanitizePascUserStatus(data: UserStatus, viewerLevel: PascAccessLevel): UserStatus {
	const badges = data.badges ?? [];
	const access =
		badges
			.map((badge) => ACCESS_BADGE.exec(badge.text)?.[1])
			.find((level): level is PascAccessLevel => level !== undefined) ?? null;
	const viewerRank = PASC_ACCESS_RANK[viewerLevel];
	const recordHidden = access !== null && viewerRank < PASC_ACCESS_RANK[access];

	const reasons = { ...data.reasons };
	let changed = false;

	if (recordHidden) {
		for (const key of DETAIL_REASON_KEYS) {
			if (key in reasons) {
				delete reasons[key];
				changed = true;
			}
		}
	} else {
		// Internal review is M1+ regardless of the record's own level.
		if (viewerRank < PASC_ACCESS_RANK.M1 && 'Internal Review' in reasons) {
			delete reasons['Internal Review'];
			changed = true;
		}

		const caseFiles = reasons['Case Files'];
		const files = caseFiles?.evidence;
		if (caseFiles && files) {
			const fallback = access ?? '0';
			const visible = files.filter(
				(entry): entry is string =>
					typeof entry === 'string' &&
					PASC_ACCESS_RANK[fileAccessLevel(entry, fallback)] <= viewerRank
			);
			if (visible.length !== files.length) {
				reasons['Case Files'] = { ...caseFiles, evidence: visible };
				changed = true;
			}
		}
	}

	if (!changed) return data;
	const sanitized = { ...data, reasons };
	// Reviewer identity belongs to the case file; do not retain it when all
	// case details are above the viewer's clearance.
	if (recordHidden) delete sanitized.reviewer;
	return sanitized;
}

export function mapPascUserStatus(
	data: UserStatus,
	identity: { userId: string; displayName: string | undefined; username: string | undefined }
): PascRecord | null {
	const badges = data.badges ?? [];
	// Explicit proxy fields win; otherwise the miss marker is negative evidence.
	// Ambiguous records are handled by isPascRecordPresent at the call site.
	if (data.pascRecordPresent === false || data.pascMissing === true) return null;
	if (
		data.pascRecordPresent !== true &&
		data.pascMissing === undefined &&
		badges.some((badge) => badge.text === PASC_MISSING_BADGE)
	) {
		return null;
	}

	const flag = NUMERIC_TO_PASC_FLAG[data.flagType] ?? 'unknown';
	const base = {
		userId: identity.userId,
		displayName: identity.displayName || identity.username || identity.userId,
		username: identity.username || identity.displayName || identity.userId,
		flag
	};

	const access =
		badges
			.map((badge) => ACCESS_BADGE.exec(badge.text)?.[1])
			.find((level): level is PascAccessLevel => level !== undefined) ?? null;
	if (access === null) {
		return {
			...base,
			accessLevel: null,
			reviewer: '',
			updatedAt: '',
			publicNote: '',
			internalReview: '',
			internalReviewMinLevel: 'M1',
			files: [],
			providerVerdicts: []
		};
	}

	const reasons = data.reasons;
	const filesEvidence = reasons['Case Files']?.evidence ?? [];
	return {
		...base,
		accessLevel: access,
		reviewer: data.reviewer?.displayName || data.reviewer?.username || '',
		updatedAt: data.lastUpdated ? new Date(data.lastUpdated * 1000).toISOString().slice(0, 10) : '',
		publicNote: reasons['PASC Finding']?.message ?? '',
		internalReview: reasons['Internal Review']?.message ?? '',
		// Server floor: internal review is M1+ minimum to read or write.
		internalReviewMinLevel: 'M1',
		files: filesEvidence
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry, index) => mapFile(entry, access, index)),
		providerVerdicts: []
	};
}

const RELIED_UPON_ORDER = ['system-scsn', 'system-rab', 'system-tase'] as const;

const RELIED_UPON_LABELS: Record<
	(typeof RELIED_UPON_ORDER)[number],
	PascProviderVerdict['provider']
> = {
	'system-scsn': 'SIGMANET',
	'system-rab': 'RAB',
	'system-tase': 'TASE'
};

// Live provider-verdict rows for the PASC tab, from the providers PASC relies
// on. Unknown (-1) verdicts are skipped: nothing settled to show yet.
export function liveProviderVerdicts(
	combined: CombinedStatus<UserStatus> | null | undefined
): PascProviderVerdict[] {
	if (!combined) return [];
	const rows: PascProviderVerdict[] = [];
	for (const apiId of RELIED_UPON_ORDER) {
		const data = combined.get(apiId)?.data;
		if (!data) continue;
		// An unknown verdict has nothing settled to show; never render it as SAFE.
		if (data.flagType === STATUS.FLAGS.UNKNOWN) continue;
		const flag = NUMERIC_TO_PASC_FLAG[data.flagType];
		if (!flag || flag === 'unknown') continue;
		rows.push({
			provider: RELIED_UPON_LABELS[apiId],
			flag,
			detail: PASC_FLAG_LABELS[flag]
		});
	}
	return rows;
}

// Referral for users with no PASC record: the highest relied-upon provider
// verdict (most severe wins, same order the override projection uses).
export function pickLivePascReferral(
	combined: CombinedStatus<UserStatus> | null | undefined
): PascReferral | null {
	if (!combined) return null;
	const automatic = new Map(
		[...combined.entries()].filter(([id]) => (RELIED_UPON_ORDER as readonly string[]).includes(id))
	);
	const worst = pickHighestSeveritySystemResult(automatic);
	const flagType = worst?.[1].data?.flagType;
	if (worst === undefined || flagType === undefined) return null;
	const flag: PascFlag | undefined = NUMERIC_TO_PASC_FLAG[flagType];
	if (!flag) return null;
	return { provider: worst[1].apiName, flag };
}
