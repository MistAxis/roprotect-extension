// Filenames can come from an inbound message or a server header and end up as a
// multipart filename or a download name. Strip path separators, control
// characters, and quotes so they cannot traverse directories or break framing.
export function sanitizeFilename(input: string, fallback: string): string {
	const cleaned = input
		.replaceAll(/[/\\]/g, '_')
		// oxlint-disable-next-line no-control-regex -- stripping control characters is the point
		.replaceAll(/[\u0000-\u001F\u007F"]/g, '')
		.trim();
	return truncateFilename(cleaned, 128) || fallback;
}

// Truncates to a UTF-16 budget without leaving a dangling high surrogate at the
// cut point (which a lone `slice` can do inside an emoji), keeping the
// extension visible.
function truncateFilename(name: string, maxLength: number): string {
	if (name.length <= maxLength) return name;

	const dot = name.lastIndexOf('.');
	const extension = dot > 0 ? name.slice(dot) : '';
	const hasExtension = extension.length > 1 && extension.length <= 16;
	const budget = Math.max(1, maxLength - (hasExtension ? extension.length : 0));
	const base = truncateUtf16Safe(hasExtension ? name.slice(0, dot) : name, budget);
	return base + (hasExtension ? extension : '');
}

function truncateUtf16Safe(value: string, maxLength: number): string {
	const sliced = value.slice(0, maxLength);
	const lastCode = sliced.charCodeAt(sliced.length - 1);
	// A high surrogate with no following low surrogate would become U+FFFD.
	if (lastCode >= 0xd8_00 && lastCode <= 0xdb_ff) return sliced.slice(0, -1);
	return sliced;
}
