'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'..','index-game.html'),'utf8');
const worker = fs.readFileSync(path.join(__dirname,'..','worker','index.js'),'utf8');
function part(a,b){const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i,a);return html.slice(i,j);}

test('level 77 opening platform stays within jump height',()=>{
  const levels=Function('const TOTAL_LEVELS=105;'+part('const LEVELS = [','// A separate Boss Fight campaign')+';return LEVELS')();
  assert.equal(levels.length,105);
  assert.ok(levels[76].platforms[1][1]-levels[76].platforms[2][1]<=110);
});
test('failed cosmetic image retries after a delay',()=>{
  const code=part('const cosmeticLoads =','// Build transparent PNG');
  let now=0, count=0, src='';const events={};
  const image={addEventListener:(name,fn)=>events[name]=fn,get src(){return src},set src(v){src=v;count++}};
  const load=Function('Date',code+';return loadCosmeticImage')({now:()=>now});
  load(image,'skin.png');events.error();load(image,'skin.png');assert.equal(count,1);
  now=5000;load(image,'skin.png');assert.equal(count,2);
});
test('achievements remain in memory when storage is blocked',()=>{
  const code=part('function loadAchievementData(){','function recordPlatformLanding(platform)');
  const result=Function(`let achievementStorageAvailable=true,achievementData,achievementNotice='',achievementNoticeTime=0,state='playing';
    const navigator={},window={localStorage:{getItem(){throw Error()},setItem(){throw Error()}}};
    const ACHIEVEMENTS=[{id:'first_jump'},{id:'coin_collector'}];${code}
    achievementData=loadAchievementData();awardAchievement('first_jump');
    for(let i=0;i<10;i++)recordCoinAchievement();return achievementData;`)();
  assert.equal(result.coinsCollected,10);assert.ok(result.earned.includes('first_jump'));assert.ok(result.earned.includes('coin_collector'));
});
test('restarting discards the full reward value',()=>{
  const code=part('function restartCurrentLevel(){','function restartRun()');
  for(const reward of [1,2,5,10]){
    const result=Function('reward',`let gameMode='level',state='playing',totalCoins=20+reward,pendingLevelReward=reward,levelIndex=0;
      const setupLevel=()=>{},hideOverlay=()=>{},clearInputs=()=>{},canvas={focus(){}};${code}
      restartCurrentLevel();return totalCoins;`)(reward);
    assert.equal(result,20);
  }
});
test('completion waits for the pickup-time reward to save',async()=>{
  const code=part('async function completeLevel(){','function update(dt)');
  let resolve;const pending=new Promise(r=>resolve=r);let banked=0,screen='';
  const harness=Function('bank','show',`let gameMode='level',boss=null,pendingLevelReward=7,levelIndex=0,state='playing',bankedCoinLevels=new Set();
    const bankWalletCoins=bank,clearInputs=()=>{},currentModeTotalLevels=()=>3,showOverlay=s=>{state=s;show(s)};
    ${code} return completeLevel;`)(n=>{banked=n;return pending},s=>screen=s);
  const completion=harness();assert.equal(banked,7);assert.equal(screen,'saving');
  resolve(true);await completion;assert.equal(screen,'levelComplete');
});
test('wallet-only sync does not send cosmetic updates',()=>{
  const code=part('function syncShopFromStorage(){',"window.addEventListener('storage'");
  const result=Function(`let walletCoins=0,equippedSkin='red',equippedHat='none',shopData,calls=0;
    const readStoredNumber=()=>2,loadShopData=()=>({equippedSkin:'red',equippedHat:'none'}),sendMultiplayerCosmetics=()=>calls++;
    ${code} syncShopFromStorage();return calls;`)();
  assert.equal(result,0);
});
test('game and worker allow the same skins',()=>{
  const a=html.match(/const FROG_SKIN_IDS = new Set\((\[[^\]]+\])\)/);
  const b=worker.match(/const ALLOWED_SKINS = new Set\((\[[^\]]+\])\)/);
  assert.ok(a&&b);assert.deepEqual(Function('return '+a[1])().sort(),Function('return '+b[1])().sort());
});
test('new embedded PNG skins are in the shop with valid sprite data',()=>{
  for(const [id,price] of [['pirate',250],['superhero',300],['wizard',350],['astronaut',400]]){
    assert.ok(html.includes(`{id:'${id}',kind:'skin'`),`${id} missing from shop items`);
    assert.ok(html.includes(`id:'${id}',kind:'skin',name:`)&&html.includes(`price:${price}`),`${id} price changed`);
    const m=html.match(new RegExp(`${id}:\\{image:new Image\\(\\),src:'data:image/png;base64,([A-Za-z0-9+/=]+)'\\}`));
    assert.ok(m,`${id} embedded sprite missing`);
    const buf=Buffer.from(m[1],'base64');
    assert.equal(buf.slice(0,8).toString('hex'),'89504e470d0a1a0a',`${id} sprite is not a PNG`);
    assert.ok(html.includes(`'${id}'`),`${id} missing from skin ids`);
  }
  assert.ok(html.includes('EMBEDDED_SKIN_IMAGES[equippedSkin]'));
});
test('clicking boss tools returns focus to the game for keyboard controls',()=>{
  const code=part('[[bossFireButton,shootFire]','function activateOverlayDialog');
  const result=Function(`let calls=0;const buttons=Array.from({length:3},()=>({addEventListener(_,fn){this.click=fn}}));
    const [bossFireButton,bossSpeedButton,bossSkipButton]=buttons;
    const shootFire=()=>{},useBossSpeed=()=>{},useBossSkip=()=>{},state='playing',canvas={focus(){calls++}};
    ${code} buttons[0].click({detail:1});buttons[0].click({detail:0});return calls;`)();
  assert.equal(result,1);
});

