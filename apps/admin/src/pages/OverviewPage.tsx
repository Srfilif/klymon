import { useEffect, useState } from 'react';
import type { AdminStats } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

export function OverviewPage(): React.JSX.Element {
  const { client } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client
      .adminStats()
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <div>
      <h1>Resumen</h1>
      {error ? <p className="error">{error}</p> : null}
      {!stats && !error ? <p className="muted">Cargando…</p> : null}
      {stats ? (
        <div className="grid">
          <div className="card"><h3>Usuarios</h3><p className="big">{stats.users}</p></div>
          <div className="card"><h3>Emails verificados</h3><p className="big">{stats.verifiedUsers}</p></div>
          <div className="card"><h3>Sesiones activas</h3><p className="big">{stats.activeSessions}</p></div>
          <div className="card"><h3>Dispositivos</h3><p className="big">{stats.devices}</p></div>
          <div className="card"><h3>Cuentas Minecraft</h3><p className="big">{stats.minecraftLinks}</p></div>
          <div className="card"><h3>Saldo total</h3><p className="big">{stats.walletsTotalBalance} pts</p></div>
          <div className="card"><h3>Movimientos</h3><p className="big">{stats.transactions}</p></div>
        </div>
      ) : null}
    </div>
  );
}
