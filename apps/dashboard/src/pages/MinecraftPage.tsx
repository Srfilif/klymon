import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { MinecraftAccount } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

export function MinecraftPage(): React.JSX.Element {
  const { client } = useSession();
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uuid, setUuid] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setAccounts(await client.minecraftAccounts());
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const link = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.linkMinecraft({ uuid: uuid.trim(), username: username.trim() });
      setUuid('');
      setUsername('');
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (id: string): Promise<void> => {
    await client.unlinkMinecraft(id);
    await reload();
  };

  return (
    <div>
      <h1>Cuentas Minecraft</h1>
      {error ? <p className="error">{error}</p> : null}
      {accounts.length === 0 ? (
        <p className="muted">Sin cuentas vinculadas.</p>
      ) : (
        <ul className="rows">
          {accounts.map((account) => (
            <li key={account.id}>
              <div>
                <strong>{account.username}</strong> <span className="muted">{account.verified ? '· verificada' : '· sin verificar'}</span>
                <br />
                <span className="muted">{account.uuid}</span>
              </div>
              <button type="button" className="button small danger" onClick={() => void unlink(account.id).catch((err: unknown) => setError(errorText(err)))}>
                Desvincular
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>Vincular cuenta</h2>
      <form className="form" onSubmit={(event) => void link(event)}>
        <label>
          UUID
          <input value={uuid} onChange={(event) => setUuid(event.target.value)} placeholder="069a79f4-…" required />
        </label>
        <label>
          Nombre de jugador
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Vinculando…' : 'Vincular'}
        </button>
      </form>
      <p className="muted">Sin token de sesión de Minecraft, el vínculo queda sin verificar.</p>
    </div>
  );
}
