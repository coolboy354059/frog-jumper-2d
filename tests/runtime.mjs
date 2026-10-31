import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(scriptMatch, 'Game script should exist');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: value => this.classes.add(value),
      remove: value => this.classes.delete(value),
      contains: value => this.classes.has(value)
    };
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.pointerCaptures = new Set();
    this.interactive = false;
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) {
      callback({ preventDefault() {}, pointerId: 1, ...event });
    }
  }
  querySelector() { return new FakeElement('generated-button'); }
  querySelectorAll() { return []; }
  closest() { return this.interactive ? this : null; }
  focus() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 68, height: 68 }; }
  setPointerCapture(id) { this.pointerCaptures.add(id); }
  hasPointerCapture(id) { return this.pointerCaptures.has(id); }
  releasePointerCapture(id) { this.pointerCaptures.delete(id); }
}

function bootGame({ touch = false } = {}) {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const contextCalls = { arcTo: 0 };
  const gradient = { addColorStop() {} };
  const drawingContext = new Proxy({
    roundRect: undefined,
    createLinearGradient: () => gradient,
    arcTo: () => { contextCalls.arcTo++; }
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  const canvas = getElement('game');
  canvas.width = 960;
  canvas.height = 600;
  canvas.getContext = () => drawingContext;

  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const documentListeners = new Map();
  const document = {
    hidden: false,
    documentElement: getElement('document-root'),
    getElementById: getElement,
    querySelectorAll: selector => selector === '.control' ? [getElement('jump-control')] : [],
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    },
    dispatch(type, event) {
      for (const callback of documentListeners.get(type) || []) callback(event);
    }
  };
  let timeoutCount = 0;
  const mediaQueries = [];
  const window = {
    localStorage,
    matchMedia(query) {
      return {
        matches: false,
        addEventListener(type, callback) { mediaQueries.push({ query, type, callback }); },
        addListener(callback) { mediaQueries.push({ query, type: 'change', callback }); }
      };
    },
    setTimeout() { timeoutCount++; return timeoutCount; },
    clearTimeout() {},
    addEventListener() {},
    close() {}
  };
  class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(value) { this._src = value; }
    get src() { return this._src; }
  }
  const navigator = { maxTouchPoints: touch ? 2 : 0 };
  const sandbox = {
    window, document, navigator, Image: FakeImage,
    requestAnimationFrame: () => 1,
    console,
    Math,
    Number,
    String,
    JSON,
    Set,
    Map
  };
  const injectedHooks = [
    '  window.__frogTest = {',
    '    getLevels: () => LEVELS,',
    '    setupLevel,',
    '    getPlatforms: () => platforms,',
    '    getCoins: () => coins,',
    '    getPlayer: () => player,',
    '    getRobot: () => robot,',
    '    getLives: () => lives,',
    '    getTotalCoins: () => totalCoins,',
    '    getCoinsThisLevel: () => coinsThisLevel,',
    '    getWalletCoins: () => walletCoins,',
    '    getState: () => state,',
    '    getInput: () => input,',
    '    readStoredNumber,',
    '    loadShopData,',
    '    startGame,',
    '    restartCurrentLevel,',
    '    returnToMenu,',
    '    requestJump,',
    '    hurt,',
    '    update,',
    '    updateRobot,',
    '    setState: value => { state = value; },',
    '    completeLevel,',
    '    moveJoystick,',
    '    resetJoystick,',
    '    clearInputs,',
    '    showBottomBar',
    '  };',
    '  setupLevel(0);'
  ].join('\n');
  const instrumented = scriptMatch[1].replace('  setupLevel(0);', injectedHooks);
  assert.notEqual(instrumented, scriptMatch[1], 'Test hooks should be injected');
  runInContext(instrumented, createContext(sandbox), { filename: 'frog-jumper-runtime.js' });
  return {
    hooks: window.__frogTest,
    storage,
    elements,
    document,
    getTimeoutCount: () => timeoutCount,
    contextCalls
  };
}

