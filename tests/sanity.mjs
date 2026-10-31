import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const maintenance = readFileSync('maintenance.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);

assert.ok(scriptMatch, 'index.html should contain the game script');
new Script(scriptMatch[1], { filename: 'index.html' });

for (const id of [
  'game', 'stage', 'overlay', 'bottom-bar',
  'bar-fullscreen', 'bar-exit',
  'move-stick', 'stick-knob', 'jump-control'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing game control: ' + id);
}

assert.ok(html.includes('id="maintenance-screen"') && html.includes('src="./maintenance.html"'), 'The maintenance gate should cover the game during updates');
assert.ok(maintenance.includes("Please wait! We're fixing bugs and adding new features."), 'Maintenance copy should be present');
assert.match(scriptMatch[1], /if\(state==='playing'\)showBottomBar\(\)/, 'The bottom bar timer should restart after gameplay overlays close');
assert.match(scriptMatch[1], /\['playing','paused','levelComplete','robotWon'\]\.includes\(state\)/, 'The restart key should be limited to game states');
assert.match(scriptMatch[1], /function moveJoystick\(e\)/, 'Touch movement should use a draggable joystick');
assert.match(scriptMatch[1], /function resetJoystick\(\)/, 'The joystick should recenter when released');
assert.match(scriptMatch[1], /input\.jumpBuffer=0;resetJoystick\(\)/, 'Clearing input should reset the joystick');
assert.match(scriptMatch[1], /state==='playing'&&!touchDevice/, 'Touchscreen controls should not auto-hide during play');
assert.match(scriptMatch[1], /releasePointerCapture\(activePointer\)/, 'Joystick pointer capture should be released when reset');
assert.match(scriptMatch[1], /const TOTAL_LEVELS = 35/);
assert.match(scriptMatch[1], /const COINS_PER_LEVEL = 5/);
assert.match(scriptMatch[1], /const cropX = 520, cropY = 260, cropW = 505, cropH = 500/, 'Jupiter should use the character-focused crop');

const assetPaths = [...scriptMatch[1].matchAll(/\.src\s*=\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
assert.ok(assetPaths.length >= 3, 'Expected the Jupiter and both hat images');
for (const asset of assetPaths) {
  assert.ok(existsSync(asset), 'Missing game asset: ' + asset);
}

const jupiter = readFileSync('assets/601f2f8d-d595-494c-bd9e-6aaaf5fcdcea.png');
assert.equal(jupiter.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Jupiter asset should be a PNG');
assert.equal(jupiter.readUInt32BE(16), 1536, 'Unexpected Jupiter PNG width');
assert.equal(jupiter.readUInt32BE(20), 1024, 'Unexpected Jupiter PNG height');

console.log('Frog Jumper sanity checks passed.');
