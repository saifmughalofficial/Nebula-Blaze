// Optional synthesized sound (off by default): a soft ambient pad plus short UI tones. No audio files.
export class Sound {
  constructor() { this.ctx = null; this.on = false; this.pad = null; }

  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setOn(on) {
    this.on = on;
    const ctx = this._ensure();
    if (!ctx) return;
    ctx.resume?.();
    if (on && !this.pad) this._startPad();
    this.master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.4);
  }

  _startPad() {
    const ctx = this.ctx, out = ctx.createGain(), filter = ctx.createBiquadFilter();
    out.gain.value = 0.07; filter.type = "lowpass"; filter.frequency.value = 700;
    filter.connect(out); out.connect(this.master);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07; lfoGain.gain.value = 350; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
    for (const f of [110, 164.8, 220.5, 329.6]) {
      const o = ctx.createOscillator();
      o.type = f > 200 ? "sine" : "triangle"; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(filter); o.start();
    }
    this.pad = out;
  }

  /** Short tone: kind = blip | chime | whoosh | boom */
  play(kind = "blip") {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain();
    g.connect(this.master);
    if (kind === "whoosh" || kind === "boom") {
      const len = kind === "boom" ? 1.2 : 0.6, buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      src.buffer = buf; f.type = kind === "boom" ? "lowpass" : "bandpass";
      f.frequency.setValueAtTime(kind === "boom" ? 400 : 300, t); f.frequency.exponentialRampToValueAtTime(kind === "boom" ? 60 : 2400, t + len);
      g.gain.setValueAtTime(kind === "boom" ? 0.5 : 0.18, t);
      src.connect(f); f.connect(g); src.start(t);
      return;
    }
    const o = ctx.createOscillator();
    o.type = "sine";
    const base = kind === "chime" ? 880 : 620;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (kind === "chime" ? 1.5 : 1.2), t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "chime" ? 0.6 : 0.18));
    o.connect(g); o.start(t); o.stop(t + 0.7);
  }
}
