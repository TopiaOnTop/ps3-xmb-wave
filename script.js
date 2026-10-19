/* =====================================================================
   WebGL PS3 Spline Wave Background — Script Autonome Corrigé
   ===================================================================== */
(function(){
'use strict';

// ── 1. Injection du CSS pour forcer le canvas à s'afficher derrière ──
const style = document.createElement('style');
style.innerHTML = `
  #ps3-wave-canvas {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 0 !important; /* Derrière le dashboard qui est à z-index: 10 */
    pointer-events: none !important;
    display: block !important;
  }
  .ps3-vignette {
    position: fixed !important;
    inset: 0 !important;
    z-index: 1 !important;
    pointer-events: none !important;
    background:
      radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, rgba(2,8,18,0.6) 100%),
      linear-gradient(to bottom, rgba(2,8,18,0.2) 0%, transparent 20%, transparent 80%, rgba(2,8,18,0.3) 100%);
  }
`;
document.head.appendChild(style);

// ── 2. Création et insertion du Canvas et de la Vignette dans le Body ──
const canvas = document.createElement('canvas');
canvas.id = 'ps3-wave-canvas';
canvas.setAttribute('aria-hidden', 'true');
document.body.appendChild(canvas);

const vignette = document.createElement('div');
vignette.className = 'ps3-vignette';
document.body.appendChild(vignette);

// ── 3. Cœur de l'algorithme Spline PS3 ──
const PS3 = {
  B380_SIZE_BYTES: 0x2200,
  TABLE_ENTRY_COUNT: 0x169,
  OUTPUT_STRIDE_BYTES: 0x400,
  LOOP_ITERS: 8,
  STORE_OFFSETS_BYTES: [0x000, 0x100, 0x200, 0x300, 0x010, 0x110, 0x210, 0x310],
  STRIDE_FLOATS: 0x400 >> 2,
};

const NORM_A = new Float32Array([0.39584, -0.0052389996, -0.58664495, 0.189007]);
const NORM_B = new Float32Array([-0.003751, -0.57536095, 0.161975, 0.417137]);
const R37_WORDS = [0x00, 0x11, 0x22, 0x33];

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function fract(v) { return v - Math.floor(v); }
function hash01(x) { return fract(Math.sin(x) * 43758.5453123); }

function bsplineBasis(t) {
  const t2 = t * t, t3 = t2 * t;
  return [(1 - 3*t + 3*t2 - t3)/6, (4 - 6*t2 + 3*t3)/6, (1 + 3*t + 3*t2 - 3*t3)/6, t3/6];
}

function evalSpline(cp, u) {
  const n = cp.length - 3;
  if (n < 1) return 0;
  const s = Math.max(0, Math.min(u * n, n - 1e-6));
  const seg = Math.floor(s), t = s - seg;
  const b = bsplineBasis(t);
  return b[0]*cp[seg] + b[1]*cp[seg+1] + b[2]*cp[seg+2] + b[3]*cp[seg+3];
}

function tableIndexFromWord(word) {
  return (19 * ((word >> 4) & 0xff) + (word & 0xf)) % PS3.TABLE_ENTRY_COUNT;
}

function wrapIndexFloat(v, len) {
  let o = v % len; return o < 0 ? o + len : o;
}

function sampleTableVec4(table, idxFloat, out) {
  const len = PS3.TABLE_ENTRY_COUNT;
  const i0 = Math.floor(idxFloat) % len, i1 = (i0 + 1) % len;
  const t = idxFloat - Math.floor(idxFloat);
  const b0 = i0 * 4, b1 = i1 * 4;
  out[0] = table[b0]*(1-t) + table[b1]*t;
  out[1] = table[b0+1]*(1-t) + table[b1+1]*t;
  out[2] = table[b0+2]*(1-t) + table[b1+2]*t;
  out[3] = table[b0+3]*(1-t) + table[b1+3]*t;
}

function vec4Set(out, base, x, y, z, w) { out[base]=x; out[base+1]=y; out[base+2]=z; out[base+3]=w; }
function vec4Mix(a, b, t, out) { const s=1-t; out[0]=a[0]*s+b[0]*t; out[1]=a[1]*s+b[1]*t; out[2]=a[2]*s+b[2]*t; out[3]=a[3]*s+b[3]*t; }

const S = {
  colorR: 37, colorG: 89, colorB: 179,
  gradientTopMul: 0.15, gradientBotMul: 0.75, // Éclairci légèrement pour bien voir le fond
  flowSpeed: 0.35, tension: 0.15, damping: 0.0001,
  length: 0.306001, spacing: 407.658, timeStep: 1.0,
  bandAmplitude: 0.280, bandSecondaryFreq: 7.0, bandSecondaryAmp: 0.035,
  travelSpeed1: 0.35, travelAmp1: 0.02,
  travelSpeed2: 0.25, travelAmp2: 0.012,
  perturbation: 0.12, perturbationScale: 0.09,
  waveCosAmp: 0.12, waveBias: -0.1, waveHeightScale: 0.6, waveSoftClip: 0.22,
  rePipelineBlend: 0.45, reDescriptorStrength: 0.7,
  reSyntheticDescriptorSeed: 1337, reSyntheticDescriptorMotion: 0.8,
  reKernelGain: 0.05, reNormalizeGain: 0.08, reKernelPhaseStep: 0.45,
  reIndexJitter: 0.008, reTemporalSmooth: 0.80,
  fresnelPower: 4.0, fresnelScale: 0.6, opacity: 0.95, brightness: 1.2,
  zDetailScale: 0.08,
  ffdScale1X: 5.67726, ffdScale1Y: 1.00077, ffdScale1Z: 1.0,
  ffdScale2X: 2.82755, ffdScale2Y: 1.27579, ffdScale2Z: 2.88782,
  ffdOffsetX: 0.0, ffdOffsetY: -0.469999, ffdOffsetZ: 0.0,
  ffdYAmp: 0.08, ffdZAmp: 0.08,
};

class Pipeline {
  constructor() {
    this.b300 = new Float32Array(16);
    this.coeffs = new Float32Array(PS3.TABLE_ENTRY_COUNT * 16);
    this.table = new Float32Array(PS3.TABLE_ENTRY_COUNT * 4);
    this.kernelPacked = new Float32Array(PS3.LOOP_ITERS * 8 * 4);
    this.kernelPackedPrev = new Float32Array(PS3.LOOP_ITERS * 8 * 4);
    this.controlPoints = new Float32Array(28);
    this.cachedB380 = null;
  }

  buildB380() {
    if (this.cachedB380) return this.cachedB380;
    const out = new Uint8Array(PS3.B380_SIZE_BYTES);
    const len = out.length, seed = S.reSyntheticDescriptorSeed;
    for (let i = 0; i < len; i++) {
      const f = i / len;
      const wave = Math.sin(f*97.0*(0.3+S.length))*0.5 + Math.sin(f*211.0*(0.15+S.tension*3.0))*0.3 + Math.sin(f*17.0*(0.2+S.perturbationScale*2.0))*0.2;
      const noise = hash01(i*13.37 + seed*0.01)*2.0 - 1.0;
      out[i] = (clamp01((wave*S.reDescriptorStrength + noise*0.35 + 1.0)*0.5)*255)|0;
    }
    this.cachedB380 = out;
    return out;
  }

  decodeCoefficients(b380, timeSec) {
    const len = b380.length, stride = 0x130;
    const phase = timeSec * S.flowSpeed * S.timeStep * S.reSyntheticDescriptorMotion;
    for (let entry = 0; entry < PS3.TABLE_ENTRY_COUNT; entry++) {
      const eb = entry * 16, db = (entry * stride) % len;
      for (let blk = 0; blk < 4; blk++)
        for (let lane = 0; lane < 4; lane++) {
          const b = b380[(db + blk*0x10 + lane*4 + (entry%7)) % len] / 255;
          const harmonic = Math.sin(entry*0.07 + blk*0.91 + lane*1.37 + phase*0.23);
          this.coeffs[eb + blk*4 + lane] = (b*2-1)*0.75 + harmonic*0.25;
        }
    }
  }

  buildTable(timeSec) {
    const b380 = this.buildB380();
    this.decodeCoefficients(b380, timeSec);
    this.b300[0]=S.damping; this.b300[1]=S.length; this.b300[2]=S.tension;
    this.b300[3]=S.spacing*0.001; this.b300[4]=S.waveCosAmp; this.b300[5]=S.waveBias;
    this.b300[6]=S.timeStep; this.b300[7]=S.perturbation; this.b300[8]=S.perturbationScale;
    this.b300[9]=S.flowSpeed; this.b300[10]=S.ffdScale1X; this.b300[11]=S.ffdScale2X;
    this.b300[12]=S.ffdOffsetY; this.b300[13]=S.fresnelScale; this.b300[14]=S.waveHeightScale;
    this.b300[15]=1.0;
    const ng = S.reNormalizeGain;
    for (let i = 0; i < PS3.TABLE_ENTRY_COUNT; i++) {
      const c = i*16, t = i*4;
      for (let l = 0; l < 4; l++) {
        const raw = this.coeffs[c+l]*this.b300[0] + this.coeffs[c+4+l]*this.b300[1] + this.coeffs[c+8+l]*this.b300[2] + this.coeffs[c+12+l]*this.b300[3];
        const da = Math.max(Math.abs(NORM_B[l]), 0.05);
        const d = NORM_B[l] < 0 ? -da : da;
        this.table[t+l] = Math.tanh(((raw - NORM_A[l]) / d) * ng);
      }
    }
  }

  runKernel(timeSec) {
    const kp = new Float32Array(PS3.LOOP_ITERS * 8 * 4);
    for (let iter = 0; iter < PS3.LOOP_ITERS; iter++) {
      const phase = timeSec * S.reKernelPhaseStep + iter * 0.37;
      const idxF = [0,0,0,0];
      for (let l = 0; l < 4; l++) {
        const bw = (R37_WORDS[l] + iter*0x13) & 0xff;
        idxF[l] = wrapIndexFloat(tableIndexFromWord(bw) + Math.sin(phase+l*0.77)*S.reIndexJitter*PS3.TABLE_ENTRY_COUNT, PS3.TABLE_ENTRY_COUNT);
      }
      const v0=new Float32Array(4), v1=new Float32Array(4), v2=new Float32Array(4), v3=new Float32Array(4);
      sampleTableVec4(this.table, idxF[0], v0);
      sampleTableVec4(this.table, idxF[1], v1);
      sampleTableVec4(this.table, idxF[2], v2);
      sampleTableVec4(this.table, idxF[3], v3);
      const mA = 0.5+0.5*Math.sin(phase*0.7), mB = 0.5+0.5*Math.cos(phase*0.9);
      const r12=new Float32Array(4), r13=new Float32Array(4), r14=new Float32Array(4), r15=new Float32Array(4);
      const r9=new Float32Array(4), r4=new Float32Array(4), r87=new Float32Array(4), r89=new Float32Array(4);
      vec4Mix(v0,v1,mA,r12); vec4Mix(v1,v2,mB,r13); vec4Mix(v2,v3,mA,r14); vec4Mix(v3,v0,mB,r15);
      for (let l=0;l<4;l++) { r9[l]=v1[l]-v0[l]; r4[l]=v2[l]-v1[l]; r87[l]=v3[l]-v2[l]; r89[l]=v0[l]-v3[l]; }
      const stores = [r12,r13,r14,r15,r9,r4,r87,r89];
      for (let s = 0; s < 8; s++) {
        const fo = (iter*PS3.STRIDE_FLOATS) + (PS3.STORE_OFFSETS_BYTES[s]>>2);
        const v = stores[s];
        vec4Set(kp, fo, v[0], v[1], v[2], v[3]);
        const pb = (iter*8+s)*4;
        kp[pb]=v[0]; kp[pb+1]=v[1]; kp[pb+2]=v[2]; kp[pb+3]=v[3];
      }
    }
    const ts = Math.max(0, Math.min(0.999, S.reTemporalSmooth));
    for (let i = 0; i < kp.length; i++) {
      const sm = this.kernelPackedPrev[i]*ts + kp[i]*(1-ts);
      kp[i] = sm; this.kernelPackedPrev[i] = sm;
    }
    this.kernelPacked = kp;
    return kp;
  }

  writeDisplacementRGBA(timeSec, outRGBA, w, h) {
    this.buildTable(timeSec);
    const kp = this.runKernel(timeSec);
    const cp = this.controlPoints, cpn = cp.length;
    const kvc = PS3.LOOP_ITERS * 8;
    const flow = timeSec * S.flowSpeed * S.timeStep;
    const tmp = new Float32Array(w * h);
    for (let row = 0; row < h; row++) {
      const z = (row / Math.max(1, h-1)) * 2 - 1;
      const rb = row * w, rp = flow*0.25 + z*1.7;
      for (let i = 0; i < cpn; i++) {
        const x = i / Math.max(1, cpn-1);
        const kvf = row*0.93 + i*0.61 + flow*0.35;
        const kv0 = ((Math.floor(kvf)%kvc)+kvc)%kvc, kv1 = (kv0+1)%kvc;
        const kt = kvf - Math.floor(kvf);
        const k0 = kv0*4, k1 = kv1*4;
        const kx = kp[k0]*(1-kt)+kp[k1]*kt, ky = kp[k0+1]*(1-kt)+kp[k1+1]*kt;
        const kz = kp[k0+2]*(1-kt)+kp[k1+2]*kt, kw = kp[k0+3]*(1-kt)+kp[k1+3]*kt;
        const re = (kx*0.45+ky*0.25+kz*0.2+kw*0.1)*S.reKernelGain + Math.sin(rp+x*6.2)*S.bandAmplitude + Math.cos(z*S.bandSecondaryFreq+x*4.8+flow*0.09)*S.bandSecondaryAmp;
        const lg = Math.sin((x*Math.PI*1.3+z*0.8)-flow*S.travelSpeed1)*S.travelAmp1*S.tension + Math.sin((x*Math.PI*2.8-z*1.2)+flow*S.travelSpeed2)*S.travelAmp2 + S.perturbation*S.perturbationScale*Math.sin((x*(4.0+S.length*2.0)+z*4.0-flow*0.6)*(S.spacing*0.01));
        cp[i] = re*S.rePipelineBlend + lg*(1.0-S.rePipelineBlend);
      }
      for (let xi = 0; xi < w; xi++) tmp[rb+xi] = evalSpline(cp, xi/Math.max(1, w-1));
    }
    for (let i = 0; i < w * h; i++) {
      const v = Math.max(0, Math.min(1, tmp[i] * 1.2 + 0.5));
      outRGBA[i*4+0] = (v * 255 + 0.5) | 0;
      outRGBA[i*4+1] = 0; outRGBA[i*4+2] = 0; outRGBA[i*4+3] = 255;
    }
  }
}

// ── 4. WebGL Setup ──
let gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) gl = canvas.getContext('experimental-webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) return;

const extFloat = gl.getExtension('OES_texture_float');
const extFloatLinear = extFloat ? gl.getExtension('OES_texture_float_linear') : null;
const USE_FLOAT_TEX = !!extFloat;

function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}
function link(vs, fs) {
  const sv = compile(vs, gl.VERTEX_SHADER);
  const sf = compile(fs, gl.FRAGMENT_SHADER);
  if (!sv || !sf) return null;
  const p = gl.createProgram();
  gl.attachShader(p, sv); gl.attachShader(p, sf);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  return p;
}

const bgProg = link(
  'precision highp float;\nattribute vec2 aPos;\nvarying vec2 vUv;\nvoid main(){vUv=vec2(aPos.x*0.5+0.5,1.0-(aPos.y*0.5+0.5));gl_Position=vec4(aPos,0.0,1.0);}',
  'precision highp float;\nvarying vec2 vUv;\nuniform vec3 uTop,uBot;\nvoid main(){gl_FragColor=vec4(mix(uTop,uBot,vUv.y),1.0);}'
);

const extDeriv = gl.getExtension('OES_standard_derivatives');
const derivPrecision = extDeriv ? '#extension GL_OES_standard_derivatives : enable\n' : '';

const waveProg = link(
  'precision highp float;\nattribute vec2 aPos;\nuniform sampler2D uTex;\nuniform float uTime;\nuniform float flowSpeed,tension,damping,uLength,spacing,perturbation,perturbationScale,timeStep;\nuniform float waveCosAmp,waveBias,waveHeightScale,waveSoftClip;\nuniform float ffdYAmp,ffdZAmp,zDetailScale;\nuniform vec3 ffdScale1,ffdScale2,ffdOffset;\nuniform float fresnelPower_,fresnelScale_;\nvarying vec3 vPos;\nvarying float vFresnel;\nvoid main(){\n  vec3 p=vec3(aPos.x,0.0,aPos.y);\n  vec2 uv=(aPos+1.0)*0.5;\n  float disp=(texture2D(uTex,uv).r-0.5)*0.8333;\n  p.y=disp;\n  p.y += sin(uTime * 0.8) * 0.12;\n  p.y+=sin((p*ffdScale1+ffdOffset).x+uTime*flowSpeed)*ffdYAmp;\n  p.z+=cos((p*ffdScale2+ffdOffset).z+uTime*flowSpeed)*ffdZAmp;\n  float bw=(cos(p.x*2.0-uTime*0.5*timeStep)*waveCosAmp+waveBias)*(1.0-damping);\n  bw+=tension*sin(p.x*uLength+uTime*flowSpeed*timeStep*0.25);\n  float st=perturbation*perturbationScale*(sin((p.x*uLength*6.0+p.z*0.5)*spacing*0.01+uTime*flowSpeed*timeStep*0.7)*0.5+sin((p.x*uLength*10.0-p.z*0.8)*spacing*0.005-uTime*flowSpeed*timeStep*0.35)*0.25);\n  float tw=(bw+st)*waveHeightScale;\n  float absT=abs(tw/max(waveSoftClip,0.0001));\n  tw=waveSoftClip*(tw/max(waveSoftClip,0.0001))/(1.0+absT);\n  p.y-=tw;\n  vec2 uv2=uv;\n  uv2.x=fract(uv2.x-uTime*flowSpeed*0.04*timeStep);\n  float disp2=(texture2D(uTex,uv2).r-0.5)*0.8333;\n  p.z-=disp2*zDetailScale;\n  float edgeFactor=abs(p.x);\n  vFresnel=pow(edgeFactor,fresnelPower_)*fresnelScale_;\n  gl_Position=vec4(p,1.0);vPos=p;\n}',
  derivPrecision + 'precision highp float;\nvarying vec3 vPos;\nvarying float vFresnel;\nuniform float opacity,brightness,fresnelPower_,fresnelScale_;\nvoid main(){\n  float F=vFresnel;\n  gl_FragColor=vec4(vec3(1.0),F*opacity*brightness);\n}'
);

if (!bgProg || !waveProg) return;

function uloc(p,n){return gl.getUniformLocation(p,n);}
function aloc(p,n){return gl.getAttribLocation(p,n);}

const extVAO = gl.getExtension('OES_vertex_array_object');
function makeVAO() { return extVAO ? extVAO.createVertexArrayOES() : null; }
function bindVAO(v) { if(extVAO) extVAO.bindVertexArrayOES(v); }
function unbindVAO() { if(extVAO) extVAO.bindVertexArrayOES(null); }

const bgVAO = makeVAO();
bindVAO(bgVAO);
const qb = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, qb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
const bgPos = aloc(bgProg, 'aPos');
if (bgPos >= 0) { gl.enableVertexAttribArray(bgPos); gl.vertexAttribPointer(bgPos, 2, gl.FLOAT, false, 0, 0); }
unbindVAO();

const RES = 130; 
const strips = RES - 1, vps = RES * 2;
const verts = new Float32Array(strips * vps * 2);
let vi = 0;
for (let y = 0; y < strips; y++)
  for (let x = 0; x < RES; x++) {
    const fx = (x/(RES-1))*2-1;
    verts[vi++]=fx; verts[vi++]=((y+1)/(RES-1))*2-1;
    verts[vi++]=fx; verts[vi++]=(y/(RES-1))*2-1;
  }
const idx = new Uint16Array(strips*(vps+2)-2);
let ii=0, base=0;
for (let s=0;s<strips;s++){
  if(s>0){idx[ii++]=base-1;idx[ii++]=base;}
  for(let i=0;i<vps;i++) idx[ii++]=base+i;
  base+=vps;
}

const gridVAO = makeVAO();
const vb = gl.createBuffer();
const ib = gl.createBuffer();
bindVAO(gridVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
const wPos = aloc(waveProg, 'aPos');
if (wPos >= 0) { gl.enableVertexAttribArray(wPos); gl.vertexAttribPointer(wPos, 2, gl.FLOAT, false, 8, 0); }
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
unbindVAO();

const TW = 256, TH = 64;
const splineTexData = USE_FLOAT_TEX ? new Float32Array(TW * TH * 4) : new Uint8Array(TW * TH * 4);
const splineTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, splineTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, (USE_FLOAT_TEX && !extFloatLinear) ? gl.NEAREST : gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, (USE_FLOAT_TEX && !extFloatLinear) ? gl.NEAREST : gl.LINEAR);

if (USE_FLOAT_TEX) {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.FLOAT, splineTexData);
} else {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, splineTexData);
}