test('shop write failures never debit coins without ownership',()=>{
  const code=part('const applyShopAction=()=>{','// Web Locks serializes purchases');
  for(const failed of ['shop','wallet']){
    const result=Function('failed',`let walletCoins=60, equippedSkin='red',equippedHat='none',messages=0;
      let shopData={ownedSkins:['red'],ownedHats:[],equippedSkin:'red',equippedHat:'none'};
      let storedWallet=60,storedShop=JSON.stringify(shopData);
      const id='black',items=[{id:'black',kind:'hat',price:60}];
      const readStoredNumber=()=>storedWallet,loadShopData=()=>JSON.parse(storedShop);
      const saveShopData=()=>{if(failed==='shop')return false;storedShop=JSON.stringify(shopData);return true};
      const saveWallet=()=>{if(failed==='wallet')return false;storedWallet=walletCoins;return true};
      const window={alert(){messages++}},showShop=()=>{},sendMultiplayerCosmetics=()=>{};
      ${code} applyShopAction();return {storedWallet,storedShop,messages};`)(failed);
    assert.equal(result.storedWallet,60);
    assert.equal(result.messages,1);
    assert.ok(!JSON.parse(result.storedShop).ownedHats.includes('black'));
  }
});
test('game-over text does not compare bonus rewards with a pickup maximum',()=>{
  assert.ok(html.includes('You earned ${Math.max(0,totalCoins-pendingLevelReward)} coins.'));
  assert.ok(html.includes('they were not saved because the level was not finished'));
});

