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

function probed(options: { failing?: () => boolean; ignorable?: boolean } = {}) {
    let clock = 0;
    let stuck = 0;
    const { client, sender, calls } = fakeClient();
    client.invoke = async (request: unknown) => {
        calls.invoke.push(request);
        if (options.failing?.()) throw Object.assign(new Error('TIMEOUT'), { flood: options.ignorable });
        return {};
    };
    const watchdog = installTelegramConnectionWatchdog(client, {
        label: 'probe', log: quiet, now: () => clock, resumeRequest: () => 'GetState',
        setInterval: () => 1, clearInterval: () => undefined,
        probe: { intervalMs: 1000, failures: 3, isIgnorable: error => Boolean((error as { flood?: boolean }).flood), onStuck: () => { stuck += 1; } },
    });
    sender.connected = true;
    return { watchdog, calls, stuck: () => stuck, tick: async () => { clock += 1000; await watchdog.check(); } };
}

test('rebuilds a client that looks connected but never answers', async () => {
    const f = probed({ failing: () => true });
    await f.tick(); await f.tick();
    assert.equal(f.stuck(), 0, 'two failures are tolerated');
    await f.tick();
    assert.equal(f.stuck(), 1);
    assert.equal(f.calls.invoke.length, 3);
});

test('a successful probe resets the failure count, and probes respect the interval', async () => {
    let fail = true;
    const f = probed({ failing: () => fail });
    await f.tick(); await f.tick();
    fail = false;
    await f.tick();
    fail = true;
    await f.tick(); await f.tick();
    assert.equal(f.stuck(), 0);
    await f.watchdog.check(); // same instant: no extra probe
    assert.equal(f.calls.invoke.length, 5);
});

test('flood waits do not count as a dead connection', async () => {
    const f = probed({ failing: () => true, ignorable: true });
    for (let i = 0; i < 5; i++) await f.tick();
    assert.equal(f.stuck(), 0);
});
