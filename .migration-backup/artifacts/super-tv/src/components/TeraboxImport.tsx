import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getToken } from '@/lib/auth';
import { Loader2, Link2, FolderSearch, Film, Tv, CheckCircle2, AlertTriangle, ChevronRight, Download, X, Play } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

type Step = 'input' | 'analyzing' | 'preview' | 'importing' | 'done' | 'error';

interface AnalyzedItem {
  name: string;
  url: string;
  poster?: string;
  size?: number;
  season?: number;
  episode?: number;
  folderName?: string;
  selected?: boolean;
}

interface AnalyzeResult {
  type: 'movie' | 'series' | 'mixed';
  title: string;
  items: AnalyzedItem[];
  poster?: string;
  totalFiles: number;
  hasFolders: boolean;
}

interface ImportResult {
  success: boolean;
  type: string;
  count?: number;
  episodes?: number;
  seasons?: number;
  title?: string;
  error?: string;
}

const CATEGORIES_MOVIES = ['Acción', 'Comedia', 'Drama', 'Terror', 'Sci-Fi', 'Animación', 'Documental', 'Romance', 'Thriller', 'Aventura', 'Fantasía'];
const CATEGORIES_SERIES = ['Drama', 'Comedia', 'Acción', 'Sci-Fi', 'Animación', 'Documental', 'Thriller', 'Fantasía'];

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function TeraboxImport() {
  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [importType, setImportType] = useState<'movie' | 'series'>('movie');
  const [customTitle, setCustomTitle] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<AnalyzedItem[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');

  const analyze = async () => {
    if (!url.trim()) return;
    setStep('analyzing');
    setErrorMsg('');
    try {
      const token = getToken('admin') || getToken('user');
      const r = await fetch(`${BASE_URL}/api/terabox/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setErrorMsg(data.error || 'Error al analizar'); setStep('error'); return; }
      setResult(data);
      const withSelected = (data.items as AnalyzedItem[]).map(i => ({ ...i, selected: true }));
      setItems(withSelected);
      setImportType(data.type === 'series' ? 'series' : 'movie');
      setCustomTitle(data.title || '');
      setCategory('');
      setStep('preview');
    } catch (e: any) {
      setErrorMsg(e.message || 'Error de conexión');
      setStep('error');
    }
  };

  const doImport = async () => {
    if (!result) return;
    setStep('importing');
    setProgress(10);
    setProgressMsg('Preparando importación...');

    const selected = items.filter(i => i.selected);
    if (!selected.length) { setErrorMsg('No hay archivos seleccionados'); setStep('error'); return; }

    setProgress(40);
    setProgressMsg(`Importando ${selected.length} archivo${selected.length > 1 ? 's' : ''}...`);

    try {
      const token = getToken('admin') || getToken('user');
      const r = await fetch(`${BASE_URL}/api/terabox/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          importType,
          title: customTitle || result.title,
          category: category || null,
          items: selected,
          poster: result.poster,
        }),
      });
      setProgress(90);
      setProgressMsg('Guardando en base de datos...');
      const data = await r.json();
      if (!r.ok) { setErrorMsg(data.error || 'Error al importar'); setStep('error'); return; }
      setProgress(100);
      setImportResult(data);
      setStep('done');
    } catch (e: any) {
      setErrorMsg(e.message || 'Error de conexión');
      setStep('error');
    }
  };

  const reset = () => {
    setStep('input');
    setUrl('');
    setResult(null);
    setItems([]);
    setErrorMsg('');
    setImportResult(null);
    setProgress(0);
  };

  const toggleItem = (idx: number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it));
  };
  const toggleAll = (val: boolean) => setItems(prev => prev.map(it => ({ ...it, selected: val })));

  const selectedCount = items.filter(i => i.selected).length;
  const cats = importType === 'series' ? CATEGORIES_SERIES : CATEGORIES_MOVIES;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Download className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">Importar desde Terabox</h2>
          <p className="text-xs text-muted-foreground">Analiza y agrega contenido automáticamente desde un enlace compartido</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {[
          { id: 'input', label: 'Enlace' },
          { id: 'analyzing', label: 'Analizar' },
          { id: 'preview', label: 'Vista previa' },
          { id: 'importing', label: 'Importar' },
          { id: 'done', label: 'Listo' },
        ].map((s, i, arr) => (
          <div key={s.id} className="flex items-center gap-1">
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
              step === s.id ? 'bg-primary text-primary-foreground' :
              (['done', 'preview', 'importing'].includes(step) && i < arr.findIndex(x => x.id === step)) ? 'bg-primary/30 text-primary' :
              'bg-muted text-muted-foreground'
            }`}>{s.label}</span>
            {i < arr.length - 1 && <ChevronRight className="w-3 h-3 opacity-30" />}
          </div>
        ))}
      </div>

      {/* INPUT STEP */}
      {step === 'input' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" /> Enlace de Terabox
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="https://1024terabox.com/s/XXXXXXXX"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyze()}
                className="bg-background font-mono text-sm"
              />
              <Button onClick={analyze} disabled={!url.trim()} className="shrink-0">
                <FolderSearch className="w-4 h-4 mr-2" /> Analizar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Pega un enlace público de Terabox. El sistema detectará películas, series, temporadas y episodios automáticamente.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { icon: FolderSearch, label: 'Detecta estructura', desc: 'Carpetas, temporadas, episodios' },
              { icon: Film, label: 'Clasifica contenido', desc: 'Películas, series automáticamente' },
              { icon: Tv, label: 'Importa todo', desc: 'Sin afectar contenido existente' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="rounded-lg border border-border/50 bg-card/30 p-3">
                <Icon className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-xs font-medium text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ANALYZING STEP */}
      {step === 'analyzing' && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-8 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          </div>
          <div className="text-center space-y-1">
            <p className="font-semibold text-foreground">Analizando enlace...</p>
            <p className="text-sm text-muted-foreground">Detectando carpetas, videos y estructura de contenido</p>
          </div>
          <div className="w-full max-w-xs space-y-2 text-xs text-muted-foreground">
            {['Conectando con Terabox', 'Leyendo estructura de carpetas', 'Detectando archivos de video', 'Clasificando contenido'].map((msg, i) => (
              <div key={msg} className="flex items-center gap-2" style={{ animationDelay: `${i * 0.5}s` }}>
                <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
                <span>{msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PREVIEW STEP */}
      {step === 'preview' && result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl border border-border bg-card/50 p-4 flex items-start gap-4">
            {result.poster ? (
              <img src={result.poster} alt="" className="w-16 h-24 object-cover rounded-lg shrink-0 bg-muted" onError={e => (e.currentTarget.style.display = 'none')} />
            ) : (
              <div className="w-16 h-24 rounded-lg bg-muted flex items-center justify-center shrink-0">
                {result.type === 'series' ? <Tv className="w-6 h-6 text-muted-foreground" /> : <Film className="w-6 h-6 text-muted-foreground" />}
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${result.type === 'series' ? 'bg-blue-500/20 text-blue-400' : result.type === 'mixed' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
                  {result.type === 'series' ? 'SERIE' : result.type === 'mixed' ? 'MIXTO' : 'PELÍCULA'}
                </span>
                <span className="text-xs text-muted-foreground">{result.totalFiles} archivo{result.totalFiles !== 1 ? 's' : ''} detectado{result.totalFiles !== 1 ? 's' : ''}</span>
                {result.hasFolders && <span className="text-xs text-muted-foreground">• Con carpetas</span>}
              </div>
              <p className="font-semibold text-foreground text-sm truncate">{result.title}</p>
            </div>
          </div>

          {/* Config */}
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Configuración</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Tipo de contenido</label>
                <div className="flex gap-2">
                  {(['movie', 'series'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setImportType(t)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${
                        importType === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {t === 'movie' ? <Film className="w-3.5 h-3.5" /> : <Tv className="w-3.5 h-3.5" />}
                      {t === 'movie' ? 'Películas' : 'Serie'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Categoría</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Sin categoría</option>
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{importType === 'series' ? 'Nombre de la serie' : 'Nombre personalizado (opcional)'}</label>
              <Input
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                placeholder={result.title}
                className="bg-background text-sm"
              />
            </div>
          </div>

          {/* File list */}
          <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
              <span className="text-xs font-medium text-foreground">{selectedCount} de {items.length} archivos seleccionados</span>
              <div className="flex gap-2 text-xs">
                <button onClick={() => toggleAll(true)} className="text-primary hover:underline">Todo</button>
                <span className="text-muted-foreground">·</span>
                <button onClick={() => toggleAll(false)} className="text-muted-foreground hover:underline">Ninguno</button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => toggleItem(idx)}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${item.selected ? 'bg-primary/5 hover:bg-primary/10' : 'opacity-50 hover:opacity-70'}`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${item.selected ? 'bg-primary border-primary' : 'border-border'}`}>
                    {item.selected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  <Play className="w-3 h-3 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.season && item.episode ? `T${item.season} E${item.episode} · ` : ''}
                      {item.folderName ? `${item.folderName} · ` : ''}
                      {formatSize(item.size)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={reset} className="flex-1 sm:flex-none">
              <X className="w-4 h-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={doImport} disabled={selectedCount === 0} className="flex-1">
              <Download className="w-4 h-4 mr-2" />
              Importar {selectedCount} archivo{selectedCount !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}

      {/* IMPORTING STEP */}
      {step === 'importing' && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-8 flex flex-col items-center gap-5">
          <div className="w-16 h-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{progressMsg}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* DONE STEP */}
      {step === 'done' && importResult && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-bold text-foreground">¡Importación completa!</p>
            {importResult.type === 'movie' ? (
              <p className="text-sm text-muted-foreground">
                Se agregaron <span className="text-foreground font-semibold">{importResult.count} película{(importResult.count || 0) > 1 ? 's' : ''}</span>
                {category ? ` en la categoría "${category}"` : ''}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Serie <span className="text-foreground font-semibold">"{importResult.title}"</span> creada
                con <span className="text-foreground font-semibold">{importResult.seasons} temporada{(importResult.seasons || 0) > 1 ? 's' : ''}</span> y{' '}
                <span className="text-foreground font-semibold">{importResult.episodes} episodio{(importResult.episodes || 0) > 1 ? 's' : ''}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">El contenido está disponible para los usuarios de inmediato</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={reset}>
              <Link2 className="w-4 h-4 mr-2" /> Importar otro
            </Button>
          </div>
        </div>
      )}

      {/* ERROR STEP */}
      {step === 'error' && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Error al procesar</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
          <Button variant="outline" onClick={reset}>Intentar de nuevo</Button>
        </div>
      )}
    </div>
  );
}
