import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult } from 'pg';
import {
    compareVersions,
    createUpdateChecker,
    normalizeVersion,
    type UpdateCheckStore,
} from './updateChecker.js';

const NOW = new Date('2026-09-01T09:00:00.000Z');

test('fork release checks discard upstream cache and handle an unpublished release without upgrade prompts', async () => {
    const store = createStore();
    store.state = { repository: 'example-upstream/project', etag: 'upstream', checkedAt: NOW.toISOString(),
        release: { version: '2.4.7', tag: 'v2.4.7', name: 'Upstream', url: 'https://github.com/example-upstream/project/releases/tag/v2.4.7' } };
    const checker = createUpdateChecker({ currentVersion: '2.4.3', store, fetch: async (input, init) => {
        assert.equal(String(input), 'https://api.github.com/repos/traceonx/tg_value/releases/latest');
        assert.equal(new Headers(init?.headers).has('if-none-match'), false);
        return new Response(null, { status: 404 });
    } });
    assert.equal((await checker.getStatus()).latestVersion, null);
    const status = await checker.checkNow();
    assert.equal(status.updateAvailable, false);
    assert.equal(status.latestVersion, null);
    assert.equal(status.stale, false);
    assert.ok(status.checkedAt);
    assert.equal(store.state.repository, 'traceonx/tg_value');
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    });
}

function createStore(): UpdateCheckStore & { state: any; deliveries: Map<string, string> } {
    const store = {
        state: null as any,
        deliveries: new Map<string, string>(),
        async loadState() { return store.state; },
        async saveState(state: any) { store.state = state; },
        async listEligibleRecipients() { return [101, 202]; },
        async claimDelivery(version: string, recipientId: string) {
            const key = `${version}:${recipientId}`;
            if (store.deliveries.get(key) === 'delivered') return false;
            store.deliveries.set(key, 'pending');
            return true;
        },
        async markDeliverySucceeded(version: string, recipientId: string) {
            store.deliveries.set(`${version}:${recipientId}`, 'delivered');
        },
        async markDeliveryFailed(version: string, recipientId: string, error: string) {
            store.deliveries.set(`${version}:${recipientId}`, `failed:${error}`);
        },
    };
    return store;
}

test('version normalization and comparison follow release semantics without downgrade prompts', () => {
    assert.equal(normalizeVersion('v2.1.1'), '2.1.1');
    assert.equal(normalizeVersion('2.2.0-rc.1'), null);
    assert.equal(normalizeVersion('release-2.2.0'), null);
    assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
    assert.equal(compareVersions('2.1.1', '2.1.1'), 0);
    assert.equal(compareVersions('2.0.0', '2.1.0'), -1);
});

test('checker uses GitHub ETag, stores successful status and detects a newer stable release', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const store = createStore();
    store.state = { repository: 'example-upstream/project', etag: '"old"', checkedAt: null, release: null };
    const checker = createUpdateChecker({
        currentVersion: '2.1.1',
        repository: 'example-upstream/project',
        store,
        now: () => NOW,
        fetch: async (input, init) => {
            requests.push({ url: String(input), headers: new Headers(init?.headers) });
            return jsonResponse({
                tag_name: 'v2.2.0', name: 'TG Vault v2.2.0', draft: false, prerelease: false,
                html_url: 'https://github.com/example-upstream/project/releases/tag/v2.2.0',
                published_at: '2026-09-01T08:00:00.000Z', body: '安全更新\n\n更多内容',
            }, { headers: { etag: '"new"' } });
        },
    });

    const status = await checker.checkNow();
    assert.equal(requests[0]?.url, 'https://api.github.com/repos/example-upstream/project/releases/latest');
    assert.equal(requests[0]?.headers.get('if-none-match'), '"old"');
    assert.equal(status.updateAvailable, true);
    assert.equal(status.latestVersion, '2.2.0');
    assert.equal(status.stale, false);
    assert.equal(store.state.etag, '"new"');
});

test('304 and fetch failures preserve the last successful release instead of claiming latest', async () => {
    const store = createStore();
    store.state = { repository: 'example-upstream/project',
        etag: '"same"', checkedAt: '2026-09-01T08:00:00.000Z',
        release: { version: '2.2.0', tag: 'v2.2.0', name: 'TG Vault v2.2.0', url: 'https://example.test/v2.2.0', publishedAt: null, notes: null },
    };
    const notModified = createUpdateChecker({ currentVersion: '2.1.1', repository: 'example-upstream/project', store, now: () => NOW, fetch: async () => new Response(null, { status: 304 }) });
    assert.equal((await notModified.checkNow()).latestVersion, '2.2.0');

    const failing = createUpdateChecker({ currentVersion: '2.1.1', repository: 'example-upstream/project', store, now: () => NOW, fetch: async () => { throw new Error('network unavailable'); } });
    const stale = await failing.checkNow();
    assert.equal(stale.latestVersion, '2.2.0');
    assert.equal(stale.stale, true);
    assert.match(stale.error || '', /暂时无法检查/);
});

test('notification delivery failure cannot make a successful release check look stale', async () => {
    const store = createStore();
    store.listEligibleRecipients = async () => { throw new Error('database temporarily unavailable'); };
    const checker = createUpdateChecker({
        currentVersion: '2.1.1', repository: 'example-upstream/project', store, now: () => NOW,
        fetch: async () => jsonResponse({ tag_name: 'v2.2.0', draft: false, prerelease: false, html_url: 'https://github.com/example-upstream/project/releases/tag/v2.2.0', published_at: null }),
        sendBotMessage: async () => undefined,
    });
    const status = await checker.checkNow();
    assert.equal(status.updateAvailable, true);
    assert.equal(status.stale, false);
    assert.equal(status.error, null);
});

test('Bot delivery is once per authenticated allowlisted user and failed recipients can retry', async () => {
    const store = createStore();
    const attempts: number[] = [];
    const checker = createUpdateChecker({
        currentVersion: '2.1.1', repository: 'example-upstream/project', store, now: () => NOW,
        fetch: async () => jsonResponse({ tag_name: 'v2.2.0', draft: false, prerelease: false, html_url: 'https://github.com/example-upstream/project/releases/tag/v2.2.0', published_at: null, body: '版本说明' }),
        sendBotMessage: async recipient => {
            attempts.push(recipient);
            if (recipient === 202 && attempts.filter(id => id === 202).length === 1) throw new Error('bot offline');
        },
    });

    await checker.checkNow();
    await checker.deliverPendingBotNotifications();
    await checker.deliverPendingBotNotifications();
    assert.deepEqual(attempts, [101, 202, 202]);
    assert.equal(store.deliveries.get('2.2.0:101'), 'delivered');
    assert.equal(store.deliveries.get('2.2.0:202'), 'delivered');
});
