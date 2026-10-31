import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const maintenance = readFileSync('maintenance.html', 'utf8');
const scriptMatch = html.match(/<script>([\\s\\S]*?)<\\/script>/i);

assert.ok(scriptMatch, 'index.html should contain the game script');
new Script(scriptMatch[1], { filename: 'index.html' });

for (const id of [
  'game', 'stage', 'overlay', 'bottom-bar',
  'bar-fullscreen', 'bar-exit',
  'left-control', 'right-control', 'jump-control'
]) {
  assert.match(html, new RegExp('id=["\\\\']' + id + '["\\\\']'), 'Missing game control: ' + id);
}

assert.ok(html.includes('src="./maintenance.html"'), 'The home page should display the standalone maintenance page');
assert.ok(maintenance.includes('Please wait! We\'re fixing bugs and adding new features.'), 'Maintenance copy should be present');
assert.match(scriptMatch[1], /if\\(state==='playing'\\)showBottomBar\\(\\)/, 'The bottom bar timer should restart after gameplay overlays close');
assert.match(scriptMatch[1], /\\['playing','paused','levelComplete','robotWon'\\]\\.includes\\(state\\)/, 'The restart key should be limited to game states');
assert.match(scriptMatch[1], /const TOTAL_LEVELS = 35/);
assert.match(scriptMatch[1], /const COINS_PER_LEVEL = 5/);

const assetPaths = [...scriptMatch[1].matchAll(/\\.src\\s*=\\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
assert.ok(assetPaths.length >= 3, 'Expected the Jupiter and both hat images');
for (const asset of assetPaths) {
  assert.ok(existsSync(asset), 'Missing game asset: ' + asset);
}

const jupiter = readFileSync('assets/601f2f8d-d595-494c-bd9e-6aaaf5fcdcea.png');
assert.equal(jupiter.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Jupiter asset should be a PNG');
assert.equal(jupiter.readUInt32BE(16), 1536, 'Unexpected Jupiter PNG width');
assert.equal(jupiter.readUInt32BE(20), 1024, 'Unexpected Jupiter PNG height');

console.log('Frog Jumper sanity checks passed.');
