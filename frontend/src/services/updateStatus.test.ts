import test from 'node:test';
import assert from 'node:assert/strict';
import type { UpdateStatus } from './apiTypes';
import { updateStatusKey } from './updateStatus';

const status: UpdateStatus = {
    enabled: true, currentVersion: '2.4.3', latestVersion: null, updateAvailable: false,
    checkedAt: '2026-10-13T02:47:46Z', stale: false, error: null,
    releaseName: null, releaseUrl: null, publishedAt: null,
};
test('completed check without a release never stays waiting or claims latest', () => {
    assert.equal(updateStatusKey(status), 'updates.noUpdate');
    assert.equal(updateStatusKey({ ...status, checkedAt: null }), 'updates.waiting');
});
test('checking, disabled and failed checks have distinct states', () => {
    assert.equal(updateStatusKey(status, true), 'updates.checking');
    assert.equal(updateStatusKey({ ...status, enabled: false }), 'updates.disabled');
    assert.equal(updateStatusKey({ ...status, stale: true }), 'updates.checkFailed');
});
test('known releases show available or latest according to version comparison', () => {
    assert.equal(updateStatusKey({ ...status, latestVersion: '2.4.7', updateAvailable: true }), 'updates.latest');
    assert.equal(updateStatusKey({ ...status, latestVersion: '2.4.3' }), 'updates.upToDate');
});
