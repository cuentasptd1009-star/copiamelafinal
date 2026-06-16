import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { apiBase } from '@/lib/api';
import {
  useGetMe, getGetMeQueryKey, useAdminLogin,
  useGetAdminStats, getGetAdminStatsQueryKey,
  useGetWhatsappAlerts, getGetWhatsappAlertsQueryKey, useDismissWhatsappAlerts,
  useListCodes, getListCodesQueryKey, useCreateCode, useDeleteCode, useAdjustCodeTime, useUpdateCode,
  useListChannels, useCreateChannel, useUpdateChannel, useDeleteChannel, useImportChannels,
  useListMovies, getListMoviesQueryKey, useCreateMovie, useUpdateMovie, useDeleteMovie,
  useListSubadmins, getListSubadminsQueryKey, useCreateSubadmin, useUpdateSubadmin, useDeleteSubadmin, useAddSubadminBalance,
  useListPackages, getListPackagesQueryKey, useCreatePackage, useUpdatePackage, useDeletePackage,
  useListAvatars, getListAvatarsQueryKey, useCreateAvatar, useDeleteAvatar,
  useAdminChangePassword,
  useListChannelCategories,
} from '@workspace/api-client-react';
import type { AdminStats } from '@workspace/api-client-react';
import { getToken, setToken, clearTokens } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Users, Tv, Film, Key, Package as PackageIcon, LogOut, Plus, Trash2, Pencil,
  Wifi, Loader2, CheckCircle2, XCircle, Clock, Upload, FolderOpen, Copy, GripVertical, ArrowUpDown, Eye, EyeOff, UserCircle2, Settings, RotateCcw, Search, X, Download, Tag,
  Activity, Signal, AlertTriangle, BarChart2, MonitorPlay, RefreshCw, Tv2, ChevronDown, ChevronRight, Globe, Link2, ListVideo, Layers, Youtube, Play
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import logo from '@assets/logo_supertv.png';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL || '').replace(/\/+$/, '');

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const loginMutation = useAdminLogin();

  const { data: session, isLoading: sessionLoading, error: sessionError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  useEffect(() => {
    if (sessionError) {
    } else if (session && session.type === 'subadmin') {
      setLocation('/subadmin');
    }
  }, [session, sessionError, setLocation]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setIsLoggingIn(true);
    loginMutation.mutate({ data: { username, password } }, {
      onSuccess: (data) => {
        setToken(data.token, 'admin');
        if (data.role === 'admin') {
          window.location.reload();
        } else {
          setLocation('/subadmin');
        }
      },
      onError: () => {
        toast({ variant: 'destructive', title: 'Error de inicio de sesión', description: 'Usuario o contraseña incorrectos' });
        setIsLoggingIn(false);
      }
    });
  };

  const handleLogout = () => { clearTokens(); window.location.reload(); };

  if (sessionLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-primary">Cargando...</div>;
  }

  if (!session || session.type !== 'admin') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-border">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center"><img src={logo} alt="Super TV" className="h-16" /></div>
            <CardTitle className="text-2xl font-bold text-foreground">Panel de Administración</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} className="bg-background" />
              <Input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-background" />
              <Button type="submit" className="w-full" disabled={isLoggingIn}>{isLoggingIn ? 'Entrando...' : 'Entrar'}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <img src={logo} alt="Super TV" className="h-7 sm:h-8" />
          <span className="text-base sm:text-xl font-bold text-primary border-l border-border pl-3 sm:pl-4">Admin</span>
        </div>
        <div className="flex items-center space-x-3 sm:space-x-4">
          <span className="text-xs sm:text-sm font-medium hidden sm:inline">{session.username}</span>
          <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-5 h-5" /></Button>
        </div>
      </header>
      <main className="flex-1 p-3 sm:p-6 overflow-auto">
        <AdminDashboard />
      </main>
    </div>
  );
}

