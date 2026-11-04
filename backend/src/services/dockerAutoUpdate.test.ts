import test from 'node:test';
import assert from 'node:assert/strict';
import { createDockerAutoUpdater, normalizeDockerAutoUpdateInterval, type DockerAutoUpdateConfig, type DockerAutoUpdateTarget } from './dockerAutoUpdate.js';

const quiet = { log() {}, warn() {} };

function fixture(config: DockerAutoUpdateConfig = { enabled: true, intervalMinutes: 5 }) {
    let clock = Date.parse('2026-11-04T12:00:00Z');
    let saved = { ...config };
    const target = {
        enabled: true, available: true, remoteChanged: false, busy: false, starts: 0, checks: 0,
        job: { phase: 'idle' } as { phase: string; startedAt?: string },
    };
    const updater: DockerAutoUpdateTarget = {
        get enabled() { return target.enabled; },
        async status() { return { available: target.available }; },
        async start() { target.starts += 1; },
        async hasRemoteUpdate() { target.checks += 1; return target.remoteChanged; },
        isBusy: () => target.busy,
        lastJob: () => target.job,
    };
    const auto = createDockerAutoUpdater({
        updater, monitor: false, log: quiet, now: () => clock,
        store: { async load() { return saved; }, async save(next) { saved = { ...next }; } },
    });
    return { auto, target, saved: () => saved, advance(minutes: number) { clock += minutes * 60_000; }, now: () => clock };
}

test('checks every configured interval and starts an upgrade only when the image changed', async () => {
    const f = fixture();
    assert.equal(await f.auto.tick(), 'latest');
    f.advance(4);
    assert.equal(await f.auto.tick(), null, 'interval has not elapsed');
    f.advance(1);
    f.target.remoteChanged = true;
    assert.equal(await f.auto.tick(), 'started');
    assert.equal(f.target.starts, 1);
    assert.equal(f.target.checks, 2);
});

test('disabled by default store value does nothing', async () => {
    const f = fixture({ enabled: false, intervalMinutes: 5 });
    f.target.remoteChanged = true;
    assert.equal(await f.auto.tick(), null);
    assert.equal(f.target.checks, 0);
});

test('never runs when Docker upgrades are not enabled for the container', async () => {
    const f = fixture();
    f.target.enabled = false;
    f.target.remoteChanged = true;
    assert.equal(await f.auto.tick(), null);
    assert.equal(f.target.checks, 0);
});

test('does not start a second upgrade while one is running', async () => {
    const f = fixture();
    f.target.busy = true;
    f.target.remoteChanged = true;
    assert.equal(await f.auto.tick(), 'busy');
    assert.equal(f.target.starts, 0);
});

test('backs off for an hour after a failed or no-op upgrade', async () => {
    const f = fixture();
    f.target.remoteChanged = true;
    f.target.job = { phase: 'failed', startedAt: new Date(f.now() - 10 * 60_000).toISOString() };
    assert.equal(await f.auto.tick(), 'backoff');
    f.advance(55);
    assert.equal(await f.auto.tick(), 'started');
});

test('registry errors are reported and retried on the next interval', async () => {
    const f = fixture();
    f.target.remoteChanged = true;
    const original = f.target;
    let fail = true;
    const auto = createDockerAutoUpdater({
        monitor: false, log: quiet, now: f.now,
        store: { async load() { return { enabled: true, intervalMinutes: 5 }; }, async save() {} },
        updater: {
            enabled: true,
            async status() { return { available: true }; },
            async start() { original.starts += 1; },
            async hasRemoteUpdate() { if (fail) throw new Error('registry down'); return true; },
            isBusy: () => false,
            lastJob: () => ({ phase: 'idle' }),
        },
    });
    assert.equal(await auto.tick(), 'error');
    assert.equal((await auto.state()).lastResult, 'error');
    fail = false;
    f.advance(5);
    assert.equal(await auto.tick(), 'started');
    assert.equal(original.starts, 1);
});

test('configure validates input, persists it and checks soon after', async () => {
    const f = fixture({ enabled: false, intervalMinutes: 5 });
    await assert.rejects(f.auto.configure({ enabled: true, intervalMinutes: 3 }));
    await assert.rejects(f.auto.configure({ enabled: 'yes', intervalMinutes: 5 }));
    const state = await f.auto.configure({ enabled: true, intervalMinutes: 10 });
    assert.deepEqual(f.saved(), { enabled: true, intervalMinutes: 10 });
    assert.equal(state.enabled, true);
    assert.equal(state.intervalMinutes, 10);
    assert.equal(await f.auto.tick(), 'latest');
    assert.equal((await f.auto.state()).nextCheckAt, new Date(f.now() + 10 * 60_000).toISOString());
});

test('interval whitelist defaults to five minutes', () => {
    assert.equal(normalizeDockerAutoUpdateInterval('5'), 5);
    assert.throws(() => normalizeDockerAutoUpdateInterval(1));
});
