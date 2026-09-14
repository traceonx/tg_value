import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runTelegramAccountAccessSweep, type TelegramAccessScope } from './telegramAccountAccessSweep.js';

test('legacy discussion scopes cannot cause a discussion read', async () => {
    const requests: Record<string, unknown>[] = [];
    const summary = await runTelegramAccountAccessSweep({
        async listTelegramAccounts() { return [{ accountId: 'account', enabled: true }]; },
        async listTelegramChannelSubscriptions() {
            return [{ sourceId: 'source', source: '@channel', enabled: true,
                scopes: ['channel', 'comments'] as unknown as TelegramAccessScope[] }];
        },
        async getTelegramAccountRuntime() {
            return { client: {
                async getEntity() { return {}; },
                async getMessages(_peer, options) { requests.push(options); return [{ id: 10 }]; },
            } };
        },
        async markTelegramAccountSourceAccess() {},
    });
    assert.equal(summary.counts.probes, 1);
    assert.deepEqual(requests, [{ limit: 1 }]);
});

test('channel jobs cannot read discussions or claim legacy discussion items', () => {
    const jobs = fs.readFileSync(new URL('./telegramChannelJobs.ts', import.meta.url), 'utf8');
    const bot = fs.readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(jobs, /replyTo\s*:|GetReplies|GetDiscussionMessage|includeComments|getDiscussionMediaRefs/);
    assert.doesNotMatch(bot, /tgd_comments|includeComments|buildTelegramCommentsKeyboard/);
    const claim = jobs.slice(jobs.indexOf('async function claimPendingDownloadRefs'), jobs.indexOf('export async function restoreTelegramDownloadRefsWithQuery'));
    assert.match(claim, /AND i\.origin = 'channel'/);
});
