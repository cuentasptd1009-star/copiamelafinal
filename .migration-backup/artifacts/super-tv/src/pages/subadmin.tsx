import { useState, useMemo } from 'react';
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe, getGetMeQueryKey, useAdminLogin,
  useListCodes, getListCodesQueryKey,
  useListPackages, getListPackagesQueryKey,
  useBuyPackage, useDeleteCode,
} from '@workspace/api-client-react';
import { setToken, clearTokens } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Wallet, Key, Package as PackageIcon, LogOut, ShoppingCart, Copy, Trash2, RefreshCw, Search, X, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import logo from '@assets/logo_supertv.png';

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

export default function SubadminPanel() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const loginMutation = useAdminLogin();

  const { data: session, isLoading: sessionLoading, error: sessionError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false }
  });

  useEffect(() => {
    if (!sessionError && session && session.type === 'admin') {
      setLocation('/admin');
    }
  }, [session, sessionError, setLocation]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setIsLoggingIn(true);
    loginMutation.mutate({ data: { username, password } }, {
      onSuccess: (data) => {
        setToken(data.token, 'admin');
        if (data.role === 'admin') setLocation('/admin');
        else window.location.reload();
      },
      onError: () => {
        toast({ variant: 'destructive', title: 'Error', description: 'Usuario o contraseña incorrectos' });
        setIsLoggingIn(false);
      }
    });
  };

  const handleLogout = () => { clearTokens(); window.location.reload(); };

  if (sessionLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center text-primary">Cargando...</div>
  );

  if (!session || session.type !== 'subadmin') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-border">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center">
              <img src={logo} alt="Super TV" className="h-16" />
            </div>
            <CardTitle className="text-2xl font-bold">Panel de Vendedor</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} />
              <Input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? 'Entrando...' : 'Entrar'}
              </Button>
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
          <span className="text-base sm:text-xl font-bold text-primary border-l border-border pl-3 sm:pl-4">Vendedor</span>
        </div>
        <div className="flex items-center space-x-3 sm:space-x-4">
          <span className="text-xs sm:text-sm font-medium hidden sm:inline">{session.username}</span>
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="flex-1 p-3 sm:p-6 overflow-auto max-w-7xl mx-auto w-full space-y-6">
        <SubadminDashboard balance={session.balance ?? 0} />
      </main>
    </div>
  );
}

type CodeItem = {
  id: number;
  code: string;
  name?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
  isExpired: boolean;
};

