'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','index-game.html'),'utf8');
const workerSource=fs.readFileSync(path.join(__dirname,'..','worker','index.js'),'utf8');

// Run the actual game script with lightweight browser adapters. Tests do not expose production hooks.
function createGame(source, options={}){
  const records=options.records||new Map(),nodes=new Map(),events={};
  let frameCount=0;
  const gradient={addColorStop(){}};
  const ctx=new Proxy({createLinearGradient:()=>gradient,measureText:t=>({width:String(t).length*8})},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    const n={id,width:960,height:600,hidden:false,style:{},dataset:{},innerHTML:'',textContent:'',value:'',disabled:false,isConnected:true,
      classList:{add(){},remove(){},contains(){return false}},
      addEventListener(type,fn){(events[id+':'+type]??=[]).push(fn)},
      setAttribute(){},removeAttribute(){},getAttribute(){return null},
      querySelector(selector){return node(selector)},querySelectorAll(selector){
        if(selector==='[data-shop-item]')return [...n.innerHTML.matchAll(/data-shop-item="([^"]+)"/g)].map(m=>{const item=node('shop-'+m[1]);item.dataset.shopItem=m[1];return item;});
        return [];
      },
      focus(){doc.activeElement=n},getContext(){return ctx},getBoundingClientRect(){return {width:68,height:68,left:0,top:0}},
      contains(){return true},hasPointerCapture(){return false},toDataURL(){return 'data:image/png;base64,AA=='}
    };
    nodes.set(id,n);return n;
  }
  const doc={hidden:false,activeElement:null,documentElement:{classList:{add(){}}},
    getElementById:node,querySelectorAll:()=>[],createElement:()=>node('offscreen'),
    addEventListener(type,fn){(events['document:'+type]??=[]).push(fn)}};
  const storage={getItem:k=>records.get(k)??null,setItem(k,v){if(options.failWrite?.(k))throw Error('Storage write blocked');records.set(k,String(v))}};
  if(options.blockStorage){storage.getItem=()=>{throw Error('Storage blocked')};storage.setItem=()=>{throw Error('Storage blocked')};}
  const win={localStorage:storage,matchMedia:()=>({matches:false,addEventListener(){}}),
    clearTimeout(){},setTimeout(){return 1},alert(message){alerts.push(message)},close(){},
    addEventListener(type,fn){(events['window:'+type]??=[]).push(fn)}};
  const alerts=[];
  const nav={maxTouchPoints:0,...options.navigator};
  const Controller=class{constructor(){this.signal={aborted:false}}abort(){this.signal.aborted=true}};
  class Picture{constructor(){this.src='';this.complete=false;this.naturalWidth=0;this.naturalHeight=0;}}
  const names=['input','state','gameMode','totalCoins','coinsThisLevel','levelCoinReward','levelIndex','equippedSkin','equippedHat','walletCoins','shopData','achievementData','infiniteWorld','elapsed','platforms','coins','enemies','player','multiplayerConnected','multiplayerMode','multiplayerWorldSeed','multiplayerWorldStartedAt','multiplayerSocket','multiplayerLastCosmetics','gamepadConnected','rafId','robot','boss','lives','bossSkipsRemaining'];
  const functions=['startGame','setupLevel','setupInfiniteExplore','restartCurrentLevel','completeLevel','update','recordCoinAchievement','recordPlatformLanding','awardAchievement','loadAchievementData','readEconomy','readWalletCoins','loadShopData','saveEconomy','showShop','loadCosmeticImage','ensureFrameLoop','frame','sendMultiplayerCosmetics','cancelMultiplayerAttempt','connectToMultiplayerRoom','advanceModeLevel','showOverlay','requestJump','bankWalletCoins'];
  const hooks='return {'+names.map(n=>'get '+n+'(){return '+n+'},set '+n+'(v){'+n+'=v}').concat(functions, ['LEVELS','BOSS_LEVELS','FROG_SKIN_IDS','WORLD_TEMPLATES']).join(',')+'};';
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const body='return '+script.trimStart().replace(/\}\)\(\);\s*$/,hooks+'})();');
  const api=new Function('window','document','navigator','Image','requestAnimationFrame','WebSocket','AbortController','fetch',body)(
    win,doc,nav,Picture,()=>++frameCount,{OPEN:1},Controller,options.fetch||(()=>Promise.reject(Error('Unexpected fetch'))));
  return {api,records,events,nodes,node,doc,alerts,frameCount:()=>frameCount};
}

