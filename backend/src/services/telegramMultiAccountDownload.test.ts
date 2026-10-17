import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const upload = fs.readFileSync(new URL('./telegramUpload.ts', import.meta.url), 'utf8');
const jobs = fs.readFileSync(new URL('./telegramChannelJobs.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

test('channel downloads select an account for the source and keep the selected client for a claimed batch', () => {
    assert.match(upload, /selectTelegramDownloadAccount\(String\(source\), \{ waitForCapacity: true, signal: taskSignal \}\)/);
    assert.match(upload, /selectedDownloadAccount\?\.client/);
    assert.match(upload, /finally[\s\S]*selectedDownloadAccount\?\.release\(\)/);
    assert.doesNotMatch(upload, /Promise\.all\([^)]*selectTelegramDownloadAccount/);
});

test('download jobs persist account assignment and attempt audit tables without changing child lease ownership', () => {
    assert.match(schema, /assigned_account_id/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS telegram_download_attempts/);
    assert.match(schema, /lease_token UUID/);
    assert.match(jobs, /lease_token|withTelegramDownloadRefLease/);
});

test('FloodWait and inaccessible sources update the selected account instead of global user state', () => {
    assert.match(upload, /markTelegramAccountCooldown/);
    assert.match(upload, /markTelegramAccountSourceAccess/);
    assert.match(upload, /markTelegramAccountSessionExpired/);
    assert.doesNotMatch(jobs, /recordTelegramUserClientFailure\('permission_denied'/);
});
