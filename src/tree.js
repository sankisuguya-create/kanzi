// 本人の学習履歴から育つ森。通信・乱数・時刻に依存せず同じ記録は同じ形と色になる。
// 36回で1本、36本で1エリア。過去のエリアは残し、表示する木だけ描画する。
// 完成木の画像は画面をまたいで再利用（LRU、RGBA換算12MiBまで）。静止時のRAFは0。
(function (root) {
'use strict';
const STEP=36, AREA=36, MAX_PIXELS=3*1024*1024;
const NAMES=['ケヤキ','サクラ','カエデ','シラカバ','スギ'];
const MODE_COLORS=[{h:139,s:31,l:53},{h:199,s:37,l:61},{h:27,s:56,l:65},{h:274,s:32,l:65},{h:49,s:52,l:60}];
const cache=new Map();let cachePixels=0;
const seed=x=>{const y=Math.sin(x*127.1+311.7)*43758.5453;return y-Math.floor(y);};
const lots=[[0,0]],dirs=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
for(let ring=1;lots.length<AREA;ring++){
  let q=0,r=-ring;
  for(const [dq,dr] of dirs)for(let step=0;step<ring&&lots.length<AREA;step++){
    lots.push([(q+r*.5)*146+seed(lots.length)*12-6,r*83+seed(lots.length+41)*10-5]);q+=dq;r+=dr;
  }
}
function mount(host, options) {
  const log=root.Sched.forestLog(options.progress), n=log.length;
  const active=Math.max(0,Math.floor((n-1)/STEP)), local=n===0?0:(n-1)%STEP+1;
  const currentRegion=Math.floor(active/AREA), dark=false;
  const state={focus:false,region:currentRegion};
  const records=new Map();
  function record(id){
    if(!records.has(id))records.set(id,{type:id%5,modes:log.slice(id*STEP,(id+1)*STEP).replace(/[prwky]/g,c=>({p:'0',r:'1',w:'2',k:'3',y:'4'}[c]))});
    return records.get(id);
  }
  function modeAt(id,i){return Number(record(id).modes[i]||0);}
  host.innerHTML='<canvas class="tree" role="img"></canvas>'+
    '<div class="forest-tools"><p class="forest-status" aria-live="polite"></p>'+
    '<button type="button" class="forest-focus" aria-pressed="false">育てている場所へ</button></div>'+
    '<div class="forest-regions" hidden><button type="button" class="forest-prev">前の森</button>'+
    '<span class="forest-region-name"></span><button type="button" class="forest-next">次の森</button></div>'+
    '<details class="forest-colors"><summary>葉の色</summary><div class="forest-legend" aria-label="学習モードと葉の色"><span><i class="forest-p" aria-hidden="true"></i>これまで</span>'+
    '<span><i class="forest-r" aria-hidden="true"></i>よむ</span><span><i class="forest-w" aria-hidden="true"></i>かく</span>'+
    '<span><i class="forest-k" aria-hidden="true"></i>カード：かんじ→よみ</span><span><i class="forest-y" aria-hidden="true"></i>カード：よみ→かんじ</span></div></details>';
  const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  const status=host.querySelector('.forest-status'),focus=host.querySelector('.forest-focus');
  const regions=host.querySelector('.forest-regions'),previous=host.querySelector('.forest-prev'),next=host.querySelector('.forest-next');
  const abort=new AbortController(),listen=(el,event,fn)=>el.addEventListener(event,fn,{signal:abort.signal});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=true,disposed=false,raf=0,transition=null,currentCamera=null,background=null,bgKey='',lastFrame=-Infinity,frames=0;
function ellipse(g,x,y,rx,ry,fill){g.fillStyle=fill;g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fill();}
function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function colors(type){const h=143;return {h,s:[29,37,57,32,27][type],l:[49,77,61,57,37][type]+(dark?5:0),stem:type===3?(dark?'#d7dfcd':'#e4e4ce'):(dark?'#a3a18a':'#8e8870')};}
function leaf(g,x,y,a,r,type,fill){g.save();g.translate(x,y);g.rotate(a);g.fillStyle=fill;g.beginPath();if(type===2){for(let j=0;j<10;j++){const t=-Math.PI/2+j*Math.PI/5,rr=j%2?r*.43:r;const xx=Math.cos(t)*rr,yy=Math.sin(t)*rr;j?g.lineTo(xx,yy):g.moveTo(xx,yy);}g.closePath();}else if(type===4){g.moveTo(0,-r);g.quadraticCurveTo(r*.7,0,0,r*.6);g.quadraticCurveTo(-r*.7,0,0,-r);}else{g.ellipse(0,0,r*.53,r,a*.13,0,Math.PI*2);}g.fill();g.restore();}
function points(id,type){return Array.from({length:36},(_,i)=>{const a=i*2.399963+seed(id+4)*.4,r=Math.sqrt((i+.5)/36);let x,y;
 if(type===4){const row=Math.floor(i/3),t=(row+1)/12;x=(i%3-1)*t*58+(seed(i+id*40)-.5)*14*t;y=-252+t*192;}
 else{const rx=[101,108,114,64][type],ry=[67,68,54,92][type];x=Math.cos(a)*r*rx+(seed(i+id*43)-.5)*8;y=-[178,170,153,172][type]+Math.sin(a)*r*ry;if(type===2)y=Math.round(y/28)*28+(seed(i+17)-.5)*7;}
 return {x,y,i,r:16+seed(id*91+i*3)*9};});}
function cluster(g,pt,type,p,mode,detail,id){const hue=MODE_COLORS[mode].h,sat=MODE_COLORS[mode].s,light=MODE_COLORS[mode].l+(type===1?7:0)+(-pt.y-120)*.04;g.save();g.translate(pt.x,pt.y);
 const rw=type===4?pt.r*1.4:pt.r,rh=type===4?pt.r*.48:pt.r*.77;
 const gradient=g.createLinearGradient(-rw,-rh,rw,rh);gradient.addColorStop(0,`hsl(${hue} ${sat}% ${light+12}%)`);gradient.addColorStop(.6,`hsl(${hue} ${sat}% ${light}%)`);gradient.addColorStop(1,`hsl(${hue} ${sat}% ${light-10}%)`);
 g.fillStyle=gradient;g.beginPath();const lobes=14;for(let k=0;k<=lobes;k++){const a=k/lobes*Math.PI*2,rr=.9+.11*Math.sin(k*2.7+id+pt.i);const x=Math.cos(a)*rw*rr,y=Math.sin(a)*rh*rr;k?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.fill();
 if(detail){for(let k=0;k<9;k++){const a=k*2.399+pt.i*.23,rr=Math.sqrt((k+.5)/9),xx=Math.cos(a)*rw*rr,yy=Math.sin(a)*rh*rr;leaf(g,xx,yy,a,3.3+seed(k+pt.i*11)*2.5,type,`hsl(${hue+seed(k)*8} ${sat+3}% ${light+5+seed(k+pt.i)*15}%)`);}if(mode===1&&pt.i%4===0){ellipse(g,-rw*.25,-rh*.1,1.5,2,'rgba(244,255,240,.7)');}else if(mode===2&&pt.i%4===0){g.strokeStyle='rgba(255,246,203,.65)';g.lineWidth=.8;g.beginPath();g.moveTo(0,-4);g.lineTo(4,0);g.lineTo(0,4);g.lineTo(-4,0);g.closePath();g.stroke();}}
 g.restore();}
function paintTree(g,id,n,res,layer){const type=record(id).type,p=colors(type),pts=points(id,type),growth=.26+.74*Math.pow(n/36,.46),detail=res>=320;
 if(n<=3){g.save();g.scale(res/320,res/320);g.translate(160,292);const h=27+n*11;if(layer!=='last'){ellipse(g,0,2,28+n*5,7,dark?'#4a5c42':'#d0d9b3');ellipse(g,0,-1,8,5,dark?'#bdac79':'#ab9567');if(n>0){g.strokeStyle=dark?'#b0c891':'#809c5e';g.lineWidth=2.5;g.lineCap='round';g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(-4,-h*.6,1,-h);g.stroke();}}
 if(n>0){const pairs=n;for(let j=0;j<pairs;j++){if(layer==='last'&&j!==pairs-1||layer==='base'&&j===pairs-1)continue;const y=-h+j*13,color=MODE_COLORS[modeAt(id,j)];for(const side of [-1,1])leaf(g,side*9,y-3,side*.9,11-j*.7,0,`hsl(${color.h} ${color.s}% ${color.l}%)`);}}g.restore();return {x:160,y:292-h+(n-1)*13};}
 g.save();g.scale(res/320,res/320);g.translate(160,292);g.scale(growth,growth);
 if(layer!=='last'){
 ellipse(g,0,1,type===4?65:96,13,dark?'rgba(2,24,14,.23)':'rgba(68,100,48,.12)');
 g.strokeStyle=p.stem;g.lineCap='round';g.lineJoin='round';
 const trunkTop=type===4?-253:type===3?-235:-153;
 g.lineWidth=type===3?7:12;g.beginPath();g.moveTo(-3,0);g.bezierCurveTo(-1,-40,5,-90,-2,trunkTop);g.stroke();
 g.strokeStyle=type===3?(dark?'#6d8270':'#9d9e83'):(dark?'#d0c8a4':'#b6ab84');g.lineWidth=type===3?1:2.3;g.beginPath();g.moveTo(-5,-3);g.bezierCurveTo(-2,-35,1,-80,-4,trunkTop*.92);g.stroke();
 if(type===3){g.strokeStyle=dark?'#768574':'#8e9580';g.lineWidth=1.5;for(let k=0;k<8;k++){g.beginPath();g.moveTo(-3,-15-k*24);g.lineTo(k%2?2:0,-16-k*24);g.stroke();}}
 const hubs=type===4?[{x:0,y:-165}]:type===3?[{x:-22,y:-158},{x:19,y:-189},{x:0,y:-224}]:[{x:-42,y:-145},{x:3,y:-180},{x:46,y:-147}];
 if(type!==4){for(const hub of hubs){g.strokeStyle=p.stem;g.lineWidth=type===3?3.5:5;g.beginPath();g.moveTo(0,-64);g.bezierCurveTo(hub.x*.25,-108,hub.x*.78,hub.y+25,hub.x,hub.y);g.stroke();}}
 for(let i=0;i<n;i++){const pt=pts[i],hub=hubs[type===4?0:pt.x<-20?0:pt.x>20?2:1];g.strokeStyle=p.stem;g.lineWidth=1.2+(1-i/36)*1.1;g.beginPath();if(type===4){g.moveTo(0,pt.y+12);g.quadraticCurveTo(pt.x*.6,pt.y+12,pt.x,pt.y);}else{g.moveTo(hub.x,hub.y);g.bezierCurveTo(hub.x*.7+pt.x*.3,hub.y-15,pt.x,pt.y+12,pt.x,pt.y);}g.stroke();}
 }
 if(type===4&&layer!=='last'){g.fillStyle=`hsl(${p.h} ${p.s}% ${p.l+7}%)`;g.beginPath();g.moveTo(0,-259);g.quadraticCurveTo(-3,-246,-13,-231);g.quadraticCurveTo(0,-235,13,-231);g.quadraticCurveTo(3,-246,0,-259);g.fill();}
 // 杉の各段を重ねた連続面でつなぐ。葉の隙間から背景が横縞に抜けない。
 if(type===4&&layer!=='last'){
   for(let row=0;row<Math.ceil(n/3);row++){
     const y=-263+row*16,top=row*6.5,bottom=(row+1.7)*6.5;
     const color=MODE_COLORS[modeAt(id,Math.min(n-1,row*3))];
     const fill=g.createLinearGradient(-bottom,y,bottom,y+32);
     fill.addColorStop(0,`hsl(${color.h} ${color.s}% ${color.l+3}%)`);
     fill.addColorStop(1,`hsl(${color.h} ${color.s}% ${color.l-10}%)`);
     g.fillStyle=fill;g.beginPath();g.moveTo(-top,y);g.lineTo(top,y);
     g.quadraticCurveTo(top+3,y+13,bottom,y+31);
     g.lineTo(bottom*.7,y+28);g.lineTo(bottom*.48,y+32);
     g.quadraticCurveTo(0,y+36,-bottom*.5,y+31);g.lineTo(-bottom,y+32);
     g.quadraticCurveTo(-top-2,y+13,-top,y);g.closePath();g.fill();
   }
 }
 const indexes=Array.from({length:n},(_,i)=>i).filter(i=>layer==='last'?i===n-1:layer==='base'?i!==n-1:true).sort((a,b)=>pts[a].y-pts[b].y);
 for(const i of indexes)cluster(g,pts[i],type,p,modeAt(id,i),detail,id);
 g.restore();
 return {x:160+pts[n-1].x*growth,y:292+pts[n-1].y*growth};}
function sprite(id,n,res,layer='full'){const r=record(id),key=[id,n,res,layer,r.type,r.modes.slice(0,n),dark].join(':');if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}const image=makeCanvas(res,res);const anchor=paintTree(image.getContext('2d'),id,n,res,layer);const result={image,anchor};cache.set(key,result);cachePixels+=res*res;while(cachePixels>MAX_PIXELS&&cache.size>1){const oldest=cache.keys().next().value;const entry=cache.get(oldest);cachePixels-=entry.image.width*entry.image.height;cache.delete(oldest);}return result;}

  function data(){const region=state.focus?currentRegion:state.region;return {region,start:region*AREA,count:Math.max(1,Math.min(AREA,active-region*AREA+1))};}
  function camera(w,h,count,region){
    const pts=lots.slice(0,count);
    if(state.focus){const p=lots[active%AREA];return {x:p[0],y:p[1]-139,s:Math.min((w-24)/292,(h-20)/292,1.18)};}
    const minX=Math.min(...pts.map(p=>p[0]))-141,maxX=Math.max(...pts.map(p=>p[0]))+141;
    const minY=Math.min(...pts.map(p=>p[1]))-282,maxY=Math.max(...pts.map(p=>p[1]))+15;
    return {x:(minX+maxX)/2,y:(minY+maxY)/2,s:Math.min((w-24)/(maxX-minX),(h-20)/(maxY-minY),1.18)};
  }
  function paintBackground(w,h,dpr){
    const key=[w,h,dpr].join(':');if(bgKey===key)return;
    background=makeCanvas(Math.round(w*dpr),Math.round(h*dpr));const g=background.getContext('2d');g.scale(dpr,dpr);
    const fill=g.createRadialGradient(w*.42,h*.26,0,w*.5,h*.4,Math.max(w,h)*.7);
    fill.addColorStop(0,'#f2f2d6');fill.addColorStop(1,'#e7efdf');g.fillStyle=fill;g.fillRect(0,0,w,h);bgKey=key;
  }
  function draw(now){
    if(disposed||!visible||document.hidden)return;
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,1.5),pw=Math.round(w*dpr),ph=Math.round(h*dpr);
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;bgKey='';}
    paintBackground(w,h,dpr);ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(background,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
    const d=data(),target=camera(w,h,d.count,d.region);let t=1,cam=target;
    // 初回のResizeObserver通知後、実際に見える最初の描画で成長を始める。
    if(frames===0&&Number.isFinite(options.prevActivity)&&options.prevActivity<n&&!reduced.matches){
      const oldId=Math.max(0,Math.floor((options.prevActivity-1)/STEP));
      const count=Math.floor(oldId/AREA)===currentRegion?Math.min(d.count,oldId%AREA+1):d.count;
      transition={start:now,from:camera(w,h,count,currentRegion),grow:true};
    }
    if(transition){t=Math.min(1,Math.max(0,(now-transition.start)/850));const e=1-Math.pow(1-t,3);cam={};for(const k of ['x','y','s'])cam[k]=transition.from[k]+(target[k]-transition.from[k])*e;}
    currentCamera=cam;ctx.save();ctx.translate(w/2,h/2);ctx.scale(cam.s,cam.s);ctx.translate(-cam.x,-cam.y);
    const ordered=state.focus?[active%AREA]:Array.from({length:d.count},(_,i)=>i).sort((a,b)=>lots[a][1]-lots[b][1]);
    for(const i of ordered){
      const id=d.start+i,pos=lots[i],isActive=id===active,size=isActive?local:STEP;
      const sx=(pos[0]-cam.x)*cam.s+w/2,sy=(pos[1]-cam.y)*cam.s+h/2;
      if(sx+160*cam.s<0||sx-160*cam.s>w||sy+28*cam.s<0||sy-292*cam.s>h)continue;
      const res=state.focus?480:cam.s>.7?320:160;
      ctx.save();ctx.translate(pos[0]-160,pos[1]-292);
      if(isActive&&transition?.grow&&t<1){
        const base=sprite(id,size,res,'base'),last=sprite(id,size,res,'last'),scale=.2+.8*(1-Math.pow(1-t,3));
        ctx.drawImage(base.image,0,0,320,320);ctx.save();ctx.translate(last.anchor.x,last.anchor.y);ctx.scale(scale,scale);ctx.translate(-last.anchor.x,-last.anchor.y);ctx.drawImage(last.image,0,0,320,320);ctx.restore();
      }else ctx.drawImage(sprite(id,size,res).image,0,0,320,320);
      ctx.restore();
    }
    ctx.restore();frames++;if(transition&&t>=1)transition=null;
  }
  function tick(now){
    raf=0;if(disposed||!visible||document.hidden){transition=null;return;}
    if(!host.isConnected){destroy();return;}
    if(!transition||now-lastFrame>=32){draw(now);lastFrame=now;}
    if(transition)raf=requestAnimationFrame(tick);
  }
  function schedule(){if(!raf&&visible&&!document.hidden&&!disposed)raf=requestAnimationFrame(tick);}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;transition=null;}
  function render(animate){
    const from=currentCamera,d=data();stop();
    status.textContent=n===0?'小さな たねから はじまる':(active+1)+'本目の '+NAMES[active%5]+(local===36?'が 育ったよ':local===1?'の 新芽が 出たよ':'が 育っているよ');
    focus.textContent=state.focus?'森全体へ':'育てている場所へ';focus.setAttribute('aria-pressed',String(state.focus));
    regions.hidden=state.focus||currentRegion===0;previous.disabled=d.region===0;next.disabled=d.region>=currentRegion;
    host.querySelector('.forest-region-name').textContent=(d.region+1)+'番目の森';
    canvas.setAttribute('aria-label',n===0?'土からのぞく種':state.focus?NAMES[active%5]+'一本、学習 '+n+'回':(d.region+1)+'番目の森、'+d.count+'本、学習 '+n+'回');
    if(animate&&from&&!reduced.matches&&visible&&!document.hidden)transition={start:performance.now(),from,grow:false};
    schedule();
  }
  listen(focus,'click',()=>{state.focus=!state.focus;state.region=currentRegion;render(true);});
  listen(previous,'click',()=>{state.region=Math.max(0,state.region-1);render(false);});
  listen(next,'click',()=>{state.region=Math.min(currentRegion,state.region+1);render(false);});
  const resize=new ResizeObserver(()=>{
    const dpr=Math.min(devicePixelRatio||1,1.5);
    if(canvas.width!==Math.round(canvas.clientWidth*dpr)||canvas.height!==Math.round(canvas.clientHeight*dpr)){stop();schedule();}
  });resize.observe(canvas);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();else stop();});intersection.observe(host);
  listen(document,'visibilitychange',()=>{if(document.hidden)stop();else schedule();});
  listen(reduced,'change',()=>{stop();schedule();});
  listen(window,'pagehide',stop);listen(window,'pageshow',schedule);
  function destroy(){if(disposed)return;stop();disposed=true;resize.disconnect();intersection.disconnect();abort.abort();background=null;records.clear();}
  render(false);
  return {destroy,metrics:()=>({frames,cachePixels,cachedImages:cache.size,visibleTrees:state.focus?1:data().count,animating:!!transition,disposed})};
}
root.Tree={mount,STEP,AREA,NAMES};
})(typeof globalThis!=='undefined'?globalThis:this);
