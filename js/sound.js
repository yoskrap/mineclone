// 효과음: 원본 사운드 파일 대신 Web Audio API로 직접 합성
let ctx = null, master = null, volume = 0.7;
function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

const MAT = { // 재질별 필터 주파수
  stone: [1800, 0.12], wood: [700, 0.12], grass: [2600, 0.1], gravel: [1300, 0.13], sand: [3200, 0.1],
  glass: [4200, 0.08], snow: [3000, 0.1], wool: [500, 0.1], water: [900, 0.2],
};
function noise(dur, freq, gain = 0.5, q = 1) {
  const a = ac(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur); const buf = a.createBuffer(1, len, a.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * (0.85 + Math.random() * 0.3); f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(master); src.start();
}
function tone(f0, f1, dur, type = 'sine', gain = 0.25) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(); o.type = type; const g = a.createGain();
  o.frequency.setValueAtTime(f0, a.currentTime); o.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(a.currentTime + dur);
}
export function play(name, material = 'stone') {
  const [fr, du] = MAT[material] || MAT.stone;
  switch (name) {
    case 'break': noise(du * 2.2, fr, 0.8, 0.8); break;
    case 'hit': noise(du * 0.6, fr, 0.25, 1.2); break;
    case 'place': noise(du * 1.5, fr * 0.8, 0.6, 0.9); break;
    case 'step': noise(du * 0.9, fr, 0.18, 1); break;
    case 'pop': tone(500, 900, 0.08, 'sine', 0.15); break;
    case 'click': tone(1200, 600, 0.05, 'square', 0.08); break;
    case 'hurt': tone(320, 160, 0.18, 'sawtooth', 0.18); noise(0.12, 800, 0.3); break;
    case 'splash': noise(0.4, 900, 0.5, 0.6); break;
  }
}
