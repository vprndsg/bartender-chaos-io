// Bartender canvas game + Chaos NPC (goal="chaos") with utility-driven AI.
// Ink-like knots are mocked here; swap in real inkjs + compiled story to upgrade.

import { Tactic, UtilitySelector, RecordOutcome, SCOPE, bbGet, bbSet } from "./bt_nodes_utility.js";

/* ---------- UI / FEED ---------- */
const feedEl = document.getElementById("feed");
const msgEl  = document.getElementById("msg");
const hintEl = document.getElementById("hint");
function say(speaker, text) {
  const p = document.createElement("p");
  if (text === undefined) { text = speaker; speaker = null; }
  p.innerHTML = speaker ? `<span class="k">${speaker}</span>: ${text}` : text;
  feedEl.appendChild(p);
  feedEl.scrollTop = feedEl.scrollHeight;
}
function sys(text) {
  const p = document.createElement("p");
  p.className = "sys";
  p.textContent = text;
  feedEl.appendChild(p);
  feedEl.scrollTop = feedEl.scrollHeight;
}
let msgT = 0;
function toast(text, t=2){ msgEl.textContent = text; msgT = t; }

/* ---------- TOUCH CONTROLS ---------- */
const padL = document.getElementById("padL");
const stick = document.getElementById("stick");
const btnA = document.getElementById("btnA");

/* ---------- CANVAS + RENDER SETUP ---------- */
const FPS_CAP = 30;
const BASE_W = 640, BASE_H = 360;
const MIN_SCALE = 3, MAX_SCALE = 16;
const TILE = 16;
const LEVELS_R = 6, LEVELS_G = 7, LEVELS_B = 6;
const DITHER_STRENGTH = 1;
const WALK_SPEED = 90;
const PLAYER_W = 10, PLAYER_H = 14;

const BAYER8 = [
  0,48,12,60,3,51,15,63, 32,16,44,28,35,19,47,31,
  8,56,4,52,11,59,7,55, 40,24,36,20,43,27,39,23,
  2,50,14,62,1,49,13,61, 34,18,46,30,33,17,45,29,
  10,58,6,54,9,57,5,53, 42,26,38,22,41,25,37,21
];

const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d", { alpha:false });
ctx.imageSmoothingEnabled = false;
const scene = document.createElement("canvas");
const sctx = scene.getContext("2d", { alpha:false });
sctx.imageSmoothingEnabled = false;

