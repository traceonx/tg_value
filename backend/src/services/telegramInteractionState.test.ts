import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramInteractionStore } from './telegramInteractionState.js';

interface WizardPayload {
    kind: 'date' | 'tag';
    step: string;
}

test('moving to a new mode message accepts its buttons and rejects the old keyboard', () => {
    const store = new TelegramInteractionStore<WizardPayload>();
    store.set({ userId: 7, chatKey: '7', kind: 'date', step: 'path', originMessageId: 11, value: { kind: 'date', step: 'path' } });
    store.update(7, '7', { kind: 'date', step: 'mode', originMessageId: 22, value: { kind: 'date', step: 'mode' } });
    for (const action of ['mode_date', 'mode_tag']) {
        const input = { userId: 7, chatKey: '7', messageId: 22, action, allowedActions: ['mode_date', 'mode_tag'] };
        assert.equal(store.validateCallback(input).ok, true);
        assert.deepEqual(store.validateCallback({ ...input, messageId: 11 }), { ok: false, reason: 'message-mismatch' });
        assert.equal(store.validateCallback({ ...input, userId: 8 }).ok, false);
        assert.equal(store.validateCallback({ ...input, chatKey: '8' }).ok, false);
    }
});

test('interaction state is isolated by user and canonical chat key', () => {
    const store = new TelegramInteractionStore<WizardPayload>({ ttlMs: 15 * 60_000, maxEntries: 10, now: () => 1_000 });
    store.set({ userId: 7, chatKey: '100', kind: 'wizard', step: 'source', originMessageId: 11, value: { kind: 'date', step: 'source' } });
    store.set({ userId: 7, chatKey: '-100200', kind: 'wizard', step: 'tag', originMessageId: 22, value: { kind: 'tag', step: 'tag' } });

    assert.equal(store.get(7, '100')?.value.kind, 'date');
    assert.equal(store.get(7, '-100200')?.value.kind, 'tag');
    assert.equal(store.get(8, '100'), undefined);
});

test('starting a new interaction replaces only the same user and chat scope', () => {
    let now = 1_000;
    const store = new TelegramInteractionStore<WizardPayload>({ ttlMs: 1_000, maxEntries: 10, now: () => now });
    store.set({ userId: 7, chatKey: '100', kind: 'wizard', step: 'source', originMessageId: 11, value: { kind: 'date', step: 'source' } });
    store.set({ userId: 7, chatKey: '200', kind: 'wizard', step: 'tag', originMessageId: 22, value: { kind: 'tag', step: 'tag' } });
    now = 1_100;
    store.set({ userId: 7, chatKey: '100', kind: 'wizard', step: 'confirm', originMessageId: 33, value: { kind: 'tag', step: 'confirm' } });

    assert.equal(store.get(7, '100')?.originMessageId, 33);
    assert.equal(store.get(7, '200')?.originMessageId, 22);
    assert.equal(store.size, 2);
});

test('expired interactions are removed and callbacks fail closed on actor chat message or action mismatch', () => {
    let now = 5_000;
    const store = new TelegramInteractionStore<WizardPayload>({ ttlMs: 500, maxEntries: 10, now: () => now });
    store.set({ userId: 7, chatKey: '-100200', kind: 'wizard', step: 'mode', originMessageId: 44, value: { kind: 'date', step: 'mode' } });

    assert.equal(store.validateCallback({ userId: 7, chatKey: '-100200', messageId: 44, action: 'date', allowedActions: ['date', 'tag'] }).ok, true);
    assert.equal(store.validateCallback({ userId: 8, chatKey: '-100200', messageId: 44, action: 'date', allowedActions: ['date'] }).ok, false);
    assert.equal(store.validateCallback({ userId: 7, chatKey: '999', messageId: 44, action: 'date', allowedActions: ['date'] }).ok, false);
    assert.equal(store.validateCallback({ userId: 7, chatKey: '-100200', messageId: 45, action: 'date', allowedActions: ['date'] }).ok, false);
    assert.equal(store.validateCallback({ userId: 7, chatKey: '-100200', messageId: 44, action: 'delete', allowedActions: ['date'] }).ok, false);

    now = 5_501;
    assert.equal(store.lookup(7, '-100200').status, 'expired');
    assert.equal(store.get(7, '-100200'), undefined);
    const expired = store.validateCallback({ userId: 7, chatKey: '-100200', messageId: 44, action: 'date', allowedActions: ['date'] });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, 'expired-or-missing');
});

test('updating an active interaction refreshes TTL without changing its origin', () => {
    let now = 100;
    const store = new TelegramInteractionStore<WizardPayload>({ ttlMs: 1_000, maxEntries: 10, now: () => now });
    store.set({ userId: 7, chatKey: '100', kind: 'wizard', step: 'source', originMessageId: 11, value: { kind: 'date', step: 'source' } });
    now = 900;
    const updated = store.update(7, '100', { kind: 'wizard', step: 'confirm', value: { kind: 'date', step: 'confirm' } });
    assert.equal(updated?.createdAt, 100);
    assert.equal(updated?.originMessageId, 11);
    assert.equal(updated?.expiresAt, 1_900);
    now = 1_101;
    assert.equal(store.get(7, '100')?.step, 'confirm');
});

test('capacity is bounded by evicting the oldest interaction', () => {
    let now = 0;
    const store = new TelegramInteractionStore<WizardPayload>({ ttlMs: 10_000, maxEntries: 2, now: () => now });
    store.set({ userId: 1, chatKey: '1', kind: 'wizard', step: 'a', value: { kind: 'date', step: 'a' } });
    now = 1;
    store.set({ userId: 2, chatKey: '2', kind: 'wizard', step: 'b', value: { kind: 'date', step: 'b' } });
    now = 2;
    store.set({ userId: 3, chatKey: '3', kind: 'wizard', step: 'c', value: { kind: 'tag', step: 'c' } });

    assert.equal(store.get(1, '1'), undefined);
    assert.equal(store.get(2, '2')?.step, 'b');
    assert.equal(store.get(3, '3')?.step, 'c');
    assert.equal(store.size, 2);
});
