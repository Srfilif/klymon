import { useCallback, useEffect, useState } from 'react';
import type { Cosmetic, Inventory } from '@klymon/api-client';
import { errorText, useSession } from '../lib/session';

export function InventoryPage(): React.JSX.Element {
  const { client } = useSession();
  const [catalog, setCatalog] = useState<Cosmetic[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [catalogResult, inventoryResult] = await Promise.all([client.catalog(), client.inventory()]);
      setCatalog(catalogResult);
      setInventory(inventoryResult);
    } catch (err) {
      setError(errorText(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ownedIds = new Set((inventory?.owned ?? []).map((entry) => entry.id));

  const purchase = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await client.purchase(id);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleEquip = async (slot: string, id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      const equipped = await client.equip(slot, inventory?.equipped[slot] === id ? null : id);
      setInventory((current) => (current ? { ...current, equipped } : current));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1>Inventario</h1>
      {error ? <p className="error">{error}</p> : null}
      <ul className="rows">
        {catalog.map((item) => {
          const owned = ownedIds.has(item.id);
          const equipped = inventory?.equipped[item.slot] === item.id;
          return (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong> <span className="muted">· {item.slot} · {item.rarity}</span>
                <br />
                <span className="muted">
                  {item.description || 'Sin descripción'} · {item.price === 0 ? 'no vendible' : `${item.price} pts`}
                  {owned ? ' · en propiedad' : ''} {equipped ? ' · equipado' : ''}
                </span>
              </div>
              <div className="pager">
                {!owned && item.price > 0 ? (
                  <button type="button" className="button small primary" disabled={busy !== null} onClick={() => void purchase(item.id)}>
                    {busy === item.id ? '…' : `Comprar (${item.price})`}
                  </button>
                ) : null}
                {owned ? (
                  <button type="button" className="button small" disabled={busy !== null} onClick={() => void toggleEquip(item.slot, item.id)}>
                    {busy === item.id ? '…' : equipped ? 'Quitar' : 'Equipar'}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {catalog.length === 0 && !error ? <p className="muted">Catálogo vacío.</p> : null}
    </div>
  );
}
