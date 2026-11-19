import { useState, type FormEvent } from 'react';
import { errorText, useSession } from '../lib/session';

export function ProfilePage(): React.JSX.Element {
  const { client, user, refreshUser } = useSession();
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyState, setVerifyState] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await client.updateProfile({ bio: bio.trim() === '' ? null : bio.trim() });
      await refreshUser();
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const requestVerification = async (): Promise<void> => {
    setVerifyState(null);
    try {
      const result = await client.requestEmailVerification();
      setVerifyState(result.alreadyVerified ? 'Tu email ya está verificado.' : 'Te hemos enviado un email de verificación.');
    } catch (err) {
      setVerifyState(errorText(err));
    }
  };

  return (
    <div>
      <h1>Perfil</h1>
      <p className="muted">
        {user?.username} · {user?.email} · {user?.emailVerified ? 'verificado' : 'sin verificar'}
      </p>
      {!user?.emailVerified ? (
        <p>
          <button type="button" className="button small" onClick={() => void requestVerification()}>
            Enviar verificación
          </button>{' '}
          {verifyState ? <span className="muted">{verifyState}</span> : null}
        </p>
      ) : null}
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label>
          Bio (máximo 280)
          <textarea value={bio} maxLength={280} rows={3} onChange={(event) => setBio(event.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="ok">Perfil guardado.</p> : null}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  );
}
