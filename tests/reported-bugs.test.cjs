'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const game = read('index-game.html');

test('the shared URL offers the same social preview as the game page', () => {
  const previewTags = html => html.match(/<meta (?:property="og:|name="twitter:)[^>]+>/g);
  const gamePreview = previewTags(game);
  assert.equal(gamePreview.length, 9);
  assert.deepEqual(previewTags(read('index.html')), gamePreview);
});

test('test-only pushes skip Pages while game changes and manual dispatch are eligible', () => {
  const workflow = read('.github/workflows/pages.yml');
  const section = workflow.match(/^on:\r?\n([\s\S]+?)\r?\n\r?\n/m)[1];
  assert.match(section, /^    branches: \["main"\]/m);
  assert.match(section, /^  workflow_dispatch:$/m);
  const paths = [...section.matchAll(/^      - (.+)$/gm)].map(match => match[1]);
  const triggersPush = files => files.some(file => paths.some(pattern =>
    pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern));
  assert.equal(triggersPush(['tests/game.test.cjs', '.github/workflows/test.yml']), false);
  assert.equal(triggersPush(['index-game.html']), true);
  assert.equal(triggersPush(['tests/game.test.cjs', 'assets/poppy-skin.png']), true);
});

test('Playwright reruns replace the status on the same commit', async () => {
  const workflow = read('.github/workflows/test.yml');
  const script = workflow.split(/\r?\n {10}script: \|\r?\n/)[1];
  const calls = [];
  const github = { rest: { repos: { createCommitStatus: async status => calls.push(status) } } };
  const context = { repo: { owner: 'owner', repo: 'game' }, sha: 'commit', runId: 9, serverUrl: 'https://github.com' };
  const run = Function('process', 'github', 'context', 'return (async () => {' + script + '})();');
  for (const outcome of ['success', 'failure', 'success']) {
    await run({ env: { TEST_OUTCOME: outcome, FAILED_TESTS: 'pixel mismatch' } }, github, context);
  }
  assert.deepEqual(calls.map(call => call.state), ['success', 'failure', 'success']);
  assert.deepEqual([...new Set(calls.map(call => call.context))], ['frog-jumper/playwright']);
  assert.equal(calls[1].description, 'pixel mismatch');
});
