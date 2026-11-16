import { useState } from 'react';
import { Check, KeyRound, LogIn, Plus, RefreshCw, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import type { Account } from '@klymon/shared-types';
import { invoke, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { shortUuid } from '../lib/utils';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Field, Input } from '../components/ui/input';

export function AccountsPage(): React.JSX.Element {
  const { t } = useI18n();
  const { accounts, refreshAccounts, toast } = useApp();
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deviceCode, setDeviceCode] = useState<{ flowId: string; userCode: string; verificationUri: string; expiresInSec: number; message: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [microsoftError, setMicrosoftError] = useState<string | null>(null);

  const startMicrosoft = async (): Promise<void> => {
    setMicrosoftError(null);
    setWaiting(true);
    try {
      const info = await invoke('accounts:begin-microsoft');
      setDeviceCode(info);
      void invoke('app:open-external', { url: info.verificationUri }).catch(() => undefined);
      try {
        await invoke('accounts:await-microsoft', { flowId: info.flowId });
        toast(t('accounts.active'), 'success');
      } catch (error) {
        setMicrosoftError(errorMessage(error));
      } finally {
        setWaiting(false);
      }
    } catch (error) {
      setMicrosoftError(errorMessage(error));
      setWaiting(false);
    }
  };

  const createOffline = async (): Promise<void> => {
    setSaving(true);
    try {
      await invoke('accounts:create-offline', { name: offlineName });
      setOfflineOpen(false);
      setOfflineName('');
      await refreshAccounts();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: () => Promise<unknown>, message?: string): Promise<void> => {
    try {
      await action();
      if (message) toast(message, 'success');
      await refreshAccounts();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => setOfflineOpen(true)}>
              <UserRound className="size-4" /> {t('accounts.addOffline')}
            </Button>
            <Button onClick={() => void startMicrosoft()}>
              <LogIn className="size-4" /> {t('accounts.addMicrosoft')}
            </Button>
          </>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState icon={<UserRound className="size-6" />} title={t('accounts.empty')} description={t('accounts.offlineHint')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((account: Account) => (
            <Card key={account.id} className={account.active ? 'border-primary/50' : undefined}>
              <CardContent className="flex items-center gap-3 p-4">
                {account.skinUrl ? (
                  <img src={account.skinUrl} alt="" className="size-12 rounded-md object-cover" />
                ) : (
                  <div className="grid size-12 place-items-center rounded-md bg-primary/15 text-sm font-bold uppercase text-primary">
                    {account.name.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{account.name}</p>
                    {account.active ? <Badge variant="success">{t('accounts.active')}</Badge> : null}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {account.type === 'microsoft' ? t('accounts.premium') : t('accounts.offline')} · {shortUuid(account.uuid)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {account.type === 'microsoft'
                      ? account.sessionValid
                        ? t('accounts.sessionValid')
                        : t('accounts.sessionExpired')
                      : t('accounts.offlineHint')}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  {!account.active ? (
                    <Button size="sm" variant="outline" onClick={() => void act(() => invoke('accounts:set-active', { id: account.id }))}>
                      <Check className="size-3.5" /> {t('accounts.setActive')}
                    </Button>
                  ) : null}
                  {account.type === 'microsoft' ? (
                    <Button size="sm" variant="ghost" onClick={() => void act(() => invoke('accounts:refresh', { id: account.id }), t('accounts.sessionValid'))}>
                      <RefreshCw className="size-3.5" /> {t('accounts.refresh')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void act(() => invoke('accounts:remove', { id: account.id }))}>
                    <Trash2 className="size-3.5" /> {t('accounts.remove')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Alert variant="info">
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="size-3.5" /> {t('accounts.offlineHint')}
        </span>
      </Alert>

      <Dialog
        open={offlineOpen}
        onOpenChange={setOfflineOpen}
        title={t('accounts.addOffline')}
        description={t('accounts.offlineHint')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOfflineOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void createOffline()} loading={saving} disabled={offlineName.trim().length < 3}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <Field label={t('accounts.offlineName')} hint="3-16 · A-Z a-z 0-9 _">
          <Input value={offlineName} onChange={(event) => setOfflineName(event.target.value)} maxLength={16} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={deviceCode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeviceCode(null);
            setWaiting(false);
          }
        }}
        title={t('accounts.addMicrosoft')}
        description={t('accounts.deviceCodeHint')}
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setDeviceCode(null);
              setWaiting(false);
            }}
          >
            {t('common.cancel')}
          </Button>
        }
      >
        {deviceCode ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="text-xs text-muted-foreground">{t('accounts.deviceCode')}</p>
            <p className="select-all rounded-md border border-primary/40 bg-primary/10 px-6 py-3 font-mono text-2xl font-bold tracking-[0.25em] text-primary">
              {deviceCode.userCode}
            </p>
            <Button variant="outline" size="sm" onClick={() => void invoke('app:open-external', { url: deviceCode.verificationUri })}>
              <KeyRound className="size-3.5" /> {t('accounts.openBrowser')}
            </Button>
            {waiting ? <Spinner label={t('accounts.waiting')} /> : null}
            {microsoftError ? <Alert variant="error">{microsoftError}</Alert> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