const pipeline = new Pipeline();

function uploadDisplacement(timeSec) {
  pipeline.writeDisplacementRGBA(timeSec, splineTexData, TW, TH);
  gl.bindTexture(gl.TEXTURE_2D, splineTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, splineTexData);
}

const bgU = { top: uloc(bgProg,'uTop'), bot: uloc(bgProg,'uBot') };
const wU = {
  tex: uloc(waveProg,'uTex'), time: uloc(waveProg,'uTime'),
  flowSpeed: uloc(waveProg,'flowSpeed'), tension: uloc(waveProg,'tension'),
  damping: uloc(waveProg,'damping'), length: uloc(waveProg,'uLength'),
  spacing: uloc(waveProg,'spacing'), perturbation: uloc(waveProg,'perturbation'),
  perturbationScale: uloc(waveProg,'perturbationScale'), timeStep: uloc(waveProg,'timeStep'),
  waveCosAmp: uloc(waveProg,'waveCosAmp'), waveBias: uloc(waveProg,'waveBias'),
  waveHeightScale: uloc(waveProg,'waveHeightScale'), waveSoftClip: uloc(waveProg,'waveSoftClip'),
  ffdScale1: uloc(waveProg,'ffdScale1'), ffdScale2: uloc(waveProg,'ffdScale2'),
  ffdOffset: uloc(waveProg,'ffdOffset'), ffdYAmp: uloc(waveProg,'ffdYAmp'),
  ffdZAmp: uloc(waveProg,'ffdZAmp'), zDetailScale: uloc(waveProg,'zDetailScale'),
  opacity: uloc(waveProg,'opacity'), brightness: uloc(waveProg,'brightness'),
  fresnelPower: uloc(waveProg,'fresnelPower_'), fresnelScale: uloc(waveProg,'fresnelScale_'),
};

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize, { passive:true });
resize();

