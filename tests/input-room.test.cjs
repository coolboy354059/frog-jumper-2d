const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../index-game.html'),'utf8');
function section(a,b){return src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));}
test('both physical keys must be released before horizontal movement stops',()=>{
 const handlers={}, c={document:{addEventListener:(k,f)=>handlers[k]=f},heldMovementKeys:new Set(),keyboardInput:{},syncHorizontalInput(){},state:'playing'};
 vm.runInNewContext(section("  document.addEventListener('keydown',e=>{","  window.addEventListener('blur'"),c);
 for(const [first,second,dir] of [['KeyD','ArrowRight','right'],['ArrowLeft','KeyA','left']]){
 for(const code of [first,second])handlers.keydown({code,preventDefault(){}});
 handlers.keyup({code:first});assert.equal(c.keyboardInput[dir],true);
 handlers.keyup({code:second});assert.equal(c.keyboardInput[dir],false);}
});
test('controller can start a game from the title screen after an idle frame',()=>{
 let pressed=false,started=false,next;
 const c={rafId:0,state:'menu',gamepadConnected:true,document:{hidden:false},gamepadInput:{},navigator:{getGamepads:()=>[{connected:true,buttons:Array.from({length:10},(_,i)=>({pressed:i===9&&pressed}))}]},previousGamepadJump:false,previousGamepadFire:false,previousGamepadMenu:false,syncHorizontalInput(){},requestAnimationFrame:f=>(next=f,1),lastTime:0,render(){},startGame:()=>{started=true}};
 vm.runInNewContext(section('  function ensureFrameLoop','  function hideOverlay')+section('  function pollGamepad','  window.addEventListener(\'gamepadconnected')+section('  function frame(now)','  document.addEventListener(\'keydown')+';ensureFrameLoop()',c);
 next(1);pressed=true;next(17);assert.ok(started);
});
test('room members and reconnecting players use the same terrain seed',()=>{
 function seed(room,now){const c={multiplayerConnected:!!room,multiplayerRoomCode:room,Date:{now:()=>now},Math:Object.assign(Object.create(Math),{random:()=>0}),WORLD_TEMPLATES:[{}],makePlayer:()=>({}),PLAYER_H:1,maintainInfiniteWorld(){},updateHUD(){}};vm.runInNewContext(section('  function setupInfiniteExplore','  function setupLevel')+';setupInfiniteExplore()',c);return c.infiniteWorld.seed;}
 assert.equal(seed('ABC234',1),seed('ABC234',2));assert.notEqual(seed('ABC234',1),seed('ABC235',1));assert.notEqual(seed('',1),seed('',2));
});
