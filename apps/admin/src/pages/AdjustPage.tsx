import { useState, type FormEvent } from 'react';
import { errorText, useSession } from '../lib/session';

export function AdjustPage(): React.JSX.Element {
  const { client } = useSession();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const entry = await client.adminAdjust({ userId: userId.trim(), amount: Number(amount), reason: reason.trim() });
      setResult(`Ajuste aplicado. Nuevo saldo: ${entry.balanceAfter} pts.`);
      setUserId('');
      setAmount('');
      setReason('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Ajustar monedero</h1>
      <p className="muted">Crédito (positivo) o débito (negativo) manual con motivo auditable. El id de usuario sale de la tabla.</p>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label>
          Id de usuario (UUID)
          <input value={userId} onChange={(event) => setUserId(event.target.value)} required />
        </label>
        <label>
          Cantidad (entero distinto de cero)
          <input value={amount} inputMode="numeric" onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label>
          Motivo
          <input value={reason} maxLength={280} onChange={(event) => setReason(event.target.value)} required />
        </label>
        {error ? <p className="error">{error}</p> : null}
        {result ? <p className="ok">{result}</p> : null}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Aplicando…' : 'Aplicar ajuste'}
        </button>
      </form>
    </div>
  );
}
