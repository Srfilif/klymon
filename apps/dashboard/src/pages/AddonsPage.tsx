import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AddonDetail, AddonListItem, PublisherKey } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

const INITIAL_CREATE = { id: '', name: '', summary: '', description: '' };
const INITIAL_VERSION = {
  version: '',
  mcVersions: '1.21.1',
  loaders: 'fabric',
  downloadUrl: '',
  sha256: '',
  fileSize: '',
  changelog: '',
  signature: '',
  keyFingerprint: '',
  capabilities: 'hud',
};

export function AddonsPage(): React.JSX.Element {
  const { client } = useSession();
  const [results, setResults] = useState<AddonListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [mine, setMine] = useState<AddonListItem[]>([]);
  const [detail, setDetail] = useState<AddonDetail | null>(null);
  const [search, setSearch] = useState('');
  const [mcVersion, setMcVersion] = useState('');
  const [create, setCreate] = useState(INITIAL_CREATE);
  const [target, setTarget] = useState('');
  const [versionForm, setVersionForm] = useState(INITIAL_VERSION);
  const [keys, setKeys] = useState<PublisherKey[]>([]);
  const [keyName, setKeyName] = useState('');
  const [keyPublic, setKeyPublic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const browse = useCallback(
    async (nextSearch = search, nextMc = mcVersion) => {
      try {
        const page = await client.browseAddons({
          search: nextSearch.trim() === '' ? undefined : nextSearch.trim(),
          mcVersion: nextMc.trim() === '' ? undefined : nextMc.trim(),
        });
        setResults(page.addons);
        setTotal(page.total);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [client, search, mcVersion],
  );

  const reloadMine = useCallback(async () => {
    try {
      setMine(await client.myAddons());
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  const reloadKeys = useCallback(async () => {
    try {
      setKeys(await client.myAddonKeys());
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void browse('', '');
    void reloadMine();
    void reloadKeys();
  }, [browse, reloadMine, reloadKeys]);

  const openDetail = async (id: string): Promise<void> => {
    setError(null);
    try {
      setDetail(await client.addonDetail(id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const submitSearch = (event: FormEvent): void => {
    event.preventDefault();
    void browse();
  };

  const submitCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const addon = await client.createAddon({
        id: create.id.trim(),
        name: create.name.trim(),
        summary: create.summary.trim(),
        description: create.description.trim() === '' ? null : create.description.trim(),
      });
      setCreate(INITIAL_CREATE);
      setTarget(addon.id);
      setNotice('Addon creado como borrador. Publica una versión para enviarlo a revisión.');
      await reloadMine();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submitVersion = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (target === '') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.publishAddonVersion(target, {
        version: versionForm.version.trim(),
        mcVersions: versionForm.mcVersions.split(',').map((part) => part.trim()).filter((part) => part !== ''),
        loaders: versionForm.loaders.split(',').map((part) => part.trim()).filter((part) => part !== ''),
        downloadUrl: versionForm.downloadUrl.trim(),
        sha256: versionForm.sha256.trim(),
        fileSize: Number(versionForm.fileSize),
        changelog: versionForm.changelog.trim() === '' ? null : versionForm.changelog.trim(),
        signature: versionForm.signature.trim() === '' ? undefined : versionForm.signature.trim(),
        keyFingerprint: versionForm.keyFingerprint.trim() === '' ? undefined : versionForm.keyFingerprint.trim(),
        capabilities: versionForm.capabilities.split(',').map((part) => part.trim()).filter((part) => part !== ''),
      });
      setVersionForm(INITIAL_VERSION);
      setNotice('Versión publicada.');
      await reloadMine();
      if (detail?.id === target) setDetail(await client.addonDetail(target));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const setCreateField = (key: keyof typeof create) => (event: { target: { value: string } }) =>
    setCreate((current) => ({ ...current, [key]: event.target.value }));
  const setVersionField = (key: keyof typeof versionForm) => (event: { target: { value: string } }) =>
    setVersionForm((current) => ({ ...current, [key]: event.target.value }));

  const submitKey = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const key = await client.registerAddonKey(keyName.trim(), keyPublic.trim());
      setKeyName('');
      setKeyPublic('');
      setNotice(`Clave registrada (${key.fingerprint.slice(0, 16)}…).`);
      await reloadKeys();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (fingerprint: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await client.revokeAddonKey(fingerprint);
      setNotice('Clave revocada. Las versiones ya publicadas no cambian.');
      await reloadKeys();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div>
      <h1>Addons ({total})</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}
      <form className="form" onSubmit={submitSearch}>
        <label>
          Buscar
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="nombre o resumen" />
        </label>
        <label>
          Versión de Minecraft
          <input value={mcVersion} onChange={(event) => setMcVersion(event.target.value)} placeholder="1.21.1" />
        </label>
        <button type="submit" className="button small">
          Filtrar
        </button>
      </form>
      <ul className="rows">
        {results.map((addon) => (
          <li key={addon.id}>
            <div>
              <strong>{addon.name}</strong> <span className="muted">· por {addon.author}</span>
              <br />
              <span className="muted">
                {addon.summary} · {addon.latestVersion ?? 'sin versiones'}
              </span>
            </div>
            <button type="button" className="button small" onClick={() => void openDetail(addon.id)}>
              Detalle
            </button>
          </li>
        ))}
      </ul>
      {results.length === 0 && !error ? <p className="muted">Sin resultados.</p> : null}
      {detail ? (
        <section>
          <h2>{detail.name}</h2>
          <p className="muted">{detail.description || detail.summary}</p>
          <ul className="rows">
            {detail.versions.map((version) => (
              <li key={version.id}>
                <div>
                  <strong>{version.version}</strong> <span className="muted">· {version.mcVersions.join(', ')} · {version.loaders.join(', ')}</span>
                  <br />
                  <span className="muted">
                    sha256 {version.sha256.slice(0, 16)}… · {(version.fileSize / 1024).toFixed(1)} KB ·{' '}
                    {version.signerFingerprint ? `firmado ${version.signerFingerprint.slice(0, 12)}…` : 'sin firmar'}
                  </span>
                  {version.changelog ? (
                    <>
                      <br />
                      <span>{version.changelog}</span>
                    </>
                  ) : null}
                </div>
                <a className="button small" href={version.downloadUrl} target="_blank" rel="noreferrer">
                  Descargar
                </a>
              </li>
            ))}
          </ul>
          {detail.versions.length === 0 ? <p className="muted">Este addon aún no tiene versiones.</p> : null}
        </section>
      ) : null}
      <h2>Mis addons ({mine.length})</h2>
      <ul className="rows">
        {mine.map((addon) => (
          <li key={addon.id}>
            <div>
              <strong>{addon.name}</strong> <span className="muted">· {addon.visibility}</span>
              <br />
              <span className="muted">
                {addon.id} · {addon.latestVersion ?? 'sin versiones'}
              </span>
            </div>
            <button type="button" className="button small" onClick={() => setTarget(addon.id)}>
              {target === addon.id ? 'Seleccionado' : 'Publicar versión'}
            </button>
          </li>
        ))}
      </ul>
      <h2>Crear addon</h2>
      <form className="form" onSubmit={(event) => void submitCreate(event)}>
        <label>
          Id (kebab-case)
          <input value={create.id} onChange={setCreateField('id')} required />
        </label>
        <label>
          Nombre
          <input value={create.name} maxLength={80} onChange={setCreateField('name')} required />
        </label>
        <label>
          Resumen
          <input value={create.summary} maxLength={160} onChange={setCreateField('summary')} required />
        </label>
        <label>
          Descripción
          <input value={create.description} maxLength={2000} onChange={setCreateField('description')} />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Creando…' : 'Crear borrador'}
        </button>
      </form>
      <h2>Publicar versión{target === '' ? '' : ` en ${target}`}</h2>
      <form className="form" onSubmit={(event) => void submitVersion(event)}>
        <label>
          Versión (semver)
          <input value={versionForm.version} onChange={setVersionField('version')} placeholder="1.0.0" required />
        </label>
        <label>
          Versiones de MC (coma)
          <input value={versionForm.mcVersions} onChange={setVersionField('mcVersions')} required />
        </label>
        <label>
          Loaders (coma)
          <input value={versionForm.loaders} onChange={setVersionField('loaders')} required />
        </label>
        <label>
          URL de descarga
          <input value={versionForm.downloadUrl} onChange={setVersionField('downloadUrl')} placeholder="https://…" required />
        </label>
        <label>
          SHA-256 del fichero
          <input value={versionForm.sha256} onChange={setVersionField('sha256')} minLength={64} maxLength={64} required />
        </label>
        <label>
          Tamaño (bytes)
          <input value={versionForm.fileSize} inputMode="numeric" onChange={setVersionField('fileSize')} required />
        </label>
        <label>
          Changelog
          <input value={versionForm.changelog} maxLength={2000} onChange={setVersionField('changelog')} />
        </label>
        <label>
          Firma Ed25519 (opcional, requerida para publicar)
          <input value={versionForm.signature} onChange={setVersionField('signature')} placeholder="base64url de scripts/sign-addon.mjs" />
        </label>
        <label>
          Huella de la clave
          <input value={versionForm.keyFingerprint} onChange={setVersionField('keyFingerprint')} placeholder="64 hex" />
        </label>
        <label>
          Capacidades (hud, tick, config)
          <input value={versionForm.capabilities} onChange={setVersionField('capabilities')} placeholder="hud" />
        </label>
        <button type="submit" className="button primary" disabled={busy || target === ''}>
          {target === '' ? 'Elige un addon arriba' : busy ? 'Publicando…' : 'Publicar versión'}
        </button>
      </form>
      <h2>Mis claves de firma ({keys.length})</h2>
      <p className="muted">Genera un par con `node scripts/sign-addon.mjs gen-key` y registra aquí la pública.</p>
      <ul className="rows">
        {keys.map((key) => (
          <li key={key.fingerprint}>
            <div>
              <strong>{key.name}</strong>{' '}
              <span className="muted">
                · {key.fingerprint.slice(0, 16)}…{key.revokedAt ? ' · revocada' : ''}
              </span>
            </div>
            {key.revokedAt ? null : (
              <button type="button" className="button small danger" onClick={() => void revokeKey(key.fingerprint)}>
                Revocar
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={(event) => void submitKey(event)}>
        <label>
          Nombre
          <input value={keyName} maxLength={40} onChange={(event) => setKeyName(event.target.value)} placeholder="portátil 2026" required />
        </label>
        <label>
          Clave pública (base64url, 43 caracteres)
          <input value={keyPublic} onChange={(event) => setKeyPublic(event.target.value)} required />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Registrando…' : 'Registrar clave'}
        </button>
      </form>
    </div>
  );
}
