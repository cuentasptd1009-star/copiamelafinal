import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBase } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type Channel = { id: number; name: string; category: string | null; logo: string | null };
type Account = { id: number; username: string; channelIds: number[]; importedCount?: number; enabled: boolean; expiresAt: string | null };
type Unit = 'days' | 'months' | 'years';
const units = { days: 'Días', months: 'Meses', years: 'Años' };
const xtreamBase = 'https://167-233-103-143.sslip.io';

function DurationFields({ amount, unit, setAmount, setUnit }: {
  amount: string; unit: Unit; setAmount: (value: string) => void; setUnit: (value: Unit) => void;
}) {
  return <div className="flex gap-2">
    <Input aria-label="Cantidad de tiempo" type="number" min={1} max={36500} step={1} value={amount}
      onChange={event => setAmount(event.target.value)} required />
    <select aria-label="Unidad de tiempo" className="rounded-md border border-input bg-background px-2 text-sm"
      value={unit} onChange={event => setUnit(event.target.value as Unit)}>
      {(Object.entries(units) as [Unit, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </div>;
}
const usersKey = ['admin', 'iptv', 'users'];

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}/api/iptv/admin${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${getToken('admin') || ''}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `La solicitud falló (HTTP ${response.status}).`);
  }
  return response;
}

