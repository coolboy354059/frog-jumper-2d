'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index-game.html'), 'utf8');

test('bosses appear every third stage throughout the campaign', () => {
  const start = html.indexOf('const BOSS_WORLD_TEMPLATES =');
  const end = html.indexOf("\n  let state = 'menu';", start);
  assert.ok(start >= 0 && end > start);
  const levels = vm.runInNewContext('const BOSS_TOTAL_LEVELS=45;\n' + html.slice(start, end) + '\nBOSS_LEVELS');
  assert.deepEqual(Array.from(levels, (level, index) => level.bossLevel ? index + 1 : 0).filter(Boolean), Array.from({length:15}, (_,i)=>(i+1)*3));
});

test('boss platform landings are distinct from adventure and race layouts', () => {
  const start = html.indexOf('function recordPlatformLanding(platform)');
  const end = html.indexOf('function showAchievements()', start);
  assert.ok(start >= 0 && end > start);
  const data = {visitedPlatforms: [], platformsLanded: 0, earned: []};
  const context = { infiniteWorld: null, levelIndex: 0, gameMode: 'level', updateAchievementData: fn => fn(data) };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.recordPlatformLanding({id:3});
  context.gameMode='race'; context.recordPlatformLanding({id:3});
  context.gameMode='boss'; context.recordPlatformLanding({id:3});
  context.recordPlatformLanding({id:3});
  assert.equal(data.platformsLanded, 2);
  assert.deepEqual(data.visitedPlatforms, ['level:0:3','boss:0:3']);
});

test('race retry button invokes the current stage retry', () => {
  const match = html.match(/\['RETRY RACE','primary',\(\)=>([a-zA-Z]+)\(\)\]/);
  assert.ok(match);
  let current=0, run=0;
  const callback = vm.runInNewContext('()=>'+match[1]+'()', {restartCurrentLevel:()=>current++,restartRun:()=>run++});
  callback();
  assert.equal(current,1);
  assert.equal(run,0);
});