test('controller menu input starts Adventure and polling does not duplicate frames',()=>{
  const ensure=part('function ensureFrameLoop(){','function hideOverlay()');
  const poll=part('function pollGamepad(){',"window.addEventListener('gamepadconnected'");
  const result=Function(`let rafId=0,lastTime=0,state='menu',gamepadConnected=true,started=0,scheduled=0;
    let previousGamepadFire=false,previousGamepadJump=false,previousGamepadMenu=false;
    const gamepadInput={},document={hidden:false},frame=()=>{},requestAnimationFrame=()=>{scheduled++;return 1};
    const buttons=Array.from({length:16},()=>({pressed:false}));buttons[9].pressed=true;
    const navigator={getGamepads:()=>[{connected:true,axes:[0],buttons}]};
    const syncHorizontalInput=()=>{},startGame=mode=>{if(mode==='level')started++},requestJump=()=>{},shootFire=()=>{},clearInputs=()=>{},showOverlay=()=>{},hideOverlay=()=>{};
    ${ensure}${poll}ensureFrameLoop();ensureFrameLoop();pollGamepad();return {scheduled,started};`)();
  assert.equal(result.scheduled,1);assert.equal(result.started,1);
});
test('multiplayer restarts use the same room seed',()=>{
  const setup=part('function setupInfiniteExplore(seed) {','function setupLevel(index)');
  const result=Function(`let multiplayerConnected=true,multiplayerRoomCode='ABC123',infiniteWorld,elapsed,ticks,platforms,coins,enemies,particles,levelIndex,level,robot,player,checkpoint,cameraX,coinsThisLevel,pendingLevelReward,infiniteSaveWarned;
    const WORLD_TEMPLATES=[{}],PLAYER_H=36,makePlayer=()=>({}),maintainInfiniteWorld=()=>{},updateHUD=()=>{};
    ${setup}setupInfiniteExplore();const first=infiniteWorld.seed;setupInfiniteExplore();return [first,infiniteWorld.seed];`)();
  assert.deepEqual(result,[parseInt('ABC123',36)>>>0,parseInt('ABC123',36)>>>0]);
});

test('math choices do not always make the answer second smallest',()=>{
  const code=part('function makeMathQuestion(operation){','function clearMathQuiz()');
  const make=Function(code+';return makeMathQuestion')();
  const ranks=new Set();
  for(let i=0;i<200;i++){
    const q=make(['Addition','Subtraction','Multiplication','Division'][i%4]);
    assert.equal(q.choices.length,4);
    assert.equal(new Set(q.choices).size,4);
    assert.ok(q.choices.includes(q.answer));
    ranks.add([...q.choices].sort((a,b)=>a-b).indexOf(q.answer));
  }
  assert.ok(ranks.size>1,'answer rank should vary, got '+[...ranks].join(','));
});

test('worker JSON helper rejects null and other non-object bodies',async()=>{
  const code=worker.slice(worker.indexOf('async function readJsonObject'),worker.indexOf('export default'));
  const read=Function(code+';return readJsonObject')();
  const req=value=>({json:async()=>value});
  assert.equal(await read(req(null)),null);
  assert.equal(await read(req([1,2])),null);
  assert.equal(await read(req('x')),null);
  assert.equal(await read(req(5)),null);
  assert.deepEqual(await read(req({mode:'level'})),{mode:'level'});
  assert.equal(await read({json:async()=>{throw new Error('bad')}}),null);
});

test('math victory text names Math Mode',()=>{
  assert.ok(html.includes("gameMode==='math'?`You finished all ${currentModeTotalLevels()} Math Mode levels"));
});

test('old multiplayer socket messages are ignored',()=>{
  const code=part("socket.addEventListener('message',event=>{","socket.addEventListener('close'");
  assert.ok(code.includes('attemptId!==multiplayerAttemptId||multiplayerSocket!==socket'));
});

test('math quiz timer pauses while the tab is hidden',()=>{
  const code=part('function beginMathQuiz(){','function showOverlay(kind,options={})');
  assert.ok(code.includes('document.hidden'));
  assert.ok(code.includes('quiz.deadline+=Date.now()-quiz.hiddenAt'));
});

test('skipping the final boss still wins and counts the skip',()=>{
  const code=part('function advanceModeLevel(){','[[bossFireButton');
  const result=Function(`let gameMode='boss',state='playing',bossSkipsRemaining=1,bossStagesSkipped=0,levelIndex=44,screen='',totalCoins=0,pendingLevelReward=0,coinsThisLevel=0;
    const currentModeTotalLevels=()=>45,showOverlay=s=>{screen=s},setupLevel=()=>{},hideOverlay=()=>{},clearInputs=()=>{},canvas={focus(){}};
    ${code} useBossSkip();return [screen,bossSkipsRemaining,bossStagesSkipped];`)();
  assert.deepEqual(result,['won',0,1]);
});