export function IptvAdmin() {
  const { toast } = useToast();
  const client = useQueryClient();
  const [merge, setMerge] = useState(false);
  const [providerServer, setProviderServer] = useState('');
  const [providerUsername, setProviderUsername] = useState('');
  const [providerPassword, setProviderPassword] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [m3uFile, setM3uFile] = useState<File | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [copyValue, setCopyValue] = useState('');
  const [accessUrl, setAccessUrl] = useState('');
  const [xtream, setXtream] = useState<{ username: string; password: string } | null>(null);
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<Unit>('days');
  const [editing, setEditing] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [renewAmount, setRenewAmount] = useState('30');
  const [renewUnit, setRenewUnit] = useState<Unit>('days');
  const users = useQuery({ queryKey: usersKey, queryFn: async () => (await (await request('/users')).json()) as Account[] });
  const channels = useQuery({ queryKey: ['admin', 'iptv', 'channels'], queryFn: async () => (await (await request('/channels')).json()) as Channel[] });
  const available = channels.data ?? [];
  const assigned = available.filter(channel => selected === null || selected.has(channel.id));
  const allAssigned = available.length > 0 && assigned.length === available.length;
  const showError = (error: Error) => toast({ variant: 'destructive', title: error.message });

  const create = useMutation({
    mutationFn: async () => {
      const duration = { amount: Number(amount), unit };
      if (merge && m3uFile && m3uFile.size > 1536 * 1024) {
        throw new Error('El archivo supera 1,5 MB. Usa un enlace M3U.');
      }
      const source = merge ? {
        providerServer, providerUsername, providerPassword,
        ...(m3uFile ? { m3uText: await m3uFile.text() } : { m3uUrl }),
      } : { channelIds: assigned.map(channel => channel.id) };
      const body = JSON.stringify({ username, password, duration, ...source });
      if (merge && new Blob([body]).size >= 2 * 1024 * 1024) {
        throw new Error('El archivo es demasiado grande. Usa un enlace M3U.');
      }
      const response = await request(merge ? '/merge' : '/users', { method: 'POST', body });
      const account: Account & { accessUrl: string } = await response.json();
      return { url: account.accessUrl, username: account.username, password };
    },
    onSuccess: account => {
      setAccessUrl(account.url);
      setXtream({ username: account.username, password: account.password });
      setAmount('30');
      setUnit('days');
      setProviderPassword('');
      setUsername('');
      setPassword('');
      setSelected(null);
      void client.invalidateQueries({ queryKey: usersKey });
      toast({ title: 'Usuario IPTV creado' });
    },
    onError: showError,
  });
  const changeState = useMutation({
    mutationFn: (account: Account) => request(`/users/${account.id}`, {
      method: 'PATCH', body: JSON.stringify({ enabled: !account.enabled }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: usersKey }),
    onError: showError,
  });

  const updateAccount = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { password?: string; duration?: { amount: number; unit: Unit } } }) =>
      request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async (_data, variables) => {
      setNewPassword('');
      await client.invalidateQueries({ queryKey: usersKey });
      toast({ title: variables.body.password ? 'Contraseña cambiada. Copia la nueva URL de lista.' : 'Servicio renovado' });
    },
    onError: showError,
  });

  async function copy(value: string, title: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyValue('');
      toast({ title });
    } catch {
      setCopyValue(value);
    }
  }

  async function copyList(account: Account) {
    try {
      const response = await request(`/users/${account.id}/list.m3u8`);
      await copy(await response.text(), 'Lista M3U8 copiada');
    } catch (error) {
      showError(error as Error);
    }
  }

  async function copyAccess(account: Account) {
    try {
      const response = await request(`/users/${account.id}/access`);
      const { url } = await response.json();
      await copy(url, 'URL de lista copiada');
    } catch (error) {
      showError(error as Error);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const matches = available.filter(channel =>
    `${channel.name} ${channel.category ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{merge ? 'Unir IPTV' : 'Crear usuario IPTV'}</h3>
          <Button type="button" variant="outline" size="sm" disabled={create.isPending} onClick={() => {
            setMerge(!merge); setAccessUrl(''); setXtream(null); setCopyValue('');
            setUsername(''); setPassword(''); setProviderPassword(''); setM3uFile(null);
          }}>{merge ? 'Volver a usuarios IPTV' : 'Unir IPTV'}</Button>
        </div>
        {merge && <fieldset disabled={create.isPending} className="grid gap-3 xl:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border p-3">
            <h4 className="text-sm font-medium">Cuenta del proveedor</h4>
            <label className="block text-sm">URL del servidor
              <Input type="url" value={providerServer} onChange={event => setProviderServer(event.target.value)} required />
            </label>
            <label className="block text-sm">Usuario del proveedor
              <Input value={providerUsername} onChange={event => setProviderUsername(event.target.value)} autoComplete="off" required />
            </label>
            <label className="block text-sm">Contraseña del proveedor
              <Input type="password" value={providerPassword} onChange={event => setProviderPassword(event.target.value)} autoComplete="off" required />
            </label>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <h4 className="text-sm font-medium">Mi lista de canales</h4>
            <label className="block text-sm">Enlace M3U
              <Input type="url" value={m3uUrl} disabled={!!m3uFile} onChange={event => setM3uUrl(event.target.value)} required={!m3uFile} />
            </label>
            <label className="block text-sm">O sube un archivo M3U
              <Input type="file" accept=".m3u,.m3u8" onChange={event => setM3uFile(event.target.files?.[0] ?? null)} />
            </label>
            {m3uFile && <Button type="button" variant="ghost" size="sm" onClick={event => {
              const field = event.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type=file]');
              if (field) field.value = '';
              setM3uFile(null);
            }}>Quitar archivo</Button>}
            <p className="text-xs text-muted-foreground">Los canales de esta lista irán primero.</p>
          </div>
        </fieldset>}
        <label className="block text-sm">{merge ? 'Usuario del acceso único' : 'Usuario'}
          <Input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off"
            required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._\x2D]{2,31}" disabled={create.isPending} />
        </label>
        <label className="block text-sm">{merge ? 'Contraseña del acceso único' : 'Contraseña'}
          <Input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}
            required minLength={8} maxLength={128} disabled={create.isPending} />
        </label>
        <div className="space-y-1">
          <p className="text-sm">Duración del servicio</p>
          <DurationFields amount={amount} unit={unit} setAmount={setAmount} setUnit={setUnit} />
        </div>
        {!merge && <fieldset disabled={create.isPending} className="space-y-2">
          <legend className="text-sm">Canales asignados ({assigned.length})</legend>
          <Button type="button" size="sm" variant={allAssigned ? 'default' : 'outline'} aria-pressed={allAssigned}
            disabled={!available.length} onClick={() => setSelected(allAssigned ? new Set() : null)}>
            Asignar todo
          </Button>
          <Input aria-label="Buscar canales IPTV" placeholder="Buscar por nombre o categoría" value={search}
            onChange={event => setSearch(event.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded border border-border p-2">
            {channels.isError && <p className="text-sm text-destructive">No se pudieron cargar los canales.</p>}
            {channels.isPending && <p className="text-sm">Cargando canales…</p>}
            {!channels.isPending && !channels.isError && !matches.length && <p className="text-sm">No hay canales HLS para esta búsqueda.</p>}
            {matches.map(channel => (
              <label key={channel.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted">
                <input type="checkbox" checked={selected === null || selected.has(channel.id)} onChange={event => {
                  const checked = event.target.checked;
                  setSelected(current => {
                    const next = new Set(current ?? available.map(item => item.id));
                    if (checked) next.add(channel.id); else next.delete(channel.id);
                    return next;
                  });
                }} />
                <span>{channel.name}</span>
                {channel.category && <span className="ml-auto text-muted-foreground">{channel.category}</span>}
              </label>
            ))}
          </div>
        </fieldset>}
        <Button type="submit" disabled={create.isPending || (!merge && !assigned.length)}>
          {create.isPending ? 'Creando…' : merge ? 'Crear acceso único' : 'Crear usuario IPTV'}
        </Button>
        {accessUrl && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2">
            <Button type="button" variant="outline" onClick={() => void copy(accessUrl, 'URL de acceso copiada')}>Copiar URL de acceso</Button>
            {xtream && <Button type="button" variant="outline" onClick={() => void copy(
              `Servidor: ${xtreamBase}\nUsuario: ${xtream.username}\nContraseña: ${xtream.password}`, 'Datos Xtream copiados'
            )}>Copiar datos Xtream</Button>}
            <Button type="button" variant="ghost" onClick={() => { setAccessUrl(''); setXtream(null); setCopyValue(''); }}>Cerrar</Button>
          </div>
        )}
      </form>
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-semibold">Usuarios IPTV</h3>
        {users.isPending && <p className="text-sm">Cargando usuarios…</p>}
        {users.isError && <p className="text-sm text-destructive">No se pudieron cargar los usuarios IPTV.</p>}
        {users.data?.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay usuarios IPTV.</p>}
        <p className="text-xs text-muted-foreground">Xtream Codes · Servidor {xtreamBase} · 5 dispositivos simultáneos por cuenta</p>
        {users.data?.map(account => (
          <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2">
            <div>
              <p className="text-sm font-medium">{account.username}</p>
              <p className="text-xs text-muted-foreground">{account.channelIds.length + (account.importedCount ?? 0)} canales · {!account.enabled ? 'Desactivado' :
                account.expiresAt && Date.parse(account.expiresAt) <= Date.now() ? 'Expirado' : 'Activo'}</p>
              <p className="text-xs text-muted-foreground">{account.expiresAt
                ? `Vence el ${new Date(account.expiresAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}`
                : 'Sin vencimiento asignado'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!account.enabled} onClick={() => void copyList(account)}>Copiar lista M3U8</Button>
              <Button size="sm" variant="outline" disabled={!account.enabled} onClick={() => void copyAccess(account)}>Copiar URL de lista</Button>
              <Button size="sm" variant="outline" onClick={() => {
                setEditing(editing === account.id ? null : account.id);
                setNewPassword(''); setRenewAmount('30'); setRenewUnit('days');
              }}>Gestionar</Button>
              <Button size="sm" variant="ghost" disabled={changeState.isPending} onClick={() => changeState.mutate(account)}>
                {account.enabled ? 'Desactivar' : 'Activar'}
              </Button>
            </div>
            {editing === account.id && (
              <div className="grid w-full gap-3 rounded border border-border p-2 sm:grid-cols-2">
                <form className="space-y-2" onSubmit={event => {
                  event.preventDefault();
                  updateAccount.mutate({ id: account.id, body: { password: newPassword } });
                }}>
                  <Input type="password" autoComplete="new-password" aria-label="Nueva contraseña IPTV"
                    placeholder="Nueva contraseña" required minLength={8} maxLength={128} value={newPassword}
                    onChange={event => setNewPassword(event.target.value)} />
                  <Button type="submit" size="sm" disabled={updateAccount.isPending}>Cambiar contraseña</Button>
                </form>
                <form className="space-y-2" onSubmit={event => {
                  event.preventDefault();
                  updateAccount.mutate({ id: account.id, body: { duration: { amount: Number(renewAmount), unit: renewUnit } } });
                }}>
                  <DurationFields amount={renewAmount} unit={renewUnit} setAmount={setRenewAmount} setUnit={setRenewUnit} />
                  <Button type="submit" size="sm" disabled={updateAccount.isPending}>Añadir tiempo</Button>
                </form>
              </div>
            )}
          </div>
        ))}
        {copyValue && <Textarea aria-label="Texto para copiar" readOnly value={copyValue} onFocus={event => event.target.select()} />}
      </section>
    </div>
  );
}
