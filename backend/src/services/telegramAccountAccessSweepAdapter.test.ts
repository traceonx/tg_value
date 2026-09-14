import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelegramAccountAccessSweepDependencies } from './telegramAccountAccessSweepAdapter.js';

test('repository adapter lists enabled subscriptions, uses account runtimes and maps access scopes', async () => {
    const queries: string[] = [];
    const marks: unknown[][] = [];
    const client = {
        async getEntity(source: string) { return { source }; },
        async getMessages() { return []; },
    };
    const dependencies = createTelegramAccountAccessSweepDependencies({
        repository: {
            async listEnabledAccounts() { return [{ id: 'account', enabled: true }]; },
            async markSourceAccess(...args: unknown[]) { marks.push(args); },
        },
        clientPool: {
            getAccountClient(accountId: string) {
                assert.equal(accountId, 'account');
                return client;
            },
        },
        async querySubscriptions(text: string) {
            queries.push(text);
            return { rows: [{ id: 'subscription', source: '@news', enabled: true }] };
        },
    });

    assert.deepEqual(await dependencies.listTelegramAccounts(), [{ accountId: 'account', enabled: true }]);
    assert.deepEqual(await dependencies.listTelegramChannelSubscriptions(), [{
        sourceId: 'subscription', source: '@news', enabled: true, scopes: ['channel'],
    }]);
    assert.equal((await dependencies.getTelegramAccountRuntime('account'))?.client, client);
    assert.match(queries[0], /telegram_channel_subscriptions[\s\S]*enabled = TRUE/);

    await dependencies.markTelegramAccountSourceAccess({
        accountId: 'account', sourceId: 'subscription', source: '@news', scope: 'channel',
        state: 'allowed', checkedAt: '2026-08-29T08:00:00.000Z', latestMessageId: null,
    });
    await dependencies.markTelegramAccountSourceAccess({
        accountId: 'account', sourceId: 'subscription', source: '@news', scope: 'channel',
        state: 'error', checkedAt: '2026-08-29T08:00:00.000Z', latestMessageId: null,
        errorCode: 'TIMEOUT',
    });
    assert.deepEqual(marks, [
        ['account', '@news', 'scan', 'allowed', null],
        ['account', '@news', 'download', 'allowed', null],
        ['account', '@news', 'scan', 'unknown', 'TIMEOUT'],
        ['account', '@news', 'download', 'unknown', 'TIMEOUT'],
    ]);
});
