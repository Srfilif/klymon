import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AdminUserRow } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

const PAGE_SIZE = 20;

export function UsersPage(): React.JSX.Element {
  const { client } = useSession();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await client.adminUsers({ limit: PAGE_SIZE, offset, search: applied === '' ? undefined : applied });
      setUsers(result.users);
      setTotal(result.total);
    } catch (err) {
      setError(errorText(err));
    }
  }, [client, offset, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setOffset(0);
    setApplied(search.trim());
  };

  return (
    <div>
      <h1>Usuarios ({total})</h1>
      {error ? <p className="error">{error}</p> : null}
      <form className="form inline" onSubmit={submit}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por usuario o email" />
        <button type="submit" className="button small">
          Buscar
        </button>
      </form>
      <ul className="rows">
        {users.map((user) => (
          <li key={user.id}>
            <div>
              <strong>{user.username}</strong> <span className="muted">· {user.role}</span>
              <br />
              <span className="muted">
                {user.email} · {user.emailVerified ? 'verificado' : 'sin verificar'} · {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="pager">
        <button type="button" className="button small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ← Anterior
        </button>
        <button type="button" className="button small" disabled={offset + users.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}
