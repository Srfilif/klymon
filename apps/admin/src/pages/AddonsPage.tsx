import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AddonDetail, AddonListItem } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

const VISIBILITIES = ['draft', 'published', 'hidden'] as const;

export function AddonsPage(): React.JSX.Element {
  const { client } = useSession();
  const [items, setItems] = useState<AddonListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<AddonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(
    async (nextSearch = search) => {
      try {
        const page = await client.adminAddons({
          search: nextSearch.trim() === '' ? undefined : nextSearch.trim(),
        });
        setItems(page.addons);
        setTotal(page.total);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [client, search],
  );

  useEffect(() => {
    void reload('');
  }, [reload]);

  const submitSearch = (event: FormEvent): void => {
    event.preventDefault();
    void reload();
  };

  const setVisibility = async (id: string, visibility: (typeof VISIBILITIES)[number]): Promise<void> => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await client.adminSetAddonVisibility(id, visibility);
      setNotice(`Addon ${id} → ${visibility}.`);
      await reload();
      if (detail?.id === id) setDetail(await client.adminAddonDetail(id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const openDetail = async (id: string): Promise<void> => {
    setError(null);
    try {
      setDetail(await client.adminAddonDetail(id));
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
        <button type="submit" className="button small">
          Filtrar
        </button>
      </form>
      <ul className="rows">
        {items.map((addon) => (
          <li key={addon.id}>
            <div>
              <strong>{addon.name}</strong> <span className="muted">· por {addon.author} · {addon.visibility}</span>
              <br />
              <span className="muted">
                {addon.id} · {addon.summary} · {addon.latestVersion ?? 'sin versiones'}
              </span>
            </div>
            <div className="pager">
              <button type="button" className="button small" onClick={() => void openDetail(addon.id)}>
                Revisar
              </button>
              {VISIBILITIES.filter((visibility) => visibility !== addon.visibility).map((visibility) => (
                <button
                  key={visibility}
                  type="button"
                  className={`button small${visibility === 'published' ? ' primary' : ''}`}
                  disabled={busy !== null}
                  onClick={() => void setVisibility(addon.id, visibility)}
                >
                  {busy === addon.id ? '…' : visibility === 'published' ? 'Publicar' : visibility === 'hidden' ? 'Ocultar' : 'A borrador'}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && !error ? <p className="muted">Sin resultados.</p> : null}
      {detail ? (
        <section>
          <h2>
            Revisión: {detail.name} ({detail.visibility})
          </h2>
          <p className="muted">
            {detail.id} · por {detail.author} · {detail.summary}
          </p>
          <ul className="rows">
            {detail.versions.map((version) => (
              <li key={version.id}>
                <div>
                  <strong>{version.version}</strong>{' '}
                  <span className="muted">
                    · {version.mcVersions.join(', ')} · {version.loaders.join(', ')}
                  </span>
                  <br />
                  <span className="muted">
                    sha256 {version.sha256.slice(0, 16)}… ·{' '}
                    {version.signerFingerprint ? `firmado ${version.signerFingerprint.slice(0, 12)}…` : 'SIN FIRMAR'} ·{' '}
                    capacidades: {version.capabilities.length > 0 ? version.capabilities.join(', ') : '—'}
                  </span>
                </div>
                <a className="button small" href={version.downloadUrl} target="_blank" rel="noreferrer">
                  Descargar
                </a>
              </li>
            ))}
          </ul>
          {detail.versions.length === 0 ? <p className="muted">Sin versiones: no se puede publicar.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
