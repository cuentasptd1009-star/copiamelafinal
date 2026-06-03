import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useLoginWithCode } from '@workspace/api-client-react';
import { apiBase } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setToken, getToken } from '@/lib/auth';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { useTvKeyboard } from '@/hooks/use-tv-keyboard';
import { Download, Share2, Smartphone, QrCode, X, Tv, CheckCircle, Loader2, Eye, EyeOff, Bookmark, BookmarkCheck } from 'lucide-react';
import logo from '@assets/logo_supertv.png';

type FocusZone = 'input' | 'remember' | 'submit' | 'qr' | 'install' | 'shortcut';

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem('supertv_device_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('supertv_device_id', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function isTvDevice(): boolean {
  const ua = navigator.userAgent;
  return (
    /Tizen/i.test(ua) ||
    /Web0S|WebOS/i.test(ua) ||
    /HbbTV/i.test(ua) ||
    /SMART-TV|SmartTV/i.test(ua) ||
    /\bTV\b/i.test(ua) ||
    /AFT[A-Z0-9]+/i.test(ua) ||
    /BRAVIA/i.test(ua) ||
    /Roku/i.test(ua) ||
    /PhilipsTV/i.test(ua) ||
    /OPR\/.*TV/i.test(ua)
  );
}

export default function Login() {
  const [code, setCode] = useState(() => {
    try { return localStorage.getItem('supertv_remembered_code') || ''; } catch { return ''; }
  });
  const [isRemembered, setIsRemembered] = useState(() => {
    try { return !!localStorage.getItem('supertv_remembered_code'); } catch { return false; }
  });
  const [showCode, setShowCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [conflictMessage, setConflictMessage] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [showShortcutHint, setShowShortcutHint] = useState(false);
  const [focusZone, setFocusZone] = useState<FocusZone>('input');
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrActivated, setQrActivated] = useState(false);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const isTV = isTvDevice();
  const [, setLocation] = useLocation();
  const { canInstall, install, showInstallButton, isIosSafari } = usePwaInstall();
  const { openKeyboard } = useTvKeyboard();

  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const rememberRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef(code);
  const qrRef = useRef<HTMLButtonElement>(null);
  const installRef = useRef<HTMLButtonElement>(null);
  const shortcutRef = useRef<HTMLButtonElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openQrModal = useCallback(async () => {
    setQrActivated(false);
    setShowQrModal(true);
    try {
      await fetch(`${apiBase}/api/device-auth/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
    } catch {}
  }, [deviceId]);

  const closeQrModal = useCallback(() => {
    setShowQrModal(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (!showQrModal || qrActivated) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/device-auth/status/${deviceId}`);
        const data = await res.json();
        if (data.status === 'confirmed' && data.token) {
          clearInterval(pollRef.current!); pollRef.current = null;
          setQrActivated(true);
          setTimeout(() => {
            setToken(data.token, 'user');
            setLocation('/home');
          }, 1500);
        } else if (data.status === 'expired') {
          clearInterval(pollRef.current!); pollRef.current = null;
          openQrModal();
        }
      } catch {}
    }, 2000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [showQrModal, qrActivated, deviceId, openQrModal, setLocation]);

  const loginMutation = useLoginWithCode();

  useEffect(() => {
    if (getToken('user')) setLocation('/home');
  }, [setLocation]);

  useEffect(() => {
    if (focusZone === 'input') inputRef.current?.focus();
    else if (focusZone === 'remember') rememberRef.current?.focus();
    else if (focusZone === 'submit') submitRef.current?.focus();
    else if (focusZone === 'qr') qrRef.current?.focus();
    else if (focusZone === 'install') installRef.current?.focus();
    else if (focusZone === 'shortcut') shortcutRef.current?.focus();
  }, [focusZone]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    codeRef.current = val;
    setCode(val);
    setErrorMsg('');
  };

  const handleRemember = () => {
    const current = (codeRef.current || code).trim();
    if (isRemembered) {
      try { localStorage.removeItem('supertv_remembered_code'); } catch {}
      setIsRemembered(false);
    } else if (current) {
      try { localStorage.setItem('supertv_remembered_code', current); } catch {}
      setIsRemembered(true);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    // codeRef.current is always up-to-date even when called from a stale onConfirm closure
    const codeToSubmit = (codeRef.current || code).trim();
    if (!codeToSubmit) return;
    setErrorMsg('');
    loginMutation.mutate(
      { data: { code: codeToSubmit, deviceId: navigator.userAgent } },
      {
        onSuccess: (data) => {
          try { localStorage.setItem('supertv_remembered_code', codeToSubmit); } catch {}
          setIsRemembered(true);
          if (data.sessionConflict) {
            setConflictMessage('Tu código está abierto en otro dispositivo. Se cerrará la otra sesión en 4 segundos...');
            setTimeout(() => { setToken(data.token, 'user'); setLocation('/home'); }, 4000);
          } else {
            setToken(data.token, 'user');
            setLocation('/home');
          }
        },
        onError: (err: unknown) => {
          const e = err as Record<string, string> | undefined;
          const serverMsg: string = e?.error || e?.message || '';
          if (serverMsg.toLowerCase().includes('no existe') || serverMsg.toLowerCase().includes('not found')) {
            setErrorMsg('Este código no existe');
          } else if (serverMsg.toLowerCase().includes('inactivo') || serverMsg.toLowerCase().includes('inactive')) {
            setErrorMsg('Este código está desactivado');
          } else if (serverMsg.toLowerCase().includes('expirado') || serverMsg.toLowerCase().includes('expired')) {
            setErrorMsg('Este código ha expirado');
          } else {
            setErrorMsg('Código inválido. Verifica e intenta de nuevo.');
          }
        },
      }
    );
  };

  const handleInstall = () => {
    if (canInstall) {
      install();
    } else {
      setShowHint(true);
    }
  };

  const handleShortcut = () => {
    setShowShortcutHint(true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showHint || showShortcutHint) {
        if (e.key === 'Escape' || e.key === 'Backspace') { setShowHint(false); setShowShortcutHint(false); }
        return;
      }

      const isTyping = document.activeElement === inputRef.current;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (focusZone === 'input') setFocusZone('remember');
          else if (focusZone === 'remember') setFocusZone('submit');
          else if (focusZone === 'submit') setFocusZone('qr');
          else if (focusZone === 'qr' && showInstallButton) setFocusZone('install');
          else if (focusZone === 'qr') setFocusZone('shortcut');
          else if (focusZone === 'install') setFocusZone('shortcut');
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (focusZone === 'shortcut' && showInstallButton) setFocusZone('install');
          else if (focusZone === 'shortcut') setFocusZone('qr');
          else if (focusZone === 'install') setFocusZone('qr');
          else if (focusZone === 'qr') setFocusZone('submit');
          else if (focusZone === 'submit') setFocusZone('remember');
          else if (focusZone === 'remember') setFocusZone('input');
          break;
        case 'Enter':
          if (focusZone === 'input') {
            e.preventDefault();
            if (isTV) {
              inputRef.current?.blur();
              openKeyboard(inputRef.current, {
                value: code,
                onChange: (v) => {
                  const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
                  codeRef.current = clean;
                  setCode(clean);
                  setErrorMsg('');
                },
                onConfirm: handleSubmit,
                label: 'Código de acceso',
                maxLength: 5,
              });
            } else {
              handleSubmit();
            }
          } else if (focusZone === 'remember' && !isTyping) {
            e.preventDefault();
            handleRemember();
          } else if (focusZone === 'submit' && !isTyping) {
            e.preventDefault();
            handleSubmit();
          } else if (focusZone === 'qr' && !isTyping) {
            e.preventDefault();
            openQrModal();
          } else if (focusZone === 'install' && !isTyping) {
            e.preventDefault();
            handleInstall();
          } else if (focusZone === 'shortcut' && !isTyping) {
            e.preventDefault();
            handleShortcut();
          }
          break;
        case 'Escape':
          if (isTyping) {
            e.preventDefault();
            inputRef.current?.blur();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusZone, showHint, showShortcutHint, showInstallButton, code]);

  const focusRing = 'ring-2 ring-primary ring-offset-2 ring-offset-background';

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md flex flex-col items-center space-y-8 animate-in fade-in zoom-in duration-500">
        <img src={logo} alt="Super TV Logo" className="w-48 h-auto drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]" />

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-2">
            {/* Input wrapper with eye button */}
            <div className="relative">
              <Input
                ref={inputRef}
                type={showCode ? 'text' : 'password'}
                value={code}
                onChange={handleCodeChange}
                onFocus={() => setFocusZone('input')}
                placeholder="PON TU CODIGO DE ACCESO"
                className={`w-full text-center text-2xl py-6 pr-14 tracking-[0.4em] font-bold bg-card border-border focus-visible:ring-primary focus-visible:border-primary text-foreground placeholder:text-muted-foreground placeholder:text-base placeholder:tracking-normal rounded-lg uppercase ${focusZone === 'input' ? focusRing : ''}`}
                autoFocus
                disabled={loginMutation.isPending || !!conflictMessage}
                maxLength={5}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowCode(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={showCode ? 'Ocultar código' : 'Mostrar código'}
              >
                {showCode ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {/* Remember button */}
            <button
              ref={rememberRef}
              type="button"
              onClick={handleRemember}
              onFocus={() => setFocusZone('remember')}
              disabled={!code.trim() && !isRemembered}
              className={`w-full flex items-center justify-center gap-2 py-2 text-sm rounded-lg border transition-all ${
                isRemembered
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80 disabled:opacity-30 disabled:cursor-not-allowed'
              } ${focusZone === 'remember' ? focusRing : ''}`}
            >
              {isRemembered
                ? <><BookmarkCheck className="w-4 h-4" /> Código recordado — toca para olvidar</>
                : <><Bookmark className="w-4 h-4" /> Recordar este código</>
              }
            </button>

            {errorMsg && (
              <p className="text-destructive text-sm text-center animate-in fade-in slide-in-from-top-1">{errorMsg}</p>
            )}
          </div>

          <Button
            ref={submitRef}
            type="submit"
            onFocus={() => setFocusZone('submit')}
            className={`w-full py-6 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-all ${focusZone === 'submit' ? focusRing : ''}`}
            disabled={loginMutation.isPending || !!conflictMessage || code.length === 0}
          >
            {loginMutation.isPending ? 'Conectando...' : 'Entrar'}
          </Button>

          {isTV && (
            <Button
              ref={qrRef}
              type="button"
              variant="outline"
              onFocus={() => setFocusZone('qr')}
              onClick={openQrModal}
              className={`w-full py-5 gap-2 border-primary/40 text-primary hover:bg-primary/10 ${focusZone === 'qr' ? focusRing : ''}`}
            >
              <QrCode className="w-4 h-4" />
              Activar por QR o Enlace — desde tu celular
            </Button>
          )}

          {conflictMessage && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-center animate-in fade-in slide-in-from-bottom-2">
              <p className="text-yellow-400 font-medium text-sm">{conflictMessage}</p>
            </div>
          )}
        </form>

        <div className="flex flex-col items-center gap-3 w-full">
          {showInstallButton && (
            <Button
              ref={installRef}
              variant="outline"
              className={`w-full gap-2 border-primary/40 text-primary hover:bg-primary/10 ${focusZone === 'install' ? focusRing : ''}`}
              onClick={handleInstall}
              onFocus={() => setFocusZone('install')}
              type="button"
            >
              <Download className="w-4 h-4" />
              Instalar APK en dispositivos Android
            </Button>
          )}
          <Button
            ref={shortcutRef}
            variant="outline"
            className={`w-full gap-2 border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 ${focusZone === 'shortcut' ? focusRing : ''}`}
            onClick={handleShortcut}
            onFocus={() => setFocusZone('shortcut')}
            type="button"
          >
            <Smartphone className="w-4 h-4" />
            Crear acceso directo a pantalla de inicio
          </Button>
          <p className="text-muted-foreground text-sm">Tu Streaming de Confianza</p>
          <p className="text-muted-foreground/40 text-xs">▲▼ Navegar · Enter Seleccionar</p>
        </div>
      </div>

      {showHint && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
          onClick={() => setShowHint(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {isIosSafari ? (
              <>
                <div className="flex items-center gap-3">
                  <Share2 className="w-6 h-6 text-primary flex-shrink-0" />
                  <h2 className="text-base font-bold">Instalar en iPhone / iPad</h2>
                </div>
                <ol className="space-y-2 text-sm text-muted-foreground list-none">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">1.</span>
                    Toca el botón <strong className="text-foreground mx-1">Compartir</strong>
                    <Share2 className="inline w-4 h-4 mx-0.5 flex-shrink-0" /> en la barra de Safari
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">2.</span>
                    Desplázate y toca <strong className="text-foreground">"Agregar a pantalla de inicio"</strong>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold">3.</span>
                    Toca <strong className="text-foreground">Agregar</strong> para confirmar
                  </li>
                </ol>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Download className="w-6 h-6 text-primary flex-shrink-0" />
                  <h2 className="text-base font-bold">Instalar APK en Android</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Para instalar el APK, abre esta página en <strong className="text-foreground">Chrome</strong> o <strong className="text-foreground">Edge</strong> y vuelve a tocar el botón de instalar. Compatible con celulares Android, Android TV y TV Box.
                </p>
              </>
            )}
            <button
              onClick={() => setShowHint(false)}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {showShortcutHint && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
          onClick={() => setShowShortcutHint(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <Smartphone className="w-6 h-6 text-primary flex-shrink-0" />
              <h2 className="text-base font-bold">Crear acceso directo</h2>
            </div>
            <div className="space-y-3">
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Android Chrome</p>
                <p className="text-sm text-muted-foreground">Menú (⋮) → "Agregar a pantalla de inicio"</p>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">iPhone / iPad (Safari)</p>
                <p className="text-sm text-muted-foreground">Botón compartir <Share2 className="inline w-3 h-3" /> → "Agregar a pantalla de inicio"</p>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Android TV / Smart TV</p>
                <p className="text-sm text-muted-foreground">Abre el navegador del TV, ve a la URL y guarda como marcador en pantalla principal</p>
              </div>
            </div>
            <button
              onClick={() => setShowShortcutHint(false)}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={closeQrModal}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tv className="w-5 h-5 text-primary" />
                <h2 className="text-base font-bold">Activar TV desde tu celular</h2>
              </div>
              <button onClick={closeQrModal} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-5 h-5" /></button>
            </div>

            {qrActivated ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle className="w-14 h-14 text-green-400" />
                <p className="text-lg font-semibold text-center text-white">¡Activado! Entrando...</p>
              </div>
            ) : (
              <>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2"><span className="text-primary font-bold shrink-0">1.</span>Abre la cámara de tu celular y escanea el QR</li>
                  <li className="flex gap-2"><span className="text-primary font-bold shrink-0">2.</span>Ingresa tu código de acceso en la página que se abre</li>
                  <li className="flex gap-2"><span className="text-primary font-bold shrink-0">3.</span>Toca <strong className="text-foreground">Activar TV</strong> — el TV se abrirá automáticamente</li>
                </ol>

                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 rounded-xl">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`${window.location.origin}/activar?d=${deviceId}`)}`}
                      alt="QR de activación"
                      className="w-44 h-44"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Esperando activación...
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground text-center">O copia este enlace en tu celular:</p>
                  <div className="bg-background rounded-lg px-3 py-2 border border-border">
                    <p className="text-xs text-primary font-mono break-all text-center select-all">{`${window.location.origin}/activar?d=${deviceId}`}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
