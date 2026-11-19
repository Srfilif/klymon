import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText, useSession } from '../lib/session';

export function OverviewPage(): React.JSX.Element {
  const { client, user } = useSession();
  const [data, setData] = useState<{ balance: number; sessions: number; devices: number; minecraft: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [wallet, sessions, devices, minecraft] = await Promise.all([
          client.wallet(),
          client.sessions(),
          client.devices(),
          client.minecraftAccounts(),
        ]);
        if (!cancelled) setData({ balance: wallet.balance, sessions: sessions.length, devices: devices.length, minecraft: minecraft.length });
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
      <h1>Hola, {user?.username}</h1>
      <p className="muted">
        {user?.email} · {user?.emailVerified ? 'Email verificado' : 'Email sin verificar'} ·{' '}
        <Link to="/profile">Editar perfil</Link>
      </p>
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <p className="muted">Cargando…</p> : null}
      {data ? (
        <div className="grid">
          <Link className="card link" to="/wallet">
            <h3>Monedero</h3>
            <p className="big">{data.balance} pts</p>
          </Link>
          <Link className="card link" to="/security">
            <h3>Sesiones activas</h3>
            <p className="big">{data.sessions}</p>
          </Link>
          <Link className="card link" to="/devices">
            <h3>Dispositivos</h3>
            <p className="big">{data.devices}</p>
          </Link>
          <Link className="card link" to="/minecraft">
            <h3>Cuentas Minecraft</h3>
            <p className="big">{data.minecraft}</p>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
