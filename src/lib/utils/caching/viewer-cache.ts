import { userStatusService, groupStatusService } from '../../services/rotector/entity-status';
import { clearDiscordDataCache } from '../../services/third-party/discord-data';
import { clearQuarryCache } from '../../services/third-party/quarry';
import { resetPascClearance } from '../../stores/pasc-clearance';
import { resetFriendsScan } from '../../stores/friends-scan';

// Everything cached here is scoped to the viewer's API key (PASC clearance and
// case details, Discord links, provider verdicts). When the key changes in the
// same tab, a stale cache would show the previous viewer's data until its TTL
// expired, so drop it immediately and refetch under the new identity.
export function clearViewerScopedCaches(): void {
	userStatusService.clearCache();
	groupStatusService.clearCache();
	clearDiscordDataCache();
	clearQuarryCache();
	resetPascClearance();
	resetFriendsScan();
}
