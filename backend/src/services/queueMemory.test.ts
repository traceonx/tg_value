import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

for (const outcome of ['success', 'cancelled', 'active_cancelled', 'retry']) {
    test(`${outcome} tasks release captured data while preserving history`, () => {
        const script = `
            import assert from 'node:assert/strict';
            import { setImmediate } from 'node:timers/promises';
            import { DownloadTaskQueue } from ${JSON.stringify(new URL('./downloadTaskQueue.ts', import.meta.url).href)};
            const queue = new DownloadTaskQueue();
            queue.ensureGroup({ id: 'g', kind: 'single', title: 'g', chatId: 'c' });
            const outcome = ${JSON.stringify(outcome)};
            if (outcome === 'cancelled') queue.pauseAll();
            function submit() {
                const payload = Buffer.alloc(1024 * 1024, 1);
                const ref = new WeakRef(payload);
                let attempts = 0;
                const done = queue.add('g', 'file', async signal => {
                    assert.equal(payload[0], 1);
                    if (outcome === 'active_cancelled') await new Promise(resolve => {
                        signal.addEventListener('abort', () => { assert.equal(payload[0], 1); resolve(); });
                    });
                    if (outcome === 'retry' && attempts++ === 0) throw new Error('retry me');
                }, 0, () => { assert.equal(payload[0], 1); });
                return { ref, done };
            }
            let { ref, done } = submit();
            if (outcome.includes('cancelled')) queue.cancelGroup('g');
            await done.catch(() => {});
            done = null;
            if (outcome === 'retry') {
                assert.equal((await queue.retryFailed()).retried, 1);
                await setImmediate();
            }
            for (let i = 0; i < 12; i++) { await setImmediate(); global.gc(); }
            assert.ok(ref.deref() === undefined, 'history retains completed task payload');
            assert.equal(queue.getDetailedStatus().history.length, 1);
            assert.equal(queue.getDetailedStatus().history[0].status, outcome.includes('cancelled') ? 'cancelled' : 'success');
        `;
        const result = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', script], {
            encoding: 'utf8', timeout: 20_000,
        });
        assert.equal(result.status, 0, result.error?.message || result.stderr);
    });
}
