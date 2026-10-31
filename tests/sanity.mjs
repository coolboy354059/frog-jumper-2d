import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);

assert.ok(scriptMatch, 'index.html should contain the game script');
new Script(scriptMatch[1], { filename: 'index.html' });

for (const id of [
  'game', 'stage', 'overlay', 'bottom-bar',
  'bar-fullscreen', 'bar-exit',
  'move-stick', 'stick-knob', 'pause-control', 'jump-control'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing game control: ' + id);
}

assert.match(scriptMatch[1], /if\(state==='playing'\)showBottomBar\(\)/, 'The bottom bar timer should restart after gameplay overlays close');
assert.match(scriptMatch[1], /\['playing','paused','levelComplete','robotWon'\]\.includes\(state\)/, 'The restart key should be limited to game states');
assert.match(scriptMatch[1], /function moveJoystick\(e\)/, 'Touch movement should use a draggable joystick');
assert.match(scriptMatch[1], /function resetJoystick\(\)/, 'The joystick should recenter when released');
assert.match(scriptMatch[1], /input\.jumpBuffer=0;if\(player\)player\.jumpBuffer=0;resetJoystick\(\)/, 'Clearing input should reset the joystick');
assert.match(scriptMatch[1], /if\(player\)player\.jumpBuffer=0/, 'Clearing input should cancel a queued player jump');
assert.match(scriptMatch[1], /const keyboardInput = \{left:false,right:false\}/, 'Keyboard directions should have their own input state');
assert.match(scriptMatch[1], /const joystickInput = \{left:false,right:false\}/, 'Joystick directions should have their own input state');
assert.match(scriptMatch[1], /syncHorizontalInput\(\)/, 'Keyboard and joystick directions should be combined without overwriting each other');
assert.match(scriptMatch[1], /state==='playing'&&!touchControlsAvailable/, 'Touchscreen controls should not auto-hide during play');
assert.match(scriptMatch[1], /releasePointerCapture\(activePointer\)/, 'Joystick pointer capture should be released when reset');
assert.match(scriptMatch[1], /function syncPauseControl\(\)/, 'Touch players should have a pause/resume control');
assert.match(scriptMatch[1], /pauseControl\.addEventListener\('click'/, 'Touch pause button should work');
assert.match(scriptMatch[1], /const useGameControls=!interactiveTarget\|\|e\.target===canvas/, 'Focused interface buttons should retain their native keyboard behavior');
assert.match(scriptMatch[1], /const TOTAL_LEVELS = 35/);
assert.match(scriptMatch[1], /const COINS_PER_LEVEL = 5/);
assert.match(scriptMatch[1], /const cropX = 520, cropY = 260, cropW = 505, cropH = 500/, 'Jupiter should use the character-focused crop');
assert.match(scriptMatch[1], /player\.jumpBuffer=0;player\.onGround=false/, 'Damage recovery should clear an old jump tap');
assert.match(scriptMatch[1], /!interactiveTarget\)startGame\('level'\)/, 'Enter should not override a focused menu button');
assert.match(scriptMatch[1], /drag the round joystick to move, tap the green button to jump/, 'Help should explain touch controls');
assert.match(scriptMatch[1], /makePlayer\(104,platforms\[0\]\.y-PLAYER_H\)/, 'Robot and frog should not overlap at the race start');
assert.match(scriptMatch[1], /Number\.isSafeInteger\(parsed\)/, 'Saved coin values should reject unsafe or partly numeric data');
assert.match(scriptMatch[1], /typeof ctx\.roundRect==='function'/, 'Canvas rounded rectangles should have a compatibility fallback');
assert.match(scriptMatch[1], /motionPreference\.addEventListener\('change'/, 'Reduced-motion preference should update while the game is open');
assert.match(scriptMatch[1], /navigator\.maxTouchPoints > 0/, 'Touch devices should be detected even without coarse-pointer media support');
assert.match(html, /html\.touch-device \.stage\{flex:0 0 auto;aspect-ratio:16\/10/, 'Touch gameplay should keep its correct aspect ratio');
assert.match(html, /env\(safe-area-inset-bottom\)/, 'Mobile layout should respect bottom safe-area insets');
assert.match(html, /orientation:landscape\) and \(max-height:520px\)/, 'Short landscape touch screens should fit the whole game and controls');
assert.match(html, /@media\(max-height:520px\)\{\.overlay\{align-items:flex-start;overflow-y:auto\}/, 'Overlay controls should remain reachable on short screens');
assert.match(html, /html\.touch-device \.stage\{width:min\(100%,calc\(\(100dvh - 164px\)\*1\.6\)\)/, 'Landscape sizing should use the shared touch-device detector');
assert.match(scriptMatch[1], /rect\.width-30/, 'Joystick knob should stay inside its outer ring');
assert.match(scriptMatch[1], /const deadZone=Math\.max\(4,rect\.width\*\.075\)/, 'Joystick should respond without a large dead zone');

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
