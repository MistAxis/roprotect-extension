import type { Changelog } from '@/lib/types/changelog';

export const CHANGELOGS: Changelog[] = [
	{
		id: 'v2.23.0',
		version: '2.23.0',
		date: '2026-11-07',
		title: 'Status filters for your friends page',
		summary:
			"The friends page scan now adds status chips next to Roblox's own filters. A chip only appears when at least one friend matches it, and selecting one shows those friends as normal Roblox cards instead of a separate list.",
		changes: [
			{
				type: 'added',
				description:
					'Friends page status filter chips that appear only for tags present in the scanned friends list'
			},
			{
				type: 'added',
				description:
					'Filtered friends are shown in the native Roblox card format with status indicators, blur settings, and paging'
			}
		]
	},
	{
		id: 'v2.22.0',
		version: '2.22.0',
		date: '2026-10-14',
		title: 'PASC provider: human-reviewed verdicts with override',
		summary:
			'A new PASC provider tab shows human-reviewed case files whose verdicts override the automatic providers. Case details stay gated by clearance, and reviewers can create and edit records without leaving the tooltip.',
		changes: [
			{
				type: 'added',
				description: 'PASC provider tab with human-reviewed case files and verdict override'
			},
			{
				type: 'added',
				description: 'Record creation and editing from the tooltip for M1+ reviewers'
			},
			{
				type: 'added',
				description: 'Case-file attachments with per-file visibility levels'
			},
			{
				type: 'changed',
				description: 'Scan totals and indicators follow the PASC verdict when one exists'
			}
		]
	},
	{
		id: 'v2.21.0',
		version: '2.21.0',
		date: '2026-10-01',
		title: 'Group verdicts move to SCSN, and a richer tooltip',
		summary:
			'Group verdicts now come from SCSN, the tooltip grows a TASE V2 account header with Discord avatars, and the extension icon has been refreshed.',
		changes: [
			{
				type: 'changed',
				description: 'Group verdicts are now served by SCSN instead of the first-party backend'
			},
			{
				type: 'added',
				description: 'Tooltip now shows a TASE V2 account header, including Discord avatars'
			},
			{
				type: 'changed',
				description: 'Refreshed extension icon'
			}
		]
	},
	{
		id: 'v2.20.0',
		version: '2.20.0',
		date: '2026-09-28',
		title: 'RoProtect, rebuilt on a leaner core',
		summary:
			'Rotector is now RoProtect. Statistics are rebuilt on the new usage endpoint, the queue and leaderboard are gone, and the extension is lighter overall. Custom API bundles use the new .roprotect-api extension, with the old .rotector-api name still accepted on import.',
		changes: [
			{
				type: 'changed',
				description: 'Renamed from Rotector to RoProtect across the interface and branding'
			},
			{
				type: 'changed',
				description:
					'Rebuilt statistics on the /v1/usage endpoint for faster, more accurate reporting'
			},
			{
				type: 'removed',
				description: 'Removed the queue view and the submitters leaderboard'
			},
			{
				type: 'removed',
				description: 'Removed the Roblox Account feature'
			},
			{
				type: 'removed',
				description: 'Removed the outdated notice modal'
			},
			{
				type: 'changed',
				description:
					'Custom API exports now use the .roprotect-api extension; existing .rotector-api imports keep working'
			},
			{
				type: 'fixed',
				description: 'Usage no longer shows missing counters before a service has reported any'
			}
		]
	},
	{
		id: 'v2.17.0',
		version: '2.17.0',
		date: '2026-05-20',
		title: 'New tools, sharper insights, smoother performance',
		summary:
			'This release brings new ways to share and contribute, including a leaderboard, tooltip image exports, and a clearer queue experience. Scan bars, indicators, and carousels load more progressively, and a long list of fixes tightens up Firefox support, tooltips, and blur handling.',
		changes: [
			{
				type: 'added',
				description:
					'Leaderboard - New tab in the popup ranks submitters by queue submissions that ended up flagged'
			},
			{
				type: 'added',
				description:
					'Tooltip export - Save the expanded tooltip as PNG, JPG, WebP, or SVG, or copy it to the clipboard, from the new Export submenu in the 3-dot menu'
			},
			{
				type: 'added',
				description:
					'Inspect-resistant tooltip text - The most-fakeable fields now render as canvas pixels so they cannot be edited via inspect-element'
			},
			{
				type: 'added',
				description:
					'Content categories - Flagged users now show a category label (CSAM, Sexual, Kink, Raceplay, Condo, or Other) alongside their status in the indicator and tooltip'
			},
			{
				type: 'added',
				description:
					'Queue history user identity - Each entry shows the user’s avatar, display name, and @username instead of just a numeric ID'
			},
			{
				type: 'added',
				description:
					'Profile scan bars - Friends and Communities carousels on profile pages now show a bulk scan summary inline with each section heading, mirroring the friends list page'
			},
			{
				type: 'added',
				description:
					'Integration scan severities - Friends caught by an enabled integration API are now counted under the severity that API reported, with a teal chip showing how many detections came from integrations'
			},
			{
				type: 'added',
				description:
					'Queue popup explainer - New sections explain how our database works, when (and when not) to queue, and the consequences of misuse'
			},
			{
				type: 'added',
				description:
					'Queue submission cost - Thorough checks count as 3× against your queue limit, with the cost shown next to the Submit button'
			},
			{
				type: 'added',
				description:
					'Review prompt - Modal asking you to leave a store review once you have helped flag a few users'
			},
			{
				type: 'added',
				description:
					'Rotector verification source - Discord and alt account entries linked by our own database now show a Rotector label'
			},
			{
				type: 'changed',
				description:
					'Scan bar granularity - Now shows a separate chip for each status type instead of grouping several together'
			},
			{
				type: 'changed',
				description:
					'Progressive status indicators - Lists leave the loading spinner as soon as Rotector resolves, without waiting for every enabled custom API'
			},
			{
				type: 'changed',
				description:
					'Group members carousel - Thumbnails, presence icons, and statuses load in parallel, and indicators mount as soon as tiles render'
			},
			{
				type: 'changed',
				description:
					'Debug logs - The Developer Logs page is replaced by a Download debug logs button in settings that exports logs and system info to share with developers'
			},
			{
				type: 'changed',
				description:
					'Reliability improvements - Several core parts of the extension were rewritten behind the scenes for better stability and smoother day-to-day use'
			},
			{
				type: 'changed',
				description:
					'Queue popup acknowledgments - Trimmed from 11 to 5 items as dropped rules are now conveyed by the new explainer sections'
			},
			{
				type: 'changed',
				description:
					'Funding links removed - Ko-fi and funding section removed; Discord link updated'
			},
			{
				type: 'changed',
				description:
					'Tooltip compact header - Shows the unique @username instead of the display name so a truncated header still identifies the right user'
			},
			{
				type: 'fixed',
				description:
					'Firefox feature loading - Friend scans, group roles, and other Roblox-powered features now work on Firefox instead of failing to load'
			},
			{
				type: 'fixed',
				description:
					'Scan bar progress - Bar now fills smoothly as each batch of friends or groups is checked instead of jumping to 30% and disappearing'
			},
			{
				type: 'fixed',
				description:
					'Self-fetched status - A locally cached status no longer keeps the indicator stuck in the loading state'
			},
			{
				type: 'fixed',
				description:
					'Tooltip on Not Flagged users - Hovering the indicator on a Not Flagged profile now reliably shows the tooltip'
			},
			{
				type: 'fixed',
				description:
					'Activity chart - Readable 7d and 30d views as well as 12-hour clock labels on the 24h view'
			},
			{
				type: 'fixed',
				description:
					'Group members carousel tooltip - Hovering a tile past the first page now shows the avatar, username, and display name in the tooltip header'
			},
			{
				type: 'fixed',
				description:
					'Group members carousel - The carousel now renders on community pages even when another extension appends extra fragments to the URL'
			},
			{
				type: 'fixed',
				description:
					'Group members carousel hidden list - Groups with a permission-restricted member list now show the "Use the Tracked tab" empty state instead of a generic error'
			},
			{
				type: 'fixed',
				description:
					'Tooltip compact mode - Switching to compact now works right away instead of only after resizing the tooltip'
			},
			{
				type: 'fixed',
				description:
					'Group members carousel stuck indicators - Switching tabs or filters quickly no longer leaves status indicators stuck on the loading spinner'
			},
			{
				type: 'fixed',
				description:
					'Profile blur - Slow page loads no longer leave description text or store items blurred on innocent profiles'
			},
			{
				type: 'fixed',
				description:
					'Rovalra currently-wearing carousel - Items rendered by the Rovalra extension are now blurred and revealed alongside the rest of the avatar items'
			},
			{
				type: 'fixed',
				description:
					'Firefox debug logs - Error details that were previously skipped now appear in downloadable debug logs'
			},
			{
				type: 'fixed',
				description:
					'Tooltip vote totals - Vote counts now refresh in the expanded tooltip after voting instead of needing to reopen it'
			},
			{
				type: 'removed',
				description:
					'Tooltip "Copy Link" menu item - Replaced by the new tooltip image export which captures the full content as a PNG instead of just a link'
			},
			{
				type: 'removed',
				description:
					'Onboarding feature showcase - Dropped the step that walked through tooltips, queue, and voting since those features are visible in the live UI'
			}
		]
	}
];
