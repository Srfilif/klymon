import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, type SyncConflictDetails, type SyncDocument, type SyncProfile, type SyncVersion } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

const NAMESPACES = ['launcher-settings', 'client-config', 'hud-layout', 'keybindings', 'loadout'];

function conflictServer(error: unknown): SyncDocument | null | undefined {
  if (error instanceof ApiError && error.statusCode === 409) {
    const details = error.details as SyncConflictDetails | undefined;
    if (details && 'server' in details) return details.server;
  }
  return undefined;
}

export function SyncPage(): React.JSX.Element {
  const { client } = useSession();
  const [profiles, setProfiles] = useState<SyncProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [docs, setDocs] = useState<Record<string, SyncDocument | null>>({});
  const [namespace, setNamespace] = useState(NAMESPACES[0] ?? 'loadout');
  const [text, setText] = useState('{}');
  const [base, setBase] = useState<number | null>(null);
  const [history, setHistory] = useState<SyncVersion[]>([]);
  const [server, setServer] = useState<SyncDocument | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadProfiles = useCallback(async () => {
    try {
      const list = await client.listSyncProfiles();
      setProfiles(list);
      if (list.length > 0 && !list.some((entry) => entry.id === profileId)) {
        setProfileId(list[0]?.id ?? '');
      }
      if (list.length === 0) setProfileId('');
    } catch (err) {
      setError(errorText(err));
    }
  }, [client, profileId]);

  const reloadDocs = useCallback(async () => {
    if (profileId === '') {
      setDocs({});
      setHistory([]);
      return;
    }
    try {
      const list = await client.listSyncDocuments(profileId);
      const byNamespace: Record<string, SyncDocument | null> = {};
      for (const entry of NAMESPACES) byNamespace[entry] = null;
      for (const doc of list) byNamespace[doc.namespace] = doc;
      setDocs(byNamespace);
      const current = byNamespace[namespace];
      setText(JSON.stringify(current?.content ?? {}, null, 2));
      setBase(current?.version ?? null);
      setServer(null);
      setHistory(current ? await client.listSyncVersions(profileId, namespace) : []);
    } catch (err) {
      setError(errorText(err));
    }
  }, [client, profileId, namespace]);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  useEffect(() => {
    void reloadDocs();
  }, [reloadDocs]);

  const createProfile = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await client.createSyncProfile(name.trim());
      setName('');
      setNotice(`Perfil "${created.name}" creado.`);
      setProfileId(created.id);
      await reloadProfiles();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const removeProfile = async (id: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await client.deleteSyncProfile(id);
      setNotice('Perfil eliminado con todos sus documentos.');
      await reloadProfiles();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const parseEditor = (): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        setError('El documento debe ser un objeto JSON.');
        return null;
      }
      return value as Record<string, unknown>;
    } catch {
      setError('JSON inválido.');
      return null;
    }
  };

  const push = async (force: boolean): Promise<void> => {
    const content = parseEditor();
    if (!content || profileId === '') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const doc = await client.pushSyncDocument(profileId, namespace, base, content, force);
      setBase(doc.version);
      setServer(null);
      setNotice(force ? `Sobrescrito como v${doc.version}.` : `Guardado como v${doc.version}.`);
      await reloadDocs();
    } catch (err) {
      const conflict = conflictServer(err);
      if (conflict !== undefined) {
        setServer(conflict);
        setError('Conflicto: el servidor cambió desde tu base. Revisa abajo y elige.');
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const useServer = (): void => {
    if (!server) return;
    setText(JSON.stringify(server.content, null, 2));
    setBase(server.version);
    setServer(null);
    setNotice('Editor actualizado con la copia del servidor. Pulsa Guardar para confirmar.');
  };

  const restore = async (version: number): Promise<void> => {
    if (profileId === '' || base === null) return;
    setError(null);
    setNotice(null);
    try {
      const doc = await client.restoreSyncVersion(profileId, namespace, base, version);
      setBase(doc.version);
      setNotice(`Versión ${version} restaurada como v${doc.version}.`);
      await reloadDocs();
    } catch (err) {
      const conflict = conflictServer(err);
      if (conflict !== undefined) {
        setServer(conflict);
        setError('Conflicto al restaurar: recarga y reintenta.');
      } else {
        setError(errorText(err));
      }
    }
  };

  return (
    <div>
      <h1>Nube ({profiles.length}/10 perfiles)</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}
      <ul className="rows">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <div>
              <strong>{profile.name}</strong> <span className="muted">· {profile.documentCount} documentos</span>
            </div>
            <div className="pager">
              <button
                type="button"
                className={`button small${profile.id === profileId ? ' primary' : ''}`}
                onClick={() => setProfileId(profile.id)}
              >
                {profile.id === profileId ? 'Activo' : 'Usar'}
              </button>
              <button type="button" className="button small danger" onClick={() => void removeProfile(profile.id)}>
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={(event) => void createProfile(event)}>
        <label>
          Nuevo perfil
          <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="main" required />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Creando…' : 'Crear'}
        </button>
      </form>
      {profileId === '' ? null : (
        <>
          <h2>Documentos</h2>
          <ul className="rows">
            {NAMESPACES.map((entry) => {
              const doc = docs[entry];
              return (
                <li key={entry}>
                  <div>
                    <strong>{entry}</strong>{' '}
                    <span className="muted">{doc ? `v${doc.version} · ${doc.updatedBy ?? 'desconocido'}` : 'nunca subido'}</span>
                  </div>
                  <button type="button" className={`button small${entry === namespace ? ' primary' : ''}`} onClick={() => setNamespace(entry)}>
                    {entry === namespace ? 'Editando' : 'Editar'}
                  </button>
                </li>
              );
            })}
          </ul>
          <h2>
            {namespace} {base === null ? '(nuevo)' : `(base v${base})`}
          </h2>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void push(false);
            }}
          >
            <label>
              Contenido JSON
              <textarea value={text} rows={10} onChange={(event) => setText(event.target.value)} spellCheck={false} />
            </label>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar (push)'}
            </button>
          </form>
          {server ? (
            <section>
              <h2>Conflicto: copia del servidor (v{server.version})</h2>
              <p className="muted">Subido por {server.updatedBy ?? 'desconocido'} · tu edición sigue en el formulario.</p>
              <pre className="muted">{JSON.stringify(server.content, null, 2).slice(0, 2000)}</pre>
              <div className="pager">
                <button type="button" className="button small primary" disabled={busy} onClick={() => void push(true)}>
                  Quedarme la mía (forzar)
                </button>
                <button type="button" className="button small" onClick={useServer}>
                  Quedarme la del servidor
                </button>
              </div>
            </section>
          ) : null}
          <h2>Historial ({history.length})</h2>
          <ul className="rows">
            {history.map((entry) => (
              <li key={entry.version}>
                <div>
                  <strong>v{entry.version}</strong> <span className="muted">· {entry.updatedBy ?? 'desconocido'} · {entry.createdAt}</span>
                </div>
                {entry.version === base ? null : (
                  <button type="button" className="button small" onClick={() => void restore(entry.version)}>
                    Restaurar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {history.length === 0 ? <p className="muted">Sin versiones todavía.</p> : null}
        </>
      )}
    </div>
  );
}
