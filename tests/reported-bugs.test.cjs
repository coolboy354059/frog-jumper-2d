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

test('an older level save cannot complete a newer run', async () => {
  const completion=part('async function completeLevel(', 'function update(dt)');
  const run=Function(`
    let state='playing',gameMode='level',levelIndex=0,pendingLevelReward=1,player={};
    const deposits=[],bankedCoinLevels=new Map(),coins=[{platformId:2,taken:true}];
    const clearInputs=()=>{},currentModeTotalLevels=()=>105,showOverlay=value=>{state=value;};
    const bankWalletCoins=amount=>new Promise(resolve=>deposits.push({amount,resolve}));
    ${completion}
    return {
      completeLevel,deposits,
      newRun(){player={};state='playing';pendingLevelReward=5;},
      status(){return [state,pendingLevelReward,bankedCoinLevels.size];}
    };`)();
  const first=run.completeLevel();
  run.newRun();
  const second=run.completeLevel();
  assert.deepEqual(run.deposits.map(deposit=>deposit.amount),[1,5]);
  run.deposits[0].resolve(true);
  await first;
  assert.deepEqual(run.status(),['saving',5,0]);
  run.deposits[1].resolve(false);
  await second;
  assert.deepEqual(run.status(),['rewardSaveFailed',5,0]);
});

test('Infinite Explore saves pickups from both runs without warning on the menu', async () => {
  const banking=part('function bankInfiniteCoins(', 'async function bankWalletCoins');
  const run=Function(`
    let state='playing',infiniteWorld;
    const deposits=[],alerts=[];
    const window={alert:value=>alerts.push(value)};
    const bankWalletCoins=amount=>new Promise(resolve=>deposits.push({amount,resolve}));
    ${banking}
    return {
      deposits,alerts,
      pickup(){const rewards={pending:1,saving:false,warned:false};infiniteWorld={rewards};bankInfiniteCoins(rewards);return rewards;},
      leave(){state='menu';infiniteWorld=null;}
    };`)();
  const previous=run.pickup();
  const current=run.pickup();
  assert.deepEqual(run.deposits.map(deposit=>deposit.amount),[1,1]);
  run.deposits[0].resolve(true);
  await Promise.resolve();
  assert.equal(previous.pending,0);
  assert.equal(current.pending,1);
  run.deposits[1].resolve(true);
  await Promise.resolve();
  assert.equal(current.pending,0);
  run.pickup();
  run.leave();
  run.deposits[2].resolve(false);
  await Promise.resolve();
  assert.deepEqual(run.alerts,[]);
});

test('room restarts preserve claimed pickups and clear actors from other modes', () => {
  const setup=part('function setupInfiniteExplore(seed)', 'function setupLevel(index)');
  const spawnCoin=part('function addInfiniteCoin(', 'function addInfiniteEnemy(');
  const run=Function(`
    let multiplayerConnected=true,multiplayerRoomCode='ABC234',roomInfiniteProgress=null,infiniteWorld,elapsed,ticks,
      platforms,coins,enemies,particles,levelIndex,level,robot,boss={alive:true},fireProjectiles=[{}],player,checkpoint,
      cameraX,coinsThisLevel,pendingLevelReward;
    const WORLD_TEMPLATES=[{}],PLAYER_H=36,makePlayer=()=>({}),updateHUD=()=>{};
    const maintainInfiniteWorld=()=>addInfiniteCoin({id:2,x:500,y:510,w:160},0);
    ${spawnCoin}${setup}
    setupInfiniteExplore();
    const first=coins[0].taken;
    infiniteWorld.rewards.claimed.add(2);
    setupInfiniteExplore();
    return [first,coins[0].taken,boss,fireProjectiles.length];`);
  assert.deepEqual(run(),[false,true,null,0]);
});

test('the Stage 3 boss patrol is excluded from checkpoints', () => {
  const levels=part('const BOSS_WORLD_TEMPLATES =','let state =');
  const patrol=part('function checkpointOverlapsBossPatrol','function update(dt)');
  const run=Function(`
    const BOSS_TOTAL_LEVELS=45;
    ${levels}
    const end=BOSS_LEVELS[2].platforms.at(-1);
    const boss={minX:end[0]+16,maxX:end[0]+end[2]-110,w:94,h:68,y:end[1]-68,alive:true};
    const player={w:36,h:36};
    ${patrol}
    const inPatrol=checkpointOverlapsBossPatrol(end[0]+190,end[1]-36);
    const above=checkpointOverlapsBossPatrol(end[0]+190,end[1]-110);
    boss.alive=false;
    return [inPatrol,above,checkpointOverlapsBossPatrol(end[0]+190,end[1]-36)];`);
  assert.deepEqual(run(),[true,false,false]);
});

test('falling below a ledge cannot snap either racer up through its side', () => {
  const landing=part('function resolvePlatformLanding','function bankInfiniteCoins');
  const run=Function(`
    const platforms=[{x:100,y:460,prevY:460,w:120}];
    ${landing}
    const actor={x:105,y:438,w:36,h:36,vy:120};
    resolvePlatformLanding(actor,470,null);
    const below=[actor.y,actor.onGround];
    actor.y=425;
    resolvePlatformLanding(actor,459,null);
    const crossed=[actor.y,actor.onGround];
    const high={x:152,y:354,w:36,h:36};
    return [below,crossed,overlapsPortal(high,platforms[0])];`);
  assert.deepEqual(run(),[[438,false],[424,true],true]);
});