const cr = S.colorR/255, cg = S.colorG/255, cb = S.colorB/255;
const topR = cr*S.gradientTopMul, topG = cg*S.gradientTopMul, topB = cb*S.gradientTopMul*1.2;
const botR = cr*S.gradientBotMul, botG = cg*S.gradientBotMul, botB = cb*S.gradientBotMul;

let prev = performance.now(), time = 0;

function frame(now) {
  const dt = Math.max(0, (now - prev) / 1000);
  prev = now;
  time += dt;

  uploadDisplacement(time);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(bgProg);

  if (bgVAO) { bindVAO(bgVAO); } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    if (bgPos >= 0) { gl.enableVertexAttribArray(bgPos); gl.vertexAttribPointer(bgPos, 2, gl.FLOAT, false, 0, 0); }
  }
  gl.uniform3f(bgU.top, topR, topG, topB);
  gl.uniform3f(bgU.bot, botR, botG, botB);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  unbindVAO();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(waveProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, splineTex);
  gl.uniform1i(wU.tex, 0);
  gl.uniform1f(wU.time, time);
  gl.uniform1f(wU.flowSpeed, S.flowSpeed);
  gl.uniform1f(wU.tension, S.tension);
  gl.uniform1f(wU.damping, S.damping);
  gl.uniform1f(wU.length, S.length);
  gl.uniform1f(wU.spacing, S.spacing);
  gl.uniform1f(wU.perturbation, S.perturbation);
  gl.uniform1f(wU.perturbationScale, S.perturbationScale);
  gl.uniform1f(wU.timeStep, S.timeStep);
  gl.uniform1f(wU.waveCosAmp, S.waveCosAmp);
  gl.uniform1f(wU.waveBias, S.waveBias);
  gl.uniform1f(wU.waveHeightScale, S.waveHeightScale);
  gl.uniform1f(wU.waveSoftClip, S.waveSoftClip);
  gl.uniform3f(wU.ffdScale1, S.ffdScale1X, S.ffdScale1Y, S.ffdScale1Z);
  gl.uniform3f(wU.ffdScale2, S.ffdScale2X, S.ffdScale2Y, S.ffdScale2Z);
  gl.uniform3f(wU.ffdOffset, S.ffdOffsetX, S.ffdOffsetY, S.ffdOffsetZ);
  gl.uniform1f(wU.ffdYAmp, S.ffdYAmp);
  gl.uniform1f(wU.ffdZAmp, S.ffdZAmp);
  gl.uniform1f(wU.zDetailScale, S.zDetailScale);
  gl.uniform1f(wU.opacity, S.opacity);
  gl.uniform1f(wU.brightness, S.brightness);
  gl.uniform1f(wU.fresnelPower, S.fresnelPower);
  gl.uniform1f(wU.fresnelScale, S.fresnelScale);

  if (gridVAO) { bindVAO(gridVAO); } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    if (wPos >= 0) { gl.enableVertexAttribArray(wPos); gl.vertexAttribPointer(wPos, 2, gl.FLOAT, false, 8, 0); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  }
  gl.drawElements(gl.TRIANGLE_STRIP, ii, gl.UNSIGNED_SHORT, 0);
  unbindVAO();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
})();
