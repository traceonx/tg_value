import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDockerUpdater, DockerError, readSummary, type DockerRequest } from './dockerUpdater.js';

const hostname = 'abcdef123456';
function fixture(t: test.TestContext) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-update-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const target = { Id: hostname + '0'.repeat(52), Name: '/tg-vault', Image: 'sha256:old',
        Config: { Image: 'sunqz/tg-vault:latest', Hostname: hostname, Labels: {} as Record<string, string> },
        Mounts: [{ Destination: '/data', Source: '/nas/data', RW: true },
            { Destination: '/var/run/docker.sock', Source: '/var/run/docker.sock', RW: true }],
        State: { Running: true, Status: 'running', ExitCode: 0, Health: { Status: 'healthy' } } };
    let helper: typeof target | undefined;
    let payload: Record<string, any>;
    let logs = JSON.stringify({ msg: 'Session done', Scanned: 1, Updated: 0, Failed: 0 });
    let imageMissing = false;
    let pull = '{"status":"Downloaded"}\n';
    let startTimeout = false;
    let replaced = false;
    const calls: { method: string; route: string }[] = [];
    const request: DockerRequest = async (method, route, body) => {
        calls.push({ method, route });
        if (replaced && route === `/containers/${hostname}/json`) throw new DockerError(404);
        if (route === '/version') return '{"ApiVersion":"1.54"}';
        if (method === 'GET' && (route === `/containers/${hostname}/json` || route === '/containers/tg-vault/json')) return JSON.stringify(target);
        if (route.startsWith('/images/') && route.endsWith('/json')) {
            if (imageMissing) throw new DockerError(404);
            return '{}';
        }
        if (route.startsWith('/images/create?')) return pull;
        if (route.startsWith('/containers/create?')) {
            payload = body as Record<string, any>;
            helper = { ...target, Config: { Image: payload.Image, Hostname: 'helper', Labels: payload.Labels },
                State: { Running: false, Status: 'created', ExitCode: 0, Health: { Status: 'healthy' } } };
            return '{"Id":"helper"}';
        }
        if (route.endsWith('/start')) {
            helper!.State.Running = true;
            helper!.State.Status = 'running';
            if (startTimeout) throw new Error('timeout after accepted start');
            return '';
        }
        if (route.includes('/logs?')) return logs;
        if (route.endsWith('/json')) { if (!helper) throw new DockerError(404); return JSON.stringify(helper); }
        if (method === 'DELETE') { assert.equal(helper?.State.Running, false); helper = undefined; return ''; }
        throw new Error(`Unexpected ${method} ${route}`);
    };
    const options = { enabled: true, stateFile: path.join(dir, 'state.json'), hostname, request, monitor: false };
    const updater = createDockerUpdater(options);
    const settle = () => new Promise<void>(resolve => setImmediate(resolve));
    return { updater, options, target, calls, settle,
        payload: () => payload,
        exit(updated = 0, failed = 0, scanned = 1) {
            helper!.State.Running = false; helper!.State.Status = 'exited';
            logs = JSON.stringify({ msg: 'Session done', Scanned: scanned, Updated: updated, Failed: failed });
        },
        setLogs(value: string) { logs = value; },
        setPull(value: string) { imageMissing = true; pull = value; },
        timeoutStart() { startTimeout = true; },
        replaceContainer() { replaced = true; target.Id = 'fedcba654321' + '0'.repeat(52); },
    };
}

test('disabled updater never accesses Docker', async () => {
    const updater = createDockerUpdater({ enabled: false, request: async () => { throw new Error('unexpected'); } });
    assert.deepEqual(await updater.status(), { enabled: false, available: false, phase: 'idle' });
    await assert.rejects(updater.start(), { status: 403 });
});

test('one click launches only the current container and negotiates Docker API; duplicate requests conflict', async t => {
    const f = fixture(t);
    const first = f.updater.start();
    await assert.rejects(f.updater.start(), { status: 409 });
    assert.equal((await first).phase, 'preparing');
    await f.settle();
    assert.deepEqual(f.payload().Cmd, ['--run-once', '--log-format', 'JSON', '--stop-timeout', '60s', 'tg-vault']);
    assert.ok(f.payload().Env.includes('DOCKER_API_VERSION=1.54'));
    assert.deepEqual(f.payload().HostConfig.Binds, ['/var/run/docker.sock:/var/run/docker.sock']);
    assert.equal((await f.updater.status()).phase, 'running');
    await assert.rejects(f.updater.start(), { status: 409 });
});