const desktop = bootGame();
const hooks = desktop.hooks;
const levels = hooks.getLevels();

assert.equal(levels.length, 35, 'The game should generate exactly 35 levels');
assert.equal(new Set(levels.map(level => level.name)).size, 35, 'Every level should have a unique name');

for (const [index, level] of levels.entries()) {
  const levelName = 'Level ' + (index + 1);
  assert.equal(level.platforms.length, 9, levelName + ' should have nine platforms');
  assert.equal(level.platforms[0][0], 0, levelName + ' should start at x=0');
  for (let i = 0; i < level.platforms.length; i++) {
    const platform = level.platforms[i];
    assert.ok(Number.isFinite(platform[0]) && Number.isFinite(platform[1]) && Number.isFinite(platform[2]), levelName + ' platform ' + i + ' should have finite geometry');
    assert.ok(platform[2] >= 82, levelName + ' platform ' + i + ' should not be too narrow');
    if (i > 0) {
      const previous = level.platforms[i - 1];
      const gap = platform[0] - (previous[0] + previous[2]);
      const rise = previous[1] - platform[1];
      assert.ok(gap >= 0 && gap <= 150, levelName + ' platform gap ' + i + ' should be reasonable');
      assert.ok(rise <= 140, levelName + ' platform rise ' + i + ' should be within the frog jump range');
      const jumpSpeed = 655;
      const gravity = 1580;
      const jumpHeight = (jumpSpeed * jumpSpeed) / (2 * gravity);
      assert.ok(rise <= jumpHeight, levelName + ' platform rise ' + i + ' must not exceed the frog jump height');
      const discriminant = jumpSpeed * jumpSpeed - 2 * gravity * rise;
      const landingTime = (jumpSpeed + Math.sqrt(discriminant)) / gravity;
      const moveSpeed = 292 + Math.min(12, Math.floor(index / 5) * 2);
      const horizontalReach = moveSpeed * landingTime + 32;
      assert.ok(gap <= horizontalReach + 1, levelName + ' gap ' + i + ' should be reachable with the frog jump and platform-edge overhang');
    }
  }
  assert.ok(level.platforms.at(-1)[2] >= 350, levelName + ' finish platform should be wide enough');
  for (const enemyIndex of level.enemies) {
    assert.ok(Number.isInteger(enemyIndex) && enemyIndex >= 0 && enemyIndex < level.platforms.length, levelName + ' enemy must reference a real platform');
  }
  for (const mover of level.movers) {
    assert.ok(Number.isInteger(mover.index) && mover.index >= 0 && mover.index < level.platforms.length, levelName + ' mover must reference a real platform');
    assert.ok(mover.amp >= 0 && mover.speed > 0, levelName + ' mover settings should be valid');
  }
  hooks.setupLevel(index);
  assert.equal(hooks.getCoins().length, 5, levelName + ' should create five coins');
  assert.equal(JSON.stringify(hooks.getCoins().map(coin => coin.platformId)), JSON.stringify([1, 2, 3, 4, 5]), levelName + ' coins should attach to the expected platforms');
}

desktop.storage.set('bad-number', '17coins');
assert.equal(hooks.readStoredNumber('bad-number', 9), 9, 'Partly numeric saved values should use the fallback');
desktop.storage.set('unsafe-number', '9007199254740993');
assert.equal(hooks.readStoredNumber('unsafe-number', 9), 9, 'Unsafe saved integers should use the fallback');
desktop.storage.set('negative-number', '-12');
assert.equal(hooks.readStoredNumber('negative-number', 9), 0, 'Saved coin totals should never be negative');
desktop.storage.set('good-number', '123');
assert.equal(hooks.readStoredNumber('good-number', 9), 123, 'Valid saved totals should load');

