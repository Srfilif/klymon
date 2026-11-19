import { useEffect, useState } from 'react';
import type { WalletEntry } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

export function WalletPage(): React.JSX.Element {
  const { client } = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [wallet, history] = await Promise.all([client.wallet(), client.transactions(50)]);
        if (!cancelled) {
          setBalance(wallet.balance);
          setEntries(history);
        }
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <div>
      <h1>Monedero</h1>
      {error ? <p className="error">{error}</p> : null}
      <p className="big">{balance === null ? '…' : `${balance} pts`}</p>
      <h2>Movimientos</h2>
      {entries.length === 0 ? (
        <p className="muted">Todavía no hay movimientos.</p>
      ) : (
        <ul className="rows">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong className={entry.amount >= 0 ? 'ok' : 'error'}>
                  {entry.amount >= 0 ? '+' : ''}
                  {entry.amount}
                </strong>{' '}
                <span className="muted">· {entry.type}</span>
                <br />
                <span className="muted">
                  {entry.reason || 'Sin motivo'} · saldo {entry.balanceAfter} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