function AdminDashboard() {
  const queryClient = useQueryClient();
  const { data: stats, dataUpdatedAt } = useGetAdminStats({ query: { queryKey: getGetAdminStatsQueryKey(), refetchInterval: 120_000 } });

  const lastRefreshed = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto">
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Códigos Activos', value: stats?.activeCodes || 0, sub: `de ${stats?.totalCodes || 0} totales`, icon: Key },
          { label: 'Canales', value: stats?.totalChannels || 0, icon: Tv },
          { label: 'Películas', value: stats?.totalMovies || 0, icon: Film },
          { label: 'Subadmins', value: stats?.totalSubadmins || 0, icon: Users },
        ].map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">{label}</CardTitle>
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold">{value}</div>
              {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <Tabs defaultValue="codes" className="w-full">
        <TabsList className="bg-card border border-border w-full justify-start overflow-x-auto flex-nowrap">
          {['activity', 'codes', 'channels', 'movies', 'series', 'subadmins', 'packages', 'avatars', 'settings'].map((v, i) => (
            <TabsTrigger key={v} value={v} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm whitespace-nowrap">
              {['Actividad', 'Códigos', 'Canales', 'Películas', 'Series', 'Subadmins', 'Paquetes', 'Avatares', 'Configuración'][i]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="mt-4 sm:mt-6 bg-card border border-border rounded-lg p-3 sm:p-6">
          <TabsContent value="activity"><ActivityPanel stats={stats} lastRefreshed={lastRefreshed} onRefresh={handleRefresh} /></TabsContent>
          <TabsContent value="codes"><CodesManager /></TabsContent>
          <TabsContent value="channels"><ChannelsManager /></TabsContent>
          <TabsContent value="movies"><MoviesManager /></TabsContent>
          <TabsContent value="series"><SeriesManager /></TabsContent>
          <TabsContent value="subadmins"><SubadminsManager /></TabsContent>
          <TabsContent value="packages"><PackagesManager /></TabsContent>
          <TabsContent value="avatars"><AvatarsManager /></TabsContent>
          <TabsContent value="settings"><SettingsManager /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function ActivityPanel({ stats, lastRefreshed, onRefresh }: {
  stats: AdminStats | undefined;
  lastRefreshed: string;
  onRefresh: () => void;
}) {
  function timeAgo(iso: string | null | undefined): string {
    if (!iso) return '—';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `hace ${diff}s`;
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return `hace ${Math.floor(diff / 86400)}d`;
  }

  const adminToken = getToken('admin') ?? '';
  const [liveData, setLiveData] = useState<{
    liveNow: { codeCode: string; codeName: string | null; channelId: number; channelName: string }[];
    liveChannels: { channelId: number; name: string; count: number }[];
    total: number;
  } | null>(null);

  useEffect(() => {
    const fetchLive = () => {
      fetch(BASE_URL + '/api/admin/live', { headers: { Authorization: 'Bearer ' + adminToken } })
        .then(r => r.json()).then(setLiveData).catch(() => {});
    };
    fetchLive();
    const interval = setInterval(fetchLive, 30_000);
    return () => clearInterval(interval);
  }, [adminToken]);

  const liveCount = liveData?.total ?? stats?.onlineNow ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Actividad en tiempo real
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Actualizado: {lastRefreshed}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border border-green-500/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Online ahora</CardTitle>
            <Signal className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-green-500">{liveCount}</div>
            <p className="text-xs text-muted-foreground">reproduciendo en vivo</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Activos recientes</CardTitle>
            <Wifi className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats?.activeRecent ?? 0}</div>
            <p className="text-xs text-muted-foreground">últimos 15 min</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border border-yellow-500/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Vencen hoy</CardTitle>
            <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-yellow-500">{stats?.expiringToday ?? 0}</div>
            <p className="text-xs text-muted-foreground">códigos activos</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Vencen en 7 días</CardTitle>
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{stats?.expiringSoon ?? 0}</div>
            <p className="text-xs text-muted-foreground">códigos activos</p>
          </CardContent>
        </Card>
      </div>

      {/* En vivo ahora */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card border-border border-green-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Códigos reproduciendo ahora
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!liveData?.liveNow?.length ? (
              <p className="text-xs text-muted-foreground px-4 pb-4">Ningún código reproduciendo en este momento.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Código</TableHead>
                    <TableHead className="text-xs">Canal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liveData.liveNow.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                          <span className="font-mono font-semibold">{s.codeCode}</span>
                          {s.codeName && <span className="text-muted-foreground truncate max-w-[70px]">{s.codeName}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">{s.channelName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MonitorPlay className="w-4 h-4 text-primary" /> Canales en vivo ahora
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!liveData?.liveChannels?.length ? (
              <p className="text-xs text-muted-foreground px-4 pb-4">Sin canales en reproducción activa.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Canal</TableHead>
                    <TableHead className="text-xs text-right">Viendo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liveData.liveChannels.map((ch) => (
                    <TableRow key={ch.channelId}>
                      <TableCell className="text-xs font-medium">{ch.name}</TableCell>
                      <TableCell className="text-xs text-right">
                        <span className="inline-flex items-center gap-1 font-mono font-semibold text-green-500">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                          {ch.count}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MonitorPlay className="w-4 h-4 text-primary" /> Canales más vistos
              <span className="text-xs font-normal text-muted-foreground ml-1">(desde último reinicio)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!stats?.topChannels?.length ? (
              <p className="text-xs text-muted-foreground px-4 pb-4">Sin datos aún. Los canales aparecen aquí cuando los usuarios los ven.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">#</TableHead>
                    <TableHead className="text-xs">Canal</TableHead>
                    <TableHead className="text-xs text-right">Vistas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.topChannels.map((ch, i) => (
                    <TableRow key={ch.channelId}>
                      <TableCell className="text-xs font-bold text-muted-foreground w-8">{i + 1}</TableCell>
                      <TableCell className="text-xs font-medium">{ch.name}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{ch.views.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" /> Sesiones recientes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!stats?.recentSessions?.length ? (
              <p className="text-xs text-muted-foreground px-4 pb-4">No hay sesiones registradas.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Código</TableHead>
                      <TableHead className="text-xs">Dispositivo</TableHead>
                      <TableHead className="text-xs text-right">Última actividad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentSessions.map((s) => {
                      const isOnline = s.lastActiveAt && (Date.now() - new Date(s.lastActiveAt).getTime()) < 2 * 60_000;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                              <span className="font-mono font-medium">{s.codeCode ?? '—'}</span>
                              {s.codeName && <span className="text-muted-foreground truncate max-w-[80px]">{s.codeName}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[100px]">{s.deviceId.slice(0, 12)}</TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{timeAgo(s.lastActiveAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <WhatsappAlertsSection />
    </div>
  );
}


function StreamStatsCard() {
  const adminToken = getToken("admin") ?? "";
  const [stats, setStats] = useState<{
    segmentCache: { totalEntries: number; activeEntries: number; maxEntries: number; totalMB: string; ttlSeconds: number };
    topChannels: { channelId: number; name: string; views: number }[];
    timestamp: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = () => {
    setLoading(true);
    fetch(BASE_URL + "/api/admin/stream-stats", {
      headers: { Authorization: "Bearer " + adminToken },
    })
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchStats(); }, []);

  const fillPct = stats ? Math.round((stats.segmentCache.activeEntries / stats.segmentCache.maxEntries) * 100) : 0;
  const fillColor = fillPct > 80 ? "bg-red-500" : fillPct > 50 ? "bg-yellow-500" : "bg-green-500";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MonitorPlay className="w-4 h-4 text-primary" /> Cache de segmentos HLS
            <span className="text-xs font-normal text-muted-foreground">(HTTP streams via VPS)</span>
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={loading ? "w-3.5 h-3.5 animate-spin" : "w-3.5 h-3.5"} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-xs">Cargando…</div>
        ) : !stats ? (
          <div className="text-xs text-muted-foreground">No se pudieron cargar los stats.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-xl font-bold text-primary">{stats.segmentCache.activeEntries}</div>
                <div className="text-[10px] text-muted-foreground">Segmentos activos</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold">{stats.segmentCache.totalMB} MB</div>
                <div className="text-[10px] text-muted-foreground">Memoria usada</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold">{stats.segmentCache.ttlSeconds}s</div>
                <div className="text-[10px] text-muted-foreground">TTL por segmento</div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>Ocupación del cache</span>
                <span>{stats.segmentCache.activeEntries}/{stats.segmentCache.maxEntries} ({fillPct}%)</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className={fillColor + " h-2 rounded-full"} style={{ width: fillPct + "%" }} />
              </div>
            </div>
            {stats.topChannels.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-muted-foreground mb-2">Top canales (desde reinicio)</div>
                <div className="space-y-1">
                  {stats.topChannels.slice(0, 5).map((ch, i) => (
                    <div key={ch.channelId} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}</span>
                        <span className="truncate">{ch.name}</span>
                      </div>
                      <span className="font-mono text-muted-foreground ml-2 flex-shrink-0">{ch.views.toLocaleString()} vistas</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground text-right">
              Actualizado: {new Date(stats.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WhatsappAlertsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetWhatsappAlerts({
    query: { queryKey: getGetWhatsappAlertsQueryKey(), refetchInterval: 300_000 },
  });
  const dismissMutation = useDismissWhatsappAlerts();

  const alerts = data?.alerts ?? [];

  function handleSendAndDismiss(subadminId: number, codeIds: number[], waUrl: string) {
    window.open(waUrl, '_blank');
    dismissMutation.mutate(
      { data: { subadminId, codeIds } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWhatsappAlertsQueryKey() });
          toast({ title: 'Alerta marcada como enviada' });
        },
      }
    );
  }

  function handleDismiss(subadminId: number, codeIds: number[]) {
    dismissMutation.mutate(
      { data: { subadminId, codeIds } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWhatsappAlertsQueryKey() });
          toast({ title: 'Alerta descartada' });
        },
      }
    );
  }

  return (
    <Card className="bg-card border-border border-green-600/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-lg leading-none">📱</span> Alertas de WhatsApp
          {alerts.length > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500 text-[10px] font-bold text-black">
              {alerts.length}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Subadmins con códigos que vencen en las próximas 48 horas
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando alertas...
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            No hay alertas pendientes. Todos los códigos están en orden.
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.subadminId} className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{alert.subadminUsername}</span>
                      <span className="text-xs text-muted-foreground font-mono">{alert.whatsappNumber}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {alert.codes.map((c) => {
                        const daysLeft = Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={c.codeId} className="flex items-center gap-2 text-xs">
                            <span className={`font-mono font-medium ${daysLeft <= 1 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {c.code}
                            </span>
                            {c.name && <span className="text-muted-foreground">{c.name}</span>}
                            <span className={`ml-auto font-medium ${daysLeft <= 1 ? 'text-red-400' : 'text-yellow-500'}`}>
                              {daysLeft <= 0 ? 'vence hoy' : daysLeft === 1 ? 'vence mañana' : `${daysLeft}d restantes`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 flex-wrap">
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5"
                      onClick={() => handleSendAndDismiss(alert.subadminId, alert.codes.map(c => c.codeId), alert.waUrl)}
                      disabled={dismissMutation.isPending}
                    >
                      <span>📱</span> Enviar WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => handleDismiss(alert.subadminId, alert.codes.map(c => c.codeId))}
                      disabled={dismissMutation.isPending}
                    >
                      Descartar
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type TimeUnit = 'minutes' | 'hours' | 'days' | 'months' | 'years';
const TIME_UNITS: { value: TimeUnit; label: string }[] = [
  { value: 'minutes', label: 'Minutos' },
  { value: 'hours', label: 'Horas' },
  { value: 'days', label: 'Días' },
  { value: 'months', label: 'Meses' },
  { value: 'years', label: 'Años' },
];

function unitsToMinutes(amount: number, unit: TimeUnit): number {
  const map: Record<TimeUnit, number> = {
    minutes: 1,
    hours: 60,
    days: 24 * 60,
    months: 30 * 24 * 60,
    years: 365 * 24 * 60,
  };
  return Math.round(amount * map[unit]);
}

function minutesToLabel(minutes: number): string {
  if (minutes >= 365 * 24 * 60 && minutes % (365 * 24 * 60) === 0)
    return `${minutes / (365 * 24 * 60)} año(s)`;
  if (minutes >= 30 * 24 * 60 && minutes % (30 * 24 * 60) === 0)
    return `${minutes / (30 * 24 * 60)} mes(es)`;
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0)
    return `${minutes / (24 * 60)} día(s)`;
  if (minutes >= 60 && minutes % 60 === 0)
    return `${minutes / 60} hora(s)`;
  return `${minutes} minuto(s)`;
}

function minutesToEditState(minutes: number): { amount: string; unit: TimeUnit } {
  if (minutes >= 365 * 24 * 60 && minutes % (365 * 24 * 60) === 0)
    return { amount: String(minutes / (365 * 24 * 60)), unit: 'years' };
  if (minutes >= 30 * 24 * 60 && minutes % (30 * 24 * 60) === 0)
    return { amount: String(minutes / (30 * 24 * 60)), unit: 'months' };
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0)
    return { amount: String(minutes / (24 * 60)), unit: 'days' };
  if (minutes >= 60 && minutes % 60 === 0)
    return { amount: String(minutes / 60), unit: 'hours' };
  return { amount: String(minutes), unit: 'minutes' };
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url.length > 35 ? url.slice(0, 35) + '…' : url; }
}

function SelectUnit({ value, onChange }: { value: TimeUnit; onChange: (v: TimeUnit) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as TimeUnit)}
      className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
      {TIME_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
    </select>
  );
}

function CodesManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: codes, isLoading } = useListCodes({ query: { queryKey: getListCodesQueryKey() } });
  const createMutation = useCreateCode();
  const deleteMutation = useDeleteCode();
  const adjustMutation = useAdjustCodeTime();
  const updateMutation = useUpdateCode();

  const [showForm, setShowForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('30');
  const [newUnit, setNewUnit] = useState<TimeUnit>('days');
  const [adjustId, setAdjustId] = useState<number | null>(null);
  const [adjAmount, setAdjAmount] = useState('7');
  const [adjUnit, setAdjUnit] = useState<TimeUnit>('days');
  const [adjOp, setAdjOp] = useState<'add' | 'subtract'>('add');
  const [reactivateId, setReactivateId] = useState<number | null>(null);
  const [reactAmount, setReactAmount] = useState('30');
  const [reactUnit, setReactUnit] = useState<TimeUnit>('days');
  const [codeSearch, setCodeSearch] = useState('');
  const [codeStatusFilter, setCodeStatusFilter] = useState<'all' | 'active' | 'expired' | 'inactive'>('all');
  const [selectedExpiredIds, setSelectedExpiredIds] = useState<Set<number>>(new Set());
  const [bulkDeletingExpired, setBulkDeletingExpired] = useState(false);

  const filteredCodes = useMemo(() => {
    let list = codes || [];
    if (codeStatusFilter === 'active') list = list.filter(c => !c.isExpired && c.isActive);
    else if (codeStatusFilter === 'expired') list = list.filter(c => c.isExpired);
    else if (codeStatusFilter === 'inactive') list = list.filter(c => !c.isActive && !c.isExpired);
    if (!codeSearch.trim()) return list;
    const q = codeSearch.trim().toLowerCase();
    return list.filter(c =>
      c.code.toLowerCase().includes(q) ||
      (c.name ?? '').toLowerCase().includes(q)
    );
  }, [codes, codeSearch, codeStatusFilter]);

  const handleCodeInput = (val: string) => {
    setNewCode(val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5));
  };

  const handleCreate = () => {
    const durationMinutes = unitsToMinutes(parseInt(newAmount) || 30, newUnit);
    const codeVal = newCode.trim().toUpperCase() || undefined;
    createMutation.mutate({ data: { code: codeVal, name: newName || undefined, durationMinutes } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCodesQueryKey() });
        toast({ title: 'Código creado' });
        setNewCode(''); setNewName(''); setNewAmount('30'); setNewUnit('days'); setShowForm(false);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al crear código' })
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm('¿Eliminar este código?')) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListCodesQueryKey() }); toast({ title: 'Código eliminado' }); }
    });
  };

  const handleAdjust = (id: number) => {
    adjustMutation.mutate({ id, data: { amount: parseInt(adjAmount) || 1, unit: adjUnit, operation: adjOp } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCodesQueryKey() });
        toast({ title: `Tiempo ${adjOp === 'add' ? 'añadido' : 'reducido'}` });
        setAdjustId(null);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al ajustar tiempo' })
    });
  };

  const handleReactivate = (id: number) => {
    const ms = unitsToMinutes(parseInt(reactAmount) || 30, reactUnit) * 60 * 1000;
    const newExpiry = new Date(Date.now() + ms).toISOString();
    updateMutation.mutate({ id, data: { expiresAt: newExpiry, isActive: true } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCodesQueryKey() });
        toast({ title: 'Código reactivado', description: `Nuevo vencimiento: ${minutesToLabel(unitsToMinutes(parseInt(reactAmount) || 30, reactUnit))} desde hoy.` });
        setReactivateId(null);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al reactivar' })
    });
  };

  const handleBulkDeleteExpired = async () => {
    if (selectedExpiredIds.size === 0 || bulkDeletingExpired) return;
    if (!confirm(`¿Eliminar ${selectedExpiredIds.size} código${selectedExpiredIds.size !== 1 ? 's' : ''} expirado${selectedExpiredIds.size !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return;
    setBulkDeletingExpired(true);
    try {
      const token = getToken('admin');
      await fetch(`${BASE_URL}/api/codes/bulk`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: Array.from(selectedExpiredIds) }),
      });
      qc.invalidateQueries({ queryKey: getListCodesQueryKey() });
      toast({ title: `🗑️ ${selectedExpiredIds.size} código${selectedExpiredIds.size !== 1 ? 's eliminados' : ' eliminado'}` });
      setSelectedExpiredIds(new Set());
    } catch {
      toast({ variant: 'destructive', title: 'Error al eliminar códigos' });
    } finally {
      setBulkDeletingExpired(false);
    }
  };

  if (isLoading) return <div className="text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium flex items-center gap-2">
          Gestión de Códigos
          <span className="text-sm font-normal text-muted-foreground">
            ({filteredCodes.length}{(codeSearch.trim() || codeStatusFilter !== 'all') ? ` de ${codes?.length ?? 0}` : ''})
          </span>
        </h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" />Nuevo Código</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={codeSearch}
          onChange={e => setCodeSearch(e.target.value)}
          placeholder="Buscar por código o nombre..."
          className="pl-9 pr-8"
        />
        {codeSearch && (
          <button onClick={() => setCodeSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {(['all', 'active', 'expired', 'inactive'] as const).map(s => {
          const labels = { all: 'Todos', active: 'Activos', expired: 'Expirados', inactive: 'Inactivos' };
          const colors = {
            all: codeStatusFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
            active: codeStatusFilter === 'active' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground',
            expired: codeStatusFilter === 'expired' ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground',
            inactive: codeStatusFilter === 'inactive' ? 'bg-yellow-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground',
          };
          return (
            <button key={s} onClick={() => { setCodeStatusFilter(s); setSelectedExpiredIds(new Set()); }} className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${colors[s]}`}>
              {labels[s]}
            </button>
          );
        })}
      </div>

      {codeStatusFilter === 'expired' && filteredCodes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap py-1">
          <button
            onClick={() => {
              if (selectedExpiredIds.size === filteredCodes.length) {
                setSelectedExpiredIds(new Set());
              } else {
                setSelectedExpiredIds(new Set(filteredCodes.map(c => c.id)));
              }
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground font-medium transition-colors border border-border"
          >
            {selectedExpiredIds.size === filteredCodes.length ? 'Deseleccionar todo' : 'Seleccionar todos los expirados'}
          </button>
          {selectedExpiredIds.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDeleteExpired}
              disabled={bulkDeletingExpired}
              className="text-xs"
            >
              {bulkDeletingExpired
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Eliminando...</>
                : <><Trash2 className="w-3.5 h-3.5 mr-1.5" />Eliminar seleccionados ({selectedExpiredIds.size})</>}
            </Button>
          )}
        </div>
      )}

      {showForm && (
        <Card className="bg-background border-border p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              placeholder="Código (auto si vacío, máx 5 chars)"
              value={newCode}
              onChange={e => handleCodeInput(e.target.value)}
              maxLength={5}
              className="uppercase"
            />
            <Input placeholder="Nombre / cliente" value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Duración:</span>
            <Input type="number" min="1" className="w-24" value={newAmount} onChange={e => setNewAmount(e.target.value)} />
            <SelectUnit value={newUnit} onChange={setNewUnit} />
            <span className="text-xs text-muted-foreground">= {minutesToLabel(unitsToMinutes(parseInt(newAmount) || 30, newUnit))}</span>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={createMutation.isPending}>{createMutation.isPending ? 'Creando...' : 'Crear Código'}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {adjustId !== null && (
        <Card className="bg-background border-border p-4 space-y-3">
          <p className="text-sm font-medium">Ajustar tiempo del código #{adjustId}</p>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={adjOp} onChange={e => setAdjOp(e.target.value as 'add' | 'subtract')}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground">
              <option value="add">Sumar</option>
              <option value="subtract">Restar</option>
            </select>
            <Input type="number" min="1" className="w-24" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} />
            <SelectUnit value={adjUnit} onChange={setAdjUnit} />
            <Button size="sm" onClick={() => handleAdjust(adjustId)} disabled={adjustMutation.isPending}>
              {adjustMutation.isPending ? 'Ajustando...' : 'Aplicar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdjustId(null)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {reactivateId !== null && (
        <Card className="bg-background border-border p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-green-400" />
            Reactivar código #{reactivateId} — nueva duración desde hoy
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            {[
              { label: '30 días', amount: '30', unit: 'days' as TimeUnit },
              { label: '60 días', amount: '60', unit: 'days' as TimeUnit },
              { label: '90 días', amount: '90', unit: 'days' as TimeUnit },
              { label: '1 año',   amount: '1',  unit: 'years' as TimeUnit },
            ].map(opt => (
              <Button
                key={opt.label}
                size="sm"
                variant={reactAmount === opt.amount && reactUnit === opt.unit ? 'default' : 'outline'}
                onClick={() => { setReactAmount(opt.amount); setReactUnit(opt.unit); }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-xs text-muted-foreground">Personalizado:</span>
            <Input type="number" min="1" className="w-24" value={reactAmount} onChange={e => setReactAmount(e.target.value)} />
            <SelectUnit value={reactUnit} onChange={setReactUnit} />
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleReactivate(reactivateId)} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Reactivando...' : 'Reactivar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReactivateId(null)}>Cancelar</Button>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {codeStatusFilter === 'expired' && <TableHead className="w-8 pr-0 pl-3"></TableHead>}
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCodes.map((code) => (
              <TableRow key={code.id} className={codeStatusFilter === 'expired' && selectedExpiredIds.has(code.id) ? 'bg-primary/10' : ''}>
                {codeStatusFilter === 'expired' && (
                  <TableCell className="w-8 pr-0 pl-3">
                    <input
                      type="checkbox"
                      className="accent-primary w-4 h-4 cursor-pointer"
                      checked={selectedExpiredIds.has(code.id)}
                      onChange={() => setSelectedExpiredIds(prev => {
                        const next = new Set(prev);
                        if (next.has(code.id)) next.delete(code.id); else next.add(code.id);
                        return next;
                      })}
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono font-bold tracking-wider">{code.code}</TableCell>
                <TableCell>{code.name || '-'}</TableCell>
                <TableCell>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${code.isExpired ? 'bg-yellow-500/20 text-yellow-400' : code.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {code.isExpired ? 'Expirado' : code.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{code.expiresAt ? new Date(code.expiresAt).toLocaleDateString('es-ES') : 'Ilimitado'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {code.isExpired && (
                      <Button variant="ghost" size="icon" title="Reactivar código" className="text-green-400 hover:text-green-300 w-8 h-8"
                        onClick={() => { setReactivateId(code.id); setReactAmount('30'); setReactUnit('days'); setAdjustId(null); }}>
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" title="Ajustar tiempo" className="text-blue-400 hover:text-blue-300 w-8 h-8"
                      onClick={() => { setAdjustId(code.id); setAdjAmount('7'); setAdjUnit('days'); setAdjOp('add'); setReactivateId(null); }}>
                      <Clock className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive w-8 h-8" onClick={() => handleDelete(code.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredCodes.length === 0 && (
              <TableRow><TableCell colSpan={codeStatusFilter === 'expired' ? 6 : 5} className="text-center text-muted-foreground py-8">{codeSearch.trim() ? 'Sin resultados para esa búsqueda' : 'Sin códigos aún'}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type StreamTestResult = { ok: boolean; status: number; latencyMs: number; message: string } | null;

function MaskedLink({ publicUrl, realUrl }: { publicUrl: string; realUrl: string }) {
  const [showReal, setShowReal] = useState(false);
  const copy = (url: string) => navigator.clipboard.writeText(url).catch(() => {});
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="text-xs font-mono truncate max-w-[140px]" title={showReal ? realUrl : publicUrl}>
        {showReal
          ? <span className="text-amber-400">{(() => { try { return new URL(realUrl).hostname; } catch { return realUrl.slice(0, 28) + '…'; } })()}</span>
          : <span className="text-blue-400">{publicUrl.replace(/^https?:\/\//, '')}</span>
        }
      </span>
      <Button variant="ghost" size="icon" className="w-6 h-6 flex-shrink-0" title={showReal ? 'Ocultar URL real' : 'Ver URL real'}
        onClick={() => setShowReal(p => !p)}>
        {showReal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </Button>
      <Button variant="ghost" size="icon" className="w-6 h-6 flex-shrink-0" title="Copiar enlace"
        onClick={() => copy(showReal ? realUrl : publicUrl)}>
        <Copy className="w-3 h-3" />
      </Button>
    </div>
  );
}

function CategoryChipPicker({ channelId, currentCategory, existingCategories, onAssigned }: {
  channelId: number;
  currentCategory?: string | null;
  existingCategories: string[];
  onAssigned: (channelId: number, category: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handle = async (cat: string | null) => {
    setSaving(true);
    await onAssigned(channelId, cat);
    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        disabled={saving}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-transparent hover:border-primary/50 transition-colors cursor-pointer"
        title="Clic para cambiar categoría"
      >
        {saving
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : currentCategory
            ? <span className="text-primary font-medium">{currentCategory}</span>
            : <span className="text-muted-foreground italic">Sin categoría</span>
        }
        <Tag className="w-3 h-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl p-2 min-w-48 max-w-64">
          <p className="text-xs text-muted-foreground mb-2 px-1 font-medium">Asignar categoría:</p>
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {existingCategories.map(cat => (
              <button
                key={cat}
                onClick={() => handle(cat)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                  cat === currentCategory
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:border-primary/60 hover:bg-primary/10'
                }`}
              >
                {cat}
              </button>
            ))}
            {currentCategory && (
              <button
                onClick={() => handle(null)}
                className="text-xs px-2.5 py-1 rounded-full border border-dashed border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              >
                Quitar
              </button>
            )}
            {existingCategories.length === 0 && (
              <p className="text-xs text-muted-foreground px-1">No hay categorías aún</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SortableChannelRow({ ch, onEdit, onDelete, testing, testResult, onTest, selected, onSelect, selectionMode, existingCategories, onCategoryChange }: {
  ch: { id: number; name: string; category?: string | null; streamUrl: string; logo?: string | null };
  onEdit: () => void;
  onDelete: () => void;
  testing: boolean;
  testResult: StreamTestResult | null | undefined;
  onTest: () => void;
  selected: boolean;
  onSelect: (id: number) => void;
  selectionMode: boolean;
  existingCategories: string[];
  onCategoryChange: (channelId: number, category: string | null) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ch.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const publicUrl = `${window.location.origin}/home`;
  return (
    <TableRow ref={setNodeRef} style={style} className={selected ? 'bg-primary/10' : ''}>
      <TableCell className="w-8 pr-0">
        {selectionMode
          ? <input type="checkbox" checked={selected} onChange={() => onSelect(ch.id)}
              className="w-4 h-4 cursor-pointer accent-primary" />
          : <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 touch-none">
              <GripVertical className="w-4 h-4" />
            </button>
        }
      </TableCell>
      <TableCell className="font-medium">{ch.name}</TableCell>
      <TableCell>
        {selectionMode
          ? <span className="text-sm text-muted-foreground">{ch.category || '-'}</span>
          : <CategoryChipPicker
              channelId={ch.id}
              currentCategory={ch.category}
              existingCategories={existingCategories}
              onAssigned={onCategoryChange}
            />
        }
      </TableCell>
      <TableCell>
        <MaskedLink publicUrl={publicUrl} realUrl={ch.streamUrl} />
      </TableCell>
      {!selectionMode && <TableCell>
        {testing ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          : testResult ? (
            <div className="flex items-center gap-1">
              {testResult.ok ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
              <span className="text-xs text-muted-foreground">{testResult.latencyMs}ms</span>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onTest}><Wifi className="w-3 h-3 mr-1" />Test</Button>
          )}
      </TableCell>}
      <TableCell className="text-right">
        {selectionMode
          ? null
          : <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" className="text-yellow-400 hover:text-yellow-300 w-8 h-8" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive w-8 h-8" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
            </div>
        }
      </TableCell>
    </TableRow>
  );
}

function SortableCategoryItem({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 group">
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-sm font-medium flex-1">{label}</span>
      <Tag className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
    </div>
  );
}

function SortableMovieRow({ mv, onEdit, onDelete, selected, onToggleSelect }: {
  mv: { id: number; title: string; category?: string | null; filePath: string };
  onEdit: () => void;
  onDelete: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: mv.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const publicUrl = `${window.location.origin}/pelicula/${mv.id}`;
  return (
    <TableRow ref={setNodeRef} style={style} className={selected ? 'bg-primary/5' : ''}>
      <TableCell className="w-8 pr-0 pl-3">
        <input type="checkbox" className="accent-primary w-4 h-4 cursor-pointer" checked={!!selected} onChange={onToggleSelect} onClick={e => e.stopPropagation()} />
      </TableCell>
      <TableCell className="w-8 pl-0 pr-0">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 touch-none">
          <GripVertical className="w-4 h-4" />
        </button>
      </TableCell>
      <TableCell className="font-medium">{mv.title}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{mv.category || '-'}</TableCell>
      <TableCell>
        <MaskedLink publicUrl={publicUrl} realUrl={mv.filePath} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" className="text-yellow-400 hover:text-yellow-300 w-8 h-8" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive w-8 h-8" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

interface CsvChannel {
  name: string;
  streamUrl: string;
  category: string;
  logo: string;
  valid: boolean;
  error?: string;
}

function parseCSV(text: string): CsvChannel[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const header = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
  const find = (names: string[]) => header.findIndex(h => names.some(n => h.includes(n)));

  const nameIdx = find(['name', 'nombre', 'canal', 'channel', 'title']);
  const urlIdx = find(['url', 'stream', 'link', 'enlace', 'address']);
  const catIdx = find(['cat', 'group', 'grupo', 'category', 'categoria']);
  const logoIdx = find(['logo', 'icon', 'imagen', 'image', 'thumbnail']);

  if (urlIdx === -1) return [];

  return lines.slice(1).map((line, i) => {
    const cols = parseLine(line);
    const url = cols[urlIdx]?.trim() ?? '';
    const name = nameIdx >= 0 ? cols[nameIdx]?.trim() : '';
    const isValidUrl = url.startsWith('http://') || url.startsWith('https://') || url.startsWith('rtmp://') || url.startsWith('rtsp://');
    return {
      name: name || `Canal ${i + 1}`,
      streamUrl: url,
      category: catIdx >= 0 ? cols[catIdx]?.trim() ?? '' : '',
      logo: logoIdx >= 0 ? cols[logoIdx]?.trim() ?? '' : '',
      valid: isValidUrl,
      error: !isValidUrl ? 'URL inválida' : undefined,
    };
  });
}

function csvToM3U(channels: CsvChannel[]): string {
  let out = '#EXTM3U\n';
  for (const ch of channels) {
    let info = '#EXTINF:-1';
    if (ch.logo) info += ` tvg-logo="${ch.logo}"`;
    if (ch.category) info += ` group-title="${ch.category}"`;
    info += `,${ch.name}`;
    out += info + '\n' + ch.streamUrl + '\n';
  }
  return out;
}

function downloadCsvTemplate() {
  const csv = 'name,url,category,logo\nCNN en Español,http://ejemplo.com/cnn.m3u8,Noticias,https://logo.com/cnn.png\nESPN,http://ejemplo.com/espn.m3u8,Deportes,\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'canales_plantilla.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

type ImportTab = 'm3u' | 'csv' | 'urls';

const STREAM_PROTOCOLS = ['http://', 'https://', 'rtmp://', 'rtmps://', 'rtsp://'];
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|ico|svg)(\?[^|\s]*)?$/i;
const IMAGE_KEYWORD_RE = /\/(logo|icon|thumb|poster|banner|image|img)s?\//i;

function isStreamUrl(url: string): boolean {
  if (!STREAM_PROTOCOLS.some(p => url.startsWith(p))) return false;
  if (url.endsWith('.html') || url.endsWith('.php')) return false;
  if (IMAGE_EXT_RE.test(url.split('?')[0]) && IMAGE_KEYWORD_RE.test(url)) return false;
  return true;
}

function isImageUrl(url: string): boolean {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  const path = url.split('?')[0];
  return IMAGE_EXT_RE.test(path) || IMAGE_KEYWORD_RE.test(path);
}

function parseTextWithLogos(content: string, prefix: string): string {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const channels: { streamUrl: string; logo?: string; name?: string }[] = [];

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
      const streamPart = parts.find(p => isStreamUrl(p));
      const logoPart = parts.find(p => isImageUrl(p));
      const namePart = parts.find(p => !isStreamUrl(p) && !isImageUrl(p) && p.length > 0);
      if (streamPart) {
        channels.push({ streamUrl: streamPart, logo: logoPart, name: namePart });
        continue;
      }
    }

    const urlRe = /(?:https?|rtmp|rtmps|rtsp):\/\/[^\s\r\n"'<>|]+/g;
    const urls = line.match(urlRe) ?? [];
    const streams = urls.filter(u => isStreamUrl(u));
    const images = urls.filter(u => isImageUrl(u));

    for (const streamUrl of streams) {
      channels.push({ streamUrl, logo: images[0] });
    }
  }

  if (channels.length === 0) return '';

  let m3u = '#EXTM3U\n';
  channels.forEach(({ streamUrl, logo, name }, i) => {
    let info = '#EXTINF:-1';
    if (logo) info += ` tvg-logo="${logo}"`;
    info += `,${name || `${prefix} ${i + 1}`}`;
    m3u += info + '\n' + streamUrl + '\n';
  });
  return m3u;
}

const ADMIN_CHANNELS_KEY = ['admin', 'channels'] as const;

function ChannelsManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: channels, isLoading } = useListChannels(undefined, { query: { queryKey: ADMIN_CHANNELS_KEY, staleTime: 0 } });
  const { data: existingCategories = [] } = useListChannelCategories();
  const createMutation = useCreateChannel();
  const updateMutation = useUpdateChannel();
  const deleteMutation = useDeleteChannel();
  const importMutation = useImportChannels();

  const [showForm, setShowForm] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importTab, setImportTab] = useState<ImportTab>('csv');
  const [importContent, setImportContent] = useState('');
  const [urlsPrefix, setUrlsPrefix] = useState('Canal');
  const [csvRows, setCsvRows] = useState<CsvChannel[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [newCh, setNewCh] = useState({ name: '', streamUrl: '', category: '', logo: '' });
  const [testResults, setTestResults] = useState<Record<number, StreamTestResult>>({});
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [editCh, setEditCh] = useState<{ id: number; name: string; streamUrl: string; category: string; logo: string } | null>(null);
  const [sortMode, setSortMode] = useState(false);
  const [sortedIds, setSortedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState('');
  const [bulkCategorySaving, setBulkCategorySaving] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [catOrderMode, setCatOrderMode] = useState(false);
  const [catOrder, setCatOrder] = useState<string[]>([]);
  const [catOrderSaving, setCatOrderSaving] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const channelsList = channels || [];

  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase();
    if (!q) return channelsList;
    return channelsList.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.category ?? '').toLowerCase().includes(q)
    );
  }, [channelsList, channelSearch]);

  const toggleSortMode = () => {
    if (!sortMode) setSortedIds(channelsList.map(c => c.id));
    setSortMode(p => !p);
  };

  const openCatOrderMode = () => {
    const currentOrder = existingCategories.length > 0 ? [...existingCategories] : [];
    setCatOrder(currentOrder);
    setCatOrderMode(true);
  };

  const handleCatOrderDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = catOrder.indexOf(active.id as string);
    const newIndex = catOrder.indexOf(over.id as string);
    setCatOrder(prev => arrayMove(prev, oldIndex, newIndex));
  };

  const saveCatOrder = async () => {
    setCatOrderSaving(true);
    try {
      const token = getToken('admin');
      await fetch(`${BASE_URL}/api/channels/category-order`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: catOrder }),
      });
      qc.invalidateQueries({ queryKey: ['channels', 'categories'] });
      toast({ title: 'Orden de categorías guardado' });
      setCatOrderMode(false);
    } catch {
      toast({ variant: 'destructive', title: 'Error al guardar el orden' });
    } finally {
      setCatOrderSaving(false);
    }
  };

  const handleQuickCategory = async (channelId: number, category: string | null) => {
    const token = getToken('admin');
    await fetch(`${BASE_URL}/api/channels/${channelId}/category`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    });
    qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedIds.indexOf(active.id as number);
    const newIndex = sortedIds.indexOf(over.id as number);
    const newOrder = arrayMove(sortedIds, oldIndex, newIndex);
    setSortedIds(newOrder);
    setSaving(true);
    try {
      const token = getToken('admin');
      await fetch(`${BASE_URL}/api/channels/reorder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: newOrder }),
      });
      qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
    } catch {
      toast({ variant: 'destructive', title: 'Error al guardar orden' });
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = () => {
    if (!newCh.name || !newCh.streamUrl) { toast({ variant: 'destructive', title: 'Nombre y URL son requeridos' }); return; }
    createMutation.mutate({ data: { name: newCh.name, streamUrl: newCh.streamUrl, category: newCh.category || undefined, logo: newCh.logo || undefined } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
        toast({ title: 'Canal creado' });
        setNewCh({ name: '', streamUrl: '', category: '', logo: '' }); setShowForm(false);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al crear canal' })
    });
  };

  const handleUpdate = () => {
    if (!editCh || !editCh.name || !editCh.streamUrl) { toast({ variant: 'destructive', title: 'Nombre y URL son requeridos' }); return; }
    updateMutation.mutate({ id: editCh.id, data: { name: editCh.name, streamUrl: editCh.streamUrl, category: editCh.category || undefined, logo: editCh.logo || undefined } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
        toast({ title: 'Canal actualizado' });
        setEditCh(null);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al actualizar canal' })
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm('¿Eliminar este canal?')) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY }); toast({ title: 'Canal eliminado' }); }
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredChannels.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredChannels.map(c => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`¿Eliminar ${selectedIds.size} canal${selectedIds.size !== 1 ? 'es' : ''}? Esta acción no se puede deshacer.`)) return;
    setBulkDeleting(true);
    try {
      const token = getToken('admin');
      await fetch(`${BASE_URL}/api/channels/bulk`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
      toast({ title: `🗑️ ${selectedIds.size} canal${selectedIds.size !== 1 ? 'es eliminados' : ' eliminado'}` });
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch {
      toast({ variant: 'destructive', title: 'Error al eliminar canales' });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkCategory = async () => {
    if (selectedIds.size === 0 || bulkCategorySaving) return;
    setBulkCategorySaving(true);
    try {
      const token = getToken('admin');
      await fetch(`${BASE_URL}/api/channels/bulk-category`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), category: bulkCategoryValue.trim() || null }),
      });
      qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
      toast({ title: `✅ Categoría asignada a ${selectedIds.size} canal${selectedIds.size !== 1 ? 'es' : ''}` });
      setBulkCategoryOpen(false);
      setBulkCategoryValue('');
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch {
      toast({ variant: 'destructive', title: 'Error al asignar categoría' });
    } finally {
      setBulkCategorySaving(false);
    }
  };

  const csvFileRef = useRef<HTMLInputElement>(null);
  const m3uFileRef = useRef<HTMLInputElement>(null);
  const urlsFileRef = useRef<HTMLInputElement>(null);

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    setCsvRows(rows);
    setCsvFileName(file.name);
    e.target.value = '';
  };

  const handleCsvPaste = (text: string) => {
    setImportContent(text);
    const rows = parseCSV(text);
    setCsvRows(rows);
    setCsvFileName('');
  };

  const handleImport = () => {
    const isPending = importMutation.isPending;
    if (isPending) return;

    if (importTab === 'csv') {
      const valid = csvRows.filter(r => r.valid);
      if (!valid.length) return;
      const m3u = csvToM3U(valid);
      importMutation.mutate({ data: { content: m3u, format: 'm3u' } }, {
        onSuccess: (data) => {
          qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
          toast({ title: `✅ Importados ${data.imported} canales`, description: data.failed > 0 ? `${data.failed} fallaron` : 'Todos los canales fueron importados correctamente' });
          setCsvRows([]); setCsvFileName(''); setImportContent(''); setShowImportDialog(false);
        },
        onError: () => toast({ variant: 'destructive', title: 'Error al importar CSV' })
      });
    } else {
      if (!importContent.trim()) return;
      let content = importContent;
      let format: 'm3u' | 'auto' = importTab === 'm3u' ? 'm3u' : 'auto';
      if (importTab === 'urls') {
        const prefix = urlsPrefix.trim() || 'Canal';
        const parsed = parseTextWithLogos(importContent, prefix);
        if (parsed) {
          content = parsed;
          format = 'm3u';
        }
      }
      importMutation.mutate({ data: { content, format } }, {
        onSuccess: (data) => {
          qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
          toast({ title: `✅ Importados ${data.imported} canales`, description: data.failed > 0 ? `${data.failed} fallaron` : undefined });
          setImportContent(''); setShowImportDialog(false);
        },
        onError: () => toast({ variant: 'destructive', title: 'Error al importar' })
      });
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let imported = 0; let failed = 0;
    for (const file of files) {
      try {
        const content = await file.text();
        const isM3U = file.name.toLowerCase().endsWith('.m3u') || file.name.toLowerCase().endsWith('.m3u8');
        let finalContent: string;
        const format: 'm3u' | 'auto' = 'm3u';
        if (isM3U) {
          finalContent = content;
        } else {
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          const parsed = parseTextWithLogos(content, baseName);
          if (!parsed) { failed++; continue; }
          finalContent = parsed;
        }
        await new Promise<void>(resolve => {
          importMutation.mutate({ data: { content: finalContent, format } }, {
            onSuccess: (data) => { imported += data.imported; failed += data.failed; resolve(); },
            onError: () => { failed++; resolve(); }
          });
        });
      } catch { failed++; }
    }
    qc.invalidateQueries({ queryKey: ADMIN_CHANNELS_KEY });
    toast({ title: `Importados ${imported} canales`, description: failed > 0 ? `${failed} no se pudieron importar` : undefined });
    e.target.value = '';
  };

  const handleTest = async (channelId: number) => {
    setTesting(prev => ({ ...prev, [channelId]: true }));
    setTestResults(prev => ({ ...prev, [channelId]: null }));
    try {
      const token = getToken('admin');
      const resp = await fetch(`${BASE_URL}/api/channels/${channelId}/test-stream`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await resp.json();
      setTestResults(prev => ({ ...prev, [channelId]: data }));
    } catch {
      setTestResults(prev => ({ ...prev, [channelId]: { ok: false, status: 0, latencyMs: 0, message: 'Error de conexión' } }));
    } finally {
      setTesting(prev => ({ ...prev, [channelId]: false }));
    }
  };

  const handleTestAll = async () => {
    for (const ch of (channels || [])) { handleTest(ch.id); await new Promise(r => setTimeout(r, 200)); }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => toast({ title: 'URL copiada' })).catch(() => {});
  };

  if (isLoading) return <div className="text-muted-foreground">Cargando...</div>;

  const displayChannels = sortMode
    ? sortedIds.map(id => channelsList.find(c => c.id === id)).filter(Boolean) as typeof channelsList
    : filteredChannels;

  const validCsvCount = csvRows.filter(r => r.valid).length;
  const invalidCsvCount = csvRows.filter(r => !r.valid).length;

  const canImport = importTab === 'csv'
    ? validCsvCount > 0
    : importContent.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <h3 className="text-lg font-medium">
          Gestión de Canales{' '}
          <span className="text-sm text-muted-foreground font-normal">
            ({channelSearch.trim() ? `${filteredChannels.length} de ` : ''}{channelsList.length})
          </span>
        </h3>
        <div className="flex gap-2 flex-wrap">
          {selectionMode ? (
            <>
              <Button size="sm" variant="outline" onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); setBulkCategoryOpen(false); setBulkCategoryValue(''); }}>
                <X className="w-4 h-4 mr-2" />Cancelar
              </Button>
              <Button size="sm" variant="outline" onClick={toggleSelectAll}>
                {selectedIds.size === filteredChannels.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedIds.size === 0}
                onClick={() => { setBulkCategoryOpen(p => !p); setBulkCategoryValue(''); }}
                className={bulkCategoryOpen ? 'border-primary text-primary' : ''}
              >
                <Tag className="w-4 h-4 mr-2" />
                Asignar categoría{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
              <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={selectedIds.size === 0 || bulkDeleting}>
                {bulkDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Eliminar {selectedIds.size > 0 ? selectedIds.size : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
              </Button>
            </>
          ) : !sortMode && (
            <>
              <Button size="sm" variant="outline" onClick={() => { setShowImportDialog(true); setImportTab('csv'); setImportContent(''); setCsvRows([]); setCsvFileName(''); }}>
                <Upload className="w-4 h-4 mr-2" />Importar canales
              </Button>
              <Button size="sm" variant="outline" onClick={() => folderRef.current?.click()}><FolderOpen className="w-4 h-4 mr-2" />Subir Carpeta</Button>
              <input ref={folderRef} type="file" className="hidden" multiple onChange={handleFolderUpload}
                {...({ webkitdirectory: '', directory: '' } as any)} />
              {channelsList.length > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={handleTestAll}><Wifi className="w-4 h-4 mr-2" />Probar Todos</Button>
                  <Button size="sm" variant="outline" onClick={() => { setSelectionMode(true); setSelectedIds(new Set()); }}>
                    <Trash2 className="w-4 h-4 mr-2" />Seleccionar
                  </Button>
                </>
              )}
              <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" />Nuevo Canal</Button>
            </>
          )}
          {channelsList.length > 1 && !selectionMode && (
            <Button size="sm" variant={sortMode ? 'default' : 'outline'} onClick={toggleSortMode}>
              <ArrowUpDown className="w-4 h-4 mr-2" />{sortMode ? 'Listo' : 'Reordenar'}
              {saving && <Loader2 className="w-3 h-3 ml-2 animate-spin" />}
            </Button>
          )}
          {existingCategories.length > 0 && !sortMode && !selectionMode && (
            <Button size="sm" variant={catOrderMode ? 'default' : 'outline'} onClick={catOrderMode ? saveCatOrder : openCatOrderMode} disabled={catOrderSaving}>
              {catOrderSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Tag className="w-4 h-4 mr-2" />}
              {catOrderMode ? 'Guardar orden' : 'Orden categorías'}
            </Button>
          )}
          {catOrderMode && (
            <Button size="sm" variant="ghost" onClick={() => setCatOrderMode(false)}>
              <X className="w-4 h-4 mr-1" />Cancelar
            </Button>
          )}
        </div>
      </div>

      {bulkCategoryOpen && selectionMode && (
        <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg border border-primary/30 bg-primary/5">
          <Tag className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-primary">Asignar categoría a {selectedIds.size} canal{selectedIds.size !== 1 ? 'es' : ''}:</span>
          <div className="flex gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Input
                list="bulk-category-options"
                value={bulkCategoryValue}
                onChange={e => setBulkCategoryValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleBulkCategory(); if (e.key === 'Escape') { setBulkCategoryOpen(false); setBulkCategoryValue(''); } }}
                placeholder="Nombre de categoría (vacío = quitar)"
                className="bg-background h-8 text-sm"
                autoFocus
              />
              <datalist id="bulk-category-options">
                {existingCategories.map((cat: string) => <option key={cat} value={cat} />)}
              </datalist>
            </div>
            <Button size="sm" onClick={handleBulkCategory} disabled={bulkCategorySaving} className="h-8">
              {bulkCategorySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setBulkCategoryOpen(false); setBulkCategoryValue(''); }} className="h-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {catOrderMode && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium text-primary">Orden de categorías de canales</p>
            <span className="text-xs text-muted-foreground ml-auto">Arrastra para reordenar</span>
          </div>
          {catOrder.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No hay categorías todavía</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatOrderDragEnd}>
              <SortableContext items={catOrder} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {catOrder.map(cat => (
                    <SortableCategoryItem key={cat} id={cat} label={cat} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}

      {sortMode && !catOrderMode && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <GripVertical className="w-3 h-3" />
          Arrastra las filas para cambiar el orden. Se guarda automáticamente.
        </p>
      )}

      {!sortMode && !catOrderMode && channelsList.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={channelSearch}
            onChange={e => setChannelSearch(e.target.value)}
            placeholder="Buscar por nombre o categoría…"
            className="pl-9 pr-9 bg-background"
          />
          {channelSearch && (
            <button onClick={() => setChannelSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={(o) => { if (!o) { setShowImportDialog(false); setImportContent(''); setCsvRows([]); setCsvFileName(''); } }}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="w-5 h-5" />Importar Canales</DialogTitle>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 bg-background rounded-lg p-1 border border-border">
            {([['csv', '📋 CSV'], ['m3u', '📺 M3U / Playlist'], ['urls', '🔗 URLs sueltas']] as [ImportTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => { setImportTab(tab); setImportContent(''); setCsvRows([]); setCsvFileName(''); }}
                className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${importTab === tab ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            {/* CSV Tab */}
            {importTab === 'csv' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Sube un archivo CSV o pega el contenido. Columnas reconocidas: <code className="text-xs bg-muted px-1 rounded">name, url, category, logo</code></p>
                  <Button size="sm" variant="ghost" className="text-xs shrink-0" onClick={downloadCsvTemplate}>
                    <Download className="w-3 h-3 mr-1" />Plantilla
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => csvFileRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 hover:border-primary/50 hover:bg-muted/30 transition-all cursor-pointer text-center"
                  >
                    <FolderOpen className="w-8 h-8 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{csvFileName || 'Subir archivo CSV'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">.csv · separado por comas o punto y coma</p>
                    </div>
                  </button>
                  <input ref={csvFileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvFileUpload} />

                  <div className="border border-border rounded-lg overflow-hidden">
                    <Textarea
                      rows={4}
                      placeholder={'name,url,category,logo\nCNN,http://...,Noticias,\nESPN,http://...,Deportes,'}
                      value={importContent}
                      onChange={e => handleCsvPaste(e.target.value)}
                      className="bg-background font-mono text-xs border-0 resize-none h-full focus-visible:ring-0"
                    />
                  </div>
                </div>

                {csvRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-green-400 font-medium flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{validCsvCount} válidos</span>
                      {invalidCsvCount > 0 && <span className="text-red-400 font-medium flex items-center gap-1"><XCircle className="w-4 h-4" />{invalidCsvCount} con errores</span>}
                      <span className="text-muted-foreground ml-auto text-xs">Vista previa</span>
                    </div>
                    <div className="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-6 py-2"></TableHead>
                            <TableHead className="py-2">Nombre</TableHead>
                            <TableHead className="py-2">URL</TableHead>
                            <TableHead className="py-2">Categoría</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {csvRows.slice(0, 50).map((row, i) => (
                            <TableRow key={i} className={!row.valid ? 'bg-red-500/5' : ''}>
                              <TableCell className="py-1.5">
                                {row.valid
                                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                                  : <span title={row.error}><XCircle className="w-3.5 h-3.5 text-red-400" /></span>}
                              </TableCell>
                              <TableCell className="py-1.5 font-medium text-xs">{row.name}</TableCell>
                              <TableCell className="py-1.5 text-xs font-mono text-muted-foreground max-w-[180px] truncate">{row.streamUrl || <span className="italic text-red-400">vacío</span>}</TableCell>
                              <TableCell className="py-1.5 text-xs text-muted-foreground">{row.category || '—'}</TableCell>
                            </TableRow>
                          ))}
                          {csvRows.length > 50 && (
                            <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-2">... y {csvRows.length - 50} más</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* M3U Tab */}
            {importTab === 'm3u' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground flex-1">Pega el contenido de tu lista M3U o M3U8, o sube el archivo directamente:</p>
                  <Button size="sm" variant="ghost" className="text-xs shrink-0" onClick={() => m3uFileRef.current?.click()}>
                    <FolderOpen className="w-3 h-3 mr-1" />Subir .m3u
                  </Button>
                  <input ref={m3uFileRef} type="file" accept=".m3u,.m3u8,.txt" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    setImportContent(await f.text());
                    e.target.value = '';
                  }} />
                </div>
                <Textarea
                  rows={10}
                  placeholder={'#EXTM3U\n#EXTINF:-1 group-title="Noticias" tvg-logo="https://logo.com/cnn.png",CNN\nhttp://ejemplo.com/cnn.m3u8\n#EXTINF:-1 group-title="Deportes",ESPN\nhttp://ejemplo.com/espn.m3u8'}
                  value={importContent}
                  onChange={e => setImportContent(e.target.value)}
                  className="bg-background font-mono text-xs"
                />
                {importContent && (
                  <p className="text-xs text-muted-foreground">
                    Se detectaron aprox. {(importContent.match(/^https?:\/\//gm) || []).length + (importContent.match(/^rtmp:\/\//gm) || []).length} canales
                  </p>
                )}
              </div>
            )}

            {/* URLs Tab */}
            {importTab === 'urls' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground flex-1">Pega URLs o sube un archivo .txt — una por línea.</p>
                  <Button size="sm" variant="ghost" className="text-xs shrink-0" onClick={() => urlsFileRef.current?.click()}>
                    <FolderOpen className="w-3 h-3 mr-1" />Subir .txt
                  </Button>
                  <input ref={urlsFileRef} type="file" accept=".txt,.text" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    setImportContent(await f.text());
                    e.target.value = '';
                  }} />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Prefijo de nombre:</label>
                  <Input
                    value={urlsPrefix}
                    onChange={e => setUrlsPrefix(e.target.value)}
                    placeholder="Canal"
                    className="h-7 text-xs w-36"
                  />
                  <span className="text-xs text-muted-foreground">→ <span className="text-foreground font-medium">{(urlsPrefix.trim() || 'Canal')} 1</span>, <span className="text-foreground font-medium">{(urlsPrefix.trim() || 'Canal')} 2</span>…</span>
                </div>

                <Textarea
                  rows={9}
                  placeholder={'http://ejemplo.com/canal1.m3u8\nhttp://ejemplo.com/canal2.m3u8\nrtmp://ejemplo.com/live/stream3'}
                  value={importContent}
                  onChange={e => setImportContent(e.target.value)}
                  className="bg-background font-mono text-xs"
                />
                {importContent && (() => {
                  const count = (importContent.match(/(?:https?|rtmp|rtmps|rtsp):\/\/[^\s\r\n"'<>]+/g) as string[] || []).filter((u: string) => !u.endsWith('.html') && !u.endsWith('.php')).length;
                  const prefix = urlsPrefix.trim() || 'Canal';
                  return count > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-green-400 font-medium">{count} URL{count !== 1 ? 's' : ''} detectada{count !== 1 ? 's' : ''}</span>
                      {' → '}{prefix} 1, {prefix} 2{count > 2 ? ` … ${prefix} ${count}` : ''}
                    </p>
                  ) : <p className="text-xs text-amber-400">No se detectaron URLs válidas</p>;
                })()}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportContent(''); setCsvRows([]); setCsvFileName(''); }}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={importMutation.isPending || !canImport} className="min-w-32">
              {importMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</>
                : <><Upload className="w-4 h-4 mr-2" />
                  {importTab === 'csv' ? `Importar ${validCsvCount} canal${validCsvCount !== 1 ? 'es' : ''}` : 'Importar'}
                </>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!sortMode && showForm && (
        <Card className="bg-background border-border p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre del canal *" value={newCh.name} onChange={e => setNewCh(p => ({ ...p, name: e.target.value }))} />
            <Input placeholder="URL del stream *" value={newCh.streamUrl} onChange={e => setNewCh(p => ({ ...p, streamUrl: e.target.value }))} />
            <Input placeholder="Categoría" value={newCh.category} onChange={e => setNewCh(p => ({ ...p, category: e.target.value }))} />
            <Input placeholder="URL del logo" value={newCh.logo} onChange={e => setNewCh(p => ({ ...p, logo: e.target.value }))} />
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleCreate} disabled={createMutation.isPending}>{createMutation.isPending ? 'Creando...' : 'Crear Canal'}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {!catOrderMode && (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortMode ? sortedIds : channelsList.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pr-0">
                    {selectionMode
                      ? <input type="checkbox"
                          checked={channelsList.length > 0 && selectedIds.size === channelsList.length}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 cursor-pointer accent-primary" />
                      : null
                    }
                  </TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Stream</TableHead>
                  {!selectionMode && !sortMode && <TableHead>Test</TableHead>}
                  <TableHead className="text-right">{selectionMode ? '' : 'Acciones'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayChannels.map(ch => (
                  <SortableChannelRow
                    key={ch.id}
                    ch={ch}
                    testing={!!testing[ch.id]}
                    testResult={testResults[ch.id]}
                    onTest={() => handleTest(ch.id)}
                    onEdit={() => setEditCh({ id: ch.id, name: ch.name, streamUrl: ch.streamUrl, category: ch.category || '', logo: ch.logo || '' })}
                    onDelete={() => handleDelete(ch.id)}
                    selected={selectedIds.has(ch.id)}
                    onSelect={toggleSelect}
                    selectionMode={selectionMode}
                    existingCategories={existingCategories}
                    onCategoryChange={handleQuickCategory}
                  />
                ))}
                {channelsList.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sin canales aún</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SortableContext>
      </DndContext>
      )}

      <Dialog open={!!editCh} onOpenChange={(o) => !o && setEditCh(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle>Editar Canal</DialogTitle></DialogHeader>
          {editCh && (
            <div className="space-y-3">
              <Input placeholder="Nombre *" value={editCh.name} onChange={e => setEditCh(p => p ? { ...p, name: e.target.value } : p)} />
              <Input placeholder="URL del stream *" value={editCh.streamUrl} onChange={e => setEditCh(p => p ? { ...p, streamUrl: e.target.value } : p)} />
              <Input placeholder="Categoría" value={editCh.category} onChange={e => setEditCh(p => p ? { ...p, category: e.target.value } : p)} />
              <Input placeholder="URL del logo" value={editCh.logo} onChange={e => setEditCh(p => p ? { ...p, logo: e.target.value } : p)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditCh(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>{updateMutation.isPending ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const VIDEO_EXTENSIONS = new Set(['mp4','mkv','avi','mov','wmv','flv','m4v','webm','ts','m3u8','mpg','mpeg','ogv','3gp','f4v','rmvb','divx','vob']);

function cleanMovieName(raw: string): string {
  let name = raw.replace(/\.[^.]+$/, '');
  name = name.replace(/\b(19|20)\d{2}\b/g, '');
  name = name.replace(/\b(2160p|1080p|1080i|720p|480p|576p|4K|4k|UHD|HD|SDR|HDR10?|DolbyVision|DV)\b/gi, '');
  name = name.replace(/\b(BluRay|Blu-Ray|BDRip|BRRip|WEBRip|WEB-DL|WEB|HDRip|DVDRip|DVD|HDTV|PDVD|VHS|CAM|TS|SCR|HC|REMUX|HQ|HQ-TS)\b/gi, '');
  name = name.replace(/\b(x264|x265|h264|h265|HEVC|AVC|DivX|XviD|AV1|VP9|MPEG2|H\.264|H\.265|10bit|8bit)\b/gi, '');
  name = name.replace(/\b(AAC|AC3|DTS|DD5|DD2|MP3|FLAC|TrueHD|Atmos|DDP|EAC3|5\.1|7\.1|2\.0|6CH|8CH)\b/gi, '');
  name = name.replace(/\b(MULTI|VOST|VOSTFR|FRENCH|ENGLISH|SPANISH|LATINO|ESP|ENG|SPA|LAT|CAST|SUB|SUBS|DUBBED|DUAL|MULTi)\b/gi, '');
  name = name.replace(/\b(YIFY|YTS|RARBG|EZTV|FGT|MKV|ION10|SPARKS|GECKOS|NTG|ETTV|SHITBOX)\b/gi, '');
  name = name.replace(/[\[\](){}]/g, ' ');
  name = name.replace(/[-_.+]+/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/\b\w/g, l => l.toUpperCase());
  return name || raw;
}

function parseNfo(content: string): { title?: string; poster?: string; filePath?: string } {
  const title = content.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const thumb = content.match(/<thumb[^>]*>([^<]+)<\/thumb>/i)?.[1]?.trim()
    || content.match(/<art[^>]*>[\s\S]*?<poster>([^<]+)<\/poster>/i)?.[1]?.trim();
  const fileinfo = content.match(/<fileinfo>[\s\S]*?<\/fileinfo>/i);
  const url = content.match(/https?:\/\/[^\s<"']+\.(mp4|mkv|avi|mov|ts|m3u8|mpg|mpeg|webm)[^\s<"']*/i)?.[0];
  return { title: title || undefined, poster: thumb || undefined, filePath: url || undefined };
}

function parseStrmOrTxt(content: string, filename: string): { title: string; filePath?: string } {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const url = lines.find(l => /^(https?|rtmp|rtsp|ftp):\/\//.test(l) || VIDEO_EXTENSIONS.has(l.split('.').pop()?.toLowerCase() || ''));
  return { title: cleanMovieName(filename), filePath: url };
}

function parseM3UMovies(content: string): { title: string; filePath: string; poster?: string }[] {
  const lines = content.split('\n').map(l => l.trim());
  const results: { title: string; filePath: string; poster?: string }[] = [];
  let currentName = ''; let currentPoster = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) {
      const nameMatch = line.match(/,(.+)$/); const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      currentName = nameMatch ? nameMatch[1].trim() : '';
      currentPoster = logoMatch ? logoMatch[1] : '';
    } else if (/^(https?|rtmp|rtsp):\/\//.test(line)) {
      if (currentName) results.push({ title: currentName, filePath: line, poster: currentPoster || undefined });
      currentName = ''; currentPoster = '';
    }
  }
  return results;
}

type DetectedMovie = {
  _id: string;
  title: string;
  filePath: string;
  poster: string;
  selected: boolean;
  searching: boolean;
  file?: File;
  uploadStatus?: 'pending' | 'uploading' | 'done' | 'error';
  uploadProgress?: number;
};

type SmartItem = { name: string; url: string; poster?: string; size?: number; season?: number; episode?: number; folderName?: string; };
type SmartSeriesGroup = { title: string; folderUrl: string; poster?: string; items: SmartItem[]; seasons: Record<string, SmartItem[]>; };
type SmartAnalyzeResult = {
  source: 'terabox' | 'http';
  type: 'movie' | 'series' | 'multi-series';
  title: string;
  items: SmartItem[];
  seasons?: Record<string, SmartItem[]>;
  seriesGroups?: SmartSeriesGroup[];
  poster?: string;
  totalFiles: number;
  hasFolders: boolean;
  folderCount: number;
};

function detectUrlSource(url: string): { label: string; color: string; supported: boolean; hint?: string } | null {
  if (!url.trim()) return null;
  const u = url.trim().toLowerCase();
  if (/terabox\.com\/s\/|1024terabox\.com\/s\/|1024tera\.com\/s\/|terabox\.app\/s\/|freeterabox\.com\/s\//.test(u))
    return { label: '📦 Terabox', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', supported: true, hint: 'Requiere cookies configuradas en Ajustes' };
  if (/mega\.nz|mega\.co\.nz/.test(u))
    return { label: '🔒 MEGA', color: 'text-red-400 bg-red-500/10 border-red-500/30', supported: false, hint: 'No compatible — usa URLs directas en modo Manual' };
  if (/drive\.google\.com|docs\.google\.com/.test(u))
    return { label: '🔒 Google Drive', color: 'text-red-400 bg-red-500/10 border-red-500/30', supported: false, hint: 'No compatible — usa URLs directas en modo Manual' };
  if (/dropbox\.com\//.test(u)) {
    const clean = u.split('?')[0];
    const ext = clean.split('.').pop() ?? '';
    const videoExts = new Set(['mp4','mkv','avi','mov','webm','ts','flv','wmv','mpg','m4v','divx','3gp']);
    if (videoExts.has(ext))
      return { label: '📂 Dropbox (archivo)', color: 'text-green-400 bg-green-500/10 border-green-500/30', supported: true, hint: 'Se convierte automáticamente a enlace directo' };
    return { label: '📂 Dropbox (carpeta)', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', supported: false, hint: 'Solo funciona con archivos individuales de Dropbox' };
  }
  const videoExts = new Set(['mp4','mkv','avi','mov','webm','ts','flv','wmv','mpg','m4v','divx','3gp','ogv']);
  const ext = u.split('?')[0].split('.').pop() ?? '';
  if (videoExts.has(ext))
    return { label: '🎬 Video directo', color: 'text-green-400 bg-green-500/10 border-green-500/30', supported: true, hint: 'URL directa de video — compatible' };
  if (/^https?:\/\//.test(u))
    return { label: '🌐 HTTP / Carpeta', color: 'text-green-400 bg-green-500/10 border-green-500/30', supported: true, hint: 'Directorio HTTP — se leerán todos los archivos automáticamente' };
  return null;
}

function SmartLinkImport({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: (type: string) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmartAnalyzeResult | null>(null);
  const [importTitle, setImportTitle] = useState('');
  const [importType, setImportType] = useState<'movie' | 'series' | 'multi-series'>('movie');
  const [category, setCategory] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  // TMDB metadata state
  const [tmdbMeta, setTmdbMeta] = useState<{ poster?: string|null; banner?: string|null; year?: number|null; genre?: string|null; description?: string|null; title?: string|null } | null>(null);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [importPoster, setImportPoster] = useState('');
  const [importYear, setImportYear] = useState<string>('');
  const [importGenre, setImportGenre] = useState('');
  const [importDescription, setImportDescription] = useState('');
  // Manual mode state
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [manualType, setManualType] = useState<'movie' | 'series'>('movie');
  const [manualUrls, setManualUrls] = useState('');

  const fetchTmdbMeta = async (title: string, type: 'movie' | 'series' | 'multi-series') => {
    if (!title.trim()) return;
    const endpoint = type === 'movie' ? `/api/movies/search-poster?q=${encodeURIComponent(title)}` : `/api/series/poster-search?q=${encodeURIComponent(title)}`;
    setTmdbLoading(true);
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const d = await r.json();
        if (d.poster || d.description || d.year || d.genre) {
          setTmdbMeta(d);
          if (d.poster) setImportPoster(d.poster);
          if (d.year) setImportYear(String(d.year));
          if (d.genre) setImportGenre(d.genre);
          if (d.description) setImportDescription(d.description);
        } else {
          setTmdbMeta(null);
        }
      }
    } catch {}
    setTmdbLoading(false);
  };

  const reset = () => {
    setUrl(''); setResult(null); setError(null); setImportTitle(''); setCategory(''); setSelectedGroups(new Set());
    setTmdbMeta(null); setImportPoster(''); setImportYear(''); setImportGenre(''); setImportDescription('');
    setManualTitle(''); setManualCategory(''); setManualUrls(''); setManualType('movie');
  };

  const handleClose = () => { reset(); setMode('auto'); onClose(); };

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setAnalyzing(true); setError(null); setResult(null);
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/smart-import/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al analizar');
      setResult(data);
      setImportTitle(data.title || '');
      setImportType(data.type);
      if (data.seriesGroups) {
        setSelectedGroups(new Set(data.seriesGroups.map((_: SmartSeriesGroup, i: number) => i)));
      }
      // Auto-fetch TMDB metadata for single movie or series
      if (data.type !== 'multi-series' && data.title) {
        fetchTmdbMeta(data.title, data.type);
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo analizar el enlace');
    }
    setAnalyzing(false);
  };

  const handleImport = async () => {
    if (!result) return;
    setImporting(true);
    try {
      const token = getToken('admin');
      const body: Record<string, unknown> = {
        type: importType, title: importTitle || result.title,
        category: category || undefined,
        poster: importPoster || result.poster || undefined,
        year: importYear ? Number(importYear) : undefined,
        genre: importGenre || undefined,
        description: importDescription || undefined,
        items: result.items, seasons: result.seasons,
      };
      if (importType === 'multi-series' && result.seriesGroups) {
        body.seriesGroups = result.seriesGroups.filter((_: SmartSeriesGroup, i: number) => selectedGroups.has(i));
      }
      const r = await fetch(`${BASE_URL}/api/smart-import/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      const count = data.count || data.episodes || 1;
      const label = importType === 'movie' ? `${count} película(s)` : importType === 'multi-series' ? `${count} serie(s)` : `serie con ${data.episodes || 0} episodio(s)`;
      toast({ title: `Importado correctamente`, description: `Se importaron ${label}` });
      onImported(importType); handleClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al importar', description: err?.message || '' });
    }
    setImporting(false);
  };

  const handleManualImport = async () => {
    const lines = manualUrls.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (!lines.length) { toast({ variant: 'destructive', title: 'Sin URLs', description: 'Pega al menos una URL de video' }); return; }
    if (!manualTitle.trim()) { toast({ variant: 'destructive', title: 'Falta título', description: 'Escribe un título' }); return; }
    setImporting(true);
    try {
      const token = getToken('admin');
      const items = lines.map((u, i) => {
        const name = u.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[._\-]+/g, ' ').trim() || `Item ${i + 1}`;
        return manualType === 'series'
          ? { name, url: u, season: 1, episode: i + 1 }
          : { name, url: u };
      });
      const r = await fetch(`${BASE_URL}/api/smart-import/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: manualType, title: manualTitle.trim(), category: manualCategory || undefined, items }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      const label = manualType === 'movie' ? `${items.length} película(s)` : `serie con ${items.length} episodio(s)`;
      toast({ title: 'Importado correctamente', description: `Se importaron ${label}` });
      onImported(manualType); handleClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al importar', description: err?.message || '' });
    }
    setImporting(false);
  };

  const typeLabel = (t: string) => t === 'movie' ? '🎬 Películas' : t === 'series' ? '📺 Serie' : '📁 Múltiples Series';
  const typeBadgeClass = (t: string) => t === 'movie' ? 'bg-blue-500/20 text-blue-400' : t === 'series' ? 'bg-purple-500/20 text-purple-400' : 'bg-orange-500/20 text-orange-400';
  const manualUrlLines = manualUrls.split('\n').filter(l => l.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="bg-card border-border max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" /> Importar desde enlace
          </DialogTitle>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 flex-shrink-0">
          <button onClick={() => setMode('auto')}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${mode === 'auto' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            Automático
          </button>
          <button onClick={() => setMode('manual')}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${mode === 'manual' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            Manual (URLs directas)
          </button>
        </div>

        <div className="space-y-4 flex-1 overflow-y-auto pr-1">

          {/* ── AUTO MODE ── */}
          {mode === 'auto' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-1.5">
                <p className="text-xs font-medium text-foreground">Servicios compatibles:</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-green-500/10 border-green-500/30 text-green-400">✅ Terabox (carpeta)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-green-500/10 border-green-500/30 text-green-400">✅ Carpeta HTTP</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-green-500/10 border-green-500/30 text-green-400">✅ Video directo (.mp4 .mkv…)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-green-500/10 border-green-500/30 text-green-400">✅ Dropbox (archivo)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-red-500/10 border-red-500/30 text-red-400">❌ MEGA</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border bg-red-500/10 border-red-500/30 text-red-400">❌ Google Drive</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={e => { setUrl(e.target.value); setResult(null); setError(null); }}
                  placeholder="https://1024terabox.com/s/... o https://servidor.com/peliculas/ o URL directa .mp4"
                  className="bg-background flex-1 font-mono text-xs"
                  onKeyDown={e => e.key === 'Enter' && !analyzing && handleAnalyze()}
                />
                <Button onClick={handleAnalyze} disabled={analyzing || !url.trim() || !(detectUrlSource(url)?.supported ?? true)} className="flex-shrink-0">
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
                  {analyzing ? 'Leyendo...' : 'Analizar'}
                </Button>
              </div>

              {/* Real-time URL source detection badge */}
              {url.trim() && (() => {
                const src = detectUrlSource(url);
                if (!src) return null;
                return (
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${src.color}`}>
                    <span className="font-semibold">{src.label}</span>
                    {src.hint && <span className="opacity-70">— {src.hint}</span>}
                    {!src.supported && (
                      <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs px-2 py-0" onClick={() => { setMode('manual'); }}>
                        Ir a Manual →
                      </Button>
                    )}
                  </div>
                );
              })()}

              {error && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <p className="leading-snug whitespace-pre-line">{error}</p>
                  </div>
                  {/terabox|Terabox/i.test(error) && (
                    <div className="pt-1 border-t border-destructive/20">
                      <p className="text-xs text-muted-foreground mb-2">Configura las cookies de Terabox en Admin → Configuración, o pega las URLs manualmente:</p>
                      <Button size="sm" variant="outline" onClick={() => setMode('manual')} className="h-7 text-xs">
                        Cambiar a modo manual
                      </Button>
                    </div>
                  )}
                  {/manual/i.test(error) && !result && (
                    <div className="pt-1 border-t border-destructive/20">
                      <Button size="sm" variant="outline" onClick={() => setMode('manual')} className="h-7 text-xs">
                        Ir a modo Manual →
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${typeBadgeClass(result.type)}`}>{typeLabel(result.type)}</span>
                    <span className="text-xs text-muted-foreground">{result.totalFiles} archivo(s) · fuente: {result.source}</span>
                    <div className="flex gap-1 ml-auto">
                      {(['movie', 'series', 'multi-series'] as const).map(t => (
                        <button key={t} onClick={() => setImportType(t)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${importType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                          {t === 'movie' ? 'Película' : t === 'series' ? 'Serie' : 'Multi-serie'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {importType !== 'multi-series' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Título</label>
                        <Input value={importTitle} onChange={e => setImportTitle(e.target.value)} className="bg-background" placeholder="Título..." />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Categoría (opcional)</label>
                        <Input value={category} onChange={e => setCategory(e.target.value)} className="bg-background" placeholder="Acción, Drama..." />
                      </div>
                    </div>
                  )}

                  {importType === 'movie' && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-secondary/30 flex items-center gap-2">
                        <Film className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-medium">{result.items.length} película(s)</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-border">
                        {result.items.map((item, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2">
                            <div className="w-7 h-10 flex-shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
                              {item.poster ? <img src={item.poster} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} /> : <Film className="w-3.5 h-3.5 text-muted-foreground/40" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{item.name}</p>
                              {item.size && <p className="text-[10px] text-muted-foreground">{(item.size / 1024 / 1024 / 1024).toFixed(2)} GB</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importType === 'series' && result.seasons && Object.keys(result.seasons).length > 0 && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-secondary/30 flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-medium">{Object.keys(result.seasons).length} temporada(s) · {result.items.length} episodio(s)</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-border">
                        {Object.entries(result.seasons).map(([sNum, eps]) => (
                          <div key={sNum}>
                            <div className="px-3 py-1.5 bg-muted/30 flex items-center gap-2">
                              <ListVideo className="w-3 h-3 text-primary/70" />
                              <span className="text-xs font-semibold">Temporada {sNum}</span>
                              <span className="text-[10px] text-muted-foreground">{(eps as SmartItem[]).length} ep.</span>
                            </div>
                            {(eps as SmartItem[]).slice(0, 5).map((ep, ei) => (
                              <div key={ei} className="flex items-center gap-2 px-4 py-1.5">
                                <span className="text-[10px] text-muted-foreground w-5">E{ep.episode ?? (ei + 1)}</span>
                                <p className="text-xs truncate flex-1">{ep.name}</p>
                              </div>
                            ))}
                            {(eps as SmartItem[]).length > 5 && <p className="text-[10px] text-muted-foreground px-4 pb-1.5">...y {(eps as SmartItem[]).length - 5} más</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importType === 'series' && !result.seasons && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-secondary/30 flex items-center gap-2">
                        <ListVideo className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-medium">{result.items.length} episodio(s)</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-border">
                        {result.items.map((item, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-[10px] text-muted-foreground w-5">{i + 1}</span>
                            <p className="text-xs truncate flex-1">{item.name}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importType === 'multi-series' && result.seriesGroups && (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-secondary/30 flex items-center gap-2">
                        <Tv2 className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-medium">{result.seriesGroups.length} serie(s) detectada(s)</span>
                        <button className="ml-auto text-[10px] text-primary hover:underline" onClick={() => setSelectedGroups(new Set(result.seriesGroups!.map((_, i) => i)))}>Todas</button>
                        <button className="text-[10px] text-muted-foreground hover:underline" onClick={() => setSelectedGroups(new Set())}>Ninguna</button>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y divide-border">
                        {result.seriesGroups.map((group, gi) => (
                          <div key={gi} className={`flex items-center gap-3 px-3 py-2 transition-colors ${selectedGroups.has(gi) ? '' : 'opacity-40'}`}>
                            <input type="checkbox" className="accent-primary" checked={selectedGroups.has(gi)}
                              onChange={e => { const s = new Set(selectedGroups); e.target.checked ? s.add(gi) : s.delete(gi); setSelectedGroups(s); }} />
                            <div className="w-7 h-10 flex-shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
                              {group.poster ? <img src={group.poster} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} /> : <Tv2 className="w-3.5 h-3.5 text-muted-foreground/40" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{group.title}</p>
                              <p className="text-[10px] text-muted-foreground">{group.items.length} ep. · {Object.keys(group.seasons).length} temp.</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="px-3 py-2 bg-secondary/10">
                        <label className="text-xs text-muted-foreground block mb-1">Categoría para todas (opcional)</label>
                        <Input value={category} onChange={e => setCategory(e.target.value)} className="bg-background h-8 text-xs" placeholder="Drama, Acción..." />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── MANUAL MODE ── */}
          {mode === 'manual' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Pega las URLs directas de video, una por línea. Ideal para Terabox y otros servicios que requieren autenticación para escaneo automático.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Título *</label>
                  <Input value={manualTitle} onChange={e => setManualTitle(e.target.value)} className="bg-background" placeholder="Nombre de la película o serie..." />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Categoría (opcional)</label>
                  <Input value={manualCategory} onChange={e => setManualCategory(e.target.value)} className="bg-background" placeholder="Acción, Drama..." />
                </div>
              </div>

              <div className="flex gap-1 text-xs">
                <button onClick={() => setManualType('movie')}
                  className={`px-3 py-1.5 rounded border transition-colors ${manualType === 'movie' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                  🎬 Película(s)
                </button>
                <button onClick={() => setManualType('series')}
                  className={`px-3 py-1.5 rounded border transition-colors ${manualType === 'series' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                  📺 Serie (episodios)
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>URLs de video — una por línea</span>
                  {manualUrlLines.length > 0 && <span className="text-primary font-medium">{manualUrlLines.length} URL(s)</span>}
                </label>
                <textarea
                  value={manualUrls}
                  onChange={e => setManualUrls(e.target.value)}
                  rows={8}
                  placeholder={"https://ejemplo.com/video1.mp4\nhttps://ejemplo.com/video2.mp4\nhttps://..."}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y min-h-[140px] focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
              </div>

              {manualUrlLines.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-secondary/30 flex items-center gap-2">
                    {manualType === 'movie' ? <Film className="w-3.5 h-3.5 text-primary" /> : <ListVideo className="w-3.5 h-3.5 text-primary" />}
                    <span className="text-xs font-medium">
                      {manualType === 'movie' ? `${manualUrlLines.length} película(s)` : `${manualUrlLines.length} episodio(s) → Temporada 1`}
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-border">
                    {manualUrlLines.slice(0, 20).map((u, i) => {
                      const name = u.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[._\-]+/g, ' ').trim() || u;
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                          {manualType === 'series' && <span className="text-[10px] text-muted-foreground w-6 flex-shrink-0">E{i + 1}</span>}
                          <p className="text-xs truncate flex-1 text-muted-foreground" title={u}>{name}</p>
                        </div>
                      );
                    })}
                    {manualUrlLines.length > 20 && <p className="text-[10px] text-muted-foreground px-3 py-1.5">...y {manualUrlLines.length - 20} más</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 mt-4 flex-shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={importing}>Cancelar</Button>
          {mode === 'auto' && result && (
            <Button onClick={handleImport} disabled={importing || (importType === 'multi-series' && selectedGroups.size === 0)}>
              {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando...</> : <><Download className="w-4 h-4 mr-2" />Importar</>}
            </Button>
          )}
          {mode === 'manual' && (
            <Button onClick={handleManualImport} disabled={importing || !manualTitle.trim() || manualUrlLines.length === 0}>
              {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando...</> : <><Download className="w-4 h-4 mr-2" />Importar {manualUrlLines.length > 0 ? `(${manualUrlLines.length})` : ''}</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extractYtVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?]+)/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function MoviesManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: movies, isLoading, isError: moviesError } = useListMovies(undefined, { query: { queryKey: getListMoviesQueryKey(), staleTime: 0, refetchOnMount: 'always' as const } });
  const createMutation = useCreateMovie();
  const updateMutation = useUpdateMovie();
  const deleteMutation = useDeleteMovie();

  const [showForm, setShowForm] = useState(false);
  const [selectedMovieIds, setSelectedMovieIds] = useState<Set<number>>(new Set());
  const [newMv, setNewMv] = useState({ title: '', filePath: '', videoFormat: '', category: '', description: '', poster: '' });
  const [editMv, setEditMv] = useState<{ id: number; title: string; filePath: string; videoFormat: string; category: string; description: string; poster: string } | null>(null);
  const [detectingFormat, setDetectingFormat] = useState(false);

  const autoDetectFormat = async (url: string, target: 'new' | 'edit') => {
    if (!url) return;
    setDetectingFormat(true);
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/detect-format`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url }),
      });
      if (r.ok) {
        const { format } = await r.json();
        if (target === 'new') setNewMv(p => ({ ...p, videoFormat: format }));
        else setEditMv(p => p ? { ...p, videoFormat: format } : p);
      }
    } catch { /* ignore */ } finally {
      setDetectingFormat(false);
    }
  };
  const [sortMode, setSortMode] = useState(false);
  const [sortedIds, setSortedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [showFolderPreview, setShowFolderPreview] = useState(false);
  const [detectedMovies, setDetectedMovies] = useState<DetectedMovie[]>([]);
  const [importing, setImporting] = useState(false);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);

  const [movieSearch, setMovieSearch] = useState('');
  const [showUrlChecker, setShowUrlChecker] = useState(false);
  const [urlCheckItems, setUrlCheckItems] = useState<Array<{ id: number; title: string; url: string; status: 'pending' | 'ok' | 'broken' | 'checking' }>>([]);
  const [urlChecking, setUrlChecking] = useState(false);
  const [urlCheckSel, setUrlCheckSel] = useState<Set<number>>(new Set());
  const urlCheckStopRef = useRef(false);

  // Archive.org browser state
  const [showArchive, setShowArchive] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveResults, setArchiveResults] = useState<{ identifier: string; title: string; description?: string; year?: string | number; creator?: string; subject?: string }[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [archivePage, setArchivePage] = useState(1);
  const [archiveCategory, setArchiveCategory] = useState('');
  const [archiveLang, setArchiveLang] = useState('');
  const [archiveImporting, setArchiveImporting] = useState<Set<string>>(new Set());
  const [archiveImported, setArchiveImported] = useState<Set<string>>(new Set());

  // YouTube browser state
  const [showYoutube, setShowYoutube] = useState(false);
  const [youtubeQuery, setYoutubeQuery] = useState('');
  const [youtubeResults, setYoutubeResults] = useState<{ videoId: string; title: string; description?: string; year?: string; thumbnail: string; channel: string; duration?: string; url: string }[]>([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState('');
  const [youtubeNextToken, setYoutubeNextToken] = useState('');
  const [youtubePrevTokens, setYoutubePrevTokens] = useState<string[]>([]);
  const [youtubePage, setYoutubePage] = useState(1);
  const [youtubeCategory, setYoutubeCategory] = useState('');
  const [youtubeLang, setYoutubeLang] = useState('');
  const [youtubeType, setYoutubeType] = useState('movie');
  const [youtubeImporting, setYoutubeImporting] = useState<Set<string>>(new Set());
  const [youtubeImported, setYoutubeImported] = useState<Set<string>>(new Set());
  const [youtubeNeedsKey, setYoutubeNeedsKey] = useState(false);

  // YouTube URL import (single video → movie)
  const [showYtUrl, setShowYtUrl] = useState(false);
  const [ytUrlInput, setYtUrlInput] = useState('');
  const [ytUrlLoading, setYtUrlLoading] = useState(false);
  const [ytUrlError, setYtUrlError] = useState('');
  const [ytUrlPreview, setYtUrlPreview] = useState<{ videoId: string; title: string | null; thumbnail: string; thumbnailHQ: string; channel: string | null; description: string | null; year: string | null; url: string; embeddingDisabled?: boolean; notFound?: boolean } | null>(null);
  const [ytUrlCategory, setYtUrlCategory] = useState('');
  const [ytUrlImporting, setYtUrlImporting] = useState(false);
  const [ytUrlImported, setYtUrlImported] = useState(false);
  // YouTube Bulk URL Import
  const [showYtBulkImport, setShowYtBulkImport] = useState(false);
  const [ytBulkText, setYtBulkText] = useState('');
  const [ytBulkCategory, setYtBulkCategory] = useState('');
  const [ytBulkDetected, setYtBulkDetected] = useState<Array<{ url: string; videoId: string; title: string; thumbnail: string; status: 'pending' | 'ok' | 'error' }>>([]);
  const [ytBulkDetecting, setYtBulkDetecting] = useState(false);
  const [ytBulkImportingAll, setYtBulkImportingAll] = useState(false);
  const [ytBulkResults, setYtBulkResults] = useState<{ ok: number; fail: number } | null>(null);

  const fetchYtUrlInfo = async (url: string) => {
    if (!url.trim()) return;
    setYtUrlLoading(true); setYtUrlError(''); setYtUrlPreview(null); setYtUrlImported(false);
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/youtube/video-info?url=${encodeURIComponent(url.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al obtener info del video');
      setYtUrlPreview(data);
    } catch (e: any) { setYtUrlError(e.message); }
    finally { setYtUrlLoading(false); }
  };

  const importYtUrl = async () => {
    if (!ytUrlPreview) return;
    setYtUrlImporting(true);
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/youtube/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          videoId: ytUrlPreview.videoId,
          title: ytUrlPreview.title,
          description: ytUrlPreview.description,
          year: ytUrlPreview.year,
          thumbnail: ytUrlPreview.thumbnailHQ || ytUrlPreview.thumbnail,
          category: ytUrlCategory || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      setYtUrlImported(true);
      setYtUrlPreview(null); setYtUrlInput(''); setYtUrlCategory('');
    } catch (e: any) { setYtUrlError(e.message); }
    finally { setYtUrlImporting(false); }
  };


  const handleYtBulkDetect = async () => {
    const urls = ytBulkText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (!urls.length) { toast({ variant: 'destructive', title: 'Pega al menos una URL de YouTube' }); return; }
    setYtBulkDetecting(true);
    setYtBulkResults(null);
    const detected: Array<{ url: string; videoId: string; title: string; thumbnail: string; status: 'pending' | 'ok' | 'error' }> = [];
    for (const url of urls) {
      const videoId = extractYtVideoId(url);
      if (!videoId) { detected.push({ url, videoId: '', title: url, thumbnail: '', status: 'error' }); continue; }
      try {
        const token = getToken('admin');
        const r = await fetch(`${BASE_URL}/api/youtube/video-info?url=${encodeURIComponent(url)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const d = await r.json();
          detected.push({ url, videoId: d.videoId || videoId, title: d.title || url, thumbnail: d.thumbnailHQ || d.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, status: 'ok' });
        } else {
          detected.push({ url, videoId, title: `Video ${videoId}`, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, status: 'ok' });
        }
      } catch {
        detected.push({ url, videoId, title: `Video ${videoId}`, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, status: 'ok' });
      }
    }
    setYtBulkDetected(detected);
    setYtBulkDetecting(false);
  };

  const handleYtBulkImportAll = async () => {
    const toImport = ytBulkDetected.filter(d => d.status === 'ok' && d.videoId);
    if (!toImport.length) { toast({ variant: 'destructive', title: 'No hay videos válidos para importar' }); return; }
    setYtBulkImportingAll(true);
    let ok = 0; let fail = 0;
    for (const item of toImport) {
      try {
        const token = getToken('admin');
        const r = await fetch(`${BASE_URL}/api/youtube/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ videoId: item.videoId, title: item.title, thumbnail: item.thumbnail, category: ytBulkCategory || undefined }),
        });
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
    }
    qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
    setYtBulkResults({ ok, fail });
    setYtBulkImportingAll(false);
    if (fail === 0) toast({ title: `${ok} película(s) importada(s) exitosamente` });
    else toast({ variant: 'destructive', title: `${ok} importadas, ${fail} fallaron` });
  };

    const archiveSearch = async (page = 1) => {
    if (!archiveQuery.trim()) return;
    setArchiveLoading(true);
    setArchiveError('');
    try {
      const token = getToken('admin');
      const langParam = archiveLang ? `&lang=${encodeURIComponent(archiveLang)}` : '';
      const r = await fetch(`${BASE_URL}/api/archive/search?q=${encodeURIComponent(archiveQuery)}&page=${page}&rows=20${langParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error buscando en Archive.org');
      setArchiveResults(data.items || []);
      setArchivePage(page);
    } catch (e: any) {
      setArchiveError(e.message);
    } finally {
      setArchiveLoading(false);
    }
  };

  const youtubeSearch = async () => {
    if (!youtubeQuery.trim()) return;
    setYoutubeLoading(true);
    setYoutubeError('');
    setYoutubeNeedsKey(false);
    try {
      const token = getToken('admin');
      const typeParam = youtubeType ? `&type=${encodeURIComponent(youtubeType)}` : '';
      const r = await fetch(`${BASE_URL}/api/admin/youtube-search?q=${encodeURIComponent(youtubeQuery)}${typeParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error buscando en YouTube');
      setYoutubeResults(data.items || []);
      setYoutubeNextToken('');
    } catch (e: any) {
      setYoutubeError(e.message);
    } finally {
      setYoutubeLoading(false);
    }
  };

  const youtubeImport = async (item: { videoId: string; title: string; description?: string; year?: string; thumbnail: string }) => {
    setYoutubeImporting(prev => new Set(prev).add(item.videoId));
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/youtube/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...item, category: youtubeCategory || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error importando');
      setYoutubeImported(prev => new Set(prev).add(item.videoId));
      qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      toast({ title: `"${item.title}" importada de YouTube` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al importar', description: e.message });
    } finally {
      setYoutubeImporting(prev => { const s = new Set(prev); s.delete(item.videoId); return s; });
    }
  };

  const archiveImport = async (item: { identifier: string; title: string; description?: string; year?: string | number }) => {
    setArchiveImporting(prev => new Set(prev).add(item.identifier));
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/archive/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...item, category: archiveCategory || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error importando');
      setArchiveImported(prev => new Set(prev).add(item.identifier));
      qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      toast({ title: `"${item.title}" importada exitosamente` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al importar', description: e.message });
    } finally {
      setArchiveImporting(prev => { const s = new Set(prev); s.delete(item.identifier); return s; });
    }
  };

  // Dropbox browser state
  const [showDropbox, setShowDropbox] = useState(false);
  const [dbxPath, setDbxPath] = useState('');
  const [dbxHistory, setDbxHistory] = useState<string[]>([]);
  const [dbxFolders, setDbxFolders] = useState<{ name: string; path: string }[]>([]);
  const [dbxFiles, setDbxFiles] = useState<{ name: string; path: string; size: number }[]>([]);
  const [dbxLoading, setDbxLoading] = useState(false);
  const [dbxError, setDbxError] = useState('');
  const [dbxSelected, setDbxSelected] = useState<Set<string>>(new Set());
  const [dbxImporting, setDbxImporting] = useState(false);
  const [dbxCategory, setDbxCategory] = useState('');

  const dbxBrowse = async (path: string) => {
    setDbxLoading(true);
    setDbxError('');
    setDbxSelected(new Set());
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/dropbox/browse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al conectar con Dropbox');
      setDbxFolders(data.folders || []);
      setDbxFiles((data.files || []).filter((f: any) => f.isVideo));
      setDbxPath(path);
    } catch (e: any) {
      setDbxError(e.message);
    } finally {
      setDbxLoading(false);
    }
  };

  const dbxOpen = () => {
    setShowDropbox(true);
    setDbxHistory([]);
    setDbxPath('');
    setDbxFolders([]);
    setDbxFiles([]);
    setDbxError('');
    setDbxSelected(new Set());
    dbxBrowse('');
  };

  const dbxNavigate = (path: string) => {
    setDbxHistory(h => [...h, dbxPath]);
    dbxBrowse(path);
  };

  const dbxBack = () => {
    const prev = dbxHistory[dbxHistory.length - 1] ?? '';
    setDbxHistory(h => h.slice(0, -1));
    dbxBrowse(prev);
  };

  const dbxToggle = (path: string) => {
    setDbxSelected(s => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  };

  const dbxSelectAll = () => {
    if (dbxSelected.size === dbxFiles.length) setDbxSelected(new Set());
    else setDbxSelected(new Set(dbxFiles.map(f => f.path)));
  };

  const dbxImport = async () => {
    const items = dbxFiles.filter(f => dbxSelected.has(f.path)).map(f => ({ name: f.name, path: f.path }));
    if (!items.length) { toast({ variant: 'destructive', title: 'Selecciona al menos un archivo' }); return; }
    setDbxImporting(true);
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/dropbox/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ importType: 'movies', items, category: dbxCategory || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      setShowDropbox(false);
      toast({ title: `${data.count} película(s) importada(s) desde Dropbox` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setDbxImporting(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const moviesList = movies || [];

  const toggleSortMode = () => {
    if (!sortMode) setSortedIds(moviesList.map(m => m.id));
    setSortMode(p => !p);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedIds.indexOf(active.id as number);
    const newIndex = sortedIds.indexOf(over.id as number);
    const newOrder = arrayMove(sortedIds, oldIndex, newIndex);
    setSortedIds(newOrder);
    setSaving(true);
    try {
      const token = getToken('admin');
      await fetch(`${BASE_URL}/api/movies/reorder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: newOrder }),
      });
      qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
    } catch {
      toast({ variant: 'destructive', title: 'Error al guardar orden' });
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = () => {
    if (!newMv.title || !newMv.filePath) { toast({ variant: 'destructive', title: 'Título y URL son requeridos' }); return; }
    createMutation.mutate({ data: { title: newMv.title, filePath: newMv.filePath, videoFormat: newMv.videoFormat || undefined, category: newMv.category || undefined, description: newMv.description || undefined, poster: newMv.poster || undefined } as any }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
        toast({ title: 'Película creada' });
        setNewMv({ title: '', filePath: '', videoFormat: '', category: '', description: '', poster: '' }); setShowForm(false);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al crear película' })
    });
  };

  const handleUpdate = () => {
    if (!editMv || !editMv.title || !editMv.filePath) { toast({ variant: 'destructive', title: 'Título y URL son requeridos' }); return; }
    updateMutation.mutate({ id: editMv.id, data: { title: editMv.title, filePath: editMv.filePath, videoFormat: editMv.videoFormat || undefined, category: editMv.category || undefined, description: editMv.description || undefined, poster: editMv.poster || undefined } as any }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
        toast({ title: 'Película actualizada' });
        setEditMv(null);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al actualizar película' })
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm('¿Eliminar esta película?')) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListMoviesQueryKey() }); toast({ title: 'Película eliminada' }); }
    });
  };

  const handleBulkDelete = async () => {
    if (selectedMovieIds.size === 0) return;
    if (!confirm(`¿Eliminar ${selectedMovieIds.size} película(s) seleccionada(s)? Esta acción no se puede deshacer.`)) return;
    let deleted = 0;
    for (const id of Array.from(selectedMovieIds)) {
      try { await deleteMutation.mutateAsync({ id }); deleted++; } catch { /* ignore */ }
    }
    qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
    setSelectedMovieIds(new Set());
    toast({ title: `${deleted} película(s) eliminada(s)` });
  };

  const updateDetected = (id: string, patch: Partial<DetectedMovie>) =>
    setDetectedMovies(prev => prev.map(m => m._id === id ? { ...m, ...patch } : m));

  const fetchPoster = async (id: string, title: string) => {
    updateDetected(id, { searching: true });
    try {
      const token = getToken('admin');
      const r = await fetch(`${BASE_URL}/api/movies/search-poster?q=${encodeURIComponent(title)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      updateDetected(id, {
        searching: false,
        poster: data.poster || '',
        title: data.title || title,
      });
    } catch {
      updateDetected(id, { searching: false });
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';

    const detected: DetectedMovie[] = [];
    const nfoMap: Record<string, { title?: string; poster?: string; filePath?: string }> = {};

    const nfoFiles = files.filter(f => f.name.toLowerCase().endsWith('.nfo'));
    await Promise.all(nfoFiles.map(async f => {
      const content = await f.text();
      const baseName = f.name.replace(/\.nfo$/i, '').toLowerCase();
      nfoMap[baseName] = parseNfo(content);
    }));

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const baseName = file.name.replace(/\.[^.]+$/, '').toLowerCase();
      const id = `${Date.now()}-${Math.random()}`;

      if (ext === 'nfo') continue;

      if (ext === 'm3u' || ext === 'm3u8') {
        const content = await file.text();
        const entries = parseM3UMovies(content);
        for (const e of entries) {
          detected.push({ _id: `${id}-${detected.length}`, title: e.title, filePath: e.filePath, poster: e.poster || '', selected: true, searching: false });
        }
        continue;
      }

      if (ext === 'strm' || ext === 'txt') {
        const content = await file.text();
        const parsed = parseStrmOrTxt(content, file.name);
        if (parsed.filePath) {
          const nfo = nfoMap[baseName] || {};
          detected.push({ _id: id, title: nfo.title || parsed.title, filePath: nfo.filePath || parsed.filePath, poster: nfo.poster || '', selected: true, searching: false });
        }
        continue;
      }

      if (VIDEO_EXTENSIONS.has(ext)) {
        const nfo = nfoMap[baseName] || {};
        if (nfo.filePath) {
          detected.push({ _id: id, title: nfo.title || cleanMovieName(file.name), filePath: nfo.filePath, poster: nfo.poster || '', selected: true, searching: false });
        } else {
          detected.push({ _id: id, title: nfo.title || cleanMovieName(file.name), filePath: '', poster: nfo.poster || '', selected: true, searching: false, file, uploadStatus: 'pending', uploadProgress: 0 });
        }
        continue;
      }
    }

    if (!detected.length) {
      toast({ variant: 'destructive', title: 'No se encontraron películas en la carpeta' });
      return;
    }

    setDetectedMovies(detected);
    setShowFolderPreview(true);
  };

  const uploadVideoFile = async (id: string, file: File): Promise<string | null> => {
    updateDetected(id, { uploadStatus: 'uploading', uploadProgress: 5 });
    const token = getToken('admin');
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 95);
          updateDetected(id, { uploadProgress: pct });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            updateDetected(id, { uploadStatus: 'done', uploadProgress: 100, filePath: data.filePath });
            resolve(data.filePath);
          } catch {
            updateDetected(id, { uploadStatus: 'error', uploadProgress: 0 });
            resolve(null);
          }
        } else {
          console.error('Upload failed:', xhr.status, xhr.responseText);
          updateDetected(id, { uploadStatus: 'error', uploadProgress: 0 });
          resolve(null);
        }
      });

      xhr.addEventListener('error', () => {
        updateDetected(id, { uploadStatus: 'error', uploadProgress: 0 });
        resolve(null);
      });

      xhr.open('POST', `${BASE_URL}/api/videos/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  };

  const handleBulkCreate = async () => {
    const toCreate = detectedMovies.filter(m => m.selected && m.title);
    if (!toCreate.length) { toast({ variant: 'destructive', title: 'Selecciona al menos una película' }); return; }
    setImporting(true);
    let ok = 0;

    for (const m of toCreate) {
      let filePath = m.filePath;
      if (m.file && (m.uploadStatus === 'pending' || m.uploadStatus === 'error')) {
        filePath = (await uploadVideoFile(m._id, m.file)) || '';
      }
      if (!filePath) continue;

      await new Promise<void>(resolve => {
        createMutation.mutate({ data: { title: m.title, filePath, poster: m.poster || undefined, category: undefined, description: undefined } }, {
          onSuccess: () => { ok++; resolve(); },
          onSettled: () => resolve(),
        });
      });
    }

    qc.invalidateQueries({ queryKey: getListMoviesQueryKey() });
    setImporting(false);
    setShowFolderPreview(false);
    setDetectedMovies([]);
    toast({ title: `${ok} película(s) importada(s)` });
  };

  const checkMovieUrls = async () => {
    const items = moviesList.map(m => ({ id: m.id, title: m.title, url: m.filePath, status: 'pending' as const }));
    setUrlCheckItems(items);
    setUrlChecking(true);
    setUrlCheckSel(new Set());
    urlCheckStopRef.current = false;
    const token = getToken('admin');
    for (let i = 0; i < items.length; i++) {
      if (urlCheckStopRef.current) break;
      setUrlCheckItems(prev => prev.map((r, j) => j === i ? { ...r, status: 'checking' } : r));
      try {
        const r = await fetch(`${BASE_URL}/api/check-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ url: items[i].url }),
          signal: AbortSignal.timeout(12000),
        });
        const d = await r.json();
        setUrlCheckItems(prev => prev.map((r2, j) => j === i ? { ...r2, status: d.ok ? 'ok' : 'broken' } : r2));
      } catch {
        setUrlCheckItems(prev => prev.map((r2, j) => j === i ? { ...r2, status: 'broken' } : r2));
      }
    }
    setUrlChecking(false);
  };

  const deleteCheckedMovies = async () => {
    if (!confirm(`¿Eliminar ${urlCheckSel.size} película(s) seleccionada(s)?`)) return;
    const ids = [...urlCheckSel];
    for (const id of ids) {
      try { await deleteMutation.mutateAsync({ params: { id } }); } catch { /* ignore */ }
    }
    setUrlCheckSel(new Set());
    setUrlCheckItems(prev => prev.filter(r => !ids.includes(r.id)));
    toast({ title: `${ids.length} película(s) eliminada(s)` });
  };

  if (isLoading) return <div className="text-muted-foreground">Cargando...</div>;

  const displayMovies = (sortMode
    ? sortedIds.map(id => moviesList.find(m => m.id === id)).filter(Boolean) as typeof moviesList
    : moviesList
  ).filter(m => !movieSearch || m.title.toLowerCase().includes(movieSearch.toLowerCase()) || (m.category || '').toLowerCase().includes(movieSearch.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-lg font-medium">Gestión de Películas</h3>
        <div className="flex gap-2 flex-wrap">
          {!sortMode && <>
            <Button size="sm" variant="outline" onClick={() => setShowSmartImport(true)}>
              <Link2 className="w-4 h-4 mr-2" />Importar enlace
            </Button>
            <Button size="sm" variant="outline" onClick={() => folderRef.current?.click()}>
              <FolderOpen className="w-4 h-4 mr-2" />Subir Carpeta
            </Button>
            <input ref={folderRef} type="file" className="hidden" multiple onChange={handleFolderUpload}
              {...({ webkitdirectory: '', directory: '' } as any)} />
            <Button size="sm" variant="outline" onClick={dbxOpen}>
              <Download className="w-4 h-4 mr-2" />Dropbox
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowArchive(true); setArchiveResults([]); setArchiveQuery(''); setArchiveImported(new Set()); setArchiveError(''); }}>
              <Globe className="w-4 h-4 mr-2" />Archive.org
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowYoutube(true); setYoutubeResults([]); setYoutubeQuery(''); setYoutubeImported(new Set()); setYoutubeError(''); setYoutubeNextToken(''); setYoutubePrevTokens([]); setYoutubePage(1); }}>
              <Youtube className="w-4 h-4 mr-2" />YouTube
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowYtUrl(true); setYtUrlInput(''); setYtUrlPreview(null); setYtUrlError(''); setYtUrlImported(false); }}>
              <Link2 className="w-4 h-4 mr-2" />URL YouTube
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowYtBulkImport(true); setYtBulkText(''); setYtBulkDetected([]); setYtBulkResults(null); setYtBulkCategory(''); }}>
              <Youtube className="w-4 h-4 mr-2 text-red-500" />Lista URLs YouTube
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowUrlChecker(p => !p); if (!showUrlChecker) { setUrlCheckItems([]); setUrlCheckSel(new Set()); } }}>
              <AlertTriangle className="w-4 h-4 mr-2" />Verificar URLs
            </Button>
            {selectedMovieIds.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={deleteMutation.isPending}>
                <Trash2 className="w-4 h-4 mr-2" />Eliminar {selectedMovieIds.size} seleccionada(s)
              </Button>
            )}
            <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" />Nueva Película</Button>
          </>}
          {moviesList.length > 1 && (
            <Button size="sm" variant={sortMode ? 'default' : 'outline'} onClick={toggleSortMode}>
              <ArrowUpDown className="w-4 h-4 mr-2" />{sortMode ? 'Listo' : 'Reordenar'}
              {saving && <Loader2 className="w-3 h-3 ml-2 animate-spin" />}
            </Button>
          )}
        </div>
      </div>

      {!sortMode && (
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={movieSearch} onChange={e => setMovieSearch(e.target.value)} placeholder="Buscar películas por título o categoría..." className="pl-8 bg-background" />
          </div>
          {movieSearch && <span className="text-xs text-muted-foreground">{displayMovies.length} resultado(s)</span>}
        </div>
      )}

      {showUrlChecker && (
        <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <p className="text-sm font-medium">Verificador de URLs</p>
              {urlCheckItems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {urlCheckItems.filter(r => r.status === 'ok').length} OK · {urlCheckItems.filter(r => r.status === 'broken').length} rotas · {urlCheckItems.filter(r => r.status === 'checking').length} verificando
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {urlCheckSel.size > 0 && (
                <Button size="sm" variant="destructive" onClick={deleteCheckedMovies}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Eliminar {urlCheckSel.size} seleccionada(s)
                </Button>
              )}
              {urlCheckItems.length > 0 && !urlChecking && (
                <Button size="sm" variant="outline" onClick={() => {
                  const brokenIds = new Set(urlCheckItems.filter(r => r.status === 'broken').map(r => r.id));
                  setUrlCheckSel(brokenIds);
                }}>
                  Seleccionar rotas ({urlCheckItems.filter(r => r.status === 'broken').length})
                </Button>
              )}
              {urlChecking ? (
                <Button size="sm" variant="outline" onClick={() => { urlCheckStopRef.current = true; setUrlChecking(false); }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Detener
                </Button>
              ) : (
                <Button size="sm" onClick={checkMovieUrls} disabled={moviesList.length === 0}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />Verificar {moviesList.length} URL(s)
                </Button>
              )}
            </div>
          </div>
          {urlCheckItems.length > 0 && (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {urlCheckItems.map(item => (
                <div key={item.id} className={`flex items-center gap-2 p-2 rounded-lg text-xs border transition-colors ${item.status === 'broken' ? 'border-destructive/40 bg-destructive/5' : item.status === 'ok' ? 'border-green-500/20 bg-green-500/5' : 'border-border bg-background/40'}`}>
                  <input type="checkbox" className="accent-primary w-3.5 h-3.5 cursor-pointer flex-shrink-0"
                    checked={urlCheckSel.has(item.id)}
                    onChange={() => setUrlCheckSel(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                  />
                  <span className="flex-shrink-0 w-14 font-semibold">
                    {item.status === 'checking' ? <span className="text-amber-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />...</span>
                      : item.status === 'ok' ? <span className="text-green-400">✓ OK</span>
                      : item.status === 'broken' ? <span className="text-destructive">✗ Rota</span>
                      : <span className="text-muted-foreground">–</span>}
                  </span>
                  <span className="truncate flex-1 font-medium">{item.title}</span>
                  <span className="truncate text-muted-foreground max-w-[200px] hidden sm:block">{item.url}</span>
                </div>
              ))}
            </div>
          )}
          {urlCheckItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Haz clic en "Verificar" para comprobar todas las URLs</p>
          )}
        </div>
      )}

      {sortMode && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <GripVertical className="w-3 h-3" />
          Arrastra las filas para cambiar el orden. Se guarda automáticamente.
        </p>
      )}

      {!sortMode && showForm && (
        <Card className="bg-background border-border p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Título *" value={newMv.title} onChange={e => setNewMv(p => ({ ...p, title: e.target.value }))} />
            <div className="flex gap-2 items-center">
              <Input placeholder="URL del archivo *" value={newMv.filePath} onChange={e => setNewMv(p => ({ ...p, filePath: e.target.value }))} onBlur={e => { if (e.target.value) autoDetectFormat(e.target.value, 'new'); }} />
              {newMv.videoFormat && <span className="shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">{newMv.videoFormat}</span>}
              {detectingFormat && <span className="shrink-0 text-[10px] text-muted-foreground animate-pulse">Detectando...</span>}
            </div>
            <Input placeholder="URL del poster" value={newMv.poster} onChange={e => setNewMv(p => ({ ...p, poster: e.target.value }))} />
            <Input placeholder="Categoría" value={newMv.category} onChange={e => setNewMv(p => ({ ...p, category: e.target.value }))} />
            <Input placeholder="Descripción" value={newMv.description} onChange={e => setNewMv(p => ({ ...p, description: e.target.value }))} />
            <div className="flex items-center gap-2 col-span-full">
              <label className="text-xs text-muted-foreground">Formato:</label>
              <select className="text-xs bg-background border border-border rounded px-2 py-1" value={newMv.videoFormat} onChange={e => setNewMv(p => ({ ...p, videoFormat: e.target.value }))}>
                <option value="">Auto-detectar</option>
                <option value="hls">HLS (.m3u8)</option>
                <option value="dash">DASH (.mpd)</option>
                <option value="native">Nativo (MP4, WebM…)</option>
                <option value="flv">FLV</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleCreate} disabled={createMutation.isPending}>{createMutation.isPending ? 'Creando...' : 'Crear'}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      <SmartLinkImport
        open={showSmartImport}
        onClose={() => setShowSmartImport(false)}
        onImported={() => qc.invalidateQueries({ queryKey: getListMoviesQueryKey() })}
      />

      {/* YouTube URL import dialog */}
      <Dialog open={showYtUrl} onOpenChange={o => !o && setShowYtUrl(false)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Youtube className="w-5 h-5 text-red-500" />
              Importar desde URL de YouTube
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={ytUrlInput}
                onChange={e => setYtUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchYtUrlInfo(ytUrlInput)}
                className="flex-1"
              />
              <Button onClick={() => fetchYtUrlInfo(ytUrlInput)} disabled={ytUrlLoading || !ytUrlInput.trim()} size="sm">
                {ytUrlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
              </Button>
            </div>

            {ytUrlError && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{ytUrlError}</p>
            )}

            {ytUrlImported && (
              <div className="text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2 flex items-center gap-2">
                <span>¡Película importada con éxito!</span>
                <button className="underline" onClick={() => { setYtUrlImported(false); setYtUrlInput(''); setYtUrlPreview(null); }}>Importar otra</button>
              </div>
            )}

            {ytUrlPreview && (
              <div className="space-y-3">
                {ytUrlPreview.notFound && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10">
                    <span className="text-red-400 text-base mt-0.5">✕</span>
                    <div>
                      <p className="text-sm font-semibold text-red-400">Video no encontrado</p>
                      <p className="text-xs text-red-400/80 leading-snug mt-0.5">Este video fue eliminado, es privado o la URL no es válida. No se mostrará a los clientes.</p>
                    </div>
                  </div>
                )}
                {ytUrlPreview.embeddingDisabled && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                    <span className="text-yellow-400 text-base mt-0.5">⚠</span>
                    <div>
                      <p className="text-sm font-semibold text-yellow-400">Video bloqueado para reproducción externa</p>
                      <p className="text-xs text-yellow-400/80 leading-snug mt-0.5">El autor no permite reproducir este video fuera de YouTube. Los clientes verán "Video no disponible" al intentar reproducirlo.</p>
                    </div>
                  </div>
                )}
                <div className="flex gap-3 p-3 rounded-lg border border-border bg-background">
                  <img
                    src={ytUrlPreview.thumbnail}
                    alt=""
                    className="w-28 h-16 object-cover rounded-md flex-shrink-0 bg-muted"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-semibold leading-snug line-clamp-2">{ytUrlPreview.title || ytUrlPreview.url}</p>
                    {ytUrlPreview.channel && (
                      <p className="text-xs text-muted-foreground">{ytUrlPreview.channel}{ytUrlPreview.year ? ` · ${ytUrlPreview.year}` : ''}</p>
                    )}
                    {ytUrlPreview.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{ytUrlPreview.description}</p>
                    )}
                  </div>
                </div>
                <Input
                  placeholder="Categoría (opcional)"
                  value={ytUrlCategory}
                  onChange={e => setYtUrlCategory(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={importYtUrl} disabled={ytUrlImporting || !!ytUrlPreview.notFound} className="flex-1" variant={ytUrlPreview.embeddingDisabled ? 'outline' : 'default'}>
                    {ytUrlImporting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando...</> : ytUrlPreview.embeddingDisabled ? 'Importar de todas formas' : 'Importar película'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowYtUrl(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {!ytUrlPreview && !ytUrlLoading && !ytUrlError && !ytUrlImported && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Pega un enlace de YouTube y pulsa Buscar para obtener la información automáticamente.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

        {/* YouTube Bulk URL Import Dialog */}
        <Dialog open={showYtBulkImport} onOpenChange={o => !o && setShowYtBulkImport(false)}>
          <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Youtube className="w-5 h-5 text-red-500" />
                Importar lista de URLs de YouTube
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Pega las URLs (una por línea)</label>
                <Textarea
                  placeholder={"https://youtube.com/watch?v=xxx\nhttps://youtu.be/yyy\nhttps://youtube.com/watch?v=zzz"}
                  value={ytBulkText}
                  onChange={e => setYtBulkText(e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {ytBulkText.split('\n').filter(l => l.trim()).length} URL(s) detectada(s)
                </p>
              </div>

              <Input
                placeholder="Categoría para todas (opcional)"
                value={ytBulkCategory}
                onChange={e => setYtBulkCategory(e.target.value)}
              />

              <Button
                onClick={handleYtBulkDetect}
                disabled={ytBulkDetecting || !ytBulkText.trim()}
                className="w-full"
              >
                {ytBulkDetecting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Detectando...</> : 'Detectar videos'}
              </Button>

              {ytBulkDetected.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {ytBulkDetected.filter(d => d.status === 'ok').length} válidos ·{' '}
                    {ytBulkDetected.filter(d => d.status === 'error').length} inválidos
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {ytBulkDetected.map((item, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center gap-3 p-2 rounded-lg border ${item.status === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-background'}`}
                      >
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt="" className="w-16 h-9 object-cover rounded flex-shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="w-16 h-9 bg-muted rounded flex-shrink-0 flex items-center justify-center">
                            <Youtube className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{item.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{item.url}</p>
                        </div>
                        {item.status === 'error' ? (
                          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ytBulkResults && (
                <div className={`text-sm p-3 rounded-lg border ${ytBulkResults.fail === 0 ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'}`}>
                  {ytBulkResults.ok} importada(s) · {ytBulkResults.fail} fallaron
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setShowYtBulkImport(false)}>Cerrar</Button>
              {ytBulkDetected.filter(d => d.status === 'ok').length > 0 && (
                <Button
                  onClick={handleYtBulkImportAll}
                  disabled={ytBulkImportingAll}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {ytBulkImportingAll
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando...</>
                    : `Importar ${ytBulkDetected.filter(d => d.status === 'ok').length} película(s)`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <Dialog open={showFolderPreview} onOpenChange={o => !o && setShowFolderPreview(false)}>
        <DialogContent className="bg-card border-border max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Películas detectadas ({detectedMovies.filter(m => m.selected).length} / {detectedMovies.length})</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Los archivos de video se subirán automáticamente al hacer clic en Importar. Edita el nombre o búsca el póster antes de importar.
          </p>
          {detectedMovies.some(m => m.file) && (
            <div className="flex items-center gap-2 text-xs bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
              <Upload className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="text-primary font-medium">
                {detectedMovies.filter(m => m.file && m.selected).length} archivo(s) de video se subirán al servidor al importar
              </span>
            </div>
          )}
          <div className="overflow-y-auto flex-1 space-y-3 pr-1 mt-2">
            {detectedMovies.map(mv => (
              <div key={mv._id} className={`flex gap-3 items-start p-3 rounded-lg border transition-colors ${mv.selected ? 'border-border bg-background' : 'border-border/30 bg-background/30 opacity-50'}`}>
                <input type="checkbox" className="mt-1 accent-primary" checked={mv.selected}
                  onChange={e => updateDetected(mv._id, { selected: e.target.checked })} />
                <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center">
                  {mv.poster
                    ? <img src={mv.poster} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    : <Film className="w-6 h-6 text-muted-foreground/40" />}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex gap-2 items-center">
                    <Input className="h-8 text-sm font-medium flex-1" value={mv.title}
                      onChange={e => updateDetected(mv._id, { title: e.target.value })} placeholder="Título *" />
                    <Button size="sm" variant="outline" className="h-8 text-xs flex-shrink-0"
                      disabled={mv.searching || !mv.title}
                      onClick={() => fetchPoster(mv._id, mv.title)}>
                      {mv.searching ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buscar'}
                    </Button>
                  </div>

                  {mv.file ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">{mv.file.name} ({(mv.file.size / 1024 / 1024).toFixed(1)} MB)</span>
                        {mv.uploadStatus === 'pending' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">Pendiente</span>}
                        {mv.uploadStatus === 'uploading' && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />Subiendo…
                          </span>
                        )}
                        {mv.uploadStatus === 'done' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600">✓ Subido</span>}
                        {mv.uploadStatus === 'error' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">✗ Error</span>}
                      </div>
                      {mv.uploadStatus === 'uploading' && (
                        <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${mv.uploadProgress || 0}%` }} />
                        </div>
                      )}
                      {mv.uploadStatus === 'done' && mv.filePath && (
                        <p className="text-[10px] font-mono text-muted-foreground truncate">{mv.filePath}</p>
                      )}
                    </div>
                  ) : (
                    <Input className="h-7 text-xs font-mono" value={mv.filePath}
                      onChange={e => updateDetected(mv._id, { filePath: e.target.value })} placeholder="URL del video *" />
                  )}

                  <Input className="h-7 text-xs" value={mv.poster}
                    onChange={e => updateDetected(mv._id, { poster: e.target.value })} placeholder="URL del póster (opcional)" />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 mt-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setDetectedMovies(p => p.map(m => ({ ...m, selected: true })))}>Seleccionar todos</Button>
            <Button variant="outline" size="sm"
              disabled={detectedMovies.filter(m => m.selected && !m.poster && !m.searching).length === 0}
              onClick={async () => {
                const pending = detectedMovies.filter(m => m.selected && !m.poster && m.title);
                for (const m of pending) await fetchPoster(m._id, m.title);
              }}>
              {detectedMovies.some(m => m.searching) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Buscar todos los pósters
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setShowFolderPreview(false)}>Cancelar</Button>
            <Button onClick={handleBulkCreate} disabled={importing || !detectedMovies.some(m => m.selected)}>
              {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importando...</> : `Importar ${detectedMovies.filter(m => m.selected).length} película(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dropbox browser dialog */}
      <Dialog open={showDropbox} onOpenChange={o => !o && setShowDropbox(false)}>
        <DialogContent className="max-w-2xl h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b border-border flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-4 h-4 text-blue-400" />
              Importar películas desde Dropbox
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 py-2 flex-shrink-0 border-b border-border flex items-center gap-2 text-sm">
            {dbxHistory.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={dbxBack}>
                <ChevronDown className="w-3 h-3 rotate-90 mr-1" />Atrás
              </Button>
            )}
            <span className="text-muted-foreground truncate flex-1 font-mono text-xs">{dbxPath || '/'}</span>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => dbxBrowse(dbxPath)} disabled={dbxLoading}>
              <RefreshCw className={`w-3 h-3 ${dbxLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-0">
            {dbxError && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{dbxError}</span>
              </div>
            )}
            {dbxLoading && <div className="text-center py-8 text-muted-foreground text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Cargando...</div>}
            {!dbxLoading && !dbxError && (
              <>
                {dbxFolders.map(f => (
                  <button key={f.path} onClick={() => dbxNavigate(f.path)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent text-left transition-colors">
                    <FolderOpen className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <span className="text-sm">{f.name}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                  </button>
                ))}
                {dbxFiles.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 py-1 px-1 border-t border-border mt-2 pt-2">
                      <span className="text-xs text-muted-foreground flex-1">{dbxFiles.length} archivo(s) de video</span>
                      <button onClick={dbxSelectAll} className="text-xs text-primary hover:underline">
                        {dbxSelected.size === dbxFiles.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                      </button>
                    </div>
                    {dbxFiles.map(f => (
                      <label key={f.path} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${dbxSelected.has(f.path) ? 'bg-primary/10 border border-primary/20' : 'hover:bg-accent'}`}>
                        <input type="checkbox" className="accent-primary" checked={dbxSelected.has(f.path)} onChange={() => dbxToggle(f.path)} />
                        <Film className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        <span className="text-sm flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-muted-foreground">{f.size ? `${(f.size / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}</span>
                      </label>
                    ))}
                  </>
                )}
                {dbxFolders.length === 0 && dbxFiles.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">Carpeta vacía</div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="px-4 py-3 border-t border-border flex-shrink-0 flex-wrap gap-2">
            <Input placeholder="Categoría (opcional)" value={dbxCategory} onChange={e => setDbxCategory(e.target.value)} className="w-40 h-8 text-sm" />
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setShowDropbox(false)}>Cancelar</Button>
            <Button size="sm" onClick={dbxImport} disabled={dbxImporting || dbxSelected.size === 0}>
              {dbxImporting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
              Importar {dbxSelected.size > 0 ? `${dbxSelected.size} película(s)` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive.org search dialog */}
      <Dialog open={showArchive} onOpenChange={o => !o && setShowArchive(false)}>
        <DialogContent className="max-w-3xl h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b border-border flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              Buscar en Archive.org
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Películas de dominio público — gratuitas y legales</p>
          </DialogHeader>

          <div className="px-4 py-3 flex-shrink-0 border-b border-border flex gap-2 flex-wrap">
            <Input
              placeholder="Chaplin, western, horror, 1940..."
              value={archiveQuery}
              onChange={e => setArchiveQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && archiveSearch(1)}
              className="flex-1 min-w-0"
            />
            <select
              value={archiveLang}
              onChange={e => setArchiveLang(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground w-32 flex-shrink-0"
            >
              <option value="">Todos los idiomas</option>
              <option value="spanish">Español</option>
              <option value="english">Inglés</option>
              <option value="french">Francés</option>
              <option value="portuguese">Portugués</option>
              <option value="italian">Italiano</option>
            </select>
            <Input
              placeholder="Categoría (opcional)"
              value={archiveCategory}
              onChange={e => setArchiveCategory(e.target.value)}
              className="w-32 flex-shrink-0"
            />
            <Button onClick={() => archiveSearch(1)} disabled={archiveLoading || !archiveQuery.trim()} className="flex-shrink-0">
              {archiveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {archiveError && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-start gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{archiveError}</span>
              </div>
            )}
            {archiveLoading && (
              <div className="text-center py-12 text-muted-foreground text-sm flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Buscando en Archive.org...</span>
              </div>
            )}
            {!archiveLoading && archiveResults.length === 0 && !archiveError && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Globe className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>Escribe cualquier frase y presiona Enter</p>
                <p className="text-xs mt-1 opacity-60">Ej: "películas de acción", "drama romántico", "El Zorro", "comedia 1980"</p>
                <p className="text-xs mt-1 opacity-40">Entiende español — traduce y busca automáticamente. Contenido adulto excluido.</p>
              </div>
            )}
            {!archiveLoading && archiveResults.length > 0 && (
              <div className="space-y-2">
                {archiveResults.map(item => (
                  <div key={item.identifier} className="flex gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors">
                    <img
                      src={`https://archive.org/services/img/${item.identifier}`}
                      alt=""
                      className="w-14 h-20 object-cover rounded flex-shrink-0 bg-muted"
                      onError={e => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).className = 'w-14 h-20 rounded flex-shrink-0 bg-muted flex items-center justify-center'; }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.year && <span className="mr-2">{item.year}</span>}
                            {item.creator && <span className="text-muted-foreground/70">{item.creator}</span>}
                          </p>
                        </div>
                        {archiveImported.has(item.identifier) ? (
                          <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded flex-shrink-0">✓ Importada</span>
                        ) : (
                          <Button
                            size="sm"
                            className="flex-shrink-0 h-7 text-xs"
                            disabled={archiveImporting.has(item.identifier)}
                            onClick={() => archiveImport(item)}
                          >
                            {archiveImporting.has(item.identifier) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                            Importar
                          </Button>
                        )}
                      </div>
                      {item.subject && (
                        <p className="text-xs text-primary/70 mt-1 truncate">{item.subject}</p>
                      )}
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                          {typeof item.description === 'string' ? item.description.replace(/<[^>]+>/g, '') : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" disabled={archivePage <= 1 || archiveLoading} onClick={() => archiveSearch(archivePage - 1)}>
                    ← Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground flex items-center px-2">Página {archivePage}</span>
                  <Button variant="outline" size="sm" disabled={archiveResults.length < 20 || archiveLoading} onClick={() => archiveSearch(archivePage + 1)}>
                    Siguiente →
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="px-4 py-3 border-t border-border flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowArchive(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* YouTube search dialog */}
      <Dialog open={showYoutube} onOpenChange={o => !o && setShowYoutube(false)}>
        <DialogContent className="max-w-2xl w-full h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b border-border flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Youtube className="w-4 h-4 text-red-500" />
              Buscar en YouTube
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Busca películas completas — se reproducen dentro de Super TV vía YouTube</p>
          </DialogHeader>

          <div className="px-4 py-3 flex-shrink-0 border-b border-border flex gap-2 flex-wrap">
            <Input
              placeholder="Título, género, año... ej: 'El Zorro', 'comedia mexicana 2010'"
              value={youtubeQuery}
              onChange={e => setYoutubeQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') youtubeSearch(); }}
              className="flex-1 min-w-0"
            />
            <select
              value={youtubeType}
              onChange={e => setYoutubeType(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground w-32 flex-shrink-0"
            >
              <option value="movie">Películas</option>
              <option value="series">Series</option>
            </select>
            <Input
              placeholder="Categoría (opcional)"
              value={youtubeCategory}
              onChange={e => setYoutubeCategory(e.target.value)}
              className="w-32 flex-shrink-0"
            />
            <Button onClick={() => youtubeSearch()} disabled={youtubeLoading || !youtubeQuery.trim()} className="flex-shrink-0">
              {youtubeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {youtubeError && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-start gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{youtubeError}</span>
              </div>
            )}
            {youtubeLoading && (
              <div className="text-center py-12 text-muted-foreground text-sm flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Buscando en YouTube...</span>
              </div>
            )}
            {!youtubeLoading && youtubeResults.length === 0 && !youtubeError && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Youtube className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>Escribe algo y presiona Enter para buscar</p>
                <p className="text-xs mt-1 opacity-60">Sin necesidad de API key — búsqueda directa en YouTube</p>
                <p className="text-xs mt-1 opacity-40">Los videos se reproducen dentro de Super TV usando el reproductor de YouTube</p>
              </div>
            )}
            {!youtubeLoading && youtubeResults.length > 0 && (() => {
              const JUNK_RE = /\b(tr[aá]iler|trailer|reseña|resumen|cr[ií]tica|review|top\s*\d+|ranking|explicado|escenas|escena|capitulo|cap[ií]tulo|episodio|temporada|clip|making\s*of|behind|entrevista|interview|analisis|an[aá]lisis|banda\s*sonora|soundtrack|ost\b|music\s*video|lyric|en\s*\d+\s*minutos?|anuncio|avance|promo\b|react\w*|vlog|shorts?\b|teaser|featurette|blooper|fan\s*made|fanmade|fan\s*film|parody|parodia|gameplay|speedrun)\b/i;
              const parseMins = (t: string) => { if (!t) return -1; const p = t.split(':').map(Number); if (p.some(isNaN)) return -1; return p.length === 3 ? p[0]*60+p[1]+p[2]/60 : p.length === 2 ? p[0]+p[1]/60 : -1; };
              const isMovie = (v: typeof youtubeResults[0]) => { if (JUNK_RE.test(v.title)) return false; const m = parseMins(v.duration ?? ''); return m === -1 || m >= 60; };
              const movies = youtubeResults.filter(isMovie);
              const others = youtubeResults.filter(v => !isMovie(v));
              const renderItem = (item: typeof youtubeResults[0]) => (
                <div key={item.videoId} className="flex gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors">
                  <div className="relative flex-shrink-0">
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="w-24 h-14 object-cover rounded bg-muted"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    {item.duration && (
                      <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-semibold px-1 py-0.5 rounded tabular-nums">{item.duration}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm leading-tight line-clamp-2">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[220px]">{item.channel}</p>
                      </div>
                      {youtubeImported.has(item.videoId) ? (
                        <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded flex-shrink-0">✓ Importada</span>
                      ) : (
                        <Button
                          size="sm"
                          className="flex-shrink-0 h-7 text-xs"
                          disabled={youtubeImporting.has(item.videoId)}
                          onClick={() => youtubeImport(item)}
                        >
                          {youtubeImporting.has(item.videoId) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                          Importar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
              return (
                <div className="space-y-2">
                  {movies.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-primary/80 uppercase tracking-wide px-1 pt-1">Películas completas ({movies.length})</p>
                      {movies.map(renderItem)}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wide px-1 pt-3 border-t border-border mt-3">Otros videos ({others.length})</p>
                      {others.map(renderItem)}
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          <DialogFooter className="px-4 py-3 border-t border-border flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowYoutube(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortMode ? sortedIds : moviesList.map(m => m.id)} strategy={verticalListSortingStrategy}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pr-0 pl-3">
                    <input type="checkbox" className="accent-primary w-4 h-4 cursor-pointer"
                      checked={displayMovies.length > 0 && displayMovies.every(m => selectedMovieIds.has(m.id))}
                      onChange={e => { if (e.target.checked) setSelectedMovieIds(new Set(displayMovies.map(m => m.id))); else setSelectedMovieIds(new Set()); }}
                    />
                  </TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Dominio</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayMovies.map(mv => (
                  <SortableMovieRow
                    key={mv.id}
                    mv={mv}
                    onEdit={() => setEditMv({ id: mv.id, title: mv.title, filePath: mv.filePath, videoFormat: (mv as any).videoFormat || '', category: mv.category || '', description: mv.description || '', poster: mv.poster || '' })}
                    onDelete={() => handleDelete(mv.id)}
                    selected={selectedMovieIds.has(mv.id)}
                    onToggleSelect={() => setSelectedMovieIds(prev => { const next = new Set(prev); if (next.has(mv.id)) next.delete(mv.id); else next.add(mv.id); return next; })}
                  />
                ))}
                {moviesList.length === 0 && (
                  moviesError
                    ? <TableRow><TableCell colSpan={7} className="text-center text-red-400 py-8">Error al cargar películas — recarga la página o vuelve a iniciar sesión.</TableCell></TableRow>
                    : <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sin películas aún</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SortableContext>
      </DndContext>

      <Dialog open={!!editMv} onOpenChange={(o) => !o && setEditMv(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle>Editar Película</DialogTitle></DialogHeader>
          {editMv && (
            <div className="space-y-3">
              <Input placeholder="Título *" value={editMv.title} onChange={e => setEditMv(p => p ? { ...p, title: e.target.value } : p)} />
              <div className="flex gap-2 items-center">
                <Input placeholder="URL del archivo *" value={editMv.filePath} onChange={e => setEditMv(p => p ? { ...p, filePath: e.target.value } : p)} onBlur={e => { if (e.target.value) autoDetectFormat(e.target.value, 'edit'); }} />
                {editMv.videoFormat && <span className="shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">{editMv.videoFormat}</span>}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Formato:</label>
                <select className="text-xs bg-background border border-border rounded px-2 py-1" value={editMv.videoFormat} onChange={e => setEditMv(p => p ? { ...p, videoFormat: e.target.value } : p)}>
                  <option value="">Auto-detectar</option>
                  <option value="hls">HLS (.m3u8)</option>
                  <option value="dash">DASH (.mpd)</option>
                  <option value="native">Nativo (MP4, WebM…)</option>
                  <option value="flv">FLV</option>
                </select>
              </div>
              <Input placeholder="URL del poster" value={editMv.poster} onChange={e => setEditMv(p => p ? { ...p, poster: e.target.value } : p)} />
              <Input placeholder="Categoría" value={editMv.category} onChange={e => setEditMv(p => p ? { ...p, category: e.target.value } : p)} />
              <Input placeholder="Descripción" value={editMv.description} onChange={e => setEditMv(p => p ? { ...p, description: e.target.value } : p)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditMv(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>{updateMutation.isPending ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SubadminPkgAssignment = { packageId: number; customPrice: string };

async function fetchSubadminPackages(subadminId: number): Promise<SubadminPkgAssignment[]> {
  const token = getToken('admin');
  const resp = await fetch(`${BASE_URL}/api/subadmins/${subadminId}/packages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.map((r: any) => ({
    packageId: r.packageId,
    customPrice: r.customPrice !== null ? String(r.customPrice) : '',
  }));
}

async function saveSubadminPackages(subadminId: number, assignments: SubadminPkgAssignment[]): Promise<void> {
  const token = getToken('admin');
  await fetch(`${BASE_URL}/api/subadmins/${subadminId}/assign-packages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packages: assignments.map(a => ({
        packageId: a.packageId,
        customPrice: a.customPrice !== '' ? parseFloat(a.customPrice) : null,
      })),
    }),
  });
}

function SubadminsManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: subadmins, isLoading } = useListSubadmins({ query: { queryKey: getListSubadminsQueryKey() } });
  const { data: allPackages } = useListPackages({ query: { queryKey: getListPackagesQueryKey() } });
  const createMutation = useCreateSubadmin();
  const updateMutation = useUpdateSubadmin();
  const deleteMutation = useDeleteSubadmin();
  const addBalanceMutation = useAddSubadminBalance();

  const [showForm, setShowForm] = useState(false);
  const [newSa, setNewSa] = useState({ username: '', password: '' });
  const [newSaPackages, setNewSaPackages] = useState<SubadminPkgAssignment[]>([]);
  const [balanceAmounts, setBalanceAmounts] = useState<Record<number, string>>({});

  type EditState = { id: number; username: string; password: string; packages: SubadminPkgAssignment[] };
  const [editSa, setEditSa] = useState<EditState | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const openEdit = async (sa: { id: number; username: string }) => {
    setEditLoading(true);
    const pkgs = await fetchSubadminPackages(sa.id);
    setEditSa({ id: sa.id, username: sa.username, password: '', packages: pkgs });
    setEditLoading(false);
  };

  const toggleNewSaPkg = (pkgId: number) => {
    setNewSaPackages(prev => {
      if (prev.find(p => p.packageId === pkgId)) return prev.filter(p => p.packageId !== pkgId);
      return [...prev, { packageId: pkgId, customPrice: '' }];
    });
  };

  const toggleEditSaPkg = (pkgId: number) => {
    if (!editSa) return;
    setEditSa(prev => {
      if (!prev) return prev;
      if (prev.packages.find(p => p.packageId === pkgId))
        return { ...prev, packages: prev.packages.filter(p => p.packageId !== pkgId) };
      return { ...prev, packages: [...prev.packages, { packageId: pkgId, customPrice: '' }] };
    });
  };

  const handleCreate = async () => {
    if (!newSa.username || !newSa.password) { toast({ variant: 'destructive', title: 'Completa usuario y contraseña' }); return; }
    createMutation.mutate({ data: newSa }, {
      onSuccess: async (created) => {
        if (newSaPackages.length > 0) {
          await saveSubadminPackages(created.id, newSaPackages);
        }
        qc.invalidateQueries({ queryKey: getListSubadminsQueryKey() });
        toast({ title: 'Subadmin creado' });
        setNewSa({ username: '', password: '' }); setNewSaPackages([]); setShowForm(false);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al crear subadmin' })
    });
  };

  const handleUpdate = async () => {
    if (!editSa || !editSa.username) { toast({ variant: 'destructive', title: 'El usuario es requerido' }); return; }
    const data: { username?: string; password?: string } = { username: editSa.username };
    if (editSa.password) data.password = editSa.password;
    updateMutation.mutate({ id: editSa.id, data }, {
      onSuccess: async () => {
        await saveSubadminPackages(editSa.id, editSa.packages);
        qc.invalidateQueries({ queryKey: getListSubadminsQueryKey() });
        toast({ title: 'Subadmin actualizado' });
        setEditSa(null);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al actualizar subadmin' })
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm('¿Eliminar este subadmin?')) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListSubadminsQueryKey() }); toast({ title: 'Subadmin eliminado' }); }
    });
  };

  const handleAddBalance = (id: number) => {
    const amount = parseFloat(balanceAmounts[id] || '0');
    if (!amount) return;
    addBalanceMutation.mutate({ id, data: { amount } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSubadminsQueryKey() });
        toast({ title: `Saldo agregado: $${amount}` });
        setBalanceAmounts(p => ({ ...p, [id]: '' }));
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al agregar saldo' })
    });
  };

  const pkgs = allPackages || [];

  if (isLoading) return <div className="text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Gestión de Subadmins</h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" />Nuevo Subadmin</Button>
      </div>

      {showForm && (
        <Card className="bg-background border-border p-4 space-y-4">
          <p className="text-sm font-medium text-muted-foreground">Datos del subadmin</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Usuario *" value={newSa.username} onChange={e => setNewSa(p => ({ ...p, username: e.target.value }))} />
            <Input type="password" placeholder="Contraseña *" value={newSa.password} onChange={e => setNewSa(p => ({ ...p, password: e.target.value }))} />
          </div>

          {pkgs.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Asignar paquetes</p>
              <div className="space-y-2 border border-border rounded-lg p-3">
                {pkgs.map(pkg => {
                  const assigned = newSaPackages.find(p => p.packageId === pkg.id);
                  return (
                    <div key={pkg.id} className="flex items-center gap-3 flex-wrap">
                      <input
                        type="checkbox"
                        id={`new-pkg-${pkg.id}`}
                        checked={!!assigned}
                        onChange={() => toggleNewSaPkg(pkg.id)}
                        className="w-4 h-4 accent-primary"
                      />
                      <label htmlFor={`new-pkg-${pkg.id}`} className="text-sm cursor-pointer flex-1">
                        {pkg.name} <span className="text-muted-foreground text-xs">({minutesToLabel(pkg.durationMinutes)} · ${pkg.price.toFixed(2)} base)</span>
                      </label>
                      {assigned && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Precio personalizado $</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={String(pkg.price.toFixed(2))}
                            value={assigned.customPrice}
                            onChange={e => setNewSaPackages(prev => prev.map(p => p.packageId === pkg.id ? { ...p, customPrice: e.target.value } : p))}
                            className="w-24 h-7 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={createMutation.isPending}>{createMutation.isPending ? 'Creando...' : 'Crear Subadmin'}</Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setNewSaPackages([]); }}>Cancelar</Button>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead>Códigos</TableHead>
              <TableHead>Agregar Saldo</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(subadmins || []).map(sa => (
              <TableRow key={sa.id}>
                <TableCell className="font-medium">{sa.username}</TableCell>
                <TableCell className="font-mono text-green-400">${sa.balance.toFixed(2)}</TableCell>
                <TableCell>{sa.totalCodesGenerated}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="0.00" className="w-20 h-8 text-sm" value={balanceAmounts[sa.id] || ''} onChange={e => setBalanceAmounts(p => ({ ...p, [sa.id]: e.target.value }))} />
                    <Button size="sm" className="h-8" onClick={() => handleAddBalance(sa.id)}>+</Button>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="text-yellow-400 hover:text-yellow-300 w-8 h-8"
                      onClick={() => openEdit(sa)}
                      disabled={editLoading}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive w-8 h-8" onClick={() => handleDelete(sa.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(subadmins || []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sin subadmins aún</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editSa} onOpenChange={(o) => !o && setEditSa(null)}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Subadmin</DialogTitle></DialogHeader>
          {editSa && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input placeholder="Usuario *" value={editSa.username} onChange={e => setEditSa(p => p ? { ...p, username: e.target.value } : p)} />
                <Input type="password" placeholder="Nueva contraseña (vacío = no cambiar)" value={editSa.password} onChange={e => setEditSa(p => p ? { ...p, password: e.target.value } : p)} />
              </div>

              {pkgs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Paquetes asignados</p>
                  <div className="space-y-2 border border-border rounded-lg p-3">
                    {pkgs.map(pkg => {
                      const assigned = editSa.packages.find(p => p.packageId === pkg.id);
                      return (
                        <div key={pkg.id} className="flex items-center gap-3 flex-wrap">
                          <input
                            type="checkbox"
                            id={`edit-pkg-${pkg.id}`}
                            checked={!!assigned}
                            onChange={() => toggleEditSaPkg(pkg.id)}
                            className="w-4 h-4 accent-primary"
                          />
                          <label htmlFor={`edit-pkg-${pkg.id}`} className="text-sm cursor-pointer flex-1">
                            {pkg.name} <span className="text-muted-foreground text-xs">({minutesToLabel(pkg.durationMinutes)} · ${pkg.price.toFixed(2)} base)</span>
                          </label>
                          {assigned && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">Precio $</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder={String(pkg.price.toFixed(2))}
                                value={assigned.customPrice}
                                onChange={e => setEditSa(prev => prev ? {
                                  ...prev,
                                  packages: prev.packages.map(p => p.packageId === pkg.id ? { ...p, customPrice: e.target.value } : p)
                                } : prev)}
                                className="w-24 h-7 text-sm"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditSa(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>{updateMutation.isPending ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PackagesManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: packages, isLoading } = useListPackages({ query: { queryKey: getListPackagesQueryKey() } });
  const createMutation = useCreatePackage();
  const updateMutation = useUpdatePackage();
  const deleteMutation = useDeletePackage();

  const [showForm, setShowForm] = useState(false);
  const [newPkg, setNewPkg] = useState({ name: '', durationAmount: '30', durationUnit: 'days' as TimeUnit, price: '0', description: '' });
  const [editPkg, setEditPkg] = useState<{ id: number; name: string; durationAmount: string; durationUnit: TimeUnit; price: string; description: string } | null>(null);

  const handleCreate = () => {
    if (!newPkg.name) { toast({ variant: 'destructive', title: 'El nombre es requerido' }); return; }
    const durationMinutes = unitsToMinutes(parseInt(newPkg.durationAmount) || 30, newPkg.durationUnit);
    createMutation.mutate({ data: { name: newPkg.name, durationMinutes, price: parseFloat(newPkg.price) || 0, description: newPkg.description || undefined } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPackagesQueryKey() });
        toast({ title: 'Paquete creado' });
        setNewPkg({ name: '', durationAmount: '30', durationUnit: 'days', price: '0', description: '' }); setShowForm(false);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al crear paquete' })
    });
  };

  const handleUpdate = () => {
    if (!editPkg || !editPkg.name) { toast({ variant: 'destructive', title: 'El nombre es requerido' }); return; }
    const durationMinutes = unitsToMinutes(parseInt(editPkg.durationAmount) || 30, editPkg.durationUnit);
    updateMutation.mutate({ id: editPkg.id, data: { name: editPkg.name, durationMinutes, price: parseFloat(editPkg.price) || 0, description: editPkg.description || undefined } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPackagesQueryKey() });
        toast({ title: 'Paquete actualizado' });
        setEditPkg(null);
      },
      onError: () => toast({ variant: 'destructive', title: 'Error al actualizar paquete' })
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm('¿Eliminar este paquete?')) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPackagesQueryKey() }); toast({ title: 'Paquete eliminado' }); }
    });
  };

  if (isLoading) return <div className="text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Gestión de Paquetes</h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" />Nuevo Paquete</Button>
      </div>

      {showForm && (
        <Card className="bg-background border-border p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre *" value={newPkg.name} onChange={e => setNewPkg(p => ({ ...p, name: e.target.value }))} />
            <div className="flex gap-2">
              <Input type="number" min="1" placeholder="Duración" value={newPkg.durationAmount} onChange={e => setNewPkg(p => ({ ...p, durationAmount: e.target.value }))} />
              <SelectUnit value={newPkg.durationUnit} onChange={v => setNewPkg(p => ({ ...p, durationUnit: v }))} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input type="number" min="0" step="0.01" placeholder="Precio (0 = gratis)" value={newPkg.price} onChange={e => setNewPkg(p => ({ ...p, price: e.target.value }))} />
            </div>
            <Input placeholder="Descripción" value={newPkg.description} onChange={e => setNewPkg(p => ({ ...p, description: e.target.value }))} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Duración: {minutesToLabel(unitsToMinutes(parseInt(newPkg.durationAmount) || 30, newPkg.durationUnit))}
          </p>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleCreate} disabled={createMutation.isPending}>{createMutation.isPending ? 'Creando...' : 'Crear'}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(packages || []).map(pkg => (
              <TableRow key={pkg.id}>
                <TableCell className="font-medium">{pkg.name}</TableCell>
                <TableCell>{minutesToLabel(pkg.durationMinutes)}</TableCell>
                <TableCell className="font-mono">{pkg.price === 0 ? <span className="text-green-400">Gratis</span> : `$${pkg.price.toFixed(2)}`}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{pkg.description || '-'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="text-yellow-400 hover:text-yellow-300 w-8 h-8"
                      onClick={() => {
                        const { amount, unit } = minutesToEditState(pkg.durationMinutes);
                        setEditPkg({ id: pkg.id, name: pkg.name, durationAmount: amount, durationUnit: unit, price: String(pkg.price), description: pkg.description || '' });
                      }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive w-8 h-8" onClick={() => handleDelete(pkg.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(packages || []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sin paquetes aún</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editPkg} onOpenChange={(o) => !o && setEditPkg(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle>Editar Paquete</DialogTitle></DialogHeader>
          {editPkg && (
            <div className="space-y-3">
              <Input placeholder="Nombre *" value={editPkg.name} onChange={e => setEditPkg(p => p ? { ...p, name: e.target.value } : p)} />
              <div className="flex gap-2">
                <Input type="number" min="1" placeholder="Duración" value={editPkg.durationAmount} onChange={e => setEditPkg(p => p ? { ...p, durationAmount: e.target.value } : p)} />
                <SelectUnit value={editPkg.durationUnit} onChange={v => setEditPkg(p => p ? { ...p, durationUnit: v } : p)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Duración: {minutesToLabel(unitsToMinutes(parseInt(editPkg.durationAmount) || 1, editPkg.durationUnit))}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input type="number" min="0" step="0.01" placeholder="Precio" value={editPkg.price} onChange={e => setEditPkg(p => p ? { ...p, price: e.target.value } : p)} />
              </div>
              <Input placeholder="Descripción" value={editPkg.description} onChange={e => setEditPkg(p => p ? { ...p, description: e.target.value } : p)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditPkg(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>{updateMutation.isPending ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApkUploadSection() {
  const { toast } = useToast();
  const [link, setLink] = useState('');
  const [currentLink, setCurrentLink] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    fetch(`${apiBase}/api/admin/apk/link`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setCurrentLink(d.link || null); setLink(d.link || ''); })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!link.trim()) {
      toast({ variant: 'destructive', title: 'Enlace vacío', description: 'Ingresa un enlace de descarga válido.' });
      return;
    }
    const token = localStorage.getItem('supertv_admin_token') || '';
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/admin/apk/set-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ link: link.trim() }),
      });
      if (!res.ok) throw new Error('Error al guardar el enlace');
      setCurrentLink(link.trim());
      toast({ title: 'Enlace guardado', description: 'El botón de Instalar APK abrirá este enlace.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar el enlace.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-card border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="w-4 h-4" /> Enlace de descarga APK
          {currentLink ? (
            <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Configurado
            </span>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Sin configurar
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ingresa el enlace de descarga del APK. Cuando el cliente pulse "Instalar APK", se abrirá automáticamente este enlace.
        </p>
        {currentLink && (
          <div className="text-xs bg-white/5 rounded-lg px-3 py-2 break-all text-muted-foreground">
            <span className="text-foreground font-medium">Enlace actual:</span> {currentLink}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="url"
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="https://ejemplo.com/super-tv.apk"
            className="flex-1 min-w-0 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled={saving}
          />
          <Button onClick={handleSave} disabled={saving || !link.trim()}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando</> : 'Guardar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsManager() {
  const { toast } = useToast();
  const changePasswordMutation = useAdminChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Terabox cookies setting
  const [teraboxCookies, setTeraboxCookies] = useState('');
  const [teraboxSaved, setTeraboxSaved] = useState(false);
  const [teraboxLoading, setTeraboxLoading] = useState(false);
  const [teraboxConfigured, setTeraboxConfigured] = useState<boolean | null>(null);
  const [showTerabox, setShowTerabox] = useState(false);

  // Dropbox token setting
  const [dropboxToken, setDropboxToken] = useState('');
  const [dropboxSaved, setDropboxSaved] = useState(false);
  const [dropboxLoading, setDropboxLoading] = useState(false);
  const [dropboxConfigured, setDropboxConfigured] = useState<boolean | null>(null);
  const [dropboxTestResult, setDropboxTestResult] = useState<{ ok: boolean; name?: string; email?: string; error?: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    fetch(`${apiBase}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setTeraboxConfigured(!!d.teraboxCookies);
        setDropboxConfigured(!!d.dropboxToken);
      })
      .catch(() => {});
  }, []);

  const handleSaveDropbox = async () => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    setDropboxLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dropboxToken: dropboxToken.trim() || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Error');
      setDropboxConfigured(!!dropboxToken.trim());
      setDropboxToken('');
      setDropboxSaved(true);
      setDropboxTestResult(null);
      setTimeout(() => setDropboxSaved(false), 3000);
      toast({ title: 'Token de Dropbox guardado', description: 'Ya puedes importar películas desde tu Dropbox.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setDropboxLoading(false);
    }
  };

  const handleClearDropbox = async () => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    setDropboxLoading(true);
    try {
      await fetch(`${apiBase}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dropboxToken: null }),
      });
      setDropboxConfigured(false);
      setDropboxTestResult(null);
      toast({ title: 'Token de Dropbox eliminado' });
    } catch { } finally { setDropboxLoading(false); }
  };

  const handleTestDropbox = async () => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    setDropboxLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/dropbox/test`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setDropboxTestResult(data);
    } catch { setDropboxTestResult({ ok: false, error: 'Error de conexión' }); }
    finally { setDropboxLoading(false); }
  };

  const handleSaveTerabox = async () => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    setTeraboxLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teraboxCookies: teraboxCookies.trim() || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Error');
      setTeraboxConfigured(!!teraboxCookies.trim());
      setTeraboxCookies('');
      setTeraboxSaved(true);
      setTimeout(() => setTeraboxSaved(false), 3000);
      toast({ title: 'Cookies de Terabox guardadas', description: 'Los videos de Terabox ya deberían reproducirse correctamente.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setTeraboxLoading(false);
    }
  };

  const handleClearTerabox = async () => {
    const token = localStorage.getItem('supertv_admin_token') || '';
    setTeraboxLoading(true);
    try {
      await fetch(`${apiBase}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teraboxCookies: null }),
      });
      setTeraboxConfigured(false);
      toast({ title: 'Cookies eliminadas' });
    } catch { /* ignore */ } finally { setTeraboxLoading(false); }
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Error', description: 'Las contraseñas nuevas no coinciden' });
      return;
    }
    if (newPassword.length < 4) {
      toast({ variant: 'destructive', title: 'Error', description: 'La nueva contraseña debe tener al menos 4 caracteres' });
      return;
    }
    changePasswordMutation.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({ title: 'Contraseña actualizada', description: 'Tu contraseña ha sido cambiada exitosamente.' });
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
        onError: (err: any) => {
          const msg = err?.data?.error ?? 'Error al cambiar la contraseña';
          toast({ variant: 'destructive', title: 'Error', description: msg });
        },
      }
    );
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h3 className="text-lg font-medium flex items-center gap-2">
        <Settings className="w-5 h-5" /> Configuración
      </h3>

      {/* APK Upload */}
      <ApkUploadSection />

      {/* Terabox Cookies */}
      <Card className="bg-background border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4" /> Cookies de Terabox
            {teraboxConfigured === true && (
              <span className="ml-auto text-xs text-green-500 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Configuradas
              </span>
            )}
            {teraboxConfigured === false && (
              <span className="ml-auto text-xs text-yellow-500 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> No configuradas
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Para reproducir videos de Terabox necesitas proporcionar las cookies de tu cuenta.
            Sin ellas, Terabox bloquea el acceso a los archivos.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Cómo obtener las cookies:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Inicia sesión en <span className="font-mono">1024terabox.com</span> en tu navegador</li>
              <li>Abre DevTools (F12) → Aplicación → Cookies → <span className="font-mono">1024terabox.com</span></li>
              <li>Copia el valor de <span className="font-mono text-yellow-400">BDUSS</span> y/o <span className="font-mono text-yellow-400">bdstoken</span></li>
              <li>Pégalos abajo en formato: <span className="font-mono">BDUSS=xxx; bdstoken=yyy</span></li>
            </ol>
          </div>
          <div className="relative">
            <textarea
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="BDUSS=abc123...; bdstoken=xyz..."
              value={teraboxCookies}
              onChange={e => setTeraboxCookies(e.target.value)}
              onFocus={() => setShowTerabox(true)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveTerabox}
              disabled={teraboxLoading || !teraboxCookies.trim()}
              className="flex-1"
            >
              {teraboxLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : teraboxSaved ? <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" /> : null}
              {teraboxSaved ? 'Guardado' : 'Guardar Cookies'}
            </Button>
            {teraboxConfigured && (
              <Button variant="outline" onClick={handleClearTerabox} disabled={teraboxLoading} className="text-destructive border-destructive hover:bg-destructive/10">
                Eliminar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dropbox Token */}
      <Card className="bg-background border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-400" /> Token de Dropbox
            {dropboxConfigured === true && (
              <span className="ml-auto text-xs text-green-500 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Configurado
              </span>
            )}
            {dropboxConfigured === false && (
              <span className="ml-auto text-xs text-yellow-500 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> No configurado
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Conecta tu cuenta de Dropbox para importar películas y series directamente desde tus carpetas.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Cómo obtener tu token:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Ve a <span className="font-mono">dropbox.com/developers/apps</span></li>
              <li>Clic en <span className="font-medium">Create app</span> → Scoped access → Full Dropbox → ponle un nombre</li>
              <li>En la pestaña <span className="font-medium">Permissions</span>, activa: <span className="font-mono text-yellow-400">files.content.read</span></li>
              <li>En la pestaña <span className="font-medium">Settings</span>, baja hasta <span className="font-medium">Generated access token</span> y haz clic en <span className="font-medium">Generate</span></li>
              <li>Copia el token y pégalo abajo</li>
            </ol>
          </div>
          <Input
            type="password"
            placeholder="sl.xxxxxxxxxxxxxxxxxx..."
            value={dropboxToken}
            onChange={e => setDropboxToken(e.target.value)}
            className="font-mono text-sm"
          />
          {dropboxTestResult && (
            <div className={`text-xs rounded-md px-3 py-2 flex items-center gap-2 ${dropboxTestResult.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
              {dropboxTestResult.ok
                ? <><CheckCircle2 className="w-3 h-3 flex-shrink-0" /> Conectado como <strong>{dropboxTestResult.name}</strong> ({dropboxTestResult.email})</>
                : <><XCircle className="w-3 h-3 flex-shrink-0" /> {dropboxTestResult.error}</>
              }
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleSaveDropbox} disabled={dropboxLoading || !dropboxToken.trim()} className="flex-1">
              {dropboxLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : dropboxSaved ? <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" /> : null}
              {dropboxSaved ? 'Guardado' : 'Guardar Token'}
            </Button>
            {dropboxConfigured && (
              <Button variant="outline" onClick={handleTestDropbox} disabled={dropboxLoading}>
                <Wifi className="w-4 h-4 mr-2" />Probar
              </Button>
            )}
            {dropboxConfigured && (
              <Button variant="outline" onClick={handleClearDropbox} disabled={dropboxLoading} className="text-destructive border-destructive hover:bg-destructive/10">
                Eliminar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-background border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="w-4 h-4" /> Cambiar Contraseña de Admin
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="relative">
              <Input
                type={showCurrent ? 'text' : 'password'}
                placeholder="Contraseña actual"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button type="button" onClick={() => setShowCurrent(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                placeholder="Nueva contraseña"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button type="button" onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                placeholder="Confirmar nueva contraseña"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button type="button" onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button type="submit" disabled={changePasswordMutation.isPending} className="w-full">
              {changePasswordMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cambiando...</>
                : 'Cambiar Contraseña'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <SectionLayoutManager />
    </div>
  );
}

type SectionId = 'channels' | 'movies' | 'series';
const SECTION_LABELS: Record<SectionId, string> = { channels: 'En Vivo (Canales)', movies: 'Películas', series: 'Series' };
const SECTION_ICONS: Record<SectionId, React.FC<{ className?: string }>> = { channels: Tv, movies: Film, series: Tv2 };
const DEFAULT_ORDER: SectionId[] = ['channels', 'movies', 'series'];
const DEFAULT_VIS: Record<SectionId, boolean> = { channels: true, movies: true, series: true };

function SortableSectionItem({ id, label, icon: Icon, visible, onToggleVisible }: { id: string; label: string; icon: React.FC<{ className?: string }>; visible: boolean; onToggleVisible: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-3 p-3 rounded-lg border ${visible ? 'border-border bg-muted/30' : 'border-border/40 bg-muted/10 opacity-60'}`}>
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none">
        <GripVertical className="w-4 h-4" />
      </button>
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      <button
        onClick={onToggleVisible}
        className={`text-xs flex items-center gap-1 px-2 py-1 rounded-md border transition-colors ${visible ? 'border-green-500/40 text-green-400 bg-green-500/10 hover:bg-green-500/20' : 'border-border text-muted-foreground hover:bg-muted'}`}
      >
        {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        {visible ? 'Visible' : 'Oculto'}
      </button>
    </div>
  );
}

function SectionLayoutManager() {
  const { toast } = useToast();
  const [order, setOrder] = useState<SectionId[]>(DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<Record<SectionId, boolean>>(DEFAULT_VIS);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const token = getToken('admin') ?? getToken('subadmin') ?? '';
    fetch(`${apiBase}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.sectionOrder) && d.sectionOrder.length > 0) setOrder(d.sectionOrder as SectionId[]);
        if (d.sectionVisibility) setVisibility({ ...DEFAULT_VIS, ...d.sectionVisibility });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrder(prev => {
        const oldIdx = prev.indexOf(active.id as SectionId);
        const newIdx = prev.indexOf(over.id as SectionId);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const toggleVisibility = (id: SectionId) => {
    setVisibility(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSave = async () => {
    const token = getToken('admin') ?? getToken('subadmin') ?? '';
    setSaving(true);
    try {
      const r = await fetch(`${apiBase}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sectionOrder: order, sectionVisibility: visibility }),
      });
      if (!r.ok) throw new Error('Error al guardar');
      toast({ title: 'Configuración guardada', description: 'Los clientes verán las secciones en el nuevo orden.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <Card className="bg-background border-border">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="w-4 h-4" /> Orden y Visibilidad de Secciones
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Arrastra para cambiar el orden. Activa o desactiva qué secciones ven los clientes.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map(id => (
              <SortableSectionItem
                key={id}
                id={id}
                label={SECTION_LABELS[id] ?? id}
                icon={SECTION_ICONS[id] ?? Tv}
                visible={visibility[id] ?? true}
                onToggleVisible={() => toggleVisibility(id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <Button onClick={handleSave} disabled={saving} className="w-full mt-2">
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar Configuración'}
        </Button>
      </CardContent>
    </Card>
  );
}

const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const AVATAR_MAX_SIZE_MB = 5;

function AvatarsManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: avatars = [], isLoading } = useListAvatars({ query: { queryKey: getListAvatarsQueryKey() } });
  const createAvatarMutation = useCreateAvatar();
  const deleteAvatarMutation = useDeleteAvatar();

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const cropToSquare = useCallback((file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const size = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Error al procesar imagen')); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Error al cargar imagen')); };
      img.src = url;
    });
  }, []);

  const uploadSingleFile = useCallback(async (file: File): Promise<void> => {
    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      throw new Error(`"${file.name}": tipo no permitido. Solo JPG, PNG o WebP.`);
    }
    if (file.size > AVATAR_MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`"${file.name}": supera el límite de ${AVATAR_MAX_SIZE_MB} MB.`);
    }
    const processedFile = await cropToSquare(file);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(`Error al leer ${file.name}`));
      reader.readAsDataURL(processedFile);
    });
    await createAvatarMutation.mutateAsync({ data: { imageUrl: dataUrl, name: baseName || null } });
  }, [cropToSquare, createAvatarMutation]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    let done = 0;
    const errorMessages: string[] = [];
    for (const file of files) {
      try {
        await uploadSingleFile(file);
        done++;
        setUploadProgress({ done: done + errorMessages.length, total: files.length });
      } catch (err) {
        errorMessages.push(err instanceof Error ? err.message : `Error con ${file.name}`);
        setUploadProgress({ done: done + errorMessages.length, total: files.length });
      }
    }
    await queryClient.invalidateQueries({ queryKey: getListAvatarsQueryKey() });
    if (errorMessages.length > 0 && done === 0) {
      toast({ variant: 'destructive', title: 'No se pudo subir ningún archivo', description: errorMessages[0] });
    } else if (errorMessages.length > 0) {
      toast({ variant: 'destructive', title: `${done} subidos, ${errorMessages.length} con error`, description: errorMessages[0] });
    } else {
      toast({ title: `${done} avatar${done > 1 ? 'es' : ''} subido${done > 1 ? 's' : ''}`, description: 'Todos los avatares fueron agregados.' });
    }
    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadSingleFile, queryClient, toast]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm('¿Eliminar este avatar?')) return;
    await deleteAvatarMutation.mutateAsync({ id });
    await queryClient.invalidateQueries({ queryKey: getListAvatarsQueryKey() });
    toast({ title: 'Avatar eliminado' });
  }, [deleteAvatarMutation, queryClient, toast]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><UserCircle2 className="w-5 h-5" /> Avatares</h2>
      </div>

      <div className="bg-secondary/30 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium">Subir avatares</p>
        <div className="flex gap-2 flex-wrap items-center">
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-2">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading
              ? uploadProgress
                ? `Subiendo ${uploadProgress.done}/${uploadProgress.total}...`
                : 'Subiendo...'
              : 'Seleccionar imágenes'}
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          {uploading && uploadProgress && (
            <div className="flex-1 max-w-xs bg-secondary rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Puedes seleccionar varias imágenes a la vez. El nombre del archivo se usará como nombre del avatar.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando avatares...
        </div>
      ) : avatars.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <UserCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Sin avatares aún. Sube el primero.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
          {avatars.map(av => (
            <div key={av.id} className="relative group flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-border group-hover:border-primary transition-colors">
                <img src={av.imageUrl} alt={av.name ?? 'Avatar'} className="w-full h-full object-cover" />
              </div>
              {av.name && <p className="text-[10px] text-muted-foreground text-center truncate w-16">{av.name}</p>}
              <button
                onClick={() => handleDelete(av.id)}
                className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BASE_API = BASE_URL;

function getAdminToken(): string {
  return getToken('admin') || '';
}

interface SeriesRow {
  id: number; title: string; description?: string | null; poster?: string | null;
  banner?: string | null; category?: string | null; genre?: string | null;
  year?: number | null; featured: boolean; hidden: boolean; order: number; createdAt: string;
}
interface SeasonRow { id: number; seriesId: number; seasonNumber: number; title?: string | null; poster?: string | null; episodes: EpisodeRow[]; }
interface EpisodeRow { id: number; seriesId: number; seasonId: number; episodeNumber: number; title: string; description?: string | null; filePath: string; thumbnail?: string | null; duration?: number | null; order: number; }

function SeriesManager() {
  const { toast } = useToast();
  const [seriesList, setSeriesList] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<{ seasons: SeasonRow[] } | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editSeries, setEditSeries] = useState<SeriesRow | null>(null);
  const [scanUrl, setScanUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showEpForm, setShowEpForm] = useState<{ seriesId: number; seasonId: number } | null>(null);
  const [showSeasonForm, setShowSeasonForm] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [newSeasonForm, setNewSeasonForm] = useState({ seasonNumber: '1', title: '' });
  const [newEpForm, setNewEpForm] = useState({ episodeNumber: '', title: '', filePath: '', videoFormat: '', description: '', thumbnail: '' });
  const [seriesScanUrl, setSeriesScanUrl] = useState('');
  const [scanningSeasons, setScanningSeasons] = useState(false);
  const [posterSearching, setPosterSearching] = useState(false);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [showYtPlaylist, setShowYtPlaylist] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytPreviewing, setYtPreviewing] = useState(false);
  const [ytImporting, setYtImporting] = useState(false);
  const [ytPreview, setYtPreview] = useState<{ playlistId: string; title: string; description: string; thumbnail: string; channelTitle: string; itemCount: number; items: Array<{ videoId: string; title: string; thumbnail: string; position: number }> } | null>(null);
  const [ytForm, setYtForm] = useState({ title: '', category: '', genre: '', year: '', poster: '', banner: '' });
  const [showYtManual, setShowYtManual] = useState(false);
  const [ytManualTitle, setYtManualTitle] = useState('');
  const [ytManualCategory, setYtManualCategory] = useState('');
  const [ytManualLinks, setYtManualLinks] = useState<Array<{ url: string; title: string }>>([{ url: '', title: '' }]);
  const [ytManualPoster, setYtManualPoster] = useState('');
  const [ytManualCreating, setYtManualCreating] = useState(false);
  const [showYtBulk, setShowYtBulk] = useState<{ seriesId: number; seasonId: number; seasonEpCount: number } | null>(null);
  const [ytBulkText, setYtBulkText] = useState('');
  const [ytBulkAdding, setYtBulkAdding] = useState(false);
  const [editEp, setEditEp] = useState<EpisodeRow | null>(null);
  const [editEpSaving, setEditEpSaving] = useState(false);

  // YouTube Series Search
  const [showYtSeriesSearch, setShowYtSeriesSearch] = useState(false);
  const [ytSQuery, setYtSQuery] = useState('');
  const [ytSResults, setYtSResults] = useState<{
    playlists: Array<{ playlistId: string; title: string; description: string; thumbnail: string; channel: string; episodeCount: number; url: string }>;
    videos: Array<{ videoId: string; title: string; description: string; thumbnail: string; channel: string; duration: string; url: string }>;
  } | null>(null);
  const [ytSLoading, setYtSLoading] = useState(false);
  const [ytSError, setYtSError] = useState('');
  const [ytSNeedsKey, setYtSNeedsKey] = useState(false);
  // Expanded import form per result
  const [ytSExpandedPlaylist, setYtSExpandedPlaylist] = useState<string | null>(null);
  const [ytSExpandedVideo, setYtSExpandedVideo] = useState<string | null>(null);
  const [ytSPlaylistForms, setYtSPlaylistForms] = useState<Record<string, { title: string; category: string; genre: string; year: string }>>({});
  const [ytSVideoForms, setYtSVideoForms] = useState<Record<string, { title: string; category: string; genre: string }>>({});
  const [ytSImporting, setYtSImporting] = useState<Set<string>>(new Set());
  const [ytSImported, setYtSImported] = useState<Set<string>>(new Set());

  const [showEpUrlChecker, setShowEpUrlChecker] = useState(false);
  const [epUrlCheckItems, setEpUrlCheckItems] = useState<Array<{ epId: number; seriesTitle: string; seasonTitle: string; epTitle: string; url: string; status: 'pending' | 'ok' | 'broken' | 'checking' }>>([]);
  const [epUrlChecking, setEpUrlChecking] = useState(false);
  const [epUrlCheckSel, setEpUrlCheckSel] = useState<Set<number>>(new Set());
  const epUrlCheckStopRef = useRef(false);

  const form0: Partial<SeriesRow> = { title: '', description: '', poster: '', banner: '', category: '', genre: '', year: undefined, featured: false, hidden: false };
  const [createForm, setCreateForm] = useState<Partial<SeriesRow>>(form0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_API}/api/series/all`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
      if (r.ok) setSeriesList(await r.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadExpanded = useCallback(async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setExpandedSeries(null); return; }
    setExpandedId(id); setExpandedLoading(true); setExpandedSeries(null);
    try {
      const r = await fetch(`${BASE_API}/api/series/${id}`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
      if (r.ok) setExpandedSeries(await r.json());
    } catch {}
    setExpandedLoading(false);
  }, [expandedId]);

  const handleCreate = async () => {
    if (!createForm.title) { toast({ variant: 'destructive', title: 'El título es requerido' }); return; }
    const r = await fetch(`${BASE_API}/api/series`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify(createForm) });
    if (r.ok) { toast({ title: 'Serie creada' }); setShowCreate(false); setCreateForm(form0); refresh(); }
    else toast({ variant: 'destructive', title: 'Error al crear serie' });
  };

  const handleUpdate = async () => {
    if (!editSeries?.title) return;
    const r = await fetch(`${BASE_API}/api/series/${editSeries.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify(editSeries) });
    if (r.ok) { toast({ title: 'Serie actualizada' }); setEditSeries(null); refresh(); }
    else toast({ variant: 'destructive', title: 'Error al actualizar' });
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta serie y todos sus episodios?')) return;
    await fetch(`${BASE_API}/api/series/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getAdminToken()}` } });
    toast({ title: 'Serie eliminada' }); refresh();
    if (expandedId === id) { setExpandedId(null); setExpandedSeries(null); }
  };

  const handleSearchPoster = async (title: string) => {
    if (!title) return;
    setPosterSearching(true);
    try {
      const r = await fetch(`${BASE_API}/api/series/poster-search?q=${encodeURIComponent(title)}`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
      if (r.ok) {
        const d = await r.json();
        if (editSeries) setEditSeries(p => p ? ({ ...p, poster: d.poster || p.poster, banner: d.banner || p.banner, year: d.year ?? p.year, genre: d.genre || p.genre, description: d.description || p.description }) : p);
        else setCreateForm(p => ({ ...p, poster: d.poster || p.poster, banner: d.banner || p.banner, year: d.year ?? p.year, genre: d.genre || p.genre, description: d.description || p.description }));
        if (d.poster || d.banner) toast({ title: 'Carátulas encontradas' });
        else toast({ title: 'Sin resultados en TMDB', variant: 'destructive' });
      }
    } catch {}
    setPosterSearching(false);
  };

  const handleScanFolder = async () => {
    if (!scanUrl.trim()) return;
    setScanning(true);
    try {
      const r = await fetch(`${BASE_API}/api/series/scan-folder`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify({ url: scanUrl.trim() }) });
      if (r.ok) {
        const data = await r.json();
        const items: Array<{ name: string; url?: string; poster?: string }> = data.items ?? [];
        if (!items.length) { toast({ title: 'No se encontraron series', variant: 'destructive' }); setScanning(false); return; }
        let imported = 0;
        for (const item of items) {
          const cr = await fetch(`${BASE_API}/api/series`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify({ title: item.name, poster: item.poster || undefined }) });
          if (cr.ok) {
            const created = await cr.json();
            if (item.url) await fetch(`${BASE_API}/api/series/${created.id}/scan-seasons`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify({ url: item.url }) });
            imported++;
          }
        }
        toast({ title: `${imported} serie(s) importada(s)` });
        setScanUrl(''); setShowScanner(false); refresh();
      } else {
        const err = await r.json().catch(() => ({}));
        toast({ variant: 'destructive', title: 'Error al escanear', description: (err as any)?.error || 'No se pudo acceder a la URL' });
      }
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Error desconocido' });
    }
    setScanning(false);
  };

  const handleScanSeasons = async (seriesId: number) => {
    if (!seriesScanUrl.trim()) return;
    setScanningSeasons(true);
    try {
      const r = await fetch(`${BASE_API}/api/series/${seriesId}/scan-seasons`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify({ url: seriesScanUrl.trim() }) });
      if (r.ok) {
        const d = await r.json();
        toast({ title: `${(d as any).seasonsCreated ?? 0} temporada(s) importada(s)` });
        setSeriesScanUrl('');
        setExpandedId(null); setExpandedSeries(null);
        setTimeout(() => loadExpanded(seriesId), 100);
      } else {
        const err = await r.json().catch(() => ({}));
        toast({ variant: 'destructive', title: 'Error al escanear temporadas', description: (err as any)?.error });
      }
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : '' });
    }
    setScanningSeasons(false);
  };

  const handleAddSeason = async () => {
    if (!showSeasonForm) return;
    const id = showSeasonForm;
    const r = await fetch(`${BASE_API}/api/seasons`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify({ seriesId: id, seasonNumber: Number(newSeasonForm.seasonNumber), title: newSeasonForm.title || undefined }) });
    if (r.ok) { toast({ title: 'Temporada creada' }); setShowSeasonForm(null); setNewSeasonForm({ seasonNumber: '1', title: '' }); loadExpanded(id); }
    else toast({ variant: 'destructive', title: 'Error al crear temporada' });
  };

  const handleDeleteSeason = async (seasonId: number, seriesId: number) => {
    if (!confirm('¿Eliminar temporada y sus episodios?')) return;
    await fetch(`${BASE_API}/api/seasons/${seasonId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getAdminToken()}` } });
    toast({ title: 'Temporada eliminada' }); loadExpanded(seriesId);
  };

  const handleAddEpisode = async () => {
    if (!showEpForm || !newEpForm.title || !newEpForm.filePath) { toast({ variant: 'destructive', title: 'Título y URL son requeridos' }); return; }
    const { seriesId, seasonId } = showEpForm;
    const r = await fetch(`${BASE_API}/api/episodes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` }, body: JSON.stringify({ seriesId, seasonId, title: newEpForm.title, filePath: newEpForm.filePath, videoFormat: newEpForm.videoFormat || undefined, description: newEpForm.description || undefined, thumbnail: newEpForm.thumbnail || undefined, episodeNumber: newEpForm.episodeNumber ? Number(newEpForm.episodeNumber) : undefined }) });
    if (r.ok) { toast({ title: 'Episodio creado' }); setShowEpForm(null); setNewEpForm({ episodeNumber: '', title: '', filePath: '', videoFormat: '', description: '', thumbnail: '' }); loadExpanded(seriesId); }
    else toast({ variant: 'destructive', title: 'Error al crear episodio' });
  };

  const handleDeleteEpisode = async (epId: number, seriesId: number) => {
    if (!confirm('¿Eliminar este episodio?')) return;
    await fetch(`${BASE_API}/api/episodes/${epId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getAdminToken()}` } });
    refresh();
  };

  const handleSaveEpisode = async () => {
    if (!editEp) return;
    setEditEpSaving(true);
    const r = await fetch(`${BASE_API}/api/episodes/${editEp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({
        title: editEp.title,
        filePath: editEp.filePath,
        thumbnail: editEp.thumbnail || undefined,
        episodeNumber: editEp.episodeNumber,
      }),
    });
    setEditEpSaving(false);
    if (r.ok) { toast({ title: 'Episodio actualizado' }); setEditEp(null); refresh(); }
    else { const d = await r.json().catch(() => ({})); toast({ variant: 'destructive', title: (d as any).error || 'Error al guardar' }); }
  };

  const handleYtBulkAdd = async () => {
    if (!showYtBulk) return;
    const urls = ytBulkText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (urls.length === 0) { toast({ variant: 'destructive', title: 'Pega al menos un enlace de YouTube' }); return; }
    setYtBulkAdding(true);
    let ok = 0; let fail = 0;
    const startNum = showYtBulk.seasonEpCount + 1;
    for (let i = 0; i < urls.length; i++) {
      const er = await fetch(`${BASE_API}/api/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({
          seriesId: showYtBulk.seriesId,
          seasonId: showYtBulk.seasonId,
          episodeNumber: startNum + i,
          title: `Episodio ${startNum + i}`,
          filePath: urls[i],
          videoFormat: 'youtube',
        }),
      });
      if (er.ok) ok++; else fail++;
    }
    if (fail > 0) toast({ variant: 'destructive', title: `${fail} episodio(s) fallaron`, description: `${ok} agregados correctamente` });
    else toast({ title: `${ok} episodio(s) agregados` });
    setShowYtBulk(null);
    setYtBulkText('');
    refresh();
    setYtBulkAdding(false);
  };

  const handleYtPreview = async () => {
    if (!ytUrl.trim()) return;
    setYtPreviewing(true);
    setYtPreview(null);
    try {
      const r = await fetch(`${BASE_API}/api/youtube/playlist-preview?url=${encodeURIComponent(ytUrl.trim())}`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
      const data = await r.json();
      if (!r.ok) { toast({ variant: 'destructive', title: data.error || 'Error al obtener la playlist' }); return; }
      setYtPreview(data);
      setYtForm(f => ({ ...f, title: f.title || data.title, poster: f.poster || data.thumbnail }));
    } catch { toast({ variant: 'destructive', title: 'Error de red' }); }
    finally { setYtPreviewing(false); }
  };

  const handleYtImport = async () => {
    if (!ytPreview) return;
    if (!ytForm.title.trim()) { toast({ variant: 'destructive', title: 'El título de la serie es requerido' }); return; }
    setYtImporting(true);
    try {
      const r = await fetch(`${BASE_API}/api/youtube/import-playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ playlistId: ytPreview.playlistId, title: ytForm.title, category: ytForm.category || undefined, genre: ytForm.genre || undefined, year: ytForm.year ? Number(ytForm.year) : undefined, poster: ytForm.poster || undefined, banner: ytForm.banner || undefined }),
      });
      const data = await r.json();
      if (!r.ok) { toast({ variant: 'destructive', title: data.error || 'Error al importar' }); return; }
      toast({ title: `Serie importada con ${data.episodesCreated} episodios` });
      setShowYtPlaylist(false); setYtUrl(''); setYtPreview(null); setYtForm({ title: '', category: '', genre: '', year: '', poster: '', banner: '' });
      refresh();
    } catch { toast({ variant: 'destructive', title: 'Error de red' }); }
    finally { setYtImporting(false); }
  };

  const handleYtManualCreate = async () => {
    const validLinks = ytManualLinks.filter(l => l.url.trim());
    if (!ytManualTitle.trim()) { toast({ variant: 'destructive', title: 'El título es requerido' }); return; }
    if (validLinks.length === 0) { toast({ variant: 'destructive', title: 'Agrega al menos un enlace de YouTube' }); return; }
    setYtManualCreating(true);
    try {
      const sr = await fetch(`${BASE_API}/api/series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ title: ytManualTitle.trim(), category: ytManualCategory.trim() || undefined, poster: ytManualPoster.trim() || undefined }),
      });
      if (!sr.ok) { toast({ variant: 'destructive', title: 'Error al crear la serie' }); setYtManualCreating(false); return; }
      const series = await sr.json();
      const snr = await fetch(`${BASE_API}/api/seasons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ seriesId: series.id, seasonNumber: 1, title: 'Temporada 1' }),
      });
      if (!snr.ok) { toast({ variant: 'destructive', title: 'Error al crear temporada' }); setYtManualCreating(false); return; }
      const season = await snr.json();
      let epFailed = 0;
      for (let i = 0; i < validLinks.length; i++) {
        const link = validLinks[i];
        const er = await fetch(`${BASE_API}/api/episodes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
          body: JSON.stringify({
            seriesId: series.id, seasonId: season.id,
            episodeNumber: i + 1,
            title: link.title.trim() || `Episodio ${i + 1}`,
            filePath: link.url.trim(),
            videoFormat: 'youtube',
          }),
        });
        if (!er.ok) epFailed++;
      }
      if (epFailed > 0) {
        toast({ variant: 'destructive', title: `${epFailed} episodio(s) no se pudieron crear` });
      } else {
        toast({ title: `Serie "${ytManualTitle.trim()}" creada con ${validLinks.length} episodio(s)` });
      }
      setShowYtManual(false);
      setYtManualTitle(''); setYtManualCategory(''); setYtManualPoster('');
      setYtManualLinks([{ url: '', title: '' }]);
      refresh();
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : '' });
    }
    setYtManualCreating(false);
  };

  const ytSeriesSearch = async () => {
    if (!ytSQuery.trim()) return;
    setYtSLoading(true);
    setYtSError('');
    setYtSNeedsKey(false);
    setYtSResults(null);
    setYtSExpandedPlaylist(null);
    setYtSExpandedVideo(null);
    setYtSImported(new Set());
    try {
      const r = await fetch(`${BASE_API}/api/youtube/series-search?q=${encodeURIComponent(ytSQuery)}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.needsKey) { setYtSNeedsKey(true); setYtSError(data.error || 'API key requerida'); }
        else throw new Error(data.error || 'Error buscando');
        return;
      }
      setYtSResults(data);
    } catch (e: any) { setYtSError(e.message); }
    finally { setYtSLoading(false); }
  };

  const ytSImportPlaylist = async (playlistId: string, form: { title: string; category: string; genre: string; year: string }) => {
    if (!form.title.trim()) { toast({ variant: 'destructive', title: 'El título es requerido' }); return; }
    setYtSImporting(prev => new Set(prev).add(playlistId));
    try {
      const r = await fetch(`${BASE_API}/api/youtube/import-playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ playlistId, title: form.title.trim(), category: form.category || undefined, genre: form.genre || undefined, year: form.year ? Number(form.year) : undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      toast({ title: `"${form.title}" importada con ${data.episodesCreated} episodios` });
      setYtSImported(prev => new Set(prev).add(playlistId));
      setYtSExpandedPlaylist(null);
      refresh();
    } catch (e: any) { toast({ variant: 'destructive', title: 'Error al importar', description: e.message }); }
    finally { setYtSImporting(prev => { const s = new Set(prev); s.delete(playlistId); return s; }); }
  };

  const ytSImportVideo = async (videoId: string, form: { title: string; category: string; genre: string }, thumbnail: string) => {
    if (!form.title.trim()) { toast({ variant: 'destructive', title: 'El título es requerido' }); return; }
    setYtSImporting(prev => new Set(prev).add(videoId));
    try {
      const r = await fetch(`${BASE_API}/api/youtube/import-video-as-series`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ videoId, title: form.title.trim(), category: form.category || undefined, genre: form.genre || undefined, poster: thumbnail }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error al importar');
      toast({ title: `"${form.title}" importada como serie` });
      setYtSImported(prev => new Set(prev).add(videoId));
      setYtSExpandedVideo(null);
      refresh();
    } catch (e: any) { toast({ variant: 'destructive', title: 'Error al importar', description: e.message }); }
    finally { setYtSImporting(prev => { const s = new Set(prev); s.delete(videoId); return s; }); }
  };

  const checkEpisodeUrls = async () => {
    setEpUrlChecking(true);
    setEpUrlCheckSel(new Set());
    epUrlCheckStopRef.current = false;
    const token = getAdminToken();
    const items: typeof epUrlCheckItems = [];
    for (const series of seriesList) {
      try {
        const r = await fetch(`${BASE_API}/api/series/${series.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) continue;
        const data = await r.json();
        for (const season of data.seasons || []) {
          for (const ep of season.episodes || []) {
            if (ep.filePath) {
              items.push({ epId: ep.id, seriesTitle: series.title, seasonTitle: season.title || `T${season.seasonNumber}`, epTitle: ep.title || `E${ep.episodeNumber}`, url: ep.filePath, status: 'pending' });
            }
          }
        }
      } catch { /* ignore */ }
    }
    setEpUrlCheckItems([...items]);
    for (let i = 0; i < items.length; i++) {
      if (epUrlCheckStopRef.current) break;
      setEpUrlCheckItems(prev => prev.map((r, j) => j === i ? { ...r, status: 'checking' } : r));
      try {
        const r = await fetch(`${BASE_API}/api/check-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ url: items[i].url }),
          signal: AbortSignal.timeout(12000),
        });
        const d = await r.json();
        setEpUrlCheckItems(prev => prev.map((r2, j) => j === i ? { ...r2, status: d.ok ? 'ok' : 'broken' } : r2));
      } catch {
        setEpUrlCheckItems(prev => prev.map((r2, j) => j === i ? { ...r2, status: 'broken' } : r2));
      }
    }
    setEpUrlChecking(false);
  };

  const deleteCheckedEpisodes = async () => {
    if (!confirm(`¿Eliminar ${epUrlCheckSel.size} episodio(s) seleccionado(s)?`)) return;
    const ids = [...epUrlCheckSel];
    const token = getAdminToken();
    for (const id of ids) {
      try { await fetch(`${BASE_API}/api/episodes/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch { /* ignore */ }
    }
    setEpUrlCheckSel(new Set());
    setEpUrlCheckItems(prev => prev.filter(r => !ids.includes(r.epId)));
    toast({ title: `${ids.length} episodio(s) eliminado(s)` });
    refresh();
  };

  const filtered = seriesList.filter(s => !searchQ || s.title.toLowerCase().includes(searchQ.toLowerCase()));

  const SeriesFormFields = ({ form, setForm }: { form: Partial<SeriesRow>; setForm: (v: Partial<SeriesRow>) => void }) => (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Título *</label>
          <Input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Nombre de la serie" className="bg-background" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Categoría</label>
          <Input value={form.category || ''} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Drama, Acción..." className="bg-background" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Género</label>
          <Input value={form.genre || ''} onChange={e => setForm({ ...form, genre: e.target.value })} placeholder="Drama" className="bg-background" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Año</label>
          <Input type="number" value={form.year || ''} onChange={e => setForm({ ...form, year: e.target.value ? Number(e.target.value) : undefined })} placeholder="2024" className="bg-background" />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Descripción</label>
        <Textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Sinopsis de la serie..." className="bg-background h-20" />
      </div>
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">URL YouTube (miniatura automática)</label>
          <Input
            placeholder="https://youtube.com/watch?v=... — pega aquí para auto-generar la carátula"
            className="bg-background"
            onChange={e => {
              const videoId = extractYtVideoId(e.target.value);
              if (videoId) {
                setForm({ ...form, poster: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` });
              }
            }}
          />
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">URL Poster</label>
            <Input value={form.poster || ''} onChange={e => setForm({ ...form, poster: e.target.value })} placeholder="https://..." className="bg-background" />
          </div>
          <Button variant="outline" size="sm" disabled={posterSearching || !form.title} onClick={() => handleSearchPoster(form.title || '')} className="flex-shrink-0">
            {posterSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="hidden sm:inline ml-1">TMDB</span>
          </Button>
        </div>
        {form.poster && (
          <img src={form.poster} alt="preview" className="h-24 w-auto rounded-lg object-cover border border-border" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">URL Banner</label>
        <Input value={form.banner || ''} onChange={e => setForm({ ...form, banner: e.target.value })} placeholder="https://... (imagen panorámica)" className="bg-background" />
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.featured} onChange={e => setForm({ ...form, featured: e.target.checked })} className="w-4 h-4 rounded" />
          Destacada
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.hidden} onChange={e => setForm({ ...form, hidden: e.target.checked })} className="w-4 h-4 rounded" />
          Oculta
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2"><Tv2 className="w-5 h-5" /> Series ({seriesList.length})</h3>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setShowSmartImport(true)} className="flex items-center gap-1.5">
            <Link2 className="w-4 h-4" /> Importar enlace
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowScanner(p => !p)} className="flex items-center gap-1.5">
            <Globe className="w-4 h-4" /> Escanear URL
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowYtPlaylist(p => !p); setYtPreview(null); }} className="flex items-center gap-1.5">
            <Play className="w-4 h-4" /> Playlist YouTube
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowYtManual(p => !p)} className="flex items-center gap-1.5">
            <Youtube className="w-4 h-4" /> Serie YouTube
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowYtSeriesSearch(true); setYtSResults(null); setYtSQuery(''); setYtSError(''); setYtSNeedsKey(false); setYtSImported(new Set()); }} className="flex items-center gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10">
            <Youtube className="w-4 h-4 text-red-500" /> Buscar en YouTube
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowEpUrlChecker(p => !p); if (!showEpUrlChecker) { setEpUrlCheckItems([]); setEpUrlCheckSel(new Set()); } }} className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Verificar URLs
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nueva Serie
          </Button>
        </div>
      </div>

      {showScanner && (
        <div className="bg-secondary/30 rounded-xl p-4 space-y-3 border border-border">
          <p className="text-sm font-medium flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Importar series desde carpeta HTTP</p>
          <p className="text-xs text-muted-foreground">URL de un directorio HTTP con subcarpetas de series. Se importarán automáticamente.</p>
          <div className="flex gap-2">
            <Input value={scanUrl} onChange={e => setScanUrl(e.target.value)} placeholder="https://servidor.com/series/" className="bg-background flex-1" />
            <Button onClick={handleScanFolder} disabled={scanning || !scanUrl.trim()}>
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="ml-1">Escanear</span>
            </Button>
          </div>
        </div>
      )}

      {showYtPlaylist && (
        <div className="bg-secondary/30 rounded-xl p-4 space-y-4 border border-border">
          <p className="text-sm font-medium flex items-center gap-2"><Play className="w-4 h-4 text-red-500" /> Importar serie desde playlist de YouTube</p>
          <p className="text-xs text-muted-foreground">Pega la URL de una playlist de YouTube. Se creará una serie con todos los videos como episodios de la Temporada 1.</p>
          <div className="flex gap-2">
            <Input value={ytUrl} onChange={e => { setYtUrl(e.target.value); setYtPreview(null); }} placeholder="https://www.youtube.com/playlist?list=PL..." className="bg-background flex-1" />
            <Button onClick={handleYtPreview} disabled={ytPreviewing || !ytUrl.trim()}>
              {ytPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="ml-1">Vista previa</span>
            </Button>
          </div>

          {ytPreview && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border">
                {ytPreview.thumbnail && <img src={ytPreview.thumbnail} alt={ytPreview.title} className="w-20 h-14 object-cover rounded flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{ytPreview.title}</p>
                  <p className="text-xs text-muted-foreground">{ytPreview.channelTitle} · {ytPreview.itemCount} videos</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Título de la serie *</label>
                  <Input value={ytForm.title} onChange={e => setYtForm(f => ({ ...f, title: e.target.value }))} className="bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Categoría</label>
                  <Input value={ytForm.category} onChange={e => setYtForm(f => ({ ...f, category: e.target.value }))} placeholder="Drama, Acción..." className="bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Género</label>
                  <Input value={ytForm.genre} onChange={e => setYtForm(f => ({ ...f, genre: e.target.value }))} placeholder="Drama" className="bg-background" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Año</label>
                  <Input type="number" value={ytForm.year} onChange={e => setYtForm(f => ({ ...f, year: e.target.value }))} placeholder="2024" className="bg-background" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs text-muted-foreground">URL Poster</label>
                  <Input value={ytForm.poster} onChange={e => setYtForm(f => ({ ...f, poster: e.target.value }))} className="bg-background" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Episodios encontrados ({ytPreview.items.length})</p>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {ytPreview.items.map((ep, i) => (
                    <div key={ep.videoId} className="flex items-center gap-2 text-xs p-1.5 rounded bg-background/60">
                      <span className="text-muted-foreground w-6 text-right flex-shrink-0">{i + 1}.</span>
                      <img src={ep.thumbnail} alt="" className="w-10 h-7 object-cover rounded flex-shrink-0" />
                      <span className="truncate">{ep.title}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setShowYtPlaylist(false); setYtUrl(''); setYtPreview(null); setYtForm({ title: '', category: '', genre: '', year: '', poster: '', banner: '' }); }}>Cancelar</Button>
                <Button onClick={handleYtImport} disabled={ytImporting || !ytForm.title.trim()}>
                  {ytImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Importar {ytPreview.itemCount} episodios
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {showYtManual && (
        <div className="bg-secondary/30 rounded-xl p-4 space-y-4 border border-border">
          <p className="text-sm font-medium flex items-center gap-2"><Youtube className="w-4 h-4 text-red-500" /> Crear serie con enlaces de YouTube</p>
          <p className="text-xs text-muted-foreground">Escribe el título y pega los enlaces de YouTube en orden. Cada enlace será un capítulo.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Título de la serie *</label>
              <Input value={ytManualTitle} onChange={e => setYtManualTitle(e.target.value)} placeholder="Ej: La Ley Divina" className="bg-background" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Categoría</label>
              <Input value={ytManualCategory} onChange={e => setYtManualCategory(e.target.value)} placeholder="Drama, Acción..." className="bg-background" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Capítulos ({ytManualLinks.filter(l => l.url.trim()).length} con enlace)
              </label>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setYtManualLinks(ls => [...ls, { url: '', title: '' }])}>
                <Plus className="w-3 h-3" /> Añadir capítulo
              </Button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {ytManualLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6 text-right flex-shrink-0 font-medium">{i + 1}.</span>
                  <Input
                    value={link.url}
                    onChange={e => {
                      const val = e.target.value;
                      setYtManualLinks(ls => ls.map((l, j) => j === i ? { ...l, url: val } : l));
                      const firstWithUrl = ytManualLinks.findIndex((l, j) => j !== i ? l.url.trim() : val.trim());
                      if (i === 0 || firstWithUrl === -1 || firstWithUrl === i) {
                        const vid = extractYtVideoId(val);
                        if (vid && !ytManualPoster) setYtManualPoster(`https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`);
                      }
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="bg-background text-xs h-8 flex-1 min-w-0"
                  />
                  <Input
                    value={link.title}
                    onChange={e => setYtManualLinks(ls => ls.map((l, j) => j === i ? { ...l, title: e.target.value } : l))}
                    placeholder={`Capítulo ${i + 1}`}
                    className="bg-background text-xs h-8 w-32 flex-shrink-0"
                  />
                  {ytManualLinks.length > 1 && (
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive flex-shrink-0" onClick={() => setYtManualLinks(ls => ls.filter((_, j) => j !== i))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Carátula (poster)</label>
            <div className="flex gap-2 items-start">
              {ytManualPoster && (
                <img
                  src={ytManualPoster}
                  alt="poster"
                  className="h-24 w-auto rounded-lg object-cover border border-border flex-shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="flex-1 space-y-1">
                <Input
                  value={ytManualPoster}
                  onChange={e => {
                    const val = e.target.value;
                    const vid = extractYtVideoId(val);
                    setYtManualPoster(vid ? `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg` : val);
                  }}
                  placeholder="Se genera automáticamente del primer capítulo, o pega una URL"
                  className="bg-background text-xs"
                />
                {ytManualPoster && (
                  <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground px-1" onClick={() => setYtManualPoster('')}>
                    Quitar carátula
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowYtManual(false); setYtManualTitle(''); setYtManualCategory(''); setYtManualPoster(''); setYtManualLinks([{ url: '', title: '' }]); }}>Cancelar</Button>
            <Button onClick={handleYtManualCreate} disabled={ytManualCreating || !ytManualTitle.trim() || ytManualLinks.filter(l => l.url.trim()).length === 0}>
              {ytManualCreating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Crear Serie ({ytManualLinks.filter(l => l.url.trim()).length} cap.)
            </Button>
          </div>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar series..." className="pl-8 bg-background" />
      </div>

      {showEpUrlChecker && (
        <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <p className="text-sm font-medium">Verificador de URLs de Episodios</p>
              {epUrlCheckItems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {epUrlCheckItems.filter(r => r.status === 'ok').length} OK · {epUrlCheckItems.filter(r => r.status === 'broken').length} rotas · {epUrlCheckItems.filter(r => r.status === 'checking').length} verificando
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {epUrlCheckSel.size > 0 && (
                <Button size="sm" variant="destructive" onClick={deleteCheckedEpisodes}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Eliminar {epUrlCheckSel.size} episodio(s)
                </Button>
              )}
              {epUrlCheckItems.length > 0 && !epUrlChecking && (
                <Button size="sm" variant="outline" onClick={() => {
                  const brokenIds = new Set(epUrlCheckItems.filter(r => r.status === 'broken').map(r => r.epId));
                  setEpUrlCheckSel(brokenIds);
                }}>
                  Seleccionar rotos ({epUrlCheckItems.filter(r => r.status === 'broken').length})
                </Button>
              )}
              {epUrlChecking ? (
                <Button size="sm" variant="outline" onClick={() => { epUrlCheckStopRef.current = true; setEpUrlChecking(false); }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Detener
                </Button>
              ) : (
                <Button size="sm" onClick={checkEpisodeUrls} disabled={seriesList.length === 0}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />Verificar episodios
                </Button>
              )}
            </div>
          </div>
          {epUrlCheckItems.length > 0 && (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {epUrlCheckItems.map((item, i) => (
                <div key={`${item.epId}-${i}`} className={`flex items-center gap-2 p-2 rounded-lg text-xs border transition-colors ${item.status === 'broken' ? 'border-destructive/40 bg-destructive/5' : item.status === 'ok' ? 'border-green-500/20 bg-green-500/5' : 'border-border bg-background/40'}`}>
                  <input type="checkbox" className="accent-primary w-3.5 h-3.5 cursor-pointer flex-shrink-0"
                    checked={epUrlCheckSel.has(item.epId)}
                    onChange={() => setEpUrlCheckSel(prev => { const n = new Set(prev); n.has(item.epId) ? n.delete(item.epId) : n.add(item.epId); return n; })}
                  />
                  <span className="flex-shrink-0 w-14 font-semibold">
                    {item.status === 'checking' ? <span className="text-amber-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />...</span>
                      : item.status === 'ok' ? <span className="text-green-400">✓ OK</span>
                      : item.status === 'broken' ? <span className="text-destructive">✗ Rota</span>
                      : <span className="text-muted-foreground">–</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{item.seriesTitle} · {item.seasonTitle} · {item.epTitle}</p>
                    <p className="truncate text-muted-foreground hidden sm:block">{item.url}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {epUrlCheckItems.length === 0 && !epUrlChecking && (
            <p className="text-xs text-muted-foreground text-center py-2">Haz clic en "Verificar episodios" para cargar y comprobar todas las URLs</p>
          )}
          {epUrlChecking && epUrlCheckItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2 flex items-center justify-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />Cargando episodios...</p>
          )}
        </div>
      )}

      {showCreate && (
        <div className="border border-border rounded-xl p-4 space-y-4 bg-secondary/20">
          <h4 className="font-semibold">Nueva Serie</h4>
          <SeriesFormFields form={createForm} setForm={(v) => setCreateForm(p => ({ ...p, ...v }))} />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowCreate(false); setCreateForm(form0); }}>Cancelar</Button>
            <Button onClick={handleCreate}>Crear Serie</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Cargando series...</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground"><Tv2 className="w-12 h-12 mx-auto mb-3 opacity-20" /><p>{searchQ ? 'Sin resultados' : 'No hay series aún. Crea la primera.'}</p></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(series => (
            <div key={series.id} className="border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3 bg-card hover:bg-card/80 transition-colors">
                <div className="w-10 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                  {series.poster ? <img src={series.poster} alt={series.title} className="w-full h-full object-cover" /> : <Tv2 className="w-5 h-5 text-muted-foreground/40" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{series.title}</p>
                    {series.featured && <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-[9px] font-bold rounded uppercase">Destacada</span>}
                    {series.hidden && <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[9px] rounded uppercase">Oculta</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{[series.category, series.genre, series.year].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setEditSeries(series)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive hover:text-destructive" onClick={() => handleDelete(series.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => loadExpanded(series.id)}>
                    {expandedId === series.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {expandedId === series.id && (
                <div className="border-t border-border p-4 bg-background/50 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium">Temporadas y episodios</p>
                    <Button size="sm" variant="outline" onClick={() => setShowSeasonForm(series.id)} className="text-xs gap-1">
                      <Plus className="w-3.5 h-3.5" /> Nueva Temporada
                    </Button>
                  </div>

                  <div className="flex gap-2 items-center flex-wrap">
                    <Input value={seriesScanUrl} onChange={e => setSeriesScanUrl(e.target.value)} placeholder="URL carpeta de episodios para auto-importar..." className="bg-background text-xs h-8 flex-1 min-w-48" />
                    <Button size="sm" variant="outline" onClick={() => handleScanSeasons(series.id)} disabled={scanningSeasons || !seriesScanUrl.trim()} className="text-xs gap-1">
                      {scanningSeasons ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                      Auto-importar
                    </Button>
                  </div>

                  {showSeasonForm === series.id && (
                    <div className="bg-card border border-border rounded-lg p-3 space-y-3">
                      <p className="text-xs font-medium">Nueva temporada</p>
                      <div className="flex gap-2">
                        <Input type="number" value={newSeasonForm.seasonNumber} onChange={e => setNewSeasonForm(p => ({ ...p, seasonNumber: e.target.value }))} placeholder="N° temporada" className="bg-background w-28 text-sm h-8" />
                        <Input value={newSeasonForm.title} onChange={e => setNewSeasonForm(p => ({ ...p, title: e.target.value }))} placeholder="Título (opcional)" className="bg-background flex-1 text-sm h-8" />
                        <Button size="sm" onClick={handleAddSeason} className="h-8">Crear</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowSeasonForm(null)} className="h-8">Cancelar</Button>
                      </div>
                    </div>
                  )}

                  {expandedLoading ? (
                    <div className="py-4 text-center text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando...</div>
                  ) : !expandedSeries?.seasons.length ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Sin temporadas. Crea una o usa Auto-importar.</p>
                  ) : expandedSeries.seasons.map(season => (
                    <div key={season.id} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between gap-2 p-2.5 bg-card">
                        <p className="text-sm font-medium">{season.title || `Temporada ${season.seasonNumber}`} <span className="text-xs text-muted-foreground font-normal">({season.episodes.length} ep.)</span></p>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2" onClick={() => { setShowYtBulk({ seriesId: series.id, seasonId: season.id, seasonEpCount: season.episodes.length }); setYtBulkText(''); setShowEpForm(null); }}><Youtube className="w-3 h-3 text-red-500" /> YouTube</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2" onClick={() => { setShowEpForm({ seriesId: series.id, seasonId: season.id }); setShowYtBulk(null); }}><Plus className="w-3 h-3" /> Episodio</Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteSeason(season.id, series.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                      {showYtBulk?.seasonId === season.id && (
                        <div className="p-3 border-t border-border bg-background/60 space-y-2">
                          <p className="text-xs font-medium text-red-500">Agregar episodios YouTube en masa</p>
                          <p className="text-[10px] text-muted-foreground">Pega un enlace de YouTube por línea. Se agregarán como episodios continuando desde el E{season.episodes.length + 1}.</p>
                          <textarea
                            className="w-full bg-background border border-border rounded text-xs p-2 h-28 resize-none font-mono"
                            placeholder={"https://youtu.be/abc123\nhttps://youtu.be/def456\nhttps://youtu.be/ghi789"}
                            value={ytBulkText}
                            onChange={e => setYtBulkText(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleYtBulkAdd} disabled={ytBulkAdding || !ytBulkText.trim()} className="h-8 text-xs bg-red-600 hover:bg-red-700">
                              {ytBulkAdding ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                              Agregar {ytBulkText.split('\n').filter(l => l.trim()).length} ep.
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowYtBulk(null)} className="h-8 text-xs">Cancelar</Button>
                          </div>
                        </div>
                      )}
                      {showEpForm?.seasonId === season.id && (
                        <div className="p-3 border-t border-border bg-background/60 space-y-2">
                          <p className="text-xs font-medium">Nuevo episodio</p>
                          <div className="grid grid-cols-2 gap-2">
                            <Input type="number" value={newEpForm.episodeNumber} onChange={e => setNewEpForm(p => ({ ...p, episodeNumber: e.target.value }))} placeholder="N° episodio" className="bg-background text-xs h-8" />
                            <Input value={newEpForm.title} onChange={e => setNewEpForm(p => ({ ...p, title: e.target.value }))} placeholder="Título *" className="bg-background text-xs h-8" />
                            <Input value={newEpForm.filePath} onChange={e => {
                              const val = e.target.value;
                              const ytId = extractYtVideoId(val);
                              setNewEpForm(p => ({ ...p, filePath: val, ...(ytId && !p.thumbnail ? { thumbnail: `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` } : {}) }));
                            }} placeholder="URL del video * (YouTube → miniatura automática)" className="bg-background text-xs h-8 col-span-2" />
                            <div className="col-span-2 flex items-center gap-2">
                              <label className="text-xs text-muted-foreground shrink-0">Formato:</label>
                              <select className="text-xs bg-background border border-border rounded px-2 py-1 h-8 flex-1" value={newEpForm.videoFormat} onChange={e => setNewEpForm(p => ({ ...p, videoFormat: e.target.value }))}>
                                <option value="">Auto-detectar</option>
                                <option value="hls">HLS (.m3u8)</option>
                                <option value="dash">DASH (.mpd)</option>
                                <option value="native">Nativo (MP4, WebM…)</option>
                                <option value="flv">FLV</option>
                              </select>
                            </div>
                            <Input value={newEpForm.description} onChange={e => setNewEpForm(p => ({ ...p, description: e.target.value }))} placeholder="Descripción (opcional)" className="bg-background text-xs h-8 col-span-2" />
                            <Input value={newEpForm.thumbnail} onChange={e => {
                              const val = e.target.value;
                              const ytId = extractYtVideoId(val);
                              setNewEpForm(p => ({ ...p, thumbnail: ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : val }));
                            }} placeholder="URL thumbnail (o pega URL de YouTube)" className="bg-background text-xs h-8 col-span-2" />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddEpisode} className="h-8 text-xs">Agregar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowEpForm(null)} className="h-8 text-xs">Cancelar</Button>
                          </div>
                        </div>
                      )}
                      {season.episodes.length > 0 && (
                        <div className="divide-y divide-border">
                          {season.episodes.map(ep => (
                            <div key={ep.id}>
                              <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                                <span className="text-xs text-muted-foreground w-6 flex-shrink-0">E{ep.episodeNumber}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">{ep.title}</p>
                                  <p className="text-[10px] text-muted-foreground truncate">{ep.filePath}</p>
                                  {ep.thumbnail && <p className="text-[10px] text-blue-400 truncate">🖼 {ep.thumbnail}</p>}
                                </div>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => setEditEp(editEp?.id === ep.id ? null : { ...ep })}><Pencil className="w-3.5 h-3.5" /></Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive flex-shrink-0" onClick={() => handleDeleteEpisode(ep.id, series.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                              </div>
                              {editEp?.id === ep.id && (
                                <div className="px-3 pb-3 pt-1 bg-muted/20 border-t border-border space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <label className="text-[10px] text-muted-foreground">N° episodio</label>
                                      <Input type="number" value={editEp.episodeNumber} onChange={e => setEditEp(p => p ? { ...p, episodeNumber: Number(e.target.value) } : p)} className="bg-background text-xs h-8" />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] text-muted-foreground">Título</label>
                                      <Input value={editEp.title} onChange={e => setEditEp(p => p ? { ...p, title: e.target.value } : p)} className="bg-background text-xs h-8" />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] text-muted-foreground">URL del video (YouTube u otro)</label>
                                    <Input value={editEp.filePath} onChange={e => setEditEp(p => p ? { ...p, filePath: e.target.value } : p)} placeholder="https://youtube.com/watch?v=..." className="bg-background text-xs h-8 font-mono" />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] text-muted-foreground">URL de imagen/miniatura (opcional)</label>
                                    <Input value={editEp.thumbnail || ''} onChange={e => setEditEp(p => p ? { ...p, thumbnail: e.target.value } : p)} placeholder="https://i.ytimg.com/vi/..." className="bg-background text-xs h-8" />
                                  </div>
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={handleSaveEpisode} disabled={editEpSaving} className="h-8 text-xs">
                                      {editEpSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Guardar
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditEp(null)} className="h-8 text-xs">Cancelar</Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <SmartLinkImport
        open={showSmartImport}
        onClose={() => setShowSmartImport(false)}
        onImported={() => refresh()}
      />

      {/* YouTube Series Search Dialog */}
      <Dialog open={showYtSeriesSearch} onOpenChange={o => !o && setShowYtSeriesSearch(false)}>
        <DialogContent className="max-w-2xl w-full h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Youtube className="w-5 h-5 text-red-500" />
              Buscar series en YouTube
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Busca playlists (por episodios) o series completas en un solo video</p>
          </DialogHeader>

          <div className="px-4 py-3 flex-shrink-0 border-b border-border flex gap-2">
            <Input
              placeholder="Nombre de la serie… ej: 'Breaking Bad', 'El Chavo', 'narcos'"
              value={ytSQuery}
              onChange={e => setYtSQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') ytSeriesSearch(); }}
              className="flex-1"
              autoFocus
            />
            <Button onClick={ytSeriesSearch} disabled={ytSLoading || !ytSQuery.trim()}>
              {ytSLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0 space-y-4">
            {ytSError && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p>{ytSError}</p>
                  {ytSNeedsKey && <p className="text-xs mt-1 opacity-70">Agrega tu YOUTUBE_API_KEY en los Secrets del proyecto para usar esta función.</p>}
                </div>
              </div>
            )}
            {ytSLoading && (
              <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-sm">Buscando en YouTube...</span>
              </div>
            )}
            {!ytSLoading && !ytSResults && !ytSError && (
              <div className="text-center py-16 text-muted-foreground">
                <Youtube className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Escribe el nombre de la serie y presiona Enter</p>
                <p className="text-xs mt-1 opacity-50">Se buscarán playlists con episodios y videos de series completas</p>
              </div>
            )}

            {!ytSLoading && ytSResults && (() => {
              const { playlists, videos } = ytSResults;
              return (
                <div className="space-y-5">
                  {/* Playlists section */}
                  {playlists.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <ListVideo className="w-4 h-4 text-red-400" />
                        <p className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">Por episodios — Playlists ({playlists.length})</p>
                      </div>
                      {playlists.map(pl => (
                        <div key={pl.playlistId} className="rounded-lg border border-border bg-card overflow-hidden">
                          <div className="flex gap-3 p-3">
                            <div className="relative flex-shrink-0">
                              <img src={pl.thumbnail} alt="" className="w-24 h-14 object-cover rounded bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              {pl.episodeCount > 0 && (
                                <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                                  {pl.episodeCount} ep.
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm leading-tight line-clamp-2">{pl.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{pl.channel}</p>
                              {pl.episodeCount > 0 && (
                                <p className="text-xs text-primary/70 mt-0.5">{pl.episodeCount} episodios en la playlist</p>
                              )}
                            </div>
                            <div className="flex-shrink-0 flex items-start">
                              {ytSImported.has(pl.playlistId) ? (
                                <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded">✓ Importada</span>
                              ) : (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  variant={ytSExpandedPlaylist === pl.playlistId ? 'default' : 'outline'}
                                  onClick={() => {
                                    if (ytSExpandedPlaylist === pl.playlistId) { setYtSExpandedPlaylist(null); return; }
                                    setYtSExpandedPlaylist(pl.playlistId);
                                    setYtSExpandedVideo(null);
                                    if (!ytSPlaylistForms[pl.playlistId]) {
                                      setYtSPlaylistForms(f => ({ ...f, [pl.playlistId]: { title: pl.title, category: '', genre: '', year: '' } }));
                                    }
                                  }}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Importar
                                </Button>
                              )}
                            </div>
                          </div>
                          {ytSExpandedPlaylist === pl.playlistId && !ytSImported.has(pl.playlistId) && (
                            <div className="px-3 pb-3 pt-0 border-t border-border bg-muted/20 space-y-2">
                              <p className="text-xs font-medium pt-2 text-muted-foreground">Configurar serie a importar</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2 space-y-1">
                                  <label className="text-[10px] text-muted-foreground">Título de la serie *</label>
                                  <Input
                                    value={ytSPlaylistForms[pl.playlistId]?.title || ''}
                                    onChange={e => setYtSPlaylistForms(f => ({ ...f, [pl.playlistId]: { ...f[pl.playlistId], title: e.target.value } }))}
                                    className="bg-background h-8 text-xs"
                                    placeholder="Nombre de la serie"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] text-muted-foreground">Categoría</label>
                                  <Input value={ytSPlaylistForms[pl.playlistId]?.category || ''} onChange={e => setYtSPlaylistForms(f => ({ ...f, [pl.playlistId]: { ...f[pl.playlistId], category: e.target.value } }))} className="bg-background h-8 text-xs" placeholder="Drama, Acción..." />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] text-muted-foreground">Año</label>
                                  <Input type="number" value={ytSPlaylistForms[pl.playlistId]?.year || ''} onChange={e => setYtSPlaylistForms(f => ({ ...f, [pl.playlistId]: { ...f[pl.playlistId], year: e.target.value } }))} className="bg-background h-8 text-xs" placeholder="2024" />
                                </div>
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  className="h-8 text-xs bg-red-600 hover:bg-red-700"
                                  disabled={ytSImporting.has(pl.playlistId)}
                                  onClick={() => ytSImportPlaylist(pl.playlistId, ytSPlaylistForms[pl.playlistId] || { title: pl.title, category: '', genre: '', year: '' })}
                                >
                                  {ytSImporting.has(pl.playlistId) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                                  Importar {pl.episodeCount > 0 ? `${pl.episodeCount} episodios` : 'playlist'}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setYtSExpandedPlaylist(null)}>Cancelar</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Single-video series section */}
                  {videos.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Film className="w-4 h-4 text-amber-400" />
                        <p className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">Serie completa — Video único ({videos.length})</p>
                      </div>
                      {videos.map(vid => (
                        <div key={vid.videoId} className="rounded-lg border border-border bg-card overflow-hidden">
                          <div className="flex gap-3 p-3">
                            <div className="relative flex-shrink-0">
                              <img src={vid.thumbnail} alt="" className="w-24 h-14 object-cover rounded bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              {vid.duration && (
                                <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-semibold px-1 py-0.5 rounded tabular-nums">{vid.duration}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm leading-tight line-clamp-2">{vid.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{vid.channel}</p>
                              {vid.duration && <p className="text-xs text-amber-400/70 mt-0.5">Duración: {vid.duration}</p>}
                            </div>
                            <div className="flex-shrink-0 flex items-start">
                              {ytSImported.has(vid.videoId) ? (
                                <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded">✓ Importada</span>
                              ) : (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  variant={ytSExpandedVideo === vid.videoId ? 'default' : 'outline'}
                                  onClick={() => {
                                    if (ytSExpandedVideo === vid.videoId) { setYtSExpandedVideo(null); return; }
                                    setYtSExpandedVideo(vid.videoId);
                                    setYtSExpandedPlaylist(null);
                                    if (!ytSVideoForms[vid.videoId]) {
                                      setYtSVideoForms(f => ({ ...f, [vid.videoId]: { title: vid.title, category: '', genre: '' } }));
                                    }
                                  }}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Importar
                                </Button>
                              )}
                            </div>
                          </div>
                          {ytSExpandedVideo === vid.videoId && !ytSImported.has(vid.videoId) && (
                            <div className="px-3 pb-3 pt-0 border-t border-border bg-muted/20 space-y-2">
                              <p className="text-xs font-medium pt-2 text-muted-foreground">Configurar serie a importar</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2 space-y-1">
                                  <label className="text-[10px] text-muted-foreground">Título de la serie *</label>
                                  <Input
                                    value={ytSVideoForms[vid.videoId]?.title || ''}
                                    onChange={e => setYtSVideoForms(f => ({ ...f, [vid.videoId]: { ...f[vid.videoId], title: e.target.value } }))}
                                    className="bg-background h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] text-muted-foreground">Categoría</label>
                                  <Input value={ytSVideoForms[vid.videoId]?.category || ''} onChange={e => setYtSVideoForms(f => ({ ...f, [vid.videoId]: { ...f[vid.videoId], category: e.target.value } }))} className="bg-background h-8 text-xs" placeholder="Drama, Acción..." />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] text-muted-foreground">Género</label>
                                  <Input value={ytSVideoForms[vid.videoId]?.genre || ''} onChange={e => setYtSVideoForms(f => ({ ...f, [vid.videoId]: { ...f[vid.videoId], genre: e.target.value } }))} className="bg-background h-8 text-xs" placeholder="Drama" />
                                </div>
                              </div>
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  className="h-8 text-xs"
                                  disabled={ytSImporting.has(vid.videoId)}
                                  onClick={() => ytSImportVideo(vid.videoId, ytSVideoForms[vid.videoId] || { title: vid.title, category: '', genre: '' }, vid.thumbnail)}
                                >
                                  {ytSImporting.has(vid.videoId) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                                  Importar como serie
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setYtSExpandedVideo(null)}>Cancelar</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {playlists.length === 0 && videos.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Youtube className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No se encontraron resultados para "{ytSQuery}"</p>
                      <p className="text-xs mt-1 opacity-60">Prueba con otro nombre o término de búsqueda</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <DialogFooter className="px-4 py-3 border-t border-border flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowYtSeriesSearch(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editSeries} onOpenChange={(o) => !o && setEditSeries(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader><DialogTitle>Editar Serie</DialogTitle></DialogHeader>
          {editSeries && <SeriesFormFields form={editSeries} setForm={(v) => setEditSeries(p => p ? ({ ...p, ...v } as SeriesRow) : p)} />}
          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setEditSeries(null)}>Cancelar</Button>
            <Button onClick={handleUpdate}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
