import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Device, DevicePreview } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

export function DevicesPage(): React.JSX.Element {
  const { client } = useSession();
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<DevicePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setDevices(await client.devices());
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const revoke = async (id: string): Promise<void> => {
    await client.revokeDevice(id);
    await reload();
  };

  const lookup = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      setPreview(await client.previewDeviceCode(code.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approved: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (approved) {
        await client.approveDeviceCode(code.trim());
        setNotice('Dispositivo vinculado.');
      } else {
        await client.denyDeviceCode(code.trim());
        setNotice('Solicitud denegada.');
      }
      setCode('');
      setPreview(null);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Dispositivos</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}
      <h2>Vincular nuevo dispositivo</h2>
      <p className="muted">Escribe el código que muestra el juego para vincularlo a tu cuenta.</p>
      <form className="form" onSubmit={(event) => void lookup(event)}>
        <label>
          Código (XXXX-XXXX)
          <input value={code} maxLength={12} onChange={(event) => setCode(event.target.value)} placeholder="ABCD-2345" required />
        </label>
        <button type="submit" className="button small" disabled={busy}>
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
      </form>
      {preview ? (
        <ul className="rows">
          <li>
            <div>
              <strong>{preview.clientName ?? 'Dispositivo desconocido'}</strong>
              <br />
              <span className="muted">Caduca {new Date(preview.expiresAt).toLocaleString()}</span>
            </div>
            <div className="pager">
              <button type="button" className="button small primary" disabled={busy} onClick={() => void decide(true)}>
                Vincular
              </button>
              <button type="button" className="button small danger" disabled={busy} onClick={() => void decide(false)}>
                Denegar
              </button>
            </div>
          </li>
        </ul>
      ) : null}
      {devices.length === 0 ? (
        <p className="muted">Sin dispositivos registrados.</p>
      ) : (
        <ul className="rows">
          {devices.map((device) => (
            <li key={device.id}>
              <div>
                <strong>{device.userAgent || 'Dispositivo desconocido'}</strong>
                <br />
                <span className="muted">
                  {device.ip || 'IP desconocida'} · visto {new Date(device.lastSeenAt).toLocaleString()} ·{' '}
                  {device.activeSessions} sesiones · {device.revoked ? 'revocado' : 'activo'}
                </span>
              </div>
              {!device.revoked ? (
                <button
                  type="button"
                  className="button small danger"
                  onClick={() => void revoke(device.id).catch((err: unknown) => setError(errorText(err)))}
                >
                  Revocar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
