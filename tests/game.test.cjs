'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');

let browser;
let server;
let baseUrl;
let serverOutput = '';

before(async () => {
  server = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const fs = require('node:fs');
    const path = require('node:path');
    const root = process.cwd();
    const types = {'.html':'text/html; charset=utf-8','.png':'image/png','.css':'text/css','.js':'text/javascript; charset=utf-8'};
    http.createServer((req,res) => {
      let pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if (pathname === '/') pathname = '/index.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err,data) => {
        if (err) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream'});
        res.end(data);
      });
    }).listen(0,'127.0.0.1',function(){process.stdout.write('PORT '+this.address().port + String.fromCharCode(10));});
  `], { stdio: ['ignore','pipe','pipe'] });
  const port = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Local test server did not start')), 10000);
    let buffer = '';
    server.stdout.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/PORT ([0-9]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.on('error', reject);
  });
  baseUrl = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: 'load' });
  return { page, errors };
}

test('page loads with correct title, canvas, and visible main menu', async () => {
  const {page,errors}=await freshPage();
  assert.match(await page.title(), /Frog Jumper/i);
  assert.equal(await page.locator('#game').count(), 1);
  assert.equal(await page.locator('#game').getAttribute('width'), '960');
  assert.equal(await page.locator('#game').getAttribute('height'), '600');
  await assertVisibleText(page, 'FROG JUMPER');
  assert.deepEqual(errors, []);
  await page.close();
});

test('all four main-menu actions work', async () => {
  const {page}=await freshPage();
  await page.getByRole('button',{name:'HOW TO PLAY'}).click();
  await assertVisibleText(page,'HOW TO HOP');
  await page.getByRole('button',{name:'BACK TO MENU'}).click();
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  await assertVisibleText(page,'FROGGY SHOP');
  await page.getByRole('button',{name:'BACK TO MENU'}).click();
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await assertHidden(page,'#overlay');
  await page.keyboard.press('p');
  await assertVisibleText(page,'PAUSED');
  await page.close();
});

test('modal popups expose dialog semantics and trap keyboard focus', async () => {
  const {page,errors}=await freshPage();
  const overlay=page.locator('#overlay');
  assert.equal(await overlay.getAttribute('role'),'dialog');
  assert.equal(await overlay.getAttribute('aria-modal'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.action),'0');
  const lastMenuAction=String(await overlay.locator('[data-action]').count()-1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.action),lastMenuAction);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.action),'0');
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  assert.equal(await overlay.getAttribute('role'),'dialog');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'shop-back');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'shop-back');
  await page.getByRole('button',{name:'BACK TO MENU'}).click();
  await page.getByRole('button',{name:'ACHIEVEMENTS'}).click();
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'achievements-back');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('platform achievements count distinct platforms, not repeated jumps on one platform', async () => {
  const {page,errors}=await freshPage();
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await page.waitForTimeout(150);
  const readPlatformProgress=()=>page.evaluate(()=>{
    const saved=JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}');
    return {count:saved.platformsLanded||0,visited:saved.visitedPlatforms||[]};
  });
  const before=await readPlatformProgress();
  assert.equal(before.count,0,'spawning on the starting platform must not count as a landing');
  assert.equal(before.visited.length,0,'the starting platform should not be recorded as a landing');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1100);
  const afterFirstLanding=await readPlatformProgress();
  assert.equal(afterFirstLanding.count,1,'the first real landing on the starting platform should count once');
  assert.equal(afterFirstLanding.visited.length,1);

  await page.keyboard.press('Space');
  await page.waitForTimeout(1100);
  const afterRepeat=await readPlatformProgress();
  assert.equal(afterRepeat.count,1,'landing on the same starting platform again must not increase unique-platform progress');
  assert.deepEqual(afterRepeat.visited,afterFirstLanding.visited);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.down('Space');
  await page.waitForTimeout(750);
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(150);
  const afterNextPlatform=await readPlatformProgress();
  assert.equal(afterNextPlatform.count,2,'landing on the next distinct platform should increase progress once');
  assert.equal(afterNextPlatform.visited.length,2);
  assert.deepEqual(errors,[]);
  await page.close();
});

test('pausing freezes the rendered game state', async () => {
  const {page,errors}=await freshPage();
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.press('p');
  await page.keyboard.up('ArrowRight');
  await assertVisibleText(page,'PAUSED');
  const pausedFrame=await page.locator('#game').evaluate(canvas=>canvas.toDataURL());
  await page.waitForTimeout(500);
  const stillPausedFrame=await page.locator('#game').evaluate(canvas=>canvas.toDataURL());
  assert.equal(stillPausedFrame,pausedFrame,'the rendered game world should remain unchanged while paused');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('canceling a touch on jump does not trigger a buffered jump', async () => {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseUrl,{waitUntil:'load'});
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await assertHidden(page,'#overlay');
  const frogCenterY=()=>page.evaluate(()=>{
    const data=document.getElementById('game').getContext('2d').getImageData(0,0,960,600).data;
    let sum=0,count=0;
    for(let y=450;y<540;y++){
      for(let x=35;x<130;x++){
        const i=(y*960+x)*4;
        if(data[i]>120&&data[i+1]<100&&data[i+2]<120){sum+=y;count++;}
      }
    }
    return count>10?sum/count:null;
  });
  await page.waitForTimeout(100);
  const before=await frogCenterY();
  assert.ok(before!==null,'the frog should be visible on the starting platform');
  await page.locator('#jump-control').evaluate(button=>{
    const rect=button.getBoundingClientRect();
    const options={bubbles:true,cancelable:true,pointerId:77,pointerType:'touch',clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};
    button.dispatchEvent(new PointerEvent('pointerdown',options));
    button.dispatchEvent(new PointerEvent('pointercancel',options));
  });
  await page.waitForTimeout(150);
  const after=await frogCenterY();
  assert.ok(after!==null&&Math.abs(after-before)<12,'canceling the touch should clear its pending jump request');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('a completed touch tap still triggers a jump', async () => {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseUrl,{waitUntil:'load'});
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await assertHidden(page,'#overlay');
  const frogCenterY=()=>page.evaluate(()=>{
    const data=document.getElementById('game').getContext('2d').getImageData(0,0,960,600).data;
    let sum=0,count=0;
    for(let y=350;y<540;y++){
      for(let x=35;x<130;x++){
        const i=(y*960+x)*4;
        if(data[i]>120&&data[i+1]<100&&data[i+2]<120){sum+=y;count++;}
      }
    }
    return count>10?sum/count:null;
  });
  await page.waitForTimeout(100);
  const before=await frogCenterY();
  assert.ok(before!==null,'the frog should be visible before the tap');
  const jumpButton=page.locator('#jump-control');
  await jumpButton.evaluate(button=>{
    window.__jumpPointerTrace=[];
    for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','touchstart','touchend','click']){
      button.addEventListener(type,event=>window.__jumpPointerTrace.push(type+':'+(event.pointerType||'')+':'+(event.pointerId??'')),true);
    }
  });
  // Use a real touch gesture and allow the fixed-step game loop to render the jump.
  await jumpButton.tap();
  let after=null;
  for(let attempt=0;attempt<10;attempt++){
    await page.waitForTimeout(50);
    after=await frogCenterY();
    if(after!==null&&after<before-25)break;
  }
  const pointerTrace=await page.evaluate(()=>window.__jumpPointerTrace);
  assert.ok(after!==null&&after<before-25,'a completed tap should still make the frog jump (before='+before+', after='+after+', events='+pointerTrace.join(' -> ')+')');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('robot race starts and can be paused and resumed', async () => {
  const {page}=await freshPage();
  await page.getByRole('button',{name:'ROBOT RACE'}).click();
  await assertHidden(page,'#overlay');
  await page.keyboard.press('Escape');
  await assertVisibleText(page,'PAUSED');
  await page.getByRole('button',{name:/RESUME/}).click();
  await assertHidden(page,'#overlay');
  await page.close();
});

test('pause menu can safely return to the title menu', async () => {
  const {page}=await freshPage();
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await page.keyboard.press('p');
  await page.getByRole('button',{name:'MENU',exact:true}).click();
  await assertVisibleText(page,'FROG JUMPER');
  await page.close();
});

test('shop displays all cosmetics, including original class-inspired skins, and prevents unaffordable purchases', async () => {
  const {page}=await freshPage();
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  for (const item of [
    'Black Hat','Jupiter Skin','Tiny TV Hat',
    'Red Quill','Longneck Pal','Sky Glider','Fishbone','Big-Eye Buddy',
    'Little Mouse','Bear Buddy','Wacky Beak','Bunny Hop','Box Buddy',
    'Whiskers','Tiny Chick','Little Alien'
  ]) await assertVisibleText(page,item);
  for (const id of [
    'spiky','longneck','glider','fishbone','bigeyes','mouse','bear',
    'longbeak','bunny','boxbot','kitty','chick','alien'
  ]) {
    const item=page.locator('[data-shop-item="'+id+'"]');
    assert.equal(await item.count(),1,'shop should contain the '+id+' skin exactly once');
    assert.equal(await item.isDisabled(),true,'new skins should not be purchasable without coins');
  }
  const jupiter=page.locator('[data-shop-item="jupiter"]');
  assert.equal(await jupiter.isDisabled(), true);
  assert.doesNotMatch(await page.locator('.shop-grid').innerText(), /Mario|Pikachu/i);
  await page.close();
});

test('Wacky Beak skin can be equipped and its transparent PNG decodes in gameplay', async () => {
  const {page,errors}=await freshPage();
  await page.evaluate(() => localStorage.setItem('frogJumperShop', JSON.stringify({
    ownedSkins:['red','longbeak'],
    ownedHats:[],
    equippedSkin:'longbeak',
    equippedHat:'none'
  })));
  await page.reload({waitUntil:'load'});
  const savedShop=await page.evaluate(()=>JSON.parse(localStorage.getItem('frogJumperShop')||'{}'));
  assert.equal(savedShop.equippedSkin,'longbeak');
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await assertHidden(page,'#overlay');
  const response=await page.request.get(baseUrl+'/assets/wacky-beak.png');
  assert.equal(response.status(),200,'Wacky Beak PNG must load successfully');
  assert.match(response.headers()['content-type']||'',/image\/png/i);
  const pngInfo=await page.evaluate(async (src)=>{
    const image=new Image();
    image.src=src;
    await image.decode();
    return {width:image.naturalWidth,height:image.naturalHeight};
  },baseUrl+'/assets/wacky-beak.png');
  assert.deepEqual(pngInfo,{width:96,height:96});
  assert.deepEqual(errors,[]);
  await page.close();
});

test('malformed saved shop data does not crash the game', async () => {
  const {page,errors}=await freshPage();
  await page.evaluate(() => localStorage.setItem('frogJumperShop','{ definitely not json'));
  await page.reload({waitUntil:'load'});
  await assertVisibleText(page,'FROG JUMPER');
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  await assertVisibleText(page,'FROGGY SHOP');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the game remains playable when browser storage is unavailable', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(() => {
    Storage.prototype.getItem=function(){throw new Error('Storage blocked');};
    Storage.prototype.setItem=function(){throw new Error('Storage blocked');};
    Storage.prototype.removeItem=function(){throw new Error('Storage blocked');};
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseUrl,{waitUntil:'load'});
  await assertVisibleText(page,'FROG JUMPER');
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  await assertVisibleText(page,'FROGGY SHOP');
  await page.getByRole('button',{name:'BACK TO MENU'}).click();
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await assertHidden(page,'#overlay');
  await page.keyboard.press('p');
  await assertVisibleText(page,'PAUSED');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('invalid and unsafe wallet values are safely handled', async () => {
  const {page,errors}=await freshPage();
  await page.evaluate(() => localStorage.setItem('frogJumperWalletCoins','999999999999999999999999999999'));
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  await assertVisibleText(page,'FROGGY SHOP');
  assert.match(await page.locator('.wallet-line').innerText(), /0 coins/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('achievements screen opens, lists all achievements, and returns to menu', async () => {
  const {page,errors}=await freshPage();
  await page.getByRole('button',{name:'ACHIEVEMENTS'}).click();
  await assertVisibleText(page,'ACHIEVEMENTS');
  await assertVisibleText(page,'0 of 5 unlocked');
  for (const name of ['First Jump','Coin Collector','Platform Hopper','Platform Master','Halloween Explorer']) {
    await assertVisibleText(page,name);
  }
  await page.getByRole('button',{name:'BACK TO MENU'}).click();
  await assertVisibleText(page,'FROG JUMPER');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('Infinite Explore can start, pause, resume, and return to the menu', async () => {
  const {page,errors}=await freshPage();
  await page.getByRole('button',{name:'INFINITE EXPLORE'}).click();
  await assertHidden(page,'#overlay');
  await page.keyboard.press('Escape');
  await assertVisibleText(page,'PAUSED');
  await page.getByRole('button',{name:/RESUME/}).click();
  await assertHidden(page,'#overlay');
  await page.keyboard.press('p');
  await assertVisibleText(page,'PAUSED');
  await page.getByRole('button',{name:'MENU',exact:true}).click();
  await assertVisibleText(page,'FROG JUMPER');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('shop purchases are charged once and remain owned after reload', async () => {
  const {page,errors}=await freshPage();
  await page.evaluate(() => localStorage.setItem('frogJumperWalletCoins','60'));
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  const blackHat=page.locator('[data-shop-item="black"]');
  assert.match(await blackHat.innerText(),/BUY/);
  await blackHat.click();
  await page.waitForFunction(()=>{
    const button=document.querySelector('[data-shop-item="black"]');
    const balance=document.querySelector('.wallet-line strong');
    return button?.textContent.trim()==='UNEQUIP'&&balance?.textContent.trim()==='0';
  });
  assert.equal((await page.locator('.wallet-line strong').innerText()).trim(),'0');
  assert.equal((await blackHat.innerText()).trim(),'UNEQUIP');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.shopItem),'black','focus should stay on the purchased shop item');
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  const savedBlackHat=page.locator('[data-shop-item="black"]');
  await page.waitForFunction(()=>document.querySelector('[data-shop-item="black"]')?.textContent.trim()==='UNEQUIP');
  assert.equal((await savedBlackHat.innerText()).trim(),'UNEQUIP');
  assert.equal((await page.locator('.wallet-line strong').innerText()).trim(),'0');
  await savedBlackHat.click();
  await page.waitForFunction(()=>document.querySelector('[data-shop-item="black"]')?.textContent.trim()==='EQUIP');
  assert.equal((await savedBlackHat.innerText()).trim(),'EQUIP');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.shopItem),'black','focus should stay on the shop item after unequipping');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('malformed achievement saves are sanitized without crashing the menu', async () => {
  const {page,errors}=await freshPage();
  await page.evaluate(() => localStorage.setItem('frogJumperAchievements',JSON.stringify({
    earned:['first_jump','not-a-real-achievement','first_jump'],
    coinsCollected:-4,
    platformsLanded:'lots'
  })));
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'ACHIEVEMENTS'}).click();
  await assertVisibleText(page,'1 of 5 unlocked');
  await assertVisibleText(page,'First Jump');
  await assertVisibleText(page,'LOCKED');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('R restarts from the pause dialog even while its button has focus', async () => {
  const {page,errors}=await freshPage();
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await page.keyboard.press('p');
  await assertVisibleText(page,'PAUSED');
  await page.keyboard.press('r');
  await assertHidden(page,'#overlay');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('the R key does not accidentally start a game from the title menu', async () => {
  const {page,errors}=await freshPage();
  await page.keyboard.press('r');
  await assertVisibleText(page,'FROG JUMPER');
  assert.equal(await page.locator('#overlay').isVisible(),true);
  await page.close();
});

test('Halloween Explorer unlocks only during October', async () => {
  async function runInfiniteExploreAt(dateString) {
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    await context.addInitScript(iso => {
      const NativeDate=Date;
      const frozenTime=NativeDate.parse(iso);
      class FrozenDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [frozenTime])); }
        static now() { return frozenTime; }
      }
      window.Date=FrozenDate;
    },dateString);
    const page=await context.newPage();
    await page.goto(baseUrl,{waitUntil:'load'});
    await page.getByRole('button',{name:'INFINITE EXPLORE'}).click();
    if(dateString.includes('-10-')){
      await page.waitForFunction(()=>(
        JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}').earned||[]
      ).includes('halloween_explorer'),null,{timeout:7000});
    }
    const earned=await page.evaluate(() => JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}').earned||[]);
    await context.close();
    return earned.includes('halloween_explorer');
  }
  assert.equal(await runInfiniteExploreAt('2026-09-30T12:00:00'),false,'September should not unlock the seasonal achievement');
  assert.equal(await runInfiniteExploreAt('2026-10-15T12:00:00'),true,'October should unlock the seasonal achievement');
});


test('multiplayer buttons are re-enabled when the WebSocket fails before opening', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(() => {
    window.__frogJumperTestSockets=[];
    class FailingWebSocket extends EventTarget {
      constructor(url) {
        super();
        this.url=url;
        this.readyState=0;
        window.__frogJumperTestSockets.push(this);
      }
      close(code=1000,reason='') {
        if(this.readyState===3)return;
        this.readyState=3;
        this.dispatchEvent(new CloseEvent('close',{code,reason}));
      }
      failBeforeOpen(withError=true) {
        if(withError)this.dispatchEvent(new Event('error'));
        this.close(1006,'Simulated connection failure');
      }
    }
    window.WebSocket=FailingWebSocket;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=String(input);
      if(url.includes('/api/rooms/')&&url.includes('/join')) {
        return new Response(JSON.stringify({token:'test-token'}),{status:200,headers:{'content-type':'application/json'}});
      }
      if(url.endsWith('/api/rooms')) {
        return new Response(JSON.stringify({code:'ABC234',mode:'level',capacity:10}),{status:201,headers:{'content-type':'application/json'}});
      }
      return nativeFetch(input,init);
    };
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(baseUrl,{waitUntil:'load'});
  await page.getByRole('button',{name:'MULTIPLAYER'}).click();

  await page.locator('#mp-create').click();
  await page.waitForFunction(()=>window.__frogJumperTestSockets.length===1);
  await page.evaluate(()=>window.__frogJumperTestSockets[0].failBeforeOpen());
  await page.waitForFunction(()=>!document.querySelector('#mp-create').disabled&&!document.querySelector('#mp-join').disabled);
  assert.match(await page.locator('#mp-status').textContent(),/Connection failed/i);

  await page.locator('#mp-code').fill('ABC234');
  await page.locator('#mp-join').click();
  await page.waitForFunction(()=>window.__frogJumperTestSockets.length===2);
  await page.evaluate(()=>window.__frogJumperTestSockets[1].failBeforeOpen(false));
  await page.waitForFunction(()=>!document.querySelector('#mp-create').disabled&&!document.querySelector('#mp-join').disabled);
  assert.match(await page.locator('#mp-status').textContent(),/Connection failed/i);
  assert.deepEqual(errors,[]);
  await context.close();
});


test('achievement progress is merged when two tabs collect coins at the same time', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const pageA=await context.newPage();
  const pageB=await context.newPage();
  const errors=[];
  for(const page of [pageA,pageB]){
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  }
  await pageA.goto(baseUrl,{waitUntil:'load'});
  await pageA.evaluate(()=>localStorage.setItem('frogJumperAchievements',JSON.stringify({
    earned:[],coinsCollected:0,platformsLanded:0,visitedPlatforms:[]
  })));
  await pageA.reload({waitUntil:'load'});
  await pageB.goto(baseUrl,{waitUntil:'load'});
  await pageA.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await pageB.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();

  async function collectFirstCoin(page){
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(650);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('Space');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(450);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(260);
    await page.keyboard.up('Space');
  }
  await Promise.all([collectFirstCoin(pageA),collectFirstCoin(pageB)]);
  await pageA.waitForFunction(()=>JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}').coinsCollected>=2,null,{timeout:7000});
  await pageB.waitForFunction(()=>JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}').coinsCollected>=2,null,{timeout:7000});
  const saved=await pageA.evaluate(()=>JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}'));
  assert.equal(saved.coinsCollected,2,'both tabs should retain their separate coin pickup progress');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('achievement screen refreshes when another tab unlocks an achievement', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const pageA=await context.newPage();
  const pageB=await context.newPage();
  const errors=[];
  for(const page of [pageA,pageB]){
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  }
  await pageA.goto(baseUrl,{waitUntil:'load'});
  await pageB.goto(baseUrl,{waitUntil:'load'});
  await pageB.getByRole('button',{name:'ACHIEVEMENTS'}).click();
  await assertVisibleText(pageB,'0 of 5 unlocked');

  await pageA.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await pageA.keyboard.press('Space');
  await pageB.waitForFunction(()=>document.querySelector('#overlay p')?.textContent.includes('1 of 5 unlocked'));
  await assertVisibleText(pageB,'First Jump');
  await assertVisibleText(pageB,'UNLOCKED');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('best-coin label refreshes across tabs when the label is present', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const pageA=await context.newPage();
  const pageB=await context.newPage();
  await pageA.goto(baseUrl,{waitUntil:'load'});
  await pageB.goto(baseUrl,{waitUntil:'load'});
  await pageB.evaluate(()=>{
    const label=document.createElement('strong');
    label.id='best-label';
    document.body.appendChild(label);
  });
  await pageA.evaluate(()=>localStorage.setItem('frogJumperBestCoins','67'));
  await pageB.waitForFunction(()=>document.querySelector('#best-label')?.textContent==='67');
  assert.equal(await pageB.locator('#best-label').textContent(),'67');
  await context.close();
});

test('a connected multiplayer disconnect shows recovery options and preserves room details', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(()=>{
    window.__frogJumperTestSockets=[];
    class MockWebSocket extends EventTarget {
      constructor(url){super();this.url=url;this.readyState=0;window.__frogJumperTestSockets.push(this);}
      openConnection(){this.readyState=1;this.dispatchEvent(new Event('open'));}
      close(code=1000,reason=''){
        if(this.readyState===3)return;
        this.readyState=3;
        this.dispatchEvent(new CloseEvent('close',{code,reason}));
      }
    }
    window.WebSocket=MockWebSocket;
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=String(input);
      if(url.includes('/api/rooms/')&&url.includes('/join')){
        return new Response(JSON.stringify({token:'test-token'}),{status:200,headers:{'content-type':'application/json'}});
      }
      if(url.endsWith('/api/rooms')){
        return new Response(JSON.stringify({code:'ABC234',mode:'race',capacity:10}),{status:201,headers:{'content-type':'application/json'}});
      }
      return nativeFetch(input,init);
    };
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(baseUrl,{waitUntil:'load'});
  await page.getByRole('button',{name:'MULTIPLAYER'}).click();
  await page.locator('#mp-name').fill('Frog Racer');
  await page.locator('#mp-mode').selectOption('race');
  await page.locator('#mp-create').click();
  await page.waitForFunction(()=>window.__frogJumperTestSockets.length===1);
  await page.evaluate(()=>window.__frogJumperTestSockets[0].openConnection());
  await assertHidden(page,'#overlay');

  await page.evaluate(()=>window.__frogJumperTestSockets[0].close(1006,'Simulated network loss'));
  await assertVisibleText(page,'MULTIPLAYER CONNECTION LOST');
  await page.getByRole('button',{name:'BACK TO MULTIPLAYER'}).click();
  assert.equal(await page.locator('#mp-name').inputValue(),'Frog Racer');
  assert.equal(await page.locator('#mp-mode').inputValue(),'race');
  assert.equal(await page.locator('#mp-code').inputValue(),'ABC234');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('browser without a 2D canvas context gets a helpful fallback instead of crashing', async () => {
  const context=await browser.newContext();
  await context.addInitScript(() => {
    const nativeGetContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args) {
      if(type==='2d') return null;
      return nativeGetContext.call(this,type,...args);
    };
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(baseUrl,{waitUntil:'load'});
  await assertVisibleText(page,'CANVAS NOT SUPPORTED');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('all game artwork files are served successfully', async () => {
  const {page}=await freshPage();
  for (const asset of [
    '/assets/601f2f8d-d595-494c-bd9e-6aaaf5fcdcea.png',
    '/assets/black-hat.png',
    '/assets/tv-hat.png',
    '/assets/wacky-beak.png'
  ]) {
    const response=await page.request.get(baseUrl+asset);
    assert.equal(response.status(),200,asset+' must load');
    assert.ok((await response.body()).length > 0,asset+' must not be empty');
  }
  await page.close();
});

test('mobile-sized viewport centers the game, popup, and touch controls', async () => {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(baseUrl,{waitUntil:'load'});
  const stage=await page.locator('#stage').boundingBox();
  const cabinet=await page.locator('.cabinet').boundingBox();
  const menuCard=await page.locator('#overlay .overlay-card').boundingBox();
  assert.ok(Math.abs((stage.x+stage.width/2)-(cabinet.x+cabinet.width/2))<3,'game stage should be horizontally centered');
  assert.ok(Math.abs((menuCard.x+menuCard.width/2)-(stage.x+stage.width/2))<3,'menu popup should be centered over the game');
  assert.equal(await page.locator('#jump-control').isVisible(),true);
  assert.equal(await page.locator('#move-stick').isVisible(),true);
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  const bottomBar=await page.locator('#bottom-bar').boundingBox();
  const controls=await page.locator('.controls').boundingBox();
  assert.ok(Math.abs((controls.x+controls.width/2)-(bottomBar.x+bottomBar.width/2))<3,'touch controls should be centered below the game');
  assert.equal(await page.locator('#pause-control').isVisible(),true);
  await page.locator('#pause-control').click();
  await assertVisibleText(page,'PAUSED');
  await page.getByRole('button',{name:/RESUME/}).click();
  await assertHidden(page,'#overlay');
  assert.deepEqual(errors,[]);
  await context.close();
});


test('Level Adventure coins are not banked until the level is completed', async () => {
  const {page,errors}=await freshPage();
  await page.evaluate(()=>localStorage.setItem('frogJumperWalletCoins','34'));
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();

  // Walk to the first platform edge, then jump through the first coin's path.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(650);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(450);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(260);
  await page.keyboard.up('Space');

  await page.waitForFunction(()=>{
    const saved=JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}');
    return saved.coinsCollected>=1;
  },null,{timeout:7000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('frogJumperWalletCoins')),'34',
    'a collected coin in an unfinished level must remain unbanked');
  await page.reload({waitUntil:'load'});
  assert.equal(await page.evaluate(()=>localStorage.getItem('frogJumperWalletCoins')),'34',
    'reloading before completing the level must not increase the wallet');
  assert.deepEqual(errors,[]);
  await page.close();
});

test('shop purchases stay synchronized across tabs and preserve both purchases', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const pageA=await context.newPage();
  await pageA.goto(baseUrl,{waitUntil:'load'});
  await pageA.evaluate(()=>localStorage.setItem('frogJumperWalletCoins','360'));
  await pageA.reload({waitUntil:'load'});
  await pageA.getByRole('button',{name:'COIN SHOP'}).click();

  const pageB=await context.newPage();
  await pageB.goto(baseUrl,{waitUntil:'load'});
  await pageB.getByRole('button',{name:'COIN SHOP'}).click();

  await pageA.locator('[data-shop-item="gold"]').click();
  await pageB.waitForFunction(()=>document.querySelector('.wallet-line')?.textContent.includes('60 coins'));
  assert.equal(await pageB.locator('[data-shop-item="black"]').isDisabled(),false,
    'the second tab should see the remaining 60-coin balance');
  await pageB.locator('[data-shop-item="black"]').click();

  await pageB.waitForFunction(()=>{
    const wallet=Number(localStorage.getItem('frogJumperWalletCoins'));
    const shop=JSON.parse(localStorage.getItem('frogJumperShop')||'{}');
    return wallet===0&&shop.ownedSkins?.includes('gold')&&shop.ownedHats?.includes('black');
  });
  const saved=await pageA.evaluate(()=>({
    wallet:localStorage.getItem('frogJumperWalletCoins'),
    shop:JSON.parse(localStorage.getItem('frogJumperShop')||'{}')
  }));
  assert.equal(saved.wallet,'0','both legitimate purchases should use exactly 360 coins');
  assert.ok(saved.shop.ownedSkins.includes('gold'),'the first tab purchase must not be erased');
  assert.ok(saved.shop.ownedHats.includes('black'),'the second tab purchase must be preserved');
  assert.deepEqual(saved.shop.ownedSkins.sort(),['gold','red']);
  await context.close();
});

// REGRESSION TEST: 2026-11-13 — Verify a connected gamepad can resume after its Menu button pauses the game.
test('gamepad menu button can pause and resume gameplay', async () => {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(baseUrl,{waitUntil:'load'});
  await page.evaluate(()=>{
    const pad={connected:true,axes:[0,0],buttons:Array.from({length:10},()=>({pressed:false}))};
    window.__frogJumperTestGamepad=pad;
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__frogJumperTestGamepad]});
  });
  const mockStatus=await page.evaluate(()=>({
    method:typeof navigator.getGamepads,
    count:navigator.getGamepads().length,
    connected:navigator.getGamepads()[0]?.connected
  }));
  assert.deepEqual(mockStatus,{method:'function',count:1,connected:true});
  await page.getByRole('button',{name:'PLAY LEVEL ADVENTURE'}).click();
  await assertHidden(page,'#overlay');
  await page.waitForTimeout(100);

  await page.evaluate(()=>{window.__frogJumperTestGamepad.buttons[9].pressed=true;});
  await page.waitForFunction(()=>document.querySelector('#overlay')?.textContent.includes('PAUSED'),null,{timeout:1000});

  await page.evaluate(()=>{window.__frogJumperTestGamepad.buttons[9].pressed=false;});
  await page.waitForTimeout(120);
  await page.evaluate(()=>{window.__frogJumperTestGamepad.buttons[9].pressed=true;});
  await page.locator('#overlay').waitFor({state:'hidden',timeout:1000});

  assert.deepEqual(errors,[]);
  await context.close();
});

async function assertVisibleText(page,text) {
  const matches=page.locator('#overlay').getByText(text,{exact:true});
  assert.ok(await matches.count()>0,'Expected visible text: '+text);
  await matches.first().waitFor({state:'visible'});
}
async function assertHidden(page,selector) {
  await page.locator(selector).waitFor({state:'hidden'});
}
