import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../routes/system.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const bot = fs.readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
const version = fs.readFileSync(new URL('./appVersion.ts', import.meta.url), 'utf8');

test('update API requires Web authentication and never caches status', () => {
    assert.match(app, /app\.use\('\/api\/system', createSystemRouter\(updateChecker\)\)/);
    assert.match(route, /router\.get\('\/update-status', requireAuth/);
    assert.match(route, /router\.post\('\/update-check', requireAuth, manualCheckLimiter/);
    assert.match(route, /Cache-Control', 'no-store'/);
    assert.match(route, /router\.get\('\/docker-update', requireAuth/);
    assert.match(route, /router\.post\('\/docker-update', requireAuth, manualCheckLimiter/);
    assert.match(route, /req\.is\('application\/json'\)/);
    assert.match(route, /req\.body\?\.confirm !== true/);
});

test('update checker is optional infrastructure and never participates in readiness', () => {
    const readyRoute = app.slice(app.indexOf("app.get('/readyz'"), app.indexOf("app.get('/health'"));
    assert.doesNotMatch(readyRoute, /updateChecker|updateAvailable/);
    assert.match(app, /UPDATE_CHECK_ENABLED/);
    assert.match(app, /6 \* 60 \* 60 \* 1000/);
    assert.match(app, /Number\.isFinite\(configuredIntervalMs\)/);
});

test('release version comes from backend package metadata and notification delivery is durable', () => {
    assert.match(version, /packageJson\.version/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS update_notification_deliveries/);
    assert.match(schema, /PRIMARY KEY \(version, channel, recipient_id\)/);
    assert.match(bot, /sendUpdateNotificationToUser/);
});