test('boss victory text does not claim every boss was defeated after a skip',()=>{
  assert.ok(html.includes("bossStagesSkipped>0?`You cleared all ${currentModeTotalLevels()} Boss Fight levels! You skipped"));
  assert.ok(html.includes("bossStagesSkipped = 0;"));
});

test('skipping a boss stage loses the coins picked up on that stage',()=>{
  const code=part('function advanceModeLevel(){','[[bossFireButton');
  const result=Function(`let gameMode='boss',state='playing',bossSkipsRemaining=2,bossStagesSkipped=0,levelIndex=10,screen='',totalCoins=25,pendingLevelReward=7,coinsThisLevel=3,nextLevel=-1;
    const currentModeTotalLevels=()=>45,showOverlay=s=>{screen=s},setupLevel=n=>{nextLevel=n},hideOverlay=()=>{},clearInputs=()=>{},canvas={focus(){}};
    ${code} useBossSkip();return [screen,nextLevel,totalCoins,pendingLevelReward,coinsThisLevel,bossSkipsRemaining,bossStagesSkipped];`)();
  assert.deepEqual(result,['',11,18,0,0,1,1]);
});

test('controller D-pad and A button can select other menu modes',()=>{
  const poll=part('function pollGamepad(){',"window.addEventListener('gamepadconnected'");
  const result=Function(`let state='menu',gamepadConnected=false,started='';
    let previousGamepadFire=false,previousGamepadJump=false,previousGamepadMenu=false,previousGamepadNavNext=false,previousGamepadNavPrev=false;
    const gamepadInput={},clicked=[];
    const buttons=['PLAY LEVEL ADVENTURE','MATH MODE','ROBOT RACE'].map(label=>({label,hidden:false,getAttribute:()=>null,focus(){document.activeElement=this;},click(){clicked.push(label);}}));
    const document={hidden:false,activeElement:buttons[0]};
    const overlay={hidden:false,contains:el=>buttons.includes(el),querySelectorAll:()=>buttons};
    let padButtons=Array.from({length:16},()=>({pressed:false}));
    const navigator={getGamepads:()=>[{connected:true,axes:[0,0],buttons:padButtons}]};
    const syncHorizontalInput=()=>{},startGame=mode=>{started=mode;},requestJump=()=>{},shootFire=()=>{},clearInputs=()=>{},showOverlay=()=>{},hideOverlay=()=>{};
    ${poll}
    const press=i=>{padButtons=Array.from({length:16},()=>({pressed:false}));if(i>=0)padButtons[i].pressed=true;pollGamepad();};
    press(13);press(-1);
    const afterOneDown=document.activeElement.label;
    press(0);
    document.activeElement=buttons[0];
    press(-1);press(13);press(-1);press(13);press(-1);press(0);
    return {afterOneDown,clicked};`)();
  assert.equal(result.afterOneDown,'MATH MODE');
  assert.deepEqual(result.clicked,['MATH MODE','ROBOT RACE']);
});

test('infinite explore keeps unpaid coins and retries instead of losing them',async()=>{
  const code=part('function bankInfiniteCoins(){','async function bankWalletCoins');
  let attempts=0,paid=0;const alerts=[];
  const bank=async amount=>{attempts++;if(attempts===1)return false;paid+=amount;return true;};
  const harness=Function('bank','alerts',`let pendingInfiniteReward=5,infiniteBankInFlight=false,infiniteSaveWarned=false;
    const window={alert:msg=>alerts.push(msg)};
    const bankWalletCoins=bank;
    ${code} return {bankInfiniteCoins,get pending(){return pendingInfiniteReward;}};`)(bank,alerts);
  harness.bankInfiniteCoins();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(harness.pending,5,'failed save should keep the coins pending');
  assert.equal(alerts.length,1);
  harness.bankInfiniteCoins();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(harness.pending,0,'retry should clear the pending coins');
  assert.equal(paid,5,'coins should be paid exactly once');
});