function createWorker(source, records=new Map()){
  const ResponseClass=typeof Response==='function'?Response:class{
    constructor(body,options={}){this.body=body;this.status=options.status||200;this.ok=this.status>=200&&this.status<300;}
    async json(){return JSON.parse(this.body);}
  };
  class TestURL{constructor(url){this.pathname=url.replace(/^https?:\/\/[^/]+/,'').split('?')[0]||'/';}}
  let random=100;
  const cryptoMock={getRandomValues(array){for(let i=0;i<array.length;i++)array[i]=random++;return array;},randomUUID:()=>String(random++)};
  const code=source.replace('export default {','const worker = {').replace('export class FrogRoom','class FrogRoom')+';return {worker,FrogRoom};';
  const exports=new Function('Response','URL','crypto',code)(ResponseClass,TestURL,cryptoMock);
  const storage={
    async get(key){return records.get(key)},
    async put(key,value){if(typeof key==='object')for(const [k,v]of Object.entries(key))records.set(k,v);else records.set(key,value)},
    async delete(key){return records.delete(key)},
    async list({prefix}){return new Map([...records].filter(([k])=>k.startsWith(prefix)))},
    async setAlarm(){}
  };
  const ctx={storage,getWebSockets:()=>[],blockConcurrencyWhile(fn){ctx.ready=fn()}};
  const room=new exports.FrogRoom(ctx,{});const request=(path,body)=>({url:'https://room.test'+path,method:'POST',headers:{get:()=>null},json:async()=>body});
  return {...exports,room,ctx,records,request};
}