function SubadminDashboard({ balance }: { balance: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: codes } = useListCodes({ query: { queryKey: getListCodesQueryKey() } });
  const { data: packages } = useListPackages({ query: { queryKey: getListPackagesQueryKey() } });
  const buyMutation = useBuyPackage();
  const deleteMutation = useDeleteCode();

  const [lastCode, setLastCode] = useState<string | null>(null);
  const [currentBalance, setCurrentBalance] = useState(balance);

  const [renewTarget, setRenewTarget] = useState<CodeItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CodeItem | null>(null);
  const [codeSearch, setCodeSearch] = useState('');
  const [codeStatusFilter, setCodeStatusFilter] = useState<'all' | 'active' | 'expired' | 'inactive'>('all');

  const pkgList = (packages as any[]) || [];

  const filteredCodes = useMemo(() => {
    let list = (codes || []) as CodeItem[];
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

  const refreshData = () => {
    qc.invalidateQueries({ queryKey: getListCodesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const handleBuy = (packageId: number, codeId?: number) => {
    buyMutation.mutate({ data: { packageId, ...(codeId ? { codeId } : {}) } }, {
      onSuccess: (data) => {
        refreshData();
        setCurrentBalance(data.remainingBalance);
        if (!codeId) {
          setLastCode(data.code?.code ?? null);
          toast({
            title: 'Código generado',
            description: `Código: ${data.code?.code ?? ''} | Saldo: $${data.remainingBalance.toFixed(2)}`,
          });
        } else {
          setRenewTarget(null);
          const newExpiry = data.code?.expiresAt
            ? new Date(data.code.expiresAt).toLocaleDateString('es-ES')
            : '';
          toast({
            title: 'Código renovado',
            description: `Nuevo vencimiento: ${newExpiry} | Saldo: $${data.remainingBalance.toFixed(2)}`,
          });
        }
      },
      onError: (err: any) => {
        const msg = (err?.error || err?.message || '').toLowerCase();
        if (msg.includes('saldo')) {
          toast({ variant: 'destructive', title: 'Saldo insuficiente', description: 'No tienes saldo suficiente.' });
        } else if (msg.includes('asignado')) {
          toast({ variant: 'destructive', title: 'Paquete no disponible', description: 'Este paquete no está asignado a tu cuenta.' });
        } else {
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudo completar la operación.' });
        }
      }
    });
  };

  const handleDelete = (codeId: number) => {
    deleteMutation.mutate({ id: codeId }, {
      onSuccess: () => {
        refreshData();
        setDeleteTarget(null);
        toast({ title: 'Código eliminado' });
      },
      onError: () => {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar el código.' });
      }
    });
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => toast({ title: 'Código copiado' })).catch(() => {});
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mi Saldo</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">${currentBalance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Saldo disponible</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Códigos Generados</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{codes?.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Total en tu cuenta</p>
          </CardContent>
        </Card>
      </div>

      {lastCode && (
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm text-muted-foreground">Último código generado:</p>
              <p className="text-2xl font-mono font-bold text-primary tracking-widest">{lastCode}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => copyCode(lastCode)}>
              <Copy className="w-4 h-4 mr-2" />Copiar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <PackageIcon className="w-5 h-5 text-primary" />
            Paquetes Disponibles
          </h3>
          {pkgList.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No tienes paquetes asignados aún.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {pkgList.map((pkg: any) => {
                const pkgId = pkg.packageId ?? pkg.id;
                const pkgName = pkg.packageName ?? pkg.name;
                const duration = pkg.durationMinutes;
                const price = pkg.effectivePrice ?? pkg.price ?? 0;

                return (
                  <Card key={pkgId} className="bg-card border-border hover:border-primary/50 transition-colors">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{pkgName}</CardTitle>
                      <CardDescription className="text-sm">
                        {minutesToLabel(duration)} de acceso
                        {pkg.description && ` · ${pkg.description}`}
                      </CardDescription>
                    </CardHeader>
                    <CardFooter className="flex justify-between items-center pt-0">
                      <div>
                        <span className="text-xl font-bold text-primary">${Number(price).toFixed(2)}</span>
                        {price === 0 && <span className="ml-2 text-xs text-green-400">Gratis</span>}
                      </div>
                      <Button
                        onClick={() => handleBuy(pkgId)}
                        disabled={buyMutation.isPending || (price > 0 && currentBalance < price)}
                        size="sm"
                      >
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        {price > 0 && currentBalance < price ? 'Sin saldo' : 'Generar código'}
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              Mis Códigos
              <span className="text-sm font-normal text-muted-foreground">
                ({filteredCodes.length}{(codeSearch.trim() || codeStatusFilter !== 'all') ? ` de ${codes?.length ?? 0}` : ''})
              </span>
            </h3>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={codeSearch}
              onChange={e => setCodeSearch(e.target.value)}
              placeholder="Buscar por código o nombre..."
              className="pl-9 pr-8 bg-card border-border"
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
                <button key={s} onClick={() => setCodeStatusFilter(s)} className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${colors[s]}`}>
                  {labels[s]}
                </button>
              );
            })}
          </div>
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCodes.map((code) => (
                    <TableRow key={code.id}>
                      <TableCell className="font-mono font-bold text-primary tracking-wider text-sm">{code.code}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          code.isExpired ? 'bg-yellow-500/20 text-yellow-400' :
                          code.isActive ? 'bg-green-500/20 text-green-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {code.isExpired ? 'Expirado' : code.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString('es-ES') : 'Ilimitado'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="w-7 h-7" title="Copiar" onClick={() => copyCode(code.code)}>
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="w-7 h-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            title="Renovar"
                            onClick={() => setRenewTarget(code as CodeItem)}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="w-7 h-7 text-destructive hover:bg-destructive/10"
                            title="Eliminar"
                            onClick={() => setDeleteTarget(code as CodeItem)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredCodes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                        {codeSearch.trim() ? 'Sin resultados para esa búsqueda.' : 'No has generado ningún código aún.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <RenewModal
        open={!!renewTarget}
        code={renewTarget}
        packages={pkgList}
        currentBalance={currentBalance}
        isPending={buyMutation.isPending}
        onRenew={(pkgId) => renewTarget && handleBuy(pkgId, renewTarget.id)}
        onClose={() => setRenewTarget(null)}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar código</DialogTitle>
            <DialogDescription>
              ¿Seguro que quieres eliminar el código{' '}
              <span className="font-mono font-bold text-primary">{deleteTarget?.code}</span>?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RenewModal({
  open, code, packages, currentBalance, isPending, onRenew, onClose,
}: {
  open: boolean;
  code: CodeItem | null;
  packages: any[];
  currentBalance: number;
  isPending: boolean;
  onRenew: (pkgId: number) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-400" />
            Renovar código
          </DialogTitle>
          <DialogDescription>
            Código: <span className="font-mono font-bold text-primary">{code?.code}</span>
            {code?.expiresAt && (
              <> · Vence: <span className="text-foreground">{new Date(code.expiresAt).toLocaleDateString('es-ES')}</span></>
            )}
            <br />
            <span className="text-xs">El tiempo del paquete se sumará al vencimiento actual.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {packages.filter((pkg: any) => (pkg.effectivePrice ?? pkg.price ?? 0) > 0).map((pkg: any) => {
            const pkgId = pkg.packageId ?? pkg.id;
            const pkgName = pkg.packageName ?? pkg.name;
            const duration = pkg.durationMinutes;
            const price = pkg.effectivePrice ?? pkg.price ?? 0;
            const canAfford = currentBalance >= price;

            return (
              <button
                key={pkgId}
                disabled={isPending || !canAfford}
                onClick={() => onRenew(pkgId)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors
                  ${canAfford
                    ? 'border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer'
                    : 'border-border/40 opacity-50 cursor-not-allowed'}
                `}
              >
                <div>
                  <p className="text-sm font-medium">{pkgName}</p>
                  <p className="text-xs text-muted-foreground">+{minutesToLabel(duration)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-primary">${Number(price).toFixed(2)}</p>
                  {!canAfford && <p className="text-xs text-destructive">Sin saldo</p>}
                </div>
              </button>
            );
          })}
          {packages.filter((pkg: any) => (pkg.effectivePrice ?? pkg.price ?? 0) > 0).length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-4">No hay paquetes de pago disponibles para renovar.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

