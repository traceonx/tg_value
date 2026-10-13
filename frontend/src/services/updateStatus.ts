import type { UpdateStatus } from './apiTypes';

export function updateStatusKey(status: UpdateStatus | null, checking = false): string {
    if (checking) return 'updates.checking';
    if (!status) return 'updates.waiting';
    if (!status.enabled) return 'updates.disabled';
    if (status.stale || status.error) return 'updates.checkFailed';
    if (status.updateAvailable) return 'updates.latest';
    if (!status.checkedAt) return 'updates.waiting';
    return status.latestVersion ? 'updates.upToDate' : 'updates.noUpdate';
}
