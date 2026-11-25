'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const game = read('index-game.html');
const part = (start, end) => game.slice(game.indexOf(start), game.indexOf(end, game.indexOf(start)));

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

function quizFixture() {
  const source = part('function clearMathQuiz()', 'function showOverlay(kind,options={})');
  const visibility = part("document.addEventListener('visibilitychange'", 'const pauseControl=');
  const run = Function(`
    let now=0, mathQuiz=null, mathOperation='Addition', state='menu', tick, onVisibility, screen, value='', writes=0;
    const completions=[];
    const pending=[{prompt:'1 + 1',answer:2,choices:[2,3]},{prompt:'2 + 2',answer:4,choices:[4,5]}];
    const document={hidden:false,addEventListener(type,fn){onVisibility=fn;}};
    const performance={now:()=>now};
    const window={setInterval(fn){tick=fn;return 1;},clearInterval(){}};
    const label={get textContent(){return value;},set textContent(text){value=text;writes++;}};
    const overlay={querySelector:()=>label,hidden:false};
    const clearInputs=()=>{},ensureFrameLoop=()=>{},makeMathQuestion=()=>pending.shift();
    const showOverlay=(kind,options)=>{state=kind;screen=options;};
    const completeLevel=feedback=>completions.push(feedback);
    ${source}${visibility}
    beginMathQuiz();
    return {
      setTime(ms){now=ms;}, tick(){tick();}, choose(i){screen.buttons[i][2]();},
      hide(hidden){document.hidden=hidden;onVisibility();},
      get writes(){return writes;}, get state(){return state;}, completions
    };
  `);
  return run();
}

test('a correct first answer still needs a second answer before the quiz deadline', () => {
  const quiz=quizFixture();
  quiz.choose(0);
  quiz.setTime(41000);
  quiz.tick();
  assert.equal(quiz.state,'mathRetry');
  assert.deepEqual(quiz.completions,[]);
});

test('a suspended quiz accepts the first answer after returning and includes final feedback', () => {
  const quiz=quizFixture();
  quiz.choose(0);
  quiz.setTime(1000);
  quiz.hide(true);
  quiz.setTime(42000);
  quiz.hide(false);
  quiz.choose(1);
  assert.deepEqual(quiz.completions,['Answer: 2 + 2 = 4.']);
});

test('a quiz with two wrong answers retries and repeated ticks preserve countdown text', () => {
  const quiz=quizFixture();
  assert.equal(quiz.writes,1);
  quiz.setTime(250);
  quiz.tick();
  assert.equal(quiz.writes,1);
  quiz.choose(1);
  quiz.choose(1);
  assert.equal(quiz.state,'mathRetry');
  assert.deepEqual(quiz.completions,[]);
});

test('touch controls ignore secondary buttons and preserve a newer keyboard jump when a touch is canceled', () => {
  const jump = part('function requestJump(', 'function hurt()');
  const joystick = part("  const moveStick=document", "  const bottomBar=");
  const jumpEvents = part("  const jumpBtn=document", "  canvas.addEventListener('pointerdown'");
  const run = Function(`
    const state='playing',player={jumpBuffer:0},joystickInput={},syncHorizontalInput=()=>{};
    const control=()=>({handlers:{},style:{},classList:{add(){},remove(){}},
      addEventListener(name,fn){this.handlers[name]=fn;},
      getBoundingClientRect(){return {left:0,top:0,width:100,height:100};},
      setPointerCapture(){},hasPointerCapture(){return false;}});
    const controls={'move-stick':control(),'stick-knob':control(),'jump-control':control()};
    const document={getElementById:id=>controls[id]};
    ${jump}${joystick}${jumpEvents}
    const pointer={button:2,pointerId:1,clientX:92,clientY:50,preventDefault(){}};
    moveStick.handlers.pointerdown(pointer);
    jumpBtn.handlers.pointerdown(pointer);
    const secondary=[!!joystickInput.right,player.jumpBuffer];
    jumpBtn.handlers.pointerdown({...pointer,button:0});
    jumpBtn.handlers.pointercancel(pointer);
    const canceled=player.jumpBuffer;
    jumpBtn.handlers.pointerdown({...pointer,button:0});
    requestJump();
    jumpBtn.handlers.pointercancel(pointer);
    const newer=player.jumpBuffer;
    player.jumpBuffer=0;
    jumpBtn.handlers.click({detail:0});
    return {secondary,canceled,newer,accessible:player.jumpBuffer};`);
  assert.deepEqual(run(),{secondary:[false,0],canceled:0,newer:0.14,accessible:0.14});
});

test('controller A starts play without also jumping', () => {
  const poll = part('function pollGamepad()', "window.addEventListener('gamepadconnected'");
  const run = Function(`
    let state='menu', jumps=0,gamepadConnected=false,previousGamepadJump=false,previousGamepadMenu=false,
      previousGamepadFire=false,previousGamepadNavNext=false,previousGamepadNavPrev=false;
    const gamepadInput={},syncHorizontalInput=()=>{};
    const button={click(){state='playing';overlay.hidden=true;}};
    const overlay={hidden:false,contains:()=>true};
    const document={activeElement:button};
    const pad={connected:true,buttons:[{pressed:true}]};
    const navigator={getGamepads:()=>[pad]};
    const requestJump=()=>jumps++;
    ${poll}
    pollGamepad();
    const afterStart=jumps;
    pollGamepad();
    pad.buttons[0].pressed=false;
    pollGamepad();
    pad.buttons[0].pressed=true;
    pollGamepad();
    return [state,afterStart,jumps];`);
  assert.deepEqual(run(),['playing',0,1]);
});
