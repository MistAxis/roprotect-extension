export function chunkArray<T>(array: T[], size: number): T[][] {
	if (!Number.isFinite(size) || size <= 0) return [];
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}
