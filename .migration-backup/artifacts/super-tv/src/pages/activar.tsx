import { useState, useEffect } from 'react';
import { CheckCircle, Tv, AlertCircle, Loader2 } from 'lucide-react';
import logo from '@assets/logo_supertv.png';
import { apiBase } from '@/lib/api';

export default function Activar() {
  const params = new URLSearchParams(window.location.search);
  const deviceId = params.get('d') ?? '';

  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    fetch(`${apiBase}/api/device-auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    }).then(() => setRegistered(true)).catch(() => {});
  }, [deviceId]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !deviceId) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBase}/api/device-auth/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, code: code.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Error al activar');
        setStatus('error');
      } else {
        setStatus('success');
      }
    } catch {
      setErrorMsg('Error de conexión. Inténtalo de nuevo.');
      setStatus('error');
    }
  };

  if (!deviceId) {
    return (
      <div className="min-h-screen bg-[#0d0d1a] flex flex-col items-center justify-center p-6 text-white">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <p className="text-lg font-semibold text-center">Enlace inválido</p>
        <p className="text-sm text-white/50 text-center mt-2">Escanea el QR desde el TV para obtener un enlace válido.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d1a] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt="Super TV" className="w-24 h-auto" />
          <div className="flex items-center gap-2 text-white/60">
            <Tv className="w-4 h-4" />
            <span className="text-sm">Activación de TV</span>
          </div>
        </div>

        {status === 'success' ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle className="w-16 h-16 text-green-400" />
            <div className="text-center space-y-2">
              <p className="text-xl font-bold text-white">¡TV Activado!</p>
              <p className="text-sm text-white/60">Tu TV se abrirá automáticamente en unos segundos.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="space-y-1">
                <h1 className="text-lg font-bold text-white">Activar tu TV</h1>
                <p className="text-sm text-white/50">Ingresa tu código de acceso para iniciar sesión en el TV.</p>
              </div>

              <form onSubmit={handleActivate} className="space-y-3">
                <input
                  type="text"
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)); setErrorMsg(''); setStatus('idle'); }}
                  placeholder="CÓDIGO DE ACCESO"
                  className="w-full bg-white/8 border border-white/15 rounded-xl px-4 py-3 text-center text-xl font-bold tracking-[0.4em] text-white placeholder:text-white/25 placeholder:text-sm placeholder:tracking-normal focus:outline-none focus:border-primary/60 transition-colors uppercase"
                  maxLength={5}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoFocus
                  disabled={status === 'loading' || !registered}
                />

                {errorMsg && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading' || code.length === 0 || !registered}
                  className="w-full py-3.5 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {status === 'loading' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Activando...</>
                  ) : (
                    'Activar TV'
                  )}
                </button>
              </form>
            </div>

            <p className="text-center text-xs text-white/30">
              Este enlace es único para tu TV y expira en 10 minutos.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
