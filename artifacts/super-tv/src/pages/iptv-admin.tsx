import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBase } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type Channel = { id: number; name: string; category: string | null; logo: string | null };
type Account = { id: number; username: string; channelIds: number[]; enabled: boolean };
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [copyValue, setCopyValue] = useState('');
  const [accessUrl, setAccessUrl] = useState('');
  const users = useQuery({ queryKey: usersKey, queryFn: async () => (await (await request('/users')).json()) as Account[] });
  const channels = useQuery({ queryKey: ['admin', 'iptv', 'channels'], queryFn: async () => (await (await request('/channels')).json()) as Channel[] });
  const available = channels.data ?? [];
  const assigned = available.filter(channel => selected === null || selected.has(channel.id));
  const allAssigned = available.length > 0 && assigned.length === available.length;
  const showError = (error: Error) => toast({ variant: 'destructive', title: error.message });

  const create = useMutation({
    mutationFn: async () => {
      const response = await request('/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, channelIds: assigned.map(channel => channel.id) }),
      });
      const account: Account & { accessUrl: string } = await response.json();
      return account.accessUrl;
    },
    onSuccess: url => {
      setAccessUrl(url);
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
        <h3 className="font-semibold">Crear usuario IPTV</h3>
        <label className="block text-sm">Usuario
          <Input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off"
            required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._\x2D]{2,31}" disabled={create.isPending} />
        </label>
        <label className="block text-sm">Contraseña
          <Input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}
            required minLength={8} maxLength={128} disabled={create.isPending} />
        </label>
        <fieldset disabled={create.isPending} className="space-y-2">
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
        </fieldset>
        <Button type="submit" disabled={create.isPending || !assigned.length}>
          {create.isPending ? 'Creando…' : 'Crear usuario IPTV'}
        </Button>
        {accessUrl && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2">
            <Button type="button" variant="outline" onClick={() => void copy(accessUrl, 'URL de acceso copiada')}>Copiar URL de acceso</Button>
            <Button type="button" variant="ghost" onClick={() => setAccessUrl('')}>Cerrar</Button>
          </div>
        )}
      </form>
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-semibold">Usuarios IPTV</h3>
        {users.isPending && <p className="text-sm">Cargando usuarios…</p>}
        {users.isError && <p className="text-sm text-destructive">No se pudieron cargar los usuarios IPTV.</p>}
        {users.data?.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay usuarios IPTV.</p>}
        {users.data?.map(account => (
          <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2">
            <div>
              <p className="text-sm font-medium">{account.username}</p>
              <p className="text-xs text-muted-foreground">{account.channelIds.length} canales · {account.enabled ? 'Activo' : 'Desactivado'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!account.enabled} onClick={() => void copyList(account)}>Copiar lista M3U8</Button>
              <Button size="sm" variant="outline" disabled={!account.enabled} onClick={() => void copyAccess(account)}>Copiar URL de lista</Button>
              <Button size="sm" variant="ghost" disabled={changeState.isPending} onClick={() => changeState.mutate(account)}>
                {account.enabled ? 'Desactivar' : 'Activar'}
              </Button>
            </div>
          </div>
        ))}
        {copyValue && <Textarea aria-label="Texto para copiar" readOnly value={copyValue} onFocus={event => event.target.select()} />}
      </section>
    </div>
  );
}
