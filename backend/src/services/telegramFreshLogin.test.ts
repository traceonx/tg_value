import assert from 'node:assert/strict';
import test from 'node:test';
import type { TelegramClient } from 'telegram';
import { start, signInBot } from 'telegram/client/auth.js';
import { Api } from 'telegram';
import { installTelegramRequestGate, TelegramRequestGate } from './telegramRequestGate.js';

function freshClient(code = 'AUTH_KEY_UNREGISTERED') {
    let authorized = false;
    const calls: string[] = [];
    const client = {
        connected: true, apiId: 123, apiHash: 'test',
        async invoke(request: { className: string }) {
            calls.push(request.className);
            if (request.className === 'updates.GetState' && !authorized) {
                throw Object.assign(new Error(code), { errorMessage: code, seconds: code === 'FLOOD_WAIT' ? 60 : undefined });
            }
            if (request.className === 'auth.ImportBotAuthorization') {
                authorized = true;
                return { className: 'auth.Authorization', user: { id: 123 } };
            }
            return {};
        },
        async invokeWithSender() { return {}; },
        async checkAuthorization() {
            try { await (this as unknown as TelegramClient).invoke(new Api.updates.GetState()); return true; }
            catch { return false; }
        },
        async getMe() { return { id: 123 }; },
        async signInBot(credentials: Parameters<typeof signInBot>[1], auth: Parameters<typeof signInBot>[2]) {
            return signInBot(this as unknown as TelegramClient, credentials, auth);
        },
        _log: { info() {} },
    } as unknown as TelegramClient;
    return { client, calls, revoke: () => { authorized = false; } };
}

test('GramJS fresh Bot start can proceed from its unauthenticated probe to token login', async () => {
    const { client, calls } = freshClient();
    let stopped = 0;
    installTelegramRequestGate(client, new TelegramRequestGate(0), async () => { stopped++; }, { freshSession: true });
    await start(client, { botAuthToken: '123:fake-token' });
    assert.ok(calls.includes('auth.ImportBotAuthorization'));
    assert.equal(stopped, 0);
    assert.equal(await client.checkAuthorization(), true);
});

for (const code of ['FLOOD_WAIT', 'AUTH_KEY_DUPLICATED', 'SESSION_REVOKED']) {
    test(`fresh login does not bypass ${code}`, async () => {
        const { client, calls } = freshClient(code);
        installTelegramRequestGate(client, new TelegramRequestGate(0), undefined, { freshSession: true });
        await assert.rejects(start(client, { botAuthToken: '123:fake-token' }));
        assert.deepEqual(calls, ['updates.GetState']);
    });
}

test('saved sessions still stop on AUTH_KEY_UNREGISTERED', async () => {
    const { client, calls } = freshClient();
    installTelegramRequestGate(client, new TelegramRequestGate(0));
    await assert.rejects(start(client, { botAuthToken: '123:fake-token' }));
    assert.deepEqual(calls, ['updates.GetState']);
});

test('fresh-session exception cannot be reused after successful login', async () => {
    const { client, calls, revoke } = freshClient();
    installTelegramRequestGate(client, new TelegramRequestGate(0), undefined, { freshSession: true });
    await start(client, { botAuthToken: '123:fake-token' });
    revoke();
    assert.equal(await client.checkAuthorization(), false);
    const count = calls.length;
    await assert.rejects(client.invoke(new Api.updates.GetState()));
    assert.equal(calls.length, count);
});
