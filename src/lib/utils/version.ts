// Compare semantic version strings and return negative/zero/positive like Array#sort.
// Pre-release suffixes (`1.2.3-beta`) are ordered before the matching release and
// never produce NaN, which sorts as 0 and hides unread changelog entries.
export function compareVersions(a: string, b: string): number {
	const pa = parseVersion(a);
	const pb = parseVersion(b);

	for (let i = 0; i < Math.max(pa.numbers.length, pb.numbers.length); i++) {
		const na = pa.numbers[i] ?? 0;
		const nb = pb.numbers[i] ?? 0;
		if (na !== nb) return na - nb;
	}

	if (pa.prerelease === pb.prerelease) return 0;
	if (!pa.prerelease) return 1;
	if (!pb.prerelease) return -1;
	return pa.prerelease.localeCompare(pb.prerelease);
}

function parseVersion(version: string): { numbers: number[]; prerelease: string } {
	const [core = '', prerelease = ''] = version.split('-', 2);
	const numbers = core.split('.').map((part) => {
		const parsed = Number.parseInt(part, 10);
		return Number.isFinite(parsed) ? parsed : 0;
	});
	return { numbers, prerelease };
}
