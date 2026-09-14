import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
    configureTelegramAccountAccessSweep,
    getTelegramAccountAccessSweepSummary,
    probeTelegramAccountSource,
    resetTelegramAccountAccessSweepForTests,
    runTelegramAccountAccessSweep,
    triggerTelegramAccountAccessSweep,
    type TelegramAccessClient,
    type TelegramAccountAccessSweepDependencies,
} from './telegramAccountAccessSweep.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');

afterEach(() => resetTelegramAccountAccessSweepForTests());

function rpcError(code: string, message = code): Error & { errorMessage: string } {
    return Object.assign(new Error(message), { errorMessage: code });
}

test('channel probe resolves the entity and reads exactly one recent message without joining', async () => {
    const calls: Array<{ method: string; value: unknown }> = [];
    const entity = { id: 'peer-1', title: 'source' };
    const client: TelegramAccessClient = {
        async getEntity(source) {
            calls.push({ method: 'getEntity', value: source });
            return entity;
        },
        async getMessages(peer, options) {
            calls.push({ method: 'getMessages', value: { peer, options } });
            return [{ id: 42 }];
        },
    };

    const result = await probeTelegramAccountSource({
        accountId: 'account-1',
        sourceId: 'subscription-1',
        source: '@source',
        scope: 'channel',
        client,
        now: () => NOW,
    });

    assert.equal(result.state, 'allowed');
    assert.equal(result.latestMessageId, 42);
    assert.equal(result.checkedAt, NOW.toISOString());
    assert.deepEqual(calls, [
        { method: 'getEntity', value: '@source' },
        { method: 'getMessages', value: { peer: entity, options: { limit: 1 } } },
    ]);
    assert.equal('invoke' in client, false, 'the probe must not join/import an invite');
});

test('probe classifies Telegram permission failures as denied and operational failures as error', async () => {
    for (const code of ['CHANNEL_PRIVATE', 'CHAT_FORBIDDEN', 'USER_NOT_PARTICIPANT', 'PEER_ID_INVALID']) {
        const result = await probeTelegramAccountSource({
            accountId: 'account-1', sourceId: code, source: '@source', scope: 'channel',
            client: {
                async getEntity() { throw rpcError(code); },
                async getMessages() { return []; },
            },
        });
        assert.equal(result.state, 'denied', code);
        assert.equal(result.errorCode, code);
    }

    const transient = await probeTelegramAccountSource({
        accountId: 'account-1', sourceId: 'network', source: '@source', scope: 'channel',
        client: {
            async getEntity() { return { id: 'peer' }; },
            async getMessages() { throw rpcError('FLOOD_WAIT_12'); },
        },
    });
    assert.equal(transient.state, 'error');
    assert.equal(transient.errorCode, 'FLOOD_WAIT_12');
});

test('sweep probes the enabled account x subscription scopes with bounded concurrency and persists every result', async () => {
    let active = 0;
    let maxActive = 0;
    const persisted: Array<{ accountId: string; sourceId: string; scope: string; state: string }> = [];
    const runtimeLookups: string[] = [];
    const client: TelegramAccessClient = {
        async getEntity(source) {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 4));
            active -= 1;
            return { source };
        },
        async getMessages() { return [{ id: 1 }]; },
    };
    const dependencies: TelegramAccountAccessSweepDependencies = {
        async listTelegramAccounts() {
            return [
                { accountId: 'a', enabled: true },
                { accountId: 'disabled', enabled: false },
                { accountId: 'b', enabled: true },
            ];
        },
        async listTelegramChannelSubscriptions() {
            return [
                { sourceId: 'channel-only', source: '@one', enabled: true, scopes: ['channel'] },
                { sourceId: 'second-channel', source: '@two', enabled: true, scopes: ['channel'] },
                { sourceId: 'paused', source: '@three', enabled: false, scopes: ['channel'] },
            ];
        },
        async getTelegramAccountRuntime(accountId) {
            runtimeLookups.push(accountId);
            return { client };
        },
        async markTelegramAccountSourceAccess(result) {
            persisted.push(result);
        },
        now: () => NOW,
    };

    const summary = await runTelegramAccountAccessSweep(dependencies, { concurrency: 2, reason: 'automatic' });

    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.counts, { accounts: 2, sources: 2, probes: 4, allowed: 4, denied: 0, error: 0 });
    assert.equal(maxActive, 2);
    assert.deepEqual(runtimeLookups.sort(), ['a', 'a', 'b', 'b']);
    assert.equal(persisted.length, 4);
    assert.deepEqual(
        persisted.map(result => `${result.accountId}:${result.sourceId}:${result.scope}`).sort(),
        [
            'a:channel-only:channel', 'a:second-channel:channel',
            'b:channel-only:channel', 'b:second-channel:channel',
        ],
    );
});