let scale=6, viewW=0, viewH=0, sceneW=0, sceneH=0, offsetX=0, offsetY=0;
function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function mix(a,b,t){ return a + (b-a)*t; }
function smoothstep(a,b,x){ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
function hash2(ix,iy){ let x=Math.sin(ix*127.1+iy*311.7)*43758.5453; return x-Math.floor(x); }
function noise2(x,y){ const xi=Math.floor(x), yi=Math.floor(y); const xf=x-xi, yf=y-yi; const u=xf*xf*(3-2*xf); const v=yf*yf*(3-2*yf); const n00=hash2(xi,yi), n10=hash2(xi+1,yi), n01=hash2(xi,yi+1), n11=hash2(xi+1,yi+1); return mix(mix(n00,n10,u), mix(n01,n11,u), v); }
function fbm(x,y){ const n1=noise2(x,y); const n2=noise2(x*2,y*2)*0.5; const n3=noise2(x*4,y*4)*0.25; return (n1+n2+n3*0.75)/2.25; }
function hsv(h,s,v){ h=((h%360)+360)%360; const c=v*s, x=c*(1-Math.abs(((h/60)%2)-1)), m=v-c; let r=0,g=0,b=0;
  if(h<60)[r,g,b]=[c,x,0]; else if(h<120)[r,g,b]=[x,c,0]; else if(h<180)[r,g,b]=[0,c,x];
  else if(h<240)[r,g,b]=[0,x,c]; else if(h<300)[r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
  return [r+m,g+m,b+m];
}
function quantChannel(v, levels, bx, by){ const t=((BAYER8[(by&7)*8+(bx&7)]/64)-0.5)*(DITHER_STRENGTH/levels); const q=Math.floor(clamp(v+t,0,1)*(levels-1)+0.5); return q/(levels-1); }

function resize(){
  const dpr=Math.max(1, window.devicePixelRatio||1);
  viewW=Math.floor(window.innerWidth*dpr);
  viewH=Math.floor(window.innerHeight*dpr);
  canvas.width=viewW; canvas.height=viewH;
  const sFitW=Math.floor(viewW/BASE_W), sFitH=Math.floor(viewH/BASE_H);
  scale=clamp(Math.min(sFitW,sFitH), MIN_SCALE, MAX_SCALE);
  sceneW=Math.max(Math.floor(viewW/scale),160);
  sceneH=Math.max(Math.floor(viewH/scale),90);
  scene.width=sceneW; scene.height=sceneH;
  const drawW=sceneW*scale, drawH=sceneH*scale;
  offsetX=Math.floor((viewW-drawW)/2);
  offsetY=Math.floor((viewH-drawH)/2);
  ensureBuffers();
}
window.addEventListener("resize", resize, { passive:true });
resize();
setTimeout(()=>hintEl.classList.add("fade"), 3500);

/* ---------- WORLD ---------- */
const world = buildWorld();
const cam = { x: world.spawn.x - sceneW*0.5, y: world.spawn.y - sceneH*0.5 };
const player = { x: world.spawn.x, y: world.spawn.y, dx:0, dy:0, facingX:0, facingY:1 };

function buildWorld(){
  const tw=80, th=56;
  const solids=new Uint8Array(tw*th), walls=new Uint8Array(tw*th);
  for(let y=0;y<th;y++) for(let x=0;x<tw;x++){ if(x<2||y<2||x>=tw-2||y>=th-2){ solids[y*tw+x]=1; walls[y*tw+x]=1; } }
  const objects=[];
  const bar = rect(TILE*6, TILE*10, TILE*30, TILE*6, "bar"); objects.push(bar); markSolidRect(solids, tw, th, bar, true);
  const pool= rect(TILE*38, TILE*28, TILE*20, TILE*10, "pool"); objects.push(pool); markSolidRect(solids, tw, th, expand(pool,-6), true);
  for(let i=0;i<3;i++){ const b=rect(TILE*60, TILE*(12+i*12), TILE*12, TILE*10, "booth"); objects.push(b); markSolidRect(solids, tw, th, b, true); }
  for(let i=0;i<6;i++){ const s=rect(TILE*(8+i*5), TILE*18, 10, 10, "stool"); objects.push(s); markSolidRect(solids, tw, th, expand(s,-4), true); }
  const jukebox=rect(TILE*58, TILE*8, TILE*8, TILE*10, "jukebox"); jukebox.interactive=true; objects.push(jukebox);
  const neon=rect(TILE*57, TILE*6, TILE*12, TILE*2, "neon"); objects.push(neon);
  const door=rect(TILE*Math.floor(tw*0.5-2), TILE*(th-4), TILE*4, TILE*3, "door"); door.interactive=true; door.open=false; objects.push(door); markSolidRect(solids, tw, th, door, true);
  const lsw=rect(TILE*4, TILE*6, TILE*2, TILE*3, "switch"); lsw.interactive=true; objects.push(lsw);

  const lights=[]; const addLight=(x,y,r,color,base=1,flicker=false,fx=0,fy=0)=>lights.push({x,y,radius:r,color,base,flicker,fx,fy});
  for(let i=0;i<4;i++){ addLight(TILE*(10+i*10), TILE*12, 85, hsv(30,0.7,0.8), 1.0,true,i*1.37,i*2.11); }
  addLight(pool.x+pool.w*0.5, pool.y+2, 95, hsv(50,0.4,0.7), 0.9,true,7.7,3.3);
  addLight(bar.x-6, bar.y+3, 90, hsv(18,0.8,0.6), 0.7,true,5.1,9.9);
  addLight(neon.x+neon.w*0.5, neon.y+2, 100, hsv(200,0.9,0.9), 1.2,true,2.2,8.8);
  const spawn={ x:TILE*21, y:TILE*9 };
  return { tw, th, pixelW:tw*TILE, pixelH:th*TILE, solids, walls, objects, lights, spawn, ambient:0.24, jukeOn:true };
}
function rect(x,y,w,h,type){ return {x,y,w,h,type}; }
function expand(r,e){ return { x:r.x+e, y:r.y+e, w:r.w-e*2, h:r.h-e*2, type:r.type, interactive:r.interactive, open:r.open }; }
function markSolidRect(solids, tw, th, r, solid){
  const x0=Math.floor(r.x/TILE), y0=Math.floor(r.y/TILE);
  const x1=Math.floor((r.x+r.w-1)/TILE), y1=Math.floor((r.y+r.h-1)/TILE);
  for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++){ if(tx<0||ty<0||tx>=tw||ty>=th) continue; solids[ty*tw+tx]=solid?1:0; }
}
function pointInRect(px,py,r){ return px>=r.x && px<r.x+r.w && py>=r.y && py<r.y+r.h; }
function isSolid(tx,ty){ if(tx<0||ty<0||tx>=world.tw||ty>=world.th) return true; return world.solids[ty*world.tw+tx]===1; }
function isWall(tx,ty){ if(tx<0||ty<0||tx>=world.tw||ty>=world.th) return true; return world.walls[ty*world.tw+tx]===1; }

function tryMove(x0,y0,dx,dy){
  const hw=PLAYER_W*0.5, hh=PLAYER_H*0.5;
  if(dx!==0){ const nx=x0+dx; if(!rectHitsSolids(nx-hw,y0-hh,PLAYER_W,PLAYER_H)) player.x=nx; }
  if(dy!==0){ const ny=y0+dy; if(!rectHitsSolids(player.x-hw,ny-hh,PLAYER_W,PLAYER_H)) player.y=ny; }
}
function rectHitsSolids(x,y,w,h){
  const x0=Math.floor(x/TILE), y0=Math.floor(y/TILE);
  const x1=Math.floor((x+w-1)/TILE), y1=Math.floor((y+h-1)/TILE);
  for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++){ if(isSolid(tx,ty)) return true; }
  return false;
}