test('unchanged image is not reported as upgraded; helper is cleaned and retry is allowed', async t => {
    const f = fixture(t);
    await f.updater.start(); await f.settle(); f.exit();
    assert.equal((await f.updater.status()).phase, 'unchanged');
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
    await f.updater.start(); await f.settle();
    assert.equal((await f.updater.status()).phase, 'running');
});

test('Watchtower replacement keeps upgrade available even when hostname still contains the removed ID', async t => {
    const f = fixture(t);
    await f.updater.start(); await f.settle(); f.exit(1);
    f.target.Image = 'sha256:new';
    f.replaceContainer();
    const restored = createDockerUpdater(f.options);
    assert.equal((await restored.status()).phase, 'success');
    assert.equal((await restored.status()).available, true);
    await restored.start(); await f.settle();
    assert.equal((await restored.status()).phase, 'running');
});

test('new process recovers update record and waits for the new image health check', async t => {
    const f = fixture(t);
    await f.updater.start(); await f.settle(); f.exit(1);
    f.target.Image = 'sha256:new'; f.target.State.Health.Status = 'starting';
    const restored = createDockerUpdater(f.options);
    assert.equal((await restored.status()).phase, 'running');
    f.target.State.Health.Status = 'healthy';
    assert.equal((await restored.status()).phase, 'success');
    assert.equal(createDockerUpdater(f.options) !== restored, true);
    assert.equal((await createDockerUpdater(f.options).status()).phase, 'success');
});

for (const scenario of ['unhealthy', 'same-image', 'failed-log', 'no-summary', 'no-target']) {
    test(`does not report success for ${scenario}`, async t => {
        const f = fixture(t);
        await f.updater.start(); await f.settle();
        f.exit(1, scenario === 'failed-log' ? 1 : 0, scenario === 'no-target' ? 0 : 1);
        if (scenario !== 'same-image') f.target.Image = 'sha256:new';
        if (scenario === 'unhealthy') f.target.State.Health.Status = 'unhealthy';
        if (scenario === 'no-summary') f.setLogs('task started');
        assert.equal((await f.updater.status()).phase, 'failed');
    });
}

test('HTTP 200 pull stream errors stop before helper creation', async t => {
    const f = fixture(t);
    f.setPull('{"error":"denied"}\n');
    await f.updater.start(); await f.settle();
    assert.equal((await f.updater.status()).phase, 'failed');
    assert.equal(f.calls.some(call => call.route.startsWith('/containers/create')), false);
});

test('ambiguous start timeout remains locked until Docker reports the actual result', async t => {
    const f = fixture(t);
    f.timeoutStart();
    await f.updater.start(); await f.settle();
    assert.equal((await f.updater.status()).phase, 'running');
    await assert.rejects(f.updater.start(), { status: 409 });
    f.exit();
    assert.equal((await f.updater.status()).phase, 'unchanged');
});

test('corrupt state disables upgrades without preventing application startup', async t => {
    const f = fixture(t);
    fs.writeFileSync(f.options.stateFile, '{');
    const updater = createDockerUpdater(f.options);
    assert.equal((await updater.status()).available, false);
    await assert.rejects(updater.start(), { status: 503 });
});

test('immutable images, disabled labels and absent persistent mounts cannot be upgraded', async t => {
    const f = fixture(t);
    f.target.Config.Image = 'image@sha256:123';
    await assert.rejects(f.updater.start());
    f.target.Config.Image = 'image:latest';
    f.target.Config.Labels['com.centurylinklabs.watchtower.enable'] = 'false';
    await assert.rejects(f.updater.start());
    delete f.target.Config.Labels['com.centurylinklabs.watchtower.enable'];
    f.target.Mounts = [];
    await assert.rejects(f.updater.start());
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('summary parser rejects incomplete or negative counts', () => {
    assert.equal(readSummary('{"msg":"Session done"}'), null);
    assert.equal(readSummary('{"msg":"Session done","Scanned":-1,"Updated":0,"Failed":0}'), null);
});