test('runtime lookup failures become structured per-source errors instead of aborting the sweep', async () => {
    const persisted: Array<{ state: string; errorCode?: string }> = [];
    const dependencies: TelegramAccountAccessSweepDependencies = {
        async listTelegramAccounts() { return [{ accountId: 'expired', enabled: true }]; },
        async listTelegramChannelSubscriptions() {
            return [{ sourceId: 'source', source: '@source', enabled: true, scopes: ['channel'] }];
        },
        async getTelegramAccountRuntime() { throw rpcError('AUTH_KEY_UNREGISTERED'); },
        async markTelegramAccountSourceAccess(result) { persisted.push(result); },
        now: () => NOW,
    };

    const summary = await runTelegramAccountAccessSweep(dependencies);
    assert.deepEqual(summary.counts, { accounts: 1, sources: 1, probes: 1, allowed: 0, denied: 0, error: 1 });
    assert.deepEqual(persisted.map(result => ({ state: result.state, errorCode: result.errorCode })), [
        { state: 'error', errorCode: 'AUTH_KEY_UNREGISTERED' },
    ]);
});

test('configured trigger supports targeted new-account/new-subscription sweeps and exposes live summary', async () => {
    const persisted: string[] = [];
    const dependencies: TelegramAccountAccessSweepDependencies = {
        async listTelegramAccounts() { return [{ accountId: 'new', enabled: true }, { accountId: 'old', enabled: true }]; },
        async listTelegramChannelSubscriptions() {
            return [
                { sourceId: 'new-source', source: '@new', enabled: true, scopes: ['channel'] },
                { sourceId: 'old-source', source: '@old', enabled: true, scopes: ['channel'] },
            ];
        },
        async getTelegramAccountRuntime() {
            return {
                client: {
                    async getEntity() { return { id: 'peer' }; },
                    async getMessages() { return []; },
                },
            };
        },
        async markTelegramAccountSourceAccess(result) {
            persisted.push(`${result.accountId}:${result.sourceId}`);
        },
        now: () => NOW,
    };
    configureTelegramAccountAccessSweep(dependencies);

    const run = triggerTelegramAccountAccessSweep({
        reason: 'account_created', accountIds: ['new'], sourceIds: ['new-source'],
    });
    assert.match(getTelegramAccountAccessSweepSummary().status, /queued|running/);
    const summary = await run;

    assert.equal(summary.reason, 'account_created');
    assert.deepEqual(persisted, ['new:new-source']);
    assert.equal(getTelegramAccountAccessSweepSummary().status, 'completed');
    assert.equal(getTelegramAccountAccessSweepSummary().counts.probes, 1);
});

test('triggers received during a run are queued rather than losing a new account or subscription sweep', async () => {
    const visited: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const dependencies: TelegramAccountAccessSweepDependencies = {
        async listTelegramAccounts() { return [{ accountId: 'a', enabled: true }, { accountId: 'b', enabled: true }]; },
        async listTelegramChannelSubscriptions() {
            return [{ sourceId: 'one', source: '@one', enabled: true, scopes: ['channel'] }];
        },
        async getTelegramAccountRuntime(accountId) {
            return {
                client: {
                    async getEntity(source: string) {
                        visited.push(`${accountId}:${source}`);
                        if (accountId === 'a') await firstGate;
                        return source;
                    },
                    async getMessages() { return []; },
                },
            };
        },
        async markTelegramAccountSourceAccess() {},
    };
    configureTelegramAccountAccessSweep(dependencies);

    const first = triggerTelegramAccountAccessSweep({ reason: 'account_created', accountIds: ['a'] });
    await new Promise(resolve => setImmediate(resolve));
    const second = triggerTelegramAccountAccessSweep({ reason: 'account_created', accountIds: ['b'] });
    releaseFirst();

    assert.equal((await first).reason, 'account_created');
    assert.equal((await second).reason, 'account_created');
    assert.deepEqual(visited, ['a:@one', 'b:@one']);
});
