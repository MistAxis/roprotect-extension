// Filenames can come from an inbound message or a server header and end up as a
// multipart filename or a download name. Strip path separators, control
// characters, and quotes so they cannot traverse directories or break framing.
export function sanitizeFilename(input: string, fallback: string): string {
	const cleaned = input
		.replaceAll(/[/\\]/g, '_')
		// oxlint-disable-next-line no-control-regex -- stripping control characters is the point
		.replaceAll(/[\u0000-\u001F\u007F"]/g, '')
		.trim()
		.slice(0, 128);
	return cleaned || fallback;
}