desktop.storage.set('frogJumperShop', JSON.stringify({
  ownedSkins: ['jupiter', 'unknown', 'jupiter'],
  ownedHats: ['tv', 'invalid', 'black'],
  equippedSkin: 'jupiter',
  equippedHat: 'tv'
}));
const shop = hooks.loadShopData();
assert.equal(JSON.stringify(shop.ownedSkins), JSON.stringify(['red', 'jupiter']), 'Shop should remove unknown/duplicate skins');
assert.equal(JSON.stringify(shop.ownedHats), JSON.stringify(['tv', 'black']), 'Shop should remove unknown/duplicate hats');
assert.equal(shop.equippedSkin, 'jupiter');
assert.equal(shop.equippedHat, 'tv');
desktop.storage.set('frogJumperShop', JSON.stringify({
  ownedSkins: 'jupiter',
  ownedHats: 'tv',
  equippedSkin: 'jupiter',
  equippedHat: 'tv'
}));
const malformedShop = hooks.loadShopData();
assert.equal(malformedShop.equippedSkin, 'red', 'Malformed cosmetic data must not equip an unowned skin');
assert.equal(malformedShop.equippedHat, 'none', 'Malformed cosmetic data must not equip an unowned hat');

hooks.startGame('race');
const player = hooks.getPlayer();
const robot = hooks.getRobot();
assert.ok(robot.x > player.x + player.w, 'Robot should start slightly ahead without overlapping the frog');

hooks.startGame('level');
hooks.getPlayer().jumpBuffer = 0.12;
hooks.clearInputs();
assert.equal(hooks.getPlayer().jumpBuffer, 0, 'Pausing or clearing inputs should discard a buffered jump');
hooks.getPlayer().jumpBuffer = 0.12;
hooks.hurt();
assert.equal(hooks.getPlayer().jumpBuffer, 0, 'Damage should discard a buffered jump');
assert.equal(hooks.getLives(), 2, 'A normal hit should remove exactly one life');

hooks.returnToMenu();
desktop.document.dispatch('keydown', { code: 'KeyR', repeat: false, target: new FakeElement('canvas'), preventDefault() {} });
assert.equal(hooks.getState(), 'menu', 'R should not start a game from the title screen');
const menuButton = new FakeElement('robot-race-button');
menuButton.interactive = true;
let spaceWasPrevented = false;
desktop.document.dispatch('keydown', {
  code: 'Space',
  repeat: false,
  target: menuButton,
  preventDefault() { spaceWasPrevented = true; }
});
assert.equal(spaceWasPrevented, false, 'Space should remain available to activate a focused menu button');
desktop.document.dispatch('keydown', {
  code: 'Enter',
  repeat: false,
  target: menuButton,
  preventDefault() {}
});
assert.equal(hooks.getState(), 'menu', 'Enter on a focused menu button should not trigger a different menu action');

desktop.document.dispatch('keydown', {
  code: 'Enter',
  repeat: false,
  target: new FakeElement('canvas'),
  preventDefault() {}
});
assert.equal(hooks.getState(), 'playing', 'Enter on the non-interactive game surface should start Level Adventure');

const input = hooks.getInput();
hooks.moveJoystick({ clientX: 65, clientY: 34 });
assert.equal(input.right, true, 'Dragging the joystick to the right should move right');
hooks.resetJoystick();
assert.equal(input.left, false);
assert.equal(input.right, false);
desktop.document.dispatch('keydown', { code: 'ArrowRight', repeat: false, target: new FakeElement('canvas'), preventDefault() {} });
hooks.moveJoystick({ clientX: 0, clientY: 34 });
assert.equal(input.left, true, 'Joystick should still set its own direction while a keyboard direction is held');
assert.equal(input.right, true, 'Keyboard direction should remain active beside an opposite joystick direction');
hooks.resetJoystick();
assert.equal(input.left, false, 'Releasing joystick should clear only joystick direction');
assert.equal(input.right, true, 'Releasing joystick should preserve the held keyboard direction');
desktop.document.dispatch('keyup', { code: 'ArrowRight', target: new FakeElement('canvas') });
assert.equal(input.right, false, 'Releasing keyboard should clear the keyboard direction');
assert.ok(desktop.contextCalls.arcTo > 0, 'Rounded-rectangle fallback should render without Canvas roundRect');