test('pickup-time rewards survive a skin change before the portal (#31)',async()=>{
  const h=createGame(source,{navigator:{locks:{request:async(_name,fn)=>fn()}}}),a=h.api;
  a.startGame('level');
  function pickup(index,skin){a.equippedSkin=skin;const c=a.coins[index];a.player.x=c.x-18;a.player.y=c.y-18;a.player.vy=0;a.player.onGround=false;a.player.standingOn=null;a.update(1/120);}
  pickup(0,'red');pickup(1,'king');assert.equal(a.levelCoinReward,11);
  a.equippedSkin='car';a.completeLevel();await Promise.resolve();
  assert.equal(a.readWalletCoins(),11);
});
test('restarting discards the full unfinished bonus reward (#40)',()=>{
  const {api:a}=createGame(source);a.startGame('level');a.totalCoins=27;a.coinsThisLevel=2;a.levelCoinReward=15;
  a.restartCurrentLevel();assert.equal(a.totalCoins,12);assert.equal(a.levelCoinReward,0);
});
test('bonus score result does not compare rewards to pickup maximum (#30)',()=>{
  const h=createGame(source);h.api.totalCoins=2625;h.api.showOverlay('gameover');
  assert.ok(h.node('overlay').innerHTML.includes('2625 coins'));assert.ok(!h.node('overlay').innerHTML.includes('of 525'));
});
test('controller Menu starts Adventure from a polled main menu (#41)',()=>{
  const pad={connected:true,axes:[0],buttons:Array.from({length:16},()=>({pressed:false}))};
  const h=createGame(source,{navigator:{getGamepads:()=>[pad]}});
  assert.ok(h.frameCount()>0);pad.buttons[9].pressed=true;h.api.frame(16);assert.equal(h.api.state,'playing');assert.equal(h.api.gameMode,'level');
});
test('achievements accumulate for a session without working storage (#43)',()=>{
  const {api:a}=createGame(source,{blockStorage:true});a.awardAchievement('first_jump');
  for(let i=0;i<10;i++)a.recordCoinAchievement();
  assert.equal(a.achievementData.coinsCollected,10);assert.ok(a.achievementData.earned.includes('first_jump'));assert.ok(a.achievementData.earned.includes('coin_collector'));
});
test('Boss platforms have separate achievement identities; Race reuses Adventure (#48)',()=>{
  const {api:a}=createGame(source);a.gameMode='level';a.recordPlatformLanding({id:3});a.gameMode='race';a.recordPlatformLanding({id:3});assert.equal(a.achievementData.platformsLanded,1);
  a.gameMode='boss';a.recordPlatformLanding({id:3});assert.equal(a.achievementData.platformsLanded,2);
});
test('failed atomic shop save leaves wallet and ownership unchanged (#46)',async()=>{
  const records=new Map([['frogJumperWalletCoins','60']]);
  const h=createGame(source,{records,failWrite:k=>k==='frogJumperEconomy',navigator:{locks:{request:async(_name,fn)=>fn()}}});
  h.api.showShop();h.events['shop-black:click'].at(-1)();await Promise.resolve();await Promise.resolve();
  assert.equal(h.api.walletCoins,60);assert.equal(h.api.readWalletCoins(),60);assert.equal(h.api.loadShopData().ownedHats.length,0);assert.ok(h.alerts.length>0);
});
test('failed compatibility mirror cannot erase an atomically saved purchase (#46)',async()=>{
  const records=new Map([['frogJumperWalletCoins','60']]);
  const h=createGame(source,{records,failWrite:k=>k==='frogJumperShop',navigator:{locks:{request:async(_name,fn)=>fn()}}});
  h.api.showShop();h.events['shop-black:click'].at(-1)();await Promise.resolve();
  const reloaded=createGame(source,{records});assert.equal(reloaded.api.readWalletCoins(),0);assert.ok(reloaded.api.loadShopData().ownedHats.includes('black'));
});
test('failed cosmetic requests retry after backoff, never every frame (#47)',()=>{
  const {api:a}=createGame(source);let attempts=0,value='';
  const image={complete:true,naturalWidth:0,get src(){return value},set src(v){value=v;attempts++}};
  a.loadCosmeticImage(image,'skin.png');a.loadCosmeticImage(image,'skin.png');assert.equal(attempts,1);
  image.frogRetryAt=0;a.loadCosmeticImage(image,'skin.png');assert.equal(attempts,2);
  image.complete=false;image.frogRetryAt=0;a.loadCosmeticImage(image,'skin.png');assert.equal(attempts,2);
});
test('Boss button focus still permits movement, jumping and fire (#45)',()=>{
  const h=createGame(source),a=h.api;a.startGame('boss');
  const target={id:'boss-fire',closest(selector){return selector==='#boss-tools'?h.node('boss-tools'):target}};
  for(const code of ['ArrowRight','Space'])h.events['document:keydown'][0]({code,repeat:false,target,preventDefault(){}});
  assert.equal(a.input.right,true);assert.ok(a.player.jumpBuffer>0);
  h.events['boss-tools:click'][0]();assert.equal(h.doc.activeElement.id,'game');
});
test('all generated Adventure rises allow worst lift phases; Level 77 jump lands (#44)',()=>{
  const {api:a}=createGame(source);
  for(const stage of a.LEVELS.slice(5))for(let p=1;p<stage.platforms.length;p++){
    const amp=i=>stage.movers.find(m=>m.index===i)?.amp||0;
    const rise=stage.platforms[p-1][1]+amp(p-1)-stage.platforms[p][1]+amp(p);
    assert.ok(rise<=105.000001,stage.name+' rise '+rise);
  }
  a.gameMode='level';a.setupLevel(76);a.state='playing';const from=a.platforms[1],to=a.platforms[2];
  a.player.x=from.x+from.w-a.player.w-4;a.player.y=from.y-a.player.h;a.player.onGround=true;a.player.standingOn=from;
  a.input.right=true;a.requestJump();let landed=false;
  for(let i=0;i<180;i++){a.update(1/120);if(a.player.standingOn===to){landed=true;break;}}
  assert.ok(landed,'Level 77 first difficult jump must land');
});
test('visible Race retry keeps the current stage like R (#49)',()=>{
  const h=createGame(source),a=h.api;a.startGame('race');a.setupLevel(6);a.showOverlay('robotWon');
  h.events['[data-action="0"]:click'].at(-1)();assert.equal(a.levelIndex,6);assert.equal(a.state,'playing');
});
test('bosses occur on stages 3,6,...45 and Stage 1 remains a warm-up (#33)',()=>{
  const {api:a}=createGame(source);assert.deepEqual(a.BOSS_LEVELS.flatMap((l,i)=>l.bossLevel?[i+1]:[]),Array.from({length:15},(_,i)=>(i+1)*3));
});
test('banking coins does not send unchanged cosmetics (#32)',async()=>{
  const h=createGame(source,{navigator:{locks:{request:async(_name,fn)=>fn()}}}),a=h.api,messages=[];
  a.multiplayerSocket={readyState:1,send:m=>messages.push(JSON.parse(m))};a.sendMultiplayerCosmetics();await a.bankWalletCoins(1);a.sendMultiplayerCosmetics();assert.equal(messages.length,1);
  a.equippedHat='black';a.sendMultiplayerCosmetics();assert.equal(messages.length,2);
});
test('same Infinite room seed yields identical terrain and respawn preserves taken coins (#42)',()=>{
  const ha=createGame(source),hb=createGame(source);const started=Date.now();
  for(const {api:a}of [ha,hb]){a.multiplayerConnected=true;a.multiplayerMode='infinite';a.multiplayerWorldSeed=123456;a.multiplayerWorldStartedAt=started;a.startGame('infinite');}
  const terrain=a=>a.platforms.map(p=>[p.id,p.x,p.baseY,p.w,p.moving]);
  assert.deepEqual(terrain(ha.api),terrain(hb.api));
  const a=ha.api,world=a.infiniteWorld,coin=a.coins[0];coin.taken=true;a.restartCurrentLevel();
  assert.equal(a.infiniteWorld,world);assert.equal(coin.taken,true);
});


