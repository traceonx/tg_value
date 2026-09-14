import assert from 'node:assert/strict';
import test from 'node:test';
import { closeTelegramLoginForHandoff, telegramAccountStopReason } from './telegramAccountSafety.js';
import { runTelegramAccountAccessSweep } from './telegramAccountAccessSweep.js';
import { probeTelegramAccountSource } from './telegramAccountAccessSweep.js';

test('probe preserves GramJS seconds when the error name contains no duration', async () => {
    const result = await probeTelegramAccountSource({
        accountId: 'a', sourceId: 's', source: '@s', scope: 'channel',
        client: { async getEntity() { throw Object.assign(new Error('FLOOD_WAIT'), { seconds: 86400 }); }, async getMessages() { return []; } },
    });
    assert.equal(result.errorCode, 'FLOOD_WAIT_86400');
});

test('handoff fails closed on either shutdown failure and always attempts destroy', async () => {
    for (const failure of ['disconnect', 'destroy']) {
        const calls: string[] = [];
        await assert.rejects(closeTelegramLoginForHandoff({
            async disconnect() { calls.push('disconnect'); if (failure === 'disconnect') throw new Error(failure); },
            async destroy() { calls.push('destroy'); if (failure === 'destroy') throw new Error(failure); },
        }), new RegExp(failure));
        assert.deepEqual(calls, ['disconnect', 'destroy']);
    }
});

test('account stop classification preserves server wait and distinguishes channel bans', () => {
    assert.deepEqual(telegramAccountStopReason({ errorMessage: 'FLOOD_WAIT', seconds: 86400 }), { kind: 'cooldown', seconds: 86400 });
    assert.deepEqual(telegramAccountStopReason(new Error('FLOOD_PREMIUM_WAIT_900')), { kind: 'cooldown', seconds: 900 });
    assert.equal(telegramAccountStopReason(new Error('USER_BANNED_IN_CHANNEL')), null);
    assert.equal(telegramAccountStopReason(new Error('AUTH_KEY_DUPLICATED'))?.kind, 'expired');
});

for (const code of ['FLOOD_WAIT_300', 'AUTH_KEY_DUPLICATED', 'USER_DEACTIVATED_BAN']) {
    test(`sweep stops one account on ${code}, releases lease and continues healthy account`, async () => {
        const calls: Record<string, number> = { bad: 0, good: 0 };
        const stopped: string[] = [];
        let acquired = 0;
        let released = 0;
        const summary = await runTelegramAccountAccessSweep({
            async listTelegramAccounts() { return ['bad', 'good'].map(accountId => ({ accountId, enabled: true })); },
            async listTelegramChannelSubscriptions() {
                return [1, 2].map(id => ({ sourceId: String(id), source: `@source${id}`, enabled: true, scopes: ['channel'] as const }));
            },
            async getTelegramAccountRuntime(accountId) {
                acquired += 1;
                return { client: {
                    async getEntity() { calls[accountId] += 1; if (accountId === 'bad') throw new Error(code); return {}; },
                    async getMessages() { return []; },
                }, release() { released += 1; } };
            },
            async markTelegramAccountSourceAccess() {},
            async onAccountError(id) { stopped.push(id); },
        }, { concurrency: 4 });
        assert.deepEqual(calls, { bad: 1, good: 2 });
        assert.deepEqual(stopped, ['bad']);
        assert.equal(acquired, released);
        assert.equal(summary.status, 'failed');
    });
}
