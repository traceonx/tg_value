import assert from 'node:assert/strict';
import test from 'node:test';
import { installTelegramSenderConnectionGuard } from './telegramSenderConnection.js';
import { runTelegramDownloadWorkers } from './telegramDownloadWorkers.js';

test('concurrent borrows share one reconnect per DC and release the guard afterwards', async () => {
    let calls = 0;
    const client = { async _connectSender(sender: unknown, _dcId: number) { calls++; await Promise.resolve(); return sender; } };
    installTelegramSenderConnectionGuard(client);
    const sender = {};
    const results = await Promise.all(Array.from({ length: 8 }, () => client._connectSender(sender, 2)));
    assert.equal(calls, 1);
    assert.ok(results.every(value => value === sender));
    await client._connectSender(sender, 2);
    assert.equal(calls, 2);
});

test('failed worker waits for remaining workers to exit before file teardown or retry', async () => {
    const events: string[] = [];
    const original = new Error('disk failure');
    await assert.rejects(runTelegramDownloadWorkers(2, async (index, signal) => {
        if (index === 0) throw original;
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(signal.aborted, true);
        events.push('worker-exited');
    }).finally(() => events.push('file-closed')), error => error === original);
    assert.deepEqual(events, ['worker-exited', 'file-closed']);
});
