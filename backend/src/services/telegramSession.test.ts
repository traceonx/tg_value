import assert from 'node:assert/strict';
import test from 'node:test';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { StringSession } from 'telegram/sessions/index.js';
import { AuthKey } from 'telegram/crypto/AuthKey.js';
import { TelegramSession } from './telegramSession.js';

class InspectableSession extends TelegramSession {
    get size() { return this._entities.size; }
}

function chat(id: number, title = 'chat') {
    return new Api.Chat({ id: bigInt(id), title } as ConstructorParameters<typeof Api.Chat>[0]);
}

test('repeated Telegram responses retain one row per peer and refresh its data', () => {
    const session = new InspectableSession('');
    for (let i = 0; i < 10_000; i++) session.processEntities({ chats: [chat(123, `chat-${i}`)] });
    assert.equal(session.size, 1);
    assert.equal(session.getEntityRowsByName('chat-0'), undefined);
    assert.ok(session.getEntityRowsByName('chat-9999'));
    assert.equal((session.getInputEntity('chat-9999') as Api.InputPeerChat).chatId.toString(), '123');
});

test('session cache bounds distinct peers and keeps recently refreshed peers', () => {
    const session = new InspectableSession('');
    for (let i = 1; i <= 10_000; i++) session.processEntities({ chats: [chat(i)] });
    session.processEntities({ chats: [chat(1), chat(10_001)] });
    assert.equal(session.size, 10_000);
    assert.ok(session.getEntityRowsById('-1'));
    assert.equal(session.getEntityRowsById('-2'), undefined);
    assert.ok(session.getEntityRowsById('-10001'));
});

test('existing saved sessions round-trip without changing authentication data', async () => {
    const original = new StringSession('');
    original.setDC(2, '149.154.167.51', 443);
    const key = new AuthKey();
    await key.setKey(Buffer.alloc(256, 7));
    original.authKey = key;
    const saved = original.save();
    const session = new TelegramSession(saved);
    await session.load();
    session.processEntities({ chats: [chat(123)] });
    assert.equal(session.save(), saved);
    assert.deepEqual(session.authKey?.getKey(), original.authKey.getKey());
});

test('users and channels with the same numeric ID remain distinct and update access hashes', () => {
    const session = new InspectableSession('');
    const user = (hash: number, username: string) => new Api.User({
        id: bigInt(123), accessHash: bigInt(hash), firstName: 'User', username,
    });
    const channel = new Api.Channel({ id: bigInt(123), accessHash: bigInt(5), title: 'Channel', broadcast: true } as ConstructorParameters<typeof Api.Channel>[0]);
    session.processEntities({ users: [user(1, 'oldname')], chats: [chat(123), channel] });
    session.processEntities({ users: [user(2, 'newname')] });
    assert.equal(session.size, 3);
    assert.equal(session.getEntityRowsByUsername('oldname'), undefined);
    assert.equal((session.getInputEntity('newname') as Api.InputPeerUser).accessHash.toString(), '2');
    assert.equal((session.getInputEntity('Channel') as Api.InputPeerChannel).accessHash.toString(), '5');
});
