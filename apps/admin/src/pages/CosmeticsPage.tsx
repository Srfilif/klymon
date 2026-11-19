import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Cosmetic } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

const SLOTS = ['cape', 'hat', 'trail', 'pet', 'emote', 'aura', 'particles', 'wings'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];

export function CosmeticsPage(): React.JSX.Element {
  const { client } = useSession();
  const [items, setItems] = useState<Cosmetic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', slot: 'cape', rarity: 'common', price: '100', description: '' });
  const [grant, setGrant] = useState({ userId: '', cosmeticId: '' });

  const reload = useCallback(async () => {
    try {
      setItems(await client.adminCosmetics());
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.adminCreateCosmetic({
        id: form.id.trim(),
        name: form.name.trim(),
        slot: form.slot,
        rarity: form.rarity,
        price: Number(form.price),
        description: form.description.trim() === '' ? null : form.description.trim(),
      });
      setForm({ id: '', name: '', slot: 'cape', rarity: 'common', price: '100', description: '' });
      setNotice('Cosmético creado.');
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await client.adminDeleteCosmetic(id);
      setNotice('Cosmético eliminado.');
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const sendGrant = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const result = await client.adminGrant(grant.userId.trim(), grant.cosmeticId.trim());
      setNotice(result.granted ? 'Concedido.' : 'El usuario ya lo tenía.');
      setGrant({ userId: '', cosmeticId: '' });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div>
      <h1>Cosméticos ({items.length})</h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}
      <ul className="rows">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.name}</strong> <span className="muted">· {item.slot} · {item.rarity}</span>
              <br />
              <span className="muted">
                {item.id} · {item.price === 0 ? 'no vendible' : `${item.price} pts`}
              </span>
            </div>
            <button type="button" className="button small danger" onClick={() => void remove(item.id)}>
              Eliminar
            </button>
          </li>
        ))}
      </ul>
      <h2>Crear cosmético</h2>
      <form className="form" onSubmit={(event) => void create(event)}>
        <label>
          Id (kebab-case)
          <input value={form.id} onChange={set('id')} required />
        </label>
        <label>
          Nombre
          <input value={form.name} onChange={set('name')} required />
        </label>
        <label>
          Slot
          <select value={form.slot} onChange={set('slot')}>
            {SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rareza
          <select value={form.rarity} onChange={set('rarity')}>
            {RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity}
              </option>
            ))}
          </select>
        </label>
        <label>
          Precio (0 = solo regalo)
          <input value={form.price} inputMode="numeric" onChange={set('price')} required />
        </label>
        <label>
          Descripción
          <input value={form.description} maxLength={280} onChange={set('description')} />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Creando…' : 'Crear'}
        </button>
      </form>
      <h2>Regalar a un usuario</h2>
      <form className="form" onSubmit={(event) => void sendGrant(event)}>
        <label>
          Id de usuario (UUID)
          <input value={grant.userId} onChange={(event) => setGrant((current) => ({ ...current, userId: event.target.value }))} required />
        </label>
        <label>
          Id de cosmético
          <input value={grant.cosmeticId} onChange={(event) => setGrant((current) => ({ ...current, cosmeticId: event.target.value }))} required />
        </label>
        <button type="submit" className="button primary">
          Regalar
        </button>
      </form>
    </div>
  );
}
