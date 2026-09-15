import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramRequestGate } from './telegramRequestGate.js';

test('short file-read flood waits resume the same operation without restarting the file', async () => {
    let now = 0;
    let calls = 0;
    const gate = new TelegramRequestGate(0, () => now, async ms => { now += ms; });
    const value = await gate.runFileRead(async () => {
        calls++;
        if (calls === 1) throw { errorMessage: 'FLOOD', seconds: 2 };
        assert.ok(now >= 2000);
        return 'same-offset-chunk';
    });
    assert.equal(value, 'same-offset-chunk');
    assert.equal(calls, 2);
});

test('another file waits for shared cooldown, while long waits and revoked sessions propagate', async () => {
    let now = 0;
    const gate = new TelegramRequestGate(0, () => now, async ms => { now += ms; });
    gate.stop({ errorMessage: 'FLOOD', seconds: 1 });
    assert.equal(await gate.runFileRead(async () => { assert.ok(now >= 1000); return 1; }), 1);
    gate.stop({ errorMessage: 'FLOOD', seconds: 120 });
    await assert.rejects(gate.runFileRead(async () => assert.fail('read during long wait')));
    gate.stop(new Error('SESSION_REVOKED'));
    await assert.rejects(gate.runFileRead(async () => assert.fail('read revoked session')), /expired/);
});

test('flood blocks reads, media and fallback sends on one identity only', async () => {
    let now = 0;
    const user = new TelegramRequestGate(0, () => now);
    const bot = new TelegramRequestGate(0, () => now);
    let calls = 0;
    await assert.rejects(user.run(async () => { throw { errorMessage: 'FLOOD_WAIT', seconds: 60 }; }));
    for (const paced of [true, false]) await assert.rejects(user.run(async () => ++calls, paced));
    assert.equal(calls, 0);
    assert.equal(await bot.run(async () => 'list response'), 'list response');
    now = 60_000;
    assert.equal(await user.run(async () => ++calls), 1);
});

test('admission spaces concurrent reads and permits nested entity resolution', async () => {
    let now = 0;
    const starts: number[] = [];
    const gate = new TelegramRequestGate(500, () => now, async ms => { now += ms; });
    await gate.run(async () => gate.run(async () => { starts.push(now); }));
    await gate.run(async () => { starts.push(now); });
    assert.deepEqual(starts, [500, 1000]);
});

test('expired authorization never resumes and shorter waits cannot shorten cooldown', async () => {
    let now = 0;
    const gate = new TelegramRequestGate(0, () => now);
    gate.stop({ errorMessage: 'FLOOD_WAIT', seconds: 100 });
    gate.stop({ errorMessage: 'FLOOD_WAIT', seconds: 1 });
    now = 2000;
    assert.throws(() => gate.check());
    gate.stop(new Error('AUTH_KEY_DUPLICATED'));
    now = 1_000_000;
    assert.throws(() => gate.check(), /expired/);
});