/* ---------- RENDER HELPERS ---------- */
let rA,gA,bA,rO,gO,bO,oMask;
function allocBuffers(w,h){ const n=w*h; rA=new Float32Array(n); gA=new Float32Array(n); bA=new Float32Array(n); rO=new Float32Array(n); gO=new Float32Array(n); bO=new Float32Array(n); oMask=new Uint8Array(n); }
function ensureBuffers(){ if(!rA || rA.length!==sceneW*sceneH) allocBuffers(sceneW,sceneH); }
function redwoodFloor(wx,wy){ const plankW=48; const u=(wx%plankW+plankW)%plankW; const seam=smoothstep(0,2,Math.min(u,plankW-u)); const grain=fbm(wx*0.02, wy*0.07); const tone=mix(0.34,0.52,grain)*mix(0.9,1.0,seam); const [r,g,b]=hsv(14+grain*6,0.65,tone); const knot=noise2(wx*0.12, wy*0.12); const kf=knot>0.94?0.7:1.0; return [r*kf,g*kf*0.98,b*kf*0.95]; }
function redwoodWall(wx,wy){ const board=22; const v=(wx%board+board)%board; const edge=smoothstep(0,2,Math.min(v,board-v)); const grain=fbm(wx*0.03, wy*0.09); const tone=mix(0.24,0.38,grain)*mix(0.88,1.0,edge); const [r,g,b]=hsv(12+grain*8,0.7,tone); return [r,g*0.96,b*0.92]; }
function shadeObject(o,wx,wy,t){
  if(o.type==="bar"){ const edge=smoothstep(0,3,wy-o.y)*smoothstep(0,3,(o.y+o.h)-wy); const gr=fbm(wx*0.02,wy*0.07); const [r,g,b]=hsv(10+gr*6,0.7,mix(0.32,0.46,edge)); const lipH=6; const inLip=wy>o.y+o.h-lipH && wy<=o.y+o.h; const fg=inLip?[r*0.7,g*0.65,b*0.6]:null; return { bg:[r,g*0.98,b*0.95], fg }; }
  if(o.type==="pool"){ const rail=6; const insideX=wx>o.x+rail && wx<o.x+o.w-rail, insideY=wy>o.y+rail && wy<o.y+o.h-rail; if(insideX&&insideY){ const r=fbm(wx*0.03,wy*0.03); const [rr,rg,rb]=hsv(135,0.6,mix(0.30,0.42,r)); return { bg:[rr,rg,rb] }; } const [wr,wg,wb]=hsv(8,0.7,0.38); return { bg:[wr*0.9,wg*0.9,wb*0.9], fg:[wr,wg,wb] }; }
  if(o.type==="stool"){ const dx=wx-(o.x+o.w*0.5), dy=wy-(o.y+o.h*0.5); const rr=o.w*0.5; const d=Math.hypot(dx,dy); if(d<rr){ const [r,g,b]=hsv(0,0.72,0.42); return { fg:[r,g,b], bg:[r*0.6,g*0.58,b*0.56] }; } return { bg:redwoodFloor(wx,wy) }; }
  if(o.type==="booth"){ const pad=4; const back=wy<o.y+pad; const [wr,wg,wb]=hsv(8,0.72, back?0.30:0.36); const fg=back?[wr*0.75,wg*0.72,wb*0.7]:null; return { bg:[wr,wg,wb], fg }; }
  if(o.type==="jukebox"){ const u=(wx-o.x)/o.w; const stripe=Math.floor(u*6)%2; const hue=world.jukeOn? mix(190,330,Math.abs(Math.sin(t*0.4))) : 30; const [r,g,b]=hsv(hue, world.jukeOn?0.9:0.4, world.jukeOn?0.85:0.35); const body=stripe?[r,g,b]:[r*0.5,g*0.5,b*0.5]; return { bg:body, fg: world.jukeOn ? [r,g,b] : null }; }
  if(o.type==="neon"){ const v=(wy-o.y)/o.h; const hue=world.jukeOn?200:315; const [r,g,b]=hsv(hue,0.65,mix(0.25,0.6,smoothstep(0.2,0.8,v))); return { bg:[r,g,b], fg:[r,g,b] }; }
  if(o.type==="door"){ if(o.open) return null; const frame=4; const inPanel=wx>o.x+frame && wx<o.x+o.w-frame && wy>o.y+frame && wy<o.y+o.h-frame; if(inPanel){ const [r,g,b]=hsv(20,0.35,0.38); return { bg:[r,g,b] }; } const [r,g,b]=hsv(10,0.75,0.30); return { bg:[r,g,b], fg:[r*0.9,g*0.88,b*0.86] }; }
  if(o.type==="switch"){ const [r,g,b]=hsv(45,0.2,0.55); return { bg:[r,g,b], fg:[r*0.9,g*0.9,b*0.9] }; }
  return null;
}
function drawPlayerToBuffers(t){
  const hw=PLAYER_W*0.5, hh=PLAYER_H*0.5;
  const sx0=Math.max(0, Math.floor(player.x-hw-cam.x));
  const sy0=Math.max(0, Math.floor(player.y-hh-cam.y));
  const sx1=Math.min(sceneW-1, Math.floor(player.x+hw-cam.x));
  const sy1=Math.min(sceneH-1, Math.floor(player.y+hh-cam.y));
  const shirtHue=world.jukeOn?195:205;
  for(let sy=sy0; sy<=sy1; sy++){ const wy=sy+cam.y;
    for(let sx=sx0; sx<=sx1; sx++){ const wx=sx+cam.x; const dx=wx-player.x, dy=wy-player.y;
      if(Math.abs(dx)>=hw || Math.abs(dy)>=hh) continue;
      let r=0,g=0,b=0;
      if(dy<-hh*0.2){ const [hr,hg,hb]=hsv(30,0.35,0.77); r=hr; g=hg; b=hb; }
      else { const s=fbm(wx*0.05,wy*0.05)*0.1; const [sr,sg,sb]=hsv(shirtHue,0.25,0.62+s); r=sr; g=sg; b=sb*0.98; }
      const shade=mix(0.94,0.75,(dy+hh)/PLAYER_H); r*=shade; g*=shade; b*=shade;
      const i=sy*sceneW+sx; rA[i]=r; gA[i]=g; bA[i]=b;
    }
  }
}

