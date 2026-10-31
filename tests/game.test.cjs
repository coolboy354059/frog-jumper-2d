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
    }).listen(0,'127.0.0.1',function(){process.stdout.write('PORT '+this.address().port+'\\n');});
  `], { stdio: ['ignore','pipe','pipe'] });
  const port = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Local test server did not start')), 10000);
    let buffer = '';
    server.stdout.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/PORT (\\d+)/);
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
  await page.evaluate(() => localStorage.setItem('frogJumperCoins','999999999999999999999999999999'));
  await page.reload({waitUntil:'load'});
  await page.getByRole('button',{name:'COIN SHOP'}).click();
  await assertVisibleText(page,'FROGGY SHOP');
  assert.deepEqual(errors, []);
  await page.close();
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
    assert.ok(Number(response.headers()['content-length'] || 0) > 0,asset+' must not be empty');
  }
  await page.close();
});

test('mobile-sized viewport exposes touch controls without breaking layout', async () => {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(baseUrl,{waitUntil:'load'});
  assert.equal(await page.locator('#jump-control').isVisible(),true);
  assert.equal(await page.locator('#move-stick').isVisible(),true);
  assert.deepEqual(errors,[]);
  await context.close();
});

async function assertVisibleText(page,text) {
  await page.locator('#overlay').getByText(text,{exact:true}).waitFor({state:'visible'});
}
async function assertHidden(page,selector) {
  await page.locator(selector).waitFor({state:'hidden'});
}