test('10 fps and 60 fps advance the same number of physics ticks over a second', () => {
  const frame=part('function frame(now)',"document.addEventListener('keydown',e=>{");
  const run=Function('fps',`
    let state='playing',rafId=0,lastTime=1,accumulator=0,ticks=0,achievementNoticeTime=0;
    const FIXED_DT=1/120,document={hidden:false},overlay={hidden:true},multiplayerConnected=false;
    const pollGamepad=()=>{},render=()=>{},update=()=>ticks++,requestAnimationFrame=()=>1;
    ${frame}
    for(let i=1;i<=fps;i++)frame(1+i*1000/fps);
    return ticks;`);
  assert.equal(run(10),120);
  assert.equal(run(60),120);
});

test('repaired achievements reload shared progress and recognize a full platform history', async () => {
  const logic=part('function loadAchievementData(', 'function showAchievements()');
  const fixture=Function(`
    let stored='{',achievementData,achievementNotice='',achievementNoticeTime=0,state='playing';
    const pendingAchievementChanges=[],status={};
    const document={getElementById:()=>status};
    const withProgressLock=(_,operation)=>Promise.resolve(operation());
    const window={localStorage:{getItem:()=>stored,setItem:(_,value)=>{stored=value;}}};
    const ACHIEVEMENTS=[{id:'first_jump',name:'First Jump'},{id:'platform_master',name:'Platform Master'}];
    const infiniteWorld=null,gameMode='level',levelIndex=0;
    ${logic}
    achievementData=loadAchievementData();
    awardAchievement('first_jump');
    const repaired=JSON.parse(stored);
    stored=JSON.stringify({...repaired,coinsCollected:1,platformsLanded:0,visitedPlatforms:Array.from({length:100},(_,i)=>'visited:'+i)});
    recordCoinAchievement();
    recordPlatformLanding({id:200});
    return {repaired,result:JSON.parse(stored),announcement:status.textContent};`)();
  assert.ok(fixture.repaired.earned.includes('first_jump'));
  assert.equal(fixture.result.coinsCollected,2);
  assert.equal(fixture.result.platformsLanded,100);
  assert.ok(fixture.result.earned.includes('platform_master'));
  assert.match(fixture.announcement,/Platform Master unlocked/);
});

test('a late lower best score cannot overwrite a higher score', async () => {
  const best=part('function getBestCoins()', 'function updateHUD()');
  const run=Function(`
    let totalCoins=0,stored=5;
    const jobs=[],document={getElementById:()=>null};
    const withProgressLock=(_,operation)=>{jobs.push(operation);return Promise.resolve();};
    const readStoredNumber=()=>stored,writeStoredNumber=(_,value)=>{stored=value;};
    ${best}
    totalCoins=11;updateBestCoins();
    totalCoins=8;updateBestCoins();
    jobs.forEach(job=>job());
    return stored;`);
  assert.equal(await run(),11);
});

test('unchanged positions stay quiet and the finishing position reaches room peers', () => {
  const send=part('function sendMultiplayerPosition','function drawRemotePlayers');
  const frame=part('function frame(now)', "document.addEventListener('keydown',e=>{");
  const run=Function(`
    let state='playing',rafId=0,lastTime=1,accumulator=0,achievementNoticeTime=0,lastRenderedState;
    let multiplayerLastSent=-Infinity,multiplayerLastPosition='';
    const packets=[],multiplayerConnected=true,WebSocket={OPEN:1},levelIndex=0;
    const multiplayerSocket={readyState:1,send:message=>packets.push(JSON.parse(message))};
    const player={x:54,y:479,face:1};
    const FIXED_DT=1/120,document={hidden:false},overlay={hidden:false};
    const pollGamepad=()=>{},render=()=>{},drawMultiplayerHud=()=>{},ensureFrameLoop=()=>{},update=()=>{},requestAnimationFrame=()=>1;
    ${send}${frame}
    frame(1);frame(101);frame(201);
    player.x=1944.7;state='levelComplete';frame(301);frame(401);
    return packets.map(packet=>packet.x);`);
  assert.deepEqual(run(),[54,1944.7]);
});

test('room platform phases use the same elapsed clock for early and late joiners', () => {
  const source=part('function platformTime()', 'function addInfinitePlatform');
  const time=Function('elapsed','performance','multiplayerClock',source+'return platformTime();');
  assert.equal(time(3,{now:()=>10000},2000),time(0,{now:()=>300},11700));
  assert.equal(time(6,{now:()=>10000},null),6);
});

test('Infinite Explore positions can pass one million while fixed stages keep their limit', () => {
  const worker=read('worker/index.js');
  const room=worker.slice(worker.indexOf('export class FrogRoom')).replace('export class FrogRoom','class FrogRoom');
  const dependencies=worker.slice(0,worker.indexOf('export default'));
  const FrogRoom=Function(dependencies+room+';return FrogRoom;')();
  const instance=Object.create(FrogRoom.prototype);
  const sent=[];
  instance.broadcast=message=>sent.push(message.player.x);
  const move=mode=>{
    let player={joined:true,mode,x:999999,y:479,levelIndex:0,face:1,updatedAt:0};
    const socket={deserializeAttachment:()=>player,serializeAttachment:value=>{player=value;}};
    instance.webSocketMessage(socket,JSON.stringify({type:'move',x:1000003,y:479,face:1,levelIndex:0}));
    return player.x;
  };
  assert.equal(move('level'),999999);
  assert.equal(move('infinite'),1000003);
  assert.deepEqual(sent,[1000003]);
});
