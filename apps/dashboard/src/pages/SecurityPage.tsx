import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

export function SecurityPage(): React.JSX.Element {
  const { client } = useSession();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSessions(await client.sessions());
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const revoke = async (id: string): Promise<void> => {
    await client.revokeSession(id);
    await reload();
  };

  const changePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setChanged(false);
    try {
      await client.changePassword(current, next);
      setChanged(true);
      setCurrent('');
      setNext('');
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Seguridad</h1>
      {error ? <p className="error">{error}</p> : null}
      <h2>Cambiar contraseña</h2>
      <form className="form" onSubmit={(event) => void changePassword(event)}>
        <label>
          Actual
          <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          Nueva (mínimo 8)
          <input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" required />
        </label>
        {changed ? <p className="ok">Contraseña cambiada. Las demás sesiones se cerraron.</p> : null}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Cambiando…' : 'Cambiar'}
        </button>
      </form>
      <h2>Sesiones activas ({sessions.length})</h2>
      {sessions.length === 0 ? (
        <p className="muted">Sin sesiones activas.</p>
      ) : (
        <ul className="rows">
          {sessions.map((session) => (
            <li key={session.id}>
              <div>
                <strong>{session.userAgent || 'Dispositivo desconocido'}</strong>
                <br />
                <span className="muted">
                  {session.ip || 'IP desconocida'} · expira {new Date(session.expiresAt).toLocaleString()}
                </span>
              </div>
              <button type="button" className="button small danger" onClick={() => void revoke(session.id).catch((err: unknown) => setError(errorText(err)))}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
