import assert from 'node:assert/strict';
import test from 'node:test';
import { MTProtoSender } from 'telegram/network/index.js';
import { installTelegramRecvLoopGuard } from './telegramRecvLoopGuard.js';

const quietLog = { debug() {}, info() {}, warn() {}, error() {}, canSend: () => false };

function strandedSender() {
    // Real GramJS sender state after more failed reconnects than reconnectRetries.
    const sender = Object.create(MTProtoSender.prototype) as any;
    Object.assign(sender, {
        _userConnected: true, isReconnecting: false, userDisconnected: false,
        _currentRetries: 6, _reconnectRetries: 5, _pendingState: new Map(), _log: quietLog,
        _connection: { recv: async () => { throw new Error('connection closed'); } },
    });
    return sender;
}

test('GramJS receive loop that gives up no longer leaves a stale handle behind', async () => {
    const sender = strandedSender();
    sender._recvLoopHandle = sender._recvLoop();
    await sender._recvLoopHandle;
    assert.equal(sender._recvLoopHandle, undefined, 'next _connect() must be able to start a receive loop');
    assert.equal(sender.userDisconnected, true);
});

test('the guard never clears a newer loop handle', async () => {
    const releases: Array<() => void> = [];
    const proto = { _recvLoop() { return new Promise<void>(resolve => { releases.push(resolve); }); } } as any;
    installTelegramRecvLoopGuard(proto);
    installTelegramRecvLoopGuard(proto); // idempotent
    const sender = Object.create(proto);
    const first = sender._recvLoop();
    const newer = sender._recvLoop();
    sender._recvLoopHandle = newer;
    releases[0]();
    await first;
    assert.equal(sender._recvLoopHandle, newer, 'an older loop exiting must not clear the running one');
    releases[1]();
    await newer;
    assert.equal(sender._recvLoopHandle, undefined);
});