test('Worker preserves every game skin through public snapshots and cosmetic messages (#37)',async()=>{
  const h=createWorker(workerSource);await h.ctx.ready;
  const {api:a}=createGame(source);let attachment={joined:true,playerId:'p',skin:'red',hat:'none'};
  const ws={deserializeAttachment:()=>({...attachment}),serializeAttachment:p=>{attachment={...p}},send(){}};
  for(const skin of a.FROG_SKIN_IDS){
    h.room.webSocketMessage(ws,JSON.stringify({type:'cosmetics',skin,hat:'none'}));
    assert.equal(attachment.skin,skin);assert.equal(h.room.publicPlayer(attachment).skin,skin);
  }
  h.room.webSocketMessage(ws,JSON.stringify({type:'cosmetics',skin:'invalid',hat:'invalid'}));
  assert.equal(attachment.skin,'red');assert.equal(attachment.hat,'none');
});
test('Worker rejects non-object HTTP payloads and ignores non-object socket messages (#34)',async()=>{
  const h=createWorker(workerSource);await h.ctx.ready;
  for(const value of [null,[],0,'text',true]){
    const response=await h.worker.fetch(h.request('/api/rooms',value),{});assert.equal(response.status,400);
    const create=await h.room.fetch(h.request('/create',value));assert.equal(create.status,400);
  }
  h.room.roomCreated=true;
  for(const value of [null,[],0,'text',true]){
    const join=await h.room.fetch(h.request('/join',value));assert.equal(join.status,400);
    h.room.webSocketMessage({deserializeAttachment:()=>({joined:true}),serializeAttachment(){throw Error('Invalid message must not mutate')}},JSON.stringify(value));
  }
});
test('Worker tickets share persisted room seed across clients and room reload (#42)',async()=>{
  const h=createWorker(workerSource);await h.ctx.ready;
  assert.equal((await h.room.fetch(h.request('/create',{mode:'infinite'}))).status,200);
  const one=await (await h.room.fetch(h.request('/join',{mode:'infinite',name:'one'}))).json();
  const two=await (await h.room.fetch(h.request('/join',{mode:'infinite',name:'two'}))).json();
  assert.equal(one.worldSeed,two.worldSeed);assert.equal(one.worldStartedAt,two.worldStartedAt);assert.ok(Number.isInteger(one.worldSeed));
  const restored=createWorker(workerSource,h.records);await restored.ctx.ready;
  const three=await (await restored.room.fetch(restored.request('/join',{mode:'infinite',name:'three'}))).json();
  assert.equal(three.worldSeed,one.worldSeed);assert.equal(three.worldStartedAt,one.worldStartedAt);
});