/* ---------- INPUT ---------- */
const keys = Object.create(null);
window.addEventListener("keydown",(e)=>{ keys[e.key.toLowerCase()]=true; if(e.key==="f")toggleFullscreen(); if(e.key==="p")paused=!paused; if(e.key==="s")saveFrame(); if(e.key==="e"||e.key===" ") tryInteract(); });
window.addEventListener("keyup",(e)=>{ keys[e.key.toLowerCase()]=false; });
let joyActive=false, joyDx=0, joyDy=0;
padL.addEventListener("pointerdown",(e)=>{ joyActive=true; padL.setPointerCapture(e.pointerId); moveStick(e); });
padL.addEventListener("pointermove",(e)=>{ if(joyActive) moveStick(e); });
padL.addEventListener("pointerup", endStick);
padL.addEventListener("pointercancel", endStick);
btnA.addEventListener("click", tryInteract);
function moveStick(e){ const r=padL.getBoundingClientRect(); const dx=e.clientX-(r.left+r.width*0.5), dy=e.clientY-(r.top+r.height*0.5); const len=Math.hypot(dx,dy); const max=r.width*0.42; const nx=len?dx/len:0, ny=len?dy/len:0; const m=Math.min(len,max); stick.style.left=`${50+(nx*m/r.width)*100}%`; stick.style.top=`${50+(ny*m/r.height)*100}%`; const dead=0.12; joyDx=Math.abs(nx)<dead?0:nx; joyDy=Math.abs(ny)<dead?0:ny; }
function endStick(){ joyActive=false; joyDx=0; joyDy=0; stick.style.left="50%"; stick.style.top="50%"; }

