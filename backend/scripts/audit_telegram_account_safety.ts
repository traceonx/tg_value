// Offline evidence only: no Telegram client, credentials, database, or network.
// Regression assertions for the repaired account safety boundaries.
import assert from 'node:assert/strict';
import { TelegramMultiAccountLoginFlows } from '../src/services/telegramMultiAccountLoginFlows.js';
import { createTelegramMultiAccountAuthorizedAdapter } from '../src/services/telegramMultiAccountLoginAdapter.js';
import { runTelegramAccountAccessSweep } from '../src/services/telegramAccountAccessSweep.js';

const events: string[] = [];
let connected = false;
const fakeClient = {
    async connect() { connected = true; },
    async sendCode() { return { phoneCodeHash: 'fake', isCodeViaApp: true }; },
    async signInCode() { return 'authorized' as const; },
    async signInPassword() {},
    async getMe() { return { id: '123' }; },
    saveSession() { return 'offline-fake-session'; },
    async disconnect() { connected = false; events.push('login-disconnected'); },
    async destroy() {},
    setQrLoginTokenHandler() {},
    async exportQrLoginToken() { return { kind: 'authorized' as const }; },
};
const adapter = createTelegramMultiAccountAuthorizedAdapter({
    repository: { async upsertAccount() { return { id: 'fake-account' }; } },
    pool: { async activateAccount() {
        assert.equal(connected, false);
        events.push('activate-after-login-disconnected');
    } },
    accessSweep: { async trigger() {
        assert.fail('login must not trigger a permission sweep');
    } },
});
const flows = new TelegramMultiAccountLoginFlows({
    credentials: async () => ({ apiId: 123, apiHash: 'offline-fake-hash' }),
    createClient: () => fakeClient,
    onAuthorized: input => adapter.upsertByTelegramUserId(input),
});
const started = await flows.startPhone('offline-admin', '+12025550123');
await flows.submitCode('offline-admin', started.flowId, '12345');
assert.deepEqual(events, [
    'login-disconnected', 'activate-after-login-disconnected',
]);
console.log('PASS: login disconnect precedes activation; no automatic sweep.');

for (const code of ['FLOOD_WAIT_300', 'AUTH_KEY_DUPLICATED', 'USER_DEACTIVATED_BAN']) {
    let requests = 0;
    const summary = await runTelegramAccountAccessSweep({
        async listTelegramAccounts() { return [{ accountId: 'fake-account', enabled: true }]; },
        async listTelegramChannelSubscriptions() {
            return [1, 2, 3].map(id => ({
                sourceId: String(id), source: `@offline${id}`, enabled: true,
                scopes: ['channel'] as const,
            }));
        },
        async getTelegramAccountRuntime() { return { client: {
            async getEntity() {
                requests += 1;
                throw Object.assign(new Error(code), { errorMessage: code });
            },
            async getMessages() { return []; },
        } }; },
        async markTelegramAccountSourceAccess() {},
    }, { concurrency: 1 });
    assert.equal(requests, 1);
    assert.equal(summary.status, 'failed');
    console.log(`PASS: ${code} stops remaining probes (${requests} request).`);
}