test('coins save anyway in browsers without Web Locks',async()=>{
  const code=part('async function bankWalletCoins(amount){','function updateBossCombat(dt)');
  const run=Function('saveOk',`let walletCoins=10;
    const navigator={};
    const readStoredNumber=()=>10,saveWallet=()=>saveOk,syncShopFromStorage=()=>{},updateHUD=()=>{};
    ${code} return bankWalletCoins(7).then(saved=>[saved,walletCoins]);`);
  assert.deepEqual(await run(true),[true,17],'no-lock save should bank the coins');
  assert.deepEqual(await run(false),[false,10],'failed storage write should restore the wallet');
});

test('enemy speed is capped below the frog top speed',()=>{
  const m=html.match(/vx:\(idx%2\?1:-1\)\*(.+?),alive:true/);
  assert.ok(m,'enemy speed expression should exist');
  const speed=Function('idx','levelIndex','return Math.abs('+m[1]+')');
  assert.equal(speed(0,0),100,'level 1 keeps the gentle starting speed');
  assert.ok(speed(1,104)<=280,'late levels must not outrun the frog');
  assert.ok(speed(0,104)<292,'enemies stay slower than the frog base speed');
});

test('boss stages do not use Adventure lava or theme decorations',()=>{
  assert.ok(html.includes("const lava=gameMode!=='boss'&&level.themeIndex===3&&player.y+player.h>585;"));
  assert.ok(html.includes("if(gameMode!=='boss'&&level.themeIndex===2){ // fireflies and moonlit glints"));
  assert.ok(html.includes("if(gameMode!=='boss'&&level.themeIndex===3){for(let i=0;i<18;i++)"));
  assert.ok(html.includes("else if(gameMode!=='boss'&&level.themeIndex===1){ctx.strokeStyle='#b4fff2aa';"));
});

test('a fresh Infinite Explore run forgets unpaid coins from the last run',()=>{
  const setup=part('function setupInfiniteExplore(seed) {','function setupLevel(index)');
  const result=Function(`let multiplayerConnected=false,multiplayerRoomCode='',infiniteWorld,elapsed,ticks,platforms,coins,enemies,particles,levelIndex,level,robot,player,checkpoint,cameraX,coinsThisLevel,pendingLevelReward,pendingInfiniteReward=9,infiniteSaveWarned=true;
    const WORLD_TEMPLATES=[{}],PLAYER_H=36,makePlayer=()=>({}),maintainInfiniteWorld=()=>{},updateHUD=()=>{};
    ${setup}setupInfiniteExplore(123);return pendingInfiniteReward;`)();
  assert.equal(result,0);
});

test('worker checks room capacity before eating a join ticket',()=>{
  const connect=worker.slice(worker.indexOf('url.pathname === "/connect"'));
  const fullCheck=connect.indexOf('if (active >= MAX_PLAYERS)');
  const eatTicket=connect.indexOf('await this.ctx.storage.delete("ticket:" + token);',fullCheck);
  assert.ok(fullCheck>=0&&eatTicket>fullCheck,'full-room check must run before the ticket is deleted');
  assert.ok(connect.includes('await this.ctx.storage.put("ticket:" + token, ticket);'),'ticket is handed back if the room fills mid-connect');
  const join=worker.slice(worker.indexOf('url.pathname === "/join"'),worker.indexOf('url.pathname === "/connect"'));
  const put=join.indexOf('await this.ctx.storage.put("ticket:" + token');
  const recount=join.indexOf('await this.countReservations() > MAX_PLAYERS');
  assert.ok(put>=0&&recount>put,'join recounts after reserving so simultaneous joins cannot overfill');
});

