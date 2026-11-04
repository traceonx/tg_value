import test from 'node:test';
import assert from 'node:assert/strict';
import { DockerError } from './dockerUpdater.js';
import {
    buildTelegramUpdateConfirmView, buildTelegramUpdateResultText, buildTelegramUpdateView, checkTelegramDockerUpdate,
    parseTelegramUpdateAction, startTelegramDockerUpdate, type TelegramDockerUpdater,
} from './telegramDockerUpdate.js';
import { menuPanels } from './telegramMenu.js';
import { findBotCommand } from '../utils/telegramCommandRegistry.js';

function updater(overrides: Partial<TelegramDockerUpdater> & { changed?: boolean; phase?: string; available?: boolean } = {}) {
    const calls = { start: 0 };
    const value: TelegramDockerUpdater = {
        enabled: true,
        async status() { return { enabled: true, available: overrides.available ?? true, phase: overrides.phase ?? 'idle' }; },
        async hasRemoteUpdate() { return overrides.changed ?? false; },
        async start() { calls.start += 1; },
        isBusy: () => false,
        ...overrides,
    };
    return { value, calls };
}
const callbackData = (view: { buttons: Array<Array<[string, string]>> }) => view.buttons.flat().map(([, data]) => data);

test('settings panel and /update command expose the update check', () => {
    assert.ok(menuPanels.settings.flat().includes('update'));
    assert.equal(findBotCommand('/update')?.command, 'update');
    assert.equal(findBotCommand('/upgrade')?.command, 'update');
});

test('check reports every updater state', async () => {
    assert.deepEqual(await checkTelegramDockerUpdate(updater({ enabled: false }).value), { kind: 'disabled' });
    assert.deepEqual(await checkTelegramDockerUpdate(updater({ available: false }).value), { kind: 'unavailable' });
    assert.deepEqual(await checkTelegramDockerUpdate(updater({ phase: 'running' }).value), { kind: 'busy' });
    assert.deepEqual(await checkTelegramDockerUpdate(updater().value), { kind: 'latest' });
    assert.deepEqual(await checkTelegramDockerUpdate(updater({ changed: true }).value), { kind: 'available' });
    const failing = updater({ async hasRemoteUpdate() { throw new Error('registry down'); } }).value;
    assert.deepEqual(await checkTelegramDockerUpdate(failing), { kind: 'error' });
});

test('only an available update offers the update button, which asks for confirmation', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
        const available = buildTelegramUpdateView({ kind: 'available' }, locale);
        assert.deepEqual(callbackData(available), ['upd_apply', 'upd_check']);
        assert.deepEqual(callbackData(buildTelegramUpdateView({ kind: 'latest' }, locale)), ['upd_check']);
        assert.deepEqual(callbackData(buildTelegramUpdateView({ kind: 'disabled' }, locale)), []);
        assert.deepEqual(callbackData(buildTelegramUpdateConfirmView(locale)), ['upd_confirm', 'upd_cancel']);
        for (const view of [available, buildTelegramUpdateConfirmView(locale)]) {
            assert.doesNotMatch(view.text, /bot\.update\./);
            for (const data of callbackData(view)) assert.ok(Buffer.byteLength(data) < 64);
        }
    }
    assert.equal(parseTelegramUpdateAction('upd_confirm'), 'confirm');
    assert.equal(parseTelegramUpdateAction('upd_other'), null);
});

test('confirm re-checks before starting and never starts without a new image', async () => {
    const latest = updater();
    const noop = await startTelegramDockerUpdate(latest.value, 'zh-CN');
    assert.equal(noop.started, false);
    assert.equal(latest.calls.start, 0);

    const fresh = updater({ changed: true });
    const started = await startTelegramDockerUpdate(fresh.value, 'zh-CN');
    assert.equal(started.started, true);
    assert.equal(fresh.calls.start, 1);

    const conflict = updater({ changed: true, async start() { throw new DockerError(409); } });
    const busy = await startTelegramDockerUpdate(conflict.value, 'en');
    assert.equal(busy.started, false);
    assert.deepEqual(callbackData(busy.view), ['upd_check']);
});

test('result notification only for settled phases', () => {
    assert.match(buildTelegramUpdateResultText('success', 'zh-CN') || '', /v\d+\.\d+\.\d+/);
    assert.ok(buildTelegramUpdateResultText('failed', 'en'));
    assert.ok(buildTelegramUpdateResultText('unchanged', 'en'));
    assert.equal(buildTelegramUpdateResultText('running', 'en'), null);
});