/* ---------- INTERACT ---------- */
function tryInteract(){
  const fx = player.x + Math.sign(player.facingX||0)*TILE + player.facingX*6;
  const fy = player.y + Math.sign(player.facingY||0)*TILE + player.facingY*6;
  const near = world.objects.find(o => o.interactive && pointInRect(fx,fy,o));
  if(!near){ toast("Nothing to interact"); return; }
  if(near.type==="door"){
    near.open=!near.open;
    const t0x=Math.floor(near.x/TILE), t0y=Math.floor(near.y/TILE);
    const t1x=Math.floor((near.x+near.w-1)/TILE), t1y=Math.floor((near.y+near.h-1)/TILE);
    for(let ty=t0y; ty<=t1y; ty++) for(let tx=t0x; tx<=t1x; tx++){ world.solids[ty*world.tw+tx]=near.open?0:1; world.walls[ty*world.tw+tx]=0; }
    toast(near.open?"Door opened":"Door closed");
  } else if(near.type==="jukebox"){ world.jukeOn=!world.jukeOn; toast(world.jukeOn?"Jukebox on":"Jukebox off"); }
  else if(near.type==="switch"){ world.ambient = world.ambient > 0.18 ? 0.14 : 0.32; toast("Lights toggled"); }
  else toast("OK");
}

/* ---------- QUEUE NODES FOR BT ---------- */
const directives = [];
function enqueue(d){ directives.push(d); }
function flushDirectives(){ while(directives.length){ const d=directives.shift(); if(d.type==="say") say(d.speaker||"NPC", d.text||""); if(d.type==="divert") story.ChoosePathString?.(d.path); } }
class QueueSay extends b3.Action {
  tick(){ enqueue({ type:"say", speaker:this.properties?.speaker||"NPC", text:this.properties?.text||"" }); return b3.SUCCESS; }
}
class QueueDivert extends b3.Action {
  tick(){ enqueue({ type:"divert", path:this.properties?.path }); return b3.SUCCESS; }
}

/* ---------- MOCK INK STORY (swappable with real inkjs) ---------- */
function createMockStory(){
  const ext = {};
  const vars = { goal:"chaos", last_outcome_ok:0, mood:0, heat:0, threat:0, trust:0, crowd:2, guard_near:0, drunk:1 };
  const rand = (a,b)=> Math.floor(Math.random()*(b-a+1))+a;

  const emit = (evt) => {
    if(evt==="alarm"){ vars.guard_near = 1; guardNearUntil = performance.now() + 12000; sys("! Alarm rings. Guard alerted."); }
    if(evt==="guard_warning"){ sys("Guard watches closely."); }
    if(evt==="npc_fled"){ sys("The troublemaker slipped out."); chaosActive=false; }
  };

  const knots = {
    "npc.chaos.insult": ()=>{
      say("ChaosNPC", "He sneers at a patron.");
      if(vars.guard_near>0) { say("Guard", "Eyes on me."); emit("guard_warning"); }
      vars.last_outcome_ok = 1; ext.report_outcome?.("insult", true);
    },
    "npc.chaos.spill": ()=>{
      say("ChaosNPC", "He shoulder-checks a tray. Drinks rain across the floor.");
      const ok = rand(0,100) > 35;
      vars.last_outcome_ok = ok?1:0;
      if(ok){ say("Crowd", "Easy! Watch it."); vars.heat += 1; }
      else { say("Staff", "We got it."); }
      ext.report_outcome?.("spill", !!ok);
    },
    "npc.chaos.pickpocket": ()=>{
      const ok = (vars.guard_near===0) && (rand(0,100)>50);
      if(ok){ say("Narrator","A wallet vanishes."); vars.heat += 1; }
      else { say("Victim","Hey! Thief!"); emit("alarm"); vars.heat += 2; }
      vars.last_outcome_ok = ok?1:0;
      ext.report_outcome?.("pickpocket", !!ok);
    },
    "npc.chaos.break_glass": ()=>{
      say("SFX","A bottle explodes against the wall.");
      emit("alarm"); vars.last_outcome_ok=1; vars.heat += 2; ext.report_outcome?.("break_glass", true);
    },
    "npc.chaos.fight": ()=>{
      say("ChaosNPC","He throws a punch.");
      const ok = rand(0,100) > (60 - vars.drunk*5);
      if(ok){ say("Crowd","Chaos erupts!"); vars.heat += 3; }
      else { say("Narrator","He whiffs and stumbles."); }
      vars.last_outcome_ok=ok?1:0; ext.report_outcome?.("start_fight", !!ok);
    },
    "npc.chaos.hide": ()=>{
      say("Narrator","He slips into shadow near the stair."); vars.last_outcome_ok=1; ext.report_outcome?.("hide", true);
    },
    "npc.chaos.flee": ()=>{
      say("Narrator","He ducks out the back door into the alley."); vars.last_outcome_ok=1; emit("npc_fled"); ext.report_outcome?.("flee", true);
    }
  };

  return {
    variablesState: vars,
    BindExternalFunction: (name, fn)=>{ ext[name]=fn; },
    ChoosePathString: (path)=> { if(knots[path]) knots[path](); },
    _ext: ext
  };
}

