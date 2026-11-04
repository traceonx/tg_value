import assert from 'node:assert/strict';
import test from 'node:test';
import { installTelegramConnectionWatchdog, type TelegramWatchdogSender } from './telegramConnectionWatchdog.js';

const quiet = { warn() {}, log() {} };

function fakeClient(options: { connectSucceeds?: boolean } = {}) {
    const sender: TelegramWatchdogSender & { connected: boolean; reconnects: number } = {
        connected: false,
        reconnects: 0,
        isConnected() { return this.connected; },
        reconnect() { this.reconnects += 1; },
    };
    const calls = { connect: 0, invoke: [] as unknown[], disconnect: 0 };
    const client = {
        _sender: sender as TelegramWatchdogSender,
        _destroyed: false,
        async connect() {
            calls.connect += 1;
            if (options.connectSucceeds === false) return false;
            sender.connected = true;
            return true;
        },
        async disconnect() { calls.disconnect += 1; sender.connected = false; },
        async destroy() { client._destroyed = true; },
        async invoke(request: unknown) { calls.invoke.push(request); return {}; },
    };
    return { client, sender, calls };
}

function install(client: ReturnType<typeof fakeClient>['client'], graceChecks = 2) {
    let scheduled = 0;
    const watchdog = installTelegramConnectionWatchdog(client, {
        label: 'test', graceChecks, log: quiet,
        setInterval: () => { scheduled += 1; return 1; },
        clearInterval: () => undefined,
        resumeRequest: () => 'GetState',
    });
    return { watchdog, scheduled: () => scheduled };
}

test('reconnects a client stranded after a failed GramJS reconnect and resumes updates', async () => {
    const { client, sender, calls } = fakeClient();
    const { watchdog } = install(client);
    sender.connected = true;
    await watchdog.check(); // arms after first healthy connection
    sender.connected = false; // reconnect gave up: _userConnected=false, not reconnecting
    await watchdog.check();
    assert.equal(calls.connect, 0, 'one bad sample is tolerated');
    await watchdog.check();
    assert.equal(calls.connect, 1);
    assert.deepEqual(calls.invoke, ['GetState']);
    assert.equal(sender.connected, true);
});

test('does nothing before the first successful connection', async () => {
    const { client, calls } = fakeClient();
    const { watchdog } = install(client, 1);
    await watchdog.check();
    await watchdog.check();
    assert.equal(calls.connect, 0);
});

test('leaves an in-progress GramJS reconnect alone', async () => {
    const { client, sender, calls } = fakeClient();
    const { watchdog } = install(client, 1);
    sender.connected = true;
    await watchdog.check();
    sender.connected = false;
    sender.isReconnecting = true;
    await watchdog.check();
    await watchdog.check();
    assert.equal(calls.connect, 0);
    sender.isReconnecting = false;
    await watchdog.check();
    assert.equal(calls.connect, 1);
});

test('keeps retrying while the network is still down', async () => {
    const { client, sender, calls } = fakeClient({ connectSucceeds: false });
    const { watchdog } = install(client, 1);
    sender.connected = true;
    await watchdog.check();
    sender.connected = false;
    await watchdog.check();
    await watchdog.check();
    assert.equal(calls.connect, 2);
    assert.equal(calls.invoke.length, 0);
});

test('restarts the receive loop when GramJS aborted it but still reports connected', async () => {
    const { client, sender, calls } = fakeClient();
    const { watchdog } = install(client, 1);
    sender.connected = true;
    await watchdog.check();
    sender.userDisconnected = true; // "Maximum reconnection retries reached"
    await watchdog.check();
    assert.equal(sender.reconnects, 1);
    assert.equal(calls.connect, 0);
});

test('intentional disconnect or destroy stops the watchdog', async () => {
    const { client, sender, calls } = fakeClient();
    const { watchdog } = install(client, 1);
    sender.connected = true;
    await watchdog.check();
    await client.disconnect();
    await watchdog.check();
    await watchdog.check();
    assert.equal(calls.connect, 0);
    assert.equal(calls.disconnect, 1);
});

test('installs once per client', () => {
    const { client } = fakeClient();
    const first = install(client);
    const second = install(client);
    assert.equal(first.watchdog, second.watchdog);
    assert.equal(second.scheduled(), 0);
});