test('menu frame loop runs and animates without a controller',()=>{
  const ensure=part('function ensureFrameLoop(){','function hideOverlay()');
  const frame=part('function frame(now){',"document.addEventListener('keydown'");
  const result=Function(`let rafId=0,lastTime=0,state='menu',elapsed=0,accumulator=0,achievementNoticeTime=0,renders=0;
    const document={hidden:false},overlay={hidden:false},FIXED_DT=1/60;
    const pollGamepad=()=>{},update=()=>{},render=()=>{renders++};
    const requestAnimationFrame=()=>1;
    ${ensure}${frame}ensureFrameLoop();const scheduled=rafId;frame(1000);frame(1016);return {scheduled,renders,elapsed};`)();
  assert.equal(result.scheduled,1,'menu should schedule frames with no gamepad');
  assert.ok(result.renders>=2,'menu should keep rendering');
  assert.ok(result.elapsed>0,'menu background time should advance so turkeys and clouds move');
});

test('every Adventure and Boss jump stays within the frog jump height',()=>{
  const levels=Function('const TOTAL_LEVELS=105;'+part('const LEVELS = [','// A separate Boss Fight campaign')+';return LEVELS')();
  assert.equal(levels.length,105);
  for(const [i,lv] of levels.entries()){
    for(let p=1;p<lv.platforms.length;p++){
      const rise=lv.platforms[p-1][1]-lv.platforms[p][1];
      assert.ok(rise<=120,`Adventure level ${i+1} platform ${p} rises ${rise}px, above the 120px cap`);
    }
  }
  const bossPart=part('const BOSS_WORLD_TEMPLATES = [','let state =');
  const bossLevels=Function('const BOSS_TOTAL_LEVELS=45;'+bossPart+';return BOSS_LEVELS')();
  assert.equal(bossLevels.length,45);
  for(const [i,lv] of bossLevels.entries()){
    for(let p=1;p<lv.platforms.length;p++){
      const rise=lv.platforms[p-1][1]-lv.platforms[p][1];
      assert.ok(rise<=120,`Boss level ${i+1} platform ${p} rises ${rise}px, above the 120px cap`);
    }
  }
});

test('robot jump strength matches the frog and it cannot stay stuck',()=>{
  assert.ok(html.includes('robot.vy=-655'),'robot should jump with the frog strength');
  assert.ok(!html.includes('robot.vy=-680'),'robot must not out-jump the frog');
  assert.ok(html.includes('(655+Math.sqrt(655*655'),'robot airtime math should use the frog jump strength');
  assert.ok(html.includes('robot.falls>=3'),'robot should recover forward after repeated falls');
});

test('robot does not win a tie at the portal',()=>{
  const code=part('function updateRobot(dt){','function bankInfiniteCoins()');
  const run=Function('playerX',`let state='playing',levelIndex=0,screen='';
    const H=600,W=960;
    const platforms=[{id:0,x:0,y:515,w:250,prevY:515},{id:1,x:1700,y:500,w:400,prevY:500}];
    const level={platforms:[[0,515,250],[1700,500,400]]};
    const robot={x:1960,y:464,w:36,h:36,vx:0,vy:0,onGround:true,standingOn:platforms[1],targetIndex:2,falls:0,stumble:0};
    const player={x:playerX,y:464,w:36,h:36};
    const showOverlay=s=>{screen=s},clearInputs=()=>{};
    ${code} updateRobot(1/120);return screen;`);
  assert.equal(run(1954),'','frog at the portal too means the player wins the tie');
  assert.equal(run(100),'robotWon','robot alone at the portal still wins');
});

test('restarting a finished level does not respawn its coins',()=>{
  const code=part('function setupLevel(index) {','function startGame(');
  const run=Function('banked',`let gameMode='level',infiniteWorld,levelIndex,level,elapsed,ticks,platforms,coins,enemies,particles,player,robot,boss,fireProjectiles,bossSpeedTimer,fireCooldown,bossPowerups,checkpoint,cameraX,coinsThisLevel,pendingLevelReward;
    const COINS_PER_LEVEL=5,PLAYER_H=36;
    const fake={platforms:[[0,515,250],[300,460,120],[500,400,120],[700,450,120],[900,380,120],[1100,430,120],[1300,370,120],[1500,430,120],[1700,500,400]],movers:[],enemies:[],bossLevel:false};
    const currentModeLevels=()=>[fake],makePlayer=(x,y)=>({x,y,w:36,h:36,onGround:false,standingOn:null}),updateHUD=()=>{};
    const bankedCoinLevels=new Set(banked?['level:0']:[]);
    ${code} setupLevel(0);return coins.map(c=>c.taken);`);
  assert.deepEqual(run(false),[false,false,false,false,false],'fresh level coins are collectible');
  assert.deepEqual(run(true),[true,true,true,true,true],'banked level coins stay collected after restart');
});