const touch = bootGame({ touch: true });
touch.hooks.startGame('level');
const pauseButton = touch.elements.get('pause-control');
assert.equal(pauseButton.hidden, false, 'Touchscreen pause button should appear during gameplay');
pauseButton.dispatch('click');
assert.equal(touch.hooks.getState(), 'paused', 'Touchscreen pause button should pause gameplay');
assert.equal(pauseButton.textContent, '▶', 'Paused state should show a resume symbol');
assert.ok(touch.elements.get('overlay').innerHTML.includes('MENU'), 'Pause screen should offer a way back to the main menu');
pauseButton.dispatch('click');
assert.equal(touch.hooks.getState(), 'playing', 'Touchscreen pause button should resume gameplay');
assert.equal(pauseButton.textContent, 'Ⅱ', 'Playing state should show a pause symbol');
const beforeTouchTimer = touch.getTimeoutCount();
touch.hooks.showBottomBar();
assert.equal(touch.getTimeoutCount(), beforeTouchTimer, 'Touch controls should not schedule an auto-hide timer');

const beforeDesktopTimer = desktop.getTimeoutCount();
desktop.hooks.startGame('level');
desktop.hooks.showBottomBar();
assert.ok(desktop.getTimeoutCount() > beforeDesktopTimer, 'Desktop controls may still auto-hide after inactivity');

hooks.startGame('level');
hooks.completeLevel();
assert.equal(hooks.getState(), 'playing', 'Level Adventure portal should stay locked until all five coins are collected');
for (const coin of hooks.getCoins()) {
  const platform = hooks.getPlatforms()[coin.platformId];
  const playerOnCoinPlatform = hooks.getPlayer();
  playerOnCoinPlatform.x = coin.x - playerOnCoinPlatform.w / 2;
  playerOnCoinPlatform.y = platform.y - playerOnCoinPlatform.h;
  playerOnCoinPlatform.vx = 0;
  playerOnCoinPlatform.vy = 0;
  playerOnCoinPlatform.onGround = false;
  playerOnCoinPlatform.standingOn = null;
  hooks.update(1 / 120);
}
assert.equal(hooks.getCoinsThisLevel(), 5, 'Standing at each coin platform should collect all five coins');
assert.equal(hooks.getTotalCoins(), 5, 'Collected coins should update the run score');
assert.equal(hooks.getWalletCoins(), 5, 'Collected coins should be added to the wallet');
hooks.completeLevel();
assert.equal(hooks.getState(), 'levelComplete', 'Collecting all five coins should unlock level completion');
hooks.restartCurrentLevel();
assert.equal(hooks.getCoinsThisLevel(), 0, 'Restarting the level should reset the level coin count');
assert.equal(hooks.getTotalCoins(), 0, 'Restarting the level should remove its coins from the run score');
assert.equal(hooks.getWalletCoins(), 0, 'Restarting the level should roll back its unbanked coin rewards');

hooks.startGame('race');
for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
  hooks.setState('playing');
  hooks.setupLevel(levelIndex);
  let frameCount = 0;
  while (hooks.getState() === 'playing' && frameCount < 6000) {
    hooks.update(1 / 120);
    frameCount++;
  }
  assert.equal(hooks.getState(), 'robotWon', 'Robot Race AI should be able to finish Level ' + (levelIndex + 1) + ' without getting stuck');
}

console.log('Frog Jumper runtime checks passed: 35 levels, level geometry, rewards, storage, inputs, mobile controls, and rendering fallback.');
