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
    const types = {'.html':'text/html; charset=utf-8','.png':'image/png','.css':'text/css'};
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
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.action),'5');
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

test('shop displays all cosmetics and prevents unaffordable purchases', async () => {
  const {page}=await freshPage();
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  for (const item of ['Black Hat','Jupiter Skin','Tiny TV Hat']) await assertVisibleText(page,item);
  const jupiter=page.locator('[data-shop-item="jupiter"]');
  assert.equal(await jupiter.isDisabled(), true);
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
  await page.evaluate(() => localStorage.setItem('frogJumperWalletCoins','20'));
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  const blackHat=page.locator('[data-shop-item="black"]');
  assert.match(await blackHat.innerText(),/BUY/);
  await blackHat.click();
  assert.match(await page.locator('.wallet-line').innerText(),/0 coins/);
  assert.equal((await blackHat.innerText()).trim(),'UNEQUIP');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.shopItem),'black','focus should stay on the purchased shop item');
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  const savedBlackHat=page.locator('[data-shop-item="black"]');
  assert.equal((await savedBlackHat.innerText()).trim(),'UNEQUIP');
  assert.match(await page.locator('.wallet-line').innerText(),/0 coins/);
  await savedBlackHat.click();
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
    const earned=await page.evaluate(() => JSON.parse(localStorage.getItem('frogJumperAchievements')||'{}').earned||[]);
    await context.close();
    return earned.includes('halloween_explorer');
  }
  assert.equal(await runInfiniteExploreAt('2026-09-30T12:00:00'),false,'September should not unlock the seasonal achievement');
  assert.equal(await runInfiniteExploreAt('2026-10-15T12:00:00'),true,'October should unlock the seasonal achievement');
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
    '/assets/tv-hat.png'
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

async function assertVisibleText(page,text) {
  const matches=page.locator('#overlay').getByText(text,{exact:true});
  assert.ok(await matches.count()>0,'Expected visible text: '+text);
  await matches.first().waitFor({state:'visible'});
}
async function assertHidden(page,selector) {
  await page.locator(selector).waitFor({state:'hidden'});
}
