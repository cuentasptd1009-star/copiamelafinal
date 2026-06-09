import { useEffect, useState } from 'react';
import { apiBase } from '@/lib/api';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import logo from '@assets/logo_supertv.png';

export default function DescargarPage() {
  const [status, setStatus] = useState<'loading' | 'available' | 'unavailable'>('loading');

  useEffect(() => {
    fetch(`${apiBase}/api/apk/info`)
      .then(r => r.json())
      .then(d => {
        if (d.available) {
          setStatus('available');
          setTimeout(() => {
            window.location.href = `${apiBase}/api/apk/download`;
          }, 800);
        } else {
          setStatus('unavailable');
        }
      })
      .catch(() => setStatus('unavailable'));
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-8 text-center">
      <img src={logo} alt="Super TV" className="h-24 w-auto object-contain" />

      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 text-white/60">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-lg">Preparando descarga...</span>
        </div>
      )}

      {status === 'available' && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-white/60 text-sm">La descarga iniciará automáticamente. Si no inicia:</p>
          <a
            href={`${apiBase}/api/apk/download`}
            className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-white rounded-xl font-semibold text-lg hover:bg-primary/90 transition-colors shadow-lg"
          >
            <Download className="w-5 h-5" />
            Descargar Super TV APK
          </a>
        </div>
      )}

      {status === 'unavailable' && (
        <div className="flex flex-col items-center gap-3 text-yellow-400">
          <AlertCircle className="w-10 h-10" />
          <p className="text-lg font-medium">APK no disponible</p>
          <p className="text-sm text-white/50">El administrador aún no ha subido el archivo APK.</p>
        </div>
      )}
    </div>
  );
}