// If you add inkjs + compiled story.json, replace createMockStory() with a loader.
const story = createMockStory();

// Outcome reporting -> update blackboard stamps only (RecordOutcome updates s/f to avoid double count)
const bb = new b3.Blackboard();
story.BindExternalFunction("report_outcome", (tactic, ok)=>{
  const stats = bb.get("chaos_stats", SCOPE) || {};
  const key = String(tactic);
  stats[key] = stats[key] || { s:0, f:0, lastMs: Date.now() };
  stats[key].lastMs = Date.now();
  bb.set("chaos_stats", stats, SCOPE);
  bb.set("last_tactic", key, SCOPE);
  story.variablesState["last_outcome_ok"] = ok ? 1 : 0;
  return 0;
});

/* ---------- BUILD CHAOS TREE ---------- */
// Override loadJSON to disable caching and throw detailed errors.
async function loadJSON(p){
  const r = await fetch(p, { cache: "no-store" });
  if (!r.ok) {
    // Provide more context on failure so it's easier to diagnose.
    throw new Error(`fetch ${p} ${r.status} ${r.statusText}`);
  }
  return r.json();
}

// Initialize the chaos NPC behavior tree. If the JSON fails to load,
// catch the error and skip AI initialization without blocking rendering.
let chaosTree;
try {
  const chaosDef = await loadJSON("./trees/chaos_npc.json");
  chaosTree = new b3.BehaviorTree();
  chaosTree.load(chaosDef, { UtilitySelector, Tactic, RecordOutcome, QueueSay, QueueDivert });
} catch (e) {
  // If the tree fails to load, notify via sys() and allow the game to run
  // without the chaos NPC. The AI tick will guard on chaosTree below.
  sys('AI init skipped: ' + e.message);
}

/* ---------- AI LOOP ---------- */
let chaosActive = true;
let guardNearUntil = 0;
function tickAI(dt, nowMs){
  const v = story.variablesState;
  if(nowMs > guardNearUntil) v.guard_near = 0;
  // small drift in world variables for variety
  if(Math.random()<0.01) v.crowd = clamp((v.crowd||2) + (Math.random()<0.5?-1:1), 0, 6);
  if(Math.random()<0.02) v.drunk = clamp((v.drunk||1) + (Math.random()<0.5?-1:1), 0, 6);
  v.heat = clamp(v.heat||0, 0, 99);
  v.trust = clamp(v.trust||0, 0, 99);
  v.mood  = clamp(v.mood||0, 0, 99);
  if (chaosActive && chaosTree) {
    chaosTree.tick({ story }, bb);
    flushDirectives();
  }
}

