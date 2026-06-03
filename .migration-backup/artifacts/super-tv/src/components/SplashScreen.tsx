import { useEffect, useRef, useState } from 'react';
import logo from '@assets/logo_supertv.png';

interface SplashScreenProps {
  onDone: () => void;
}

function playIntroSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.85, ctx.currentTime);
    master.connect(ctx.destination);

    // ── Reverb convolver (impulse response) ──────────────────────────
    const reverbLen = ctx.sampleRate * 1.8;
    const reverbBuf = ctx.createBuffer(2, reverbLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = reverbBuf.getChannelData(c);
      for (let i = 0; i < reverbLen; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLen, 2.2);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = reverbBuf;
    const reverbGain = ctx.createGain();
    reverbGain.gain.setValueAtTime(0.28, ctx.currentTime);
    convolver.connect(reverbGain);
    reverbGain.connect(master);

    // ── Low-pass filter for warmth ────────────────────────────────────
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(3200, ctx.currentTime);
    lpf.connect(master);
    lpf.connect(convolver);

    const now = ctx.currentTime;

    // Helper: create a bass "dum" hit
    function bassDum(t: number, freq: number, vol: number, decay: number) {
      // Sub-bass oscillator
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 2.2, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07);

      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);

      osc.connect(g);
      g.connect(lpf);
      osc.start(t);
      osc.stop(t + decay + 0.05);

      // Second harmonic
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 4, t);
      osc2.frequency.exponentialRampToValueAtTime(freq * 2, t + 0.05);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(vol * 0.3, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + decay * 0.5);
      osc2.connect(g2);
      g2.connect(lpf);
      osc2.start(t);
      osc2.stop(t + decay * 0.5 + 0.05);

      // Noise burst (attack transient)
      const bufLen = Math.floor(ctx.sampleRate * 0.05);
      const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1;
      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuf;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(vol * 0.18, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      const noiseLpf = ctx.createBiquadFilter();
      noiseLpf.type = 'lowpass';
      noiseLpf.frequency.setValueAtTime(200, t);
      noiseNode.connect(noiseLpf);
      noiseLpf.connect(noiseGain);
      noiseGain.connect(lpf);
      noiseNode.start(t);
      noiseNode.stop(t + 0.06);
    }

    // ── High shimmer tone ─────────────────────────────────────────────
    function shimmer(t: number) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      osc.connect(g);
      g.connect(lpf);
      osc.start(t);
      osc.stop(t + 1.2);
    }

    // Beat 1 – deep thud at t=0
    bassDum(now + 0.05, 58, 0.95, 1.0);
    // Beat 2 – slightly higher, more resonant, at t≈0.55s (Netflix-like gap)
    bassDum(now + 0.60, 78, 1.0, 1.3);
    // High shimmer on beat 2
    shimmer(now + 0.63);

    // Close context after sound finishes
    setTimeout(() => { try { ctx.close(); } catch {} }, 3000);
  } catch {
    // Audio not available — silent fallback
  }
}

export function SplashScreen({ onDone }: SplashScreenProps) {
  const [phase, setPhase] = useState<'hold' | 'fadeout'>('hold');
  const doneRef = useRef(false);

  useEffect(() => {
    // Play sound after a very brief delay so the DOM is painted
    const soundTimer = setTimeout(() => playIntroSound(), 80);

    // Start fade-out at 2.4s
    const fadeTimer = setTimeout(() => setPhase('fadeout'), 2400);

    // Call onDone after fade completes (fade duration 600ms)
    const doneTimer = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, 3050);

    return () => {
      clearTimeout(soundTimer);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
      style={{
        opacity: phase === 'fadeout' ? 0 : 1,
        transition: phase === 'fadeout' ? 'opacity 0.65s ease-in' : 'none',
      }}
    >
      {/* Radial glow behind logo */}
      <div
        style={{
          position: 'absolute',
          width: 420,
          height: 420,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(185,28,28,0.45) 0%, rgba(185,28,28,0.12) 45%, transparent 70%)',
          animation: 'splashGlow 2s ease-out forwards',
        }}
      />

      {/* Logo */}
      <img
        src={logo}
        alt="Super TV"
        style={{
          width: 220,
          maxWidth: '65vw',
          position: 'relative',
          animation: 'splashLogo 2.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
          filter: 'drop-shadow(0 0 32px rgba(185,28,28,0.7)) drop-shadow(0 0 80px rgba(185,28,28,0.35))',
        }}
      />

      <style>{`
        @keyframes splashLogo {
          0%   { opacity: 0; transform: scale(0.55); filter: drop-shadow(0 0 0px rgba(185,28,28,0)); }
          18%  { opacity: 1; }
          55%  { transform: scale(1.07); filter: drop-shadow(0 0 40px rgba(185,28,28,0.85)) drop-shadow(0 0 90px rgba(185,28,28,0.45)); }
          75%  { transform: scale(0.97); }
          100% { opacity: 1; transform: scale(1.0); filter: drop-shadow(0 0 28px rgba(185,28,28,0.65)) drop-shadow(0 0 70px rgba(185,28,28,0.30)); }
        }
        @keyframes splashGlow {
          0%   { opacity: 0; transform: scale(0.3); }
          40%  { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0.7; transform: scale(1.0); }
        }
      `}</style>
    </div>
  );
}
