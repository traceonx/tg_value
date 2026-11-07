import { MTProtoSender } from 'telegram/network/index.js';

/*
 * GramJS 2.26 bug: when `_currentRetries > _reconnectRetries`, `_recvLoop`
 * returns without clearing `_recvLoopHandle`. Every later `_connect()` then
 * believes a receive loop is still running and never starts one, so the
 * client keeps "connecting" while no response is ever read: each ping times
 * out and the client reconnects forever. Clearing the handle whenever the
 * loop exits lets the next connect start a fresh receive loop.
 */

type RecvLoopSender = {
    _recvLoop: (...args: unknown[]) => Promise<unknown>;
    _recvLoopHandle?: unknown;
    __tgvaultRecvLoopRun?: object;
};

const PATCHED = Symbol.for('tgvault.recvLoopGuard');

export function installTelegramRecvLoopGuard(prototype: object = MTProtoSender.prototype): void {
    const target = prototype as RecvLoopSender & { [PATCHED]?: boolean };
    if (target[PATCHED]) return;
    const original = target._recvLoop;
    target._recvLoop = async function (this: RecvLoopSender, ...args: unknown[]) {
        const run = {};
        this.__tgvaultRecvLoopRun = run;
        try {
            return await original.apply(this, args);
        } finally {
            // Only clear our own handle: a newer loop replaces the marker.
            if (this.__tgvaultRecvLoopRun === run) this._recvLoopHandle = undefined;
        }
    };
    target[PATCHED] = true;
}

installTelegramRecvLoopGuard();