/* ---------- MAIN LOOP ---------- */
let paused=false, last=performance.now(), aiAcc=0;
function frame(now){
  const dt = Math.min((now-last)/1000, 0.05); last=now;
  if(!paused){
    // INPUT
    let mx=0,my=0;
    if(keys.w||keys.arrowup) my-=1; if(keys.s||keys.arrowdown) my+=1; if(keys.a||keys.arrowleft) mx-=1; if(keys.d||keys.arrowright) mx+=1;
    mx += joyDx; my += joyDy; const ml=Math.hypot(mx,my); if(ml>0){ mx/=ml; my/=ml; }
    const vx=mx*WALK_SPEED*dt, vy=my*WALK_SPEED*dt;
    tryMove(player.x, player.y, vx, 0);
    tryMove(player.x, player.y, 0, vy);
    if(ml>0.01){ player.facingX=mx; player.facingY=my; }

    cam.x = clamp(player.x - sceneW*0.5, 0, world.pixelW - sceneW);
    cam.y = clamp(player.y - sceneH*0.5, 0, world.pixelH - sceneH);

    // LIGHTS
    for(const L of world.lights){ const base=L.base||1; const flick=L.flicker ? mix(0.92,1.08, noise2((now/1000)*3.1+L.fx, L.fy)) : 1; L._amp=base*flick; }

    // RENDER
    ensureBuffers();
    const img = sctx.createImageData(sceneW, sceneH); const px = img.data;
    oMask.fill(0);
    let p=0;
    for(let y=0;y<sceneH;y++){
      const wy=Math.floor(cam.y+y), ty=Math.floor(wy/TILE);
      for(let x=0;x<sceneW;x++,p++){
        const wx=Math.floor(cam.x+x), tx=Math.floor(wx/TILE);
        let r,g,b; if(isWall(tx,ty)) [r,g,b]=redwoodWall(wx,wy); else [r,g,b]=redwoodFloor(wx,wy);
        for(const o of world.objects){ if(wx<o.x||wx>=o.x+o.w||wy<o.y||wy>=o.y+o.h) continue; const col=shadeObject(o,wx,wy, now/1000); if(col){ if(col.bg){ [r,g,b]=col.bg; } if(col.fg){ rO[p]=col.fg[0]; gO[p]=col.fg[1]; bO[p]=col.fg[2]; oMask[p]=1; } } }
        let lr=0,lg=0,lb=0;
        for(const L of world.lights){ const dx=wx-L.x, dy=wy-L.y; const d2=dx*dx+dy*dy, r2=L.radius*L.radius; if(d2<r2){ const t=1-d2/r2; const k=L._amp*t*t; lr+=L.color[0]*k; lg+=L.color[1]*k; lb+=L.color[2]*k; } }
        r=clamp(r*world.ambient+lr,0,1); g=clamp(g*world.ambient+lg,0,1); b=clamp(b*world.ambient+lb,0,1);
        const nx=x/sceneW, ny=y/sceneH; const vign=smoothstep(0.96,0.5, Math.hypot(nx-0.5, ny-0.5)); r*=vign; g*=vign; b*=vign;
        rA[p]=r; gA[p]=g; bA[p]=b;
      }
    }
    drawPlayerToBuffers(now/1000);
    const n=sceneW*sceneH; for(let i=0;i<n;i++) if(oMask[i]){ rA[i]=rO[i]; gA[i]=gO[i]; bA[i]=bO[i]; }
    let q=0; for(let y=0;y<sceneH;y++){ for(let x=0;x<sceneW;x++,q++){ const rq=quantChannel(rA[q],LEVELS_R,x,y); const gq=quantChannel(gA[q],LEVELS_G,x,y); const bq=quantChannel(bA[q],LEVELS_B,x,y); const i=q*4; px[i]=Math.round(rq*255); px[i+1]=Math.round(gq*255); px[i+2]=Math.round(bq*255); px[i+3]=255; } }
    sctx.putImageData(img,0,0);
    ctx.fillStyle="#000"; ctx.fillRect(0,0,viewW,viewH); ctx.drawImage(scene,0,0,sceneW,sceneH, offsetX,offsetY, sceneW*scale, sceneH*scale);

    if(msgT>0){ msgT-=dt; if(msgT<=0) msgEl.textContent=""; }

    aiAcc += dt; if(aiAcc>1.5){ tickAI(aiAcc, now); aiAcc=0; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- BROWSER HELPERS ---------- */
function toggleFullscreen(){ const el=document.documentElement; if(!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.(); }
function saveFrame(){ const a=document.createElement("a"); a.download="bartender-chaos.png"; a.href=canvas.toDataURL("image/png"); a.click(); }