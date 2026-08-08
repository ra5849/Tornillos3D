/* Tornillos 3D - Sistema de sonido sintetizado (WebAudio), sin archivos */
(function () {
  var ctx = null, master = null, muted = false;

  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.95;
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 5;
        comp.attack.value = 0.004; comp.release.value = 0.16;
        master.connect(comp); comp.connect(ctx.destination);
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || muted) return;
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, vol, freq, delay) {
    if (!ctx || muted) return;
    var t = ctx.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1600; f.Q.value = 1;
    var g = ctx.createGain(); g.gain.setValueAtTime(vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  function click() { tone(1150, 0.05, 'triangle', 0.25, 740); noise(0.03, 0.12, 3500); }
  function hover() { tone(680, 0.04, 'sine', 0.08); }
  function unscrew() {
    tone(480, 0.28, 'sawtooth', 0.22, 110);
    tone(720, 0.22, 'sine', 0.16, 210);
    noise(0.1, 0.12, 1200, 0.02);
    tone(210, 0.05, 'sine', 0.12, 0, 0.26);
  }
  function dropInto() { tone(1650, 0.06, 'sine', 0.22, 2100); tone(640, 0.08, 'triangle', 0.16, 420, 0.02); }
  function platePop() {
    tone(260, 0.34, 'sine', 0.4, 92);
    noise(0.25, 0.3, 520);
    tone(940, 0.12, 'triangle', 0.12, 320, 0.05);
  }
  function reveal() { tone(840, 0.12, 'sine', 0.16, 1250); tone(1250, 0.16, 'sine', 0.12, 1800, 0.07); }
  function error() {
    tone(180, 0.16, 'square', 0.22, 150);
    tone(150, 0.22, 'square', 0.2, 120, 0.02);
    noise(0.12, 0.14, 300);
  }
  function heartLose() { tone(320, 0.24, 'sawtooth', 0.25, 120); tone(230, 0.3, 'sawtooth', 0.2, 90, 0.05); }
  function hammer() { tone(900, 0.05, 'square', 0.3, 200); noise(0.12, 0.3, 700); tone(220, 0.1, 'sine', 0.3, 60, 0.02); }
  function coin() { tone(1250, 0.08, 'sine', 0.2); tone(1875, 0.12, 'sine', 0.18, 0, 0.06); }
  function buy() { tone(520, 0.07, 'sine', 0.2, 700); tone(700, 0.08, 'sine', 0.18, 940, 0.06); tone(940, 0.14, 'sine', 0.16, 1250, 0.12); }
  function start() { [392, 523, 659].forEach(function (f, i) { tone(f, 0.12, 'triangle', 0.2, 0, i * 0.07); }); }
  function winFanfare() {
    var seq = [523, 659, 784, 1046];
    seq.forEach(function (f, i) {
      tone(f, 0.16, 'triangle', 0.22, 0, i * 0.11);
      tone(f / 2, 0.2, 'triangle', 0.1, 0, i * 0.11);
    });
    tone(1318, 0.4, 'triangle', 0.2, 0, seq.length * 0.11);
    noise(0.3, 0.12, 2400, seq.length * 0.11);
  }
  function lose() { [330, 262, 196, 147].forEach(function (f, i) { tone(f, 0.28, 'sawtooth', 0.18, f * 0.8, i * 0.14); }); }

  window.SJaudio = {
    init: ensure, unmute: function () { muted = false; }, toggle: function () { muted = !muted; return muted; },
    isMuted: function () { return muted; },
    sfx: {
      click: click, hover: hover, unscrew: unscrew, dropInto: dropInto, platePop: platePop,
      reveal: reveal, error: error, heartLose: heartLose, hammer: hammer, coin: coin,
      buy: buy, start: start, winFanfare: winFanfare, lose: lose
    }
  };
})();