test('infinite explore save warning shows at most once per run',async()=>{
  const code=part('function bankInfiniteCoins(){','async function bankWalletCoins');
  const alerts=[];
  const harness=Function('alerts',`let pendingInfiniteReward=5,infiniteBankInFlight=false,infiniteSaveWarned=false;
    const window={alert:msg=>alerts.push(msg)};
    const bankWalletCoins=async()=>false;
    ${code} return bankInfiniteCoins;`)(alerts);
  for(let i=0;i<3;i++){harness();await new Promise(r=>setTimeout(r,0));}
  assert.equal(alerts.length,1,'repeated save failures should warn only once');
});

test('boss tools do not cover the multiplayer room label',()=>{
  const code=part('function drawMultiplayerHud(){','function requestJump()');
  assert.ok(code.includes("(gameMode==='boss'&&state==='playing')?54:12"),'room label should drop below the boss tools in Boss Fight');
});

test('worker rate-limits room joins per IP',async()=>{
  const deps=worker.slice(0,worker.indexOf('export default'));
  const roomClass=worker.slice(worker.indexOf('export class FrogRoom')).replace('export class FrogRoom','class FrogRoom');
  const FrogRoom=Function(deps+roomClass+';return FrogRoom')();
  const store=new Map();
  const ctx={
    storage:{
      async get(k){return store.get(k);},
      async put(k,v){ if(typeof k==='object'){for(const [key,value] of Object.entries(k))store.set(key,value);} else store.set(k,v); },
      async delete(k){store.delete(k);},
      async list({prefix}){const out=new Map();for(const [k,v] of store)if(k.startsWith(prefix))out.set(k,v);return out;},
      async setAlarm(){}
    },
    blockConcurrencyWhile(fn){return fn();},
    getWebSockets(){return [];}
  };
  const room=new FrogRoom(ctx,{});
  const req=(path,body)=>({url:'https://room.internal'+path,method:'POST',json:async()=>body,headers:{get:()=>null}});
  assert.equal((await room.fetch(req('/create',{mode:'level'}))).status,200);
  let lastStatus=0;
  for(let i=0;i<7;i++) lastStatus=(await room.fetch(req('/join',{name:'Frog',mode:'level',ip:'1.2.3.4'}))).status;
  assert.equal(lastStatus,429,'one IP hammering join should be rate-limited');
  assert.equal((await room.fetch(req('/join',{name:'Frog',mode:'level',ip:'5.6.7.8'}))).status,200,'a different IP can still join');
});

test('main menu links to the Frog Jumper podcast episode',()=>{
  const code=part("if(kind==='menu'){","content.buttons.forEach");
  assert.ok(code.includes("podcastLink.textContent='🎧 Listen to the Frog Jumper Podcast'"),'menu should show the podcast link label');
  assert.ok(code.includes("podcastLink.href='https://muse.ai/podcasts/media/1505287765993747/4c9d8fe9-6e29-4117-bc54-151fcc0443bd/ep-f1d9446f-59dd-4331-a4e9-90703504de50.mp3'"),'podcast link should point to the published episode audio');
  assert.ok(code.includes("podcastLink.target='_blank'"),'podcast link should open in a new tab');
  assert.ok(code.includes("podcastLink.rel='noopener'"),'podcast link should use noopener');
  assert.ok(code.includes('append(racingLink,podcastLink,adLink)'),'podcast link should be appended to the menu button row');
});
