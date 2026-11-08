import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { logger } from './logging/logger';

// Reviewer/API-authored markdown can be arbitrarily long. Rendering a multi-MB
// document blocks the UI thread, so clip before parsing.
const MAX_MARKDOWN_LENGTH = 200_000;

// Keep sanitization conservative: markdown renders inside roblox.com's page
// (and for lower-clearance viewers), so no style/embed surfaces and no
// `target` without `noopener`.
const PURIFY_CONFIG = {
	FORBID_TAGS: [
		'style',
		'form',
		'input',
		'button',
		'select',
		'textarea',
		'iframe',
		'object',
		'embed'
	],
	FORBID_ATTR: ['style', 'srcdoc', 'formaction']
};

// Runs once when the module is first imported. Rewrites every link that opens a
// new tab so the opened document cannot reach back through `window.opener`.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.nodeName === 'A' && node.hasAttribute('target')) {
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

// Renders reviewer/authored markdown for display. Output is DOMPurify-sanitized:
// PASC content renders for lower-clearance viewers, so raw HTML must never
// reach the page. Returns an empty string on failure rather than throwing.
export async function renderMarkdown(text: string): Promise<string> {
	try {
		const clipped = text.length > MAX_MARKDOWN_LENGTH ? text.slice(0, MAX_MARKDOWN_LENGTH) : text;
		const html = await marked.parse(clipped);
		return DOMPurify.sanitize(html, PURIFY_CONFIG);
	} catch (error) {
		logger.error('Markdown render failed:', error);
		return '';
	}
}
