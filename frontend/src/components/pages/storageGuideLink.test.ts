import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const settings = fs.readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8');

const storageGuideUrl = 'https://github.com/traceonx/tg_value/blob/docker-hub/docs/storage.md';

test('storage setup guide opens this project storage documentation', () => {
    assert.match(settings, new RegExp(`href=["']${storageGuideUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
    assert.match(settings, /target="_blank"/);
    assert.match(settings, /rel="noopener noreferrer"/);
});
