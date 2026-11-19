import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, LogIn, LogOut, RefreshCw, Upload, UserRoundPlus } from 'lucide-react';
import type { PlatformStatusModel, SyncDocStatusModel, SyncProfileModel } from '@klymon/shared-types';
import { errorMessage, invoke } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { Alert, PageHeader, Spinner } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Field, Input } from '../components/ui/input';
import { Select } from '../components/ui/select';

const NAMESPACES = ['launcher-settings', 'loadout', 'client-config', 'keybindings'];

export function PlatformPage(): React.JSX.Element {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const [status, setStatus] = useState<PlatformStatusModel | null>(null);
  const [profiles, setProfiles] = useState<SyncProfileModel[]>([]);
  const [docs, setDocs] = useState<SyncDocStatusModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [apiUrl, setApiUrl] = useState('');

  const reload = useCallback(async () => {
    try {
      const current = await invoke('platform:status');
      setStatus(current);
      setApiUrl(current.apiUrl);
      if (current.signedIn) {
        const [listed, docStatus] = await Promise.all([invoke('sync:profiles'), invoke('sync:status')]);
        setProfiles(listed);
        setDocs(docStatus);
      } else {
        setProfiles([]);
        setDocs([]);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (key: string, action: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      await action();
      if (done) toast(done, 'success');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const saveApiUrl = () =>
    run('api-url', async () => {
      await updateSettings({ platformApiUrl: apiUrl.trim() });
    }, t('platform.saved'));

  if (loading || !settings) {
    return <Spinner label={t('common.loading')} />;
  }

  const activeProfile = settings.syncProfileId;

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.platform')} subtitle={t('platform.subtitle')} />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <Card>
        <CardContent className="space-y-4">
          {status?.signedIn ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-10 place-items-center rounded-md bg-primary/20 font-bold">
                {(status.username ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{status.username}</p>
                <p className="text-xs text-muted-foreground">
                  {status.persisted ? t('platform.persisted') : t('platform.memoryOnly')}
                </p>
              </div>
              <Button variant="secondary" disabled={busy !== null} onClick={() => void run('logout', () => invoke('platform:logout'), t('platform.loggedOut'))}>
                <LogOut className="size-4" /> {t('platform.logout')}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="font-medium">{showRegister ? t('platform.register') : t('platform.login')}</h3>
                {showRegister ? (
                  <>
                    <Field label={t('platform.username')}>
                      <Input value={regName} onChange={(event) => setRegName(event.target.value)} autoComplete="username" />
                    </Field>
                    <Field label={t('platform.email')}>
                      <Input type="email" value={regEmail} onChange={(event) => setRegEmail(event.target.value)} autoComplete="email" />
                    </Field>
                    <Field label={t('platform.password')}>
                      <Input
                        type="password"
                        value={regPassword}
                        onChange={(event) => setRegPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </Field>
                    <Button
                      disabled={busy !== null}
                      onClick={() =>
                        void run(
                          'register',
                          () => invoke('platform:register', { username: regName.trim(), email: regEmail.trim(), password: regPassword }),
                          t('platform.accountCreated'),
                        )
                      }
                    >
                      <UserRoundPlus className="size-4" /> {t('platform.register')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Field label={t('platform.identifier')}>
                      <Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" />
                    </Field>
                    <Field label={t('platform.password')}>
                      <Input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                    </Field>
                    <Button
                      disabled={busy !== null}
                      onClick={() => void run('login', () => invoke('platform:login', { identifier: identifier.trim(), password }), t('platform.loggedIn'))}
                    >
                      <LogIn className="size-4" /> {t('platform.login')}
                    </Button>
                  </>
                )}
                <button type="button" className="text-xs text-primary underline" onClick={() => setShowRegister((current) => !current)}>
                  {showRegister ? t('platform.showLogin') : t('platform.showRegister')}
                </button>
              </div>
              <div className="space-y-3">
                <h3 className="font-medium">{t('platform.server')}</h3>
                <Field label={t('platform.apiUrl')} hint={t('platform.apiUrlHint')}>
                  <Input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} spellCheck={false} />
                </Field>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void saveApiUrl()}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.signedIn ? (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-medium">{t('sync.title')}</h3>
              <div className="min-w-48 flex-1">
                <Select
                  aria-label={t('sync.profiles')}
                  value={activeProfile ?? ''}
                  placeholder={t('sync.noProfile')}
                  options={profiles.map((profile) => ({ value: profile.id, label: `${profile.name} (${profile.documentCount})` }))}
                  onValueChange={(value) => void run('select', () => invoke('sync:select-profile', { profileId: value || null }))}
                />
              </div>
              <Button variant="secondary" disabled={busy !== null || !activeProfile} onClick={() => void run('pull', () => invoke('sync:pull'), t('sync.pulled'))}>
                <RefreshCw className="size-4" /> {t('sync.pull')}
              </Button>
            </div>
            {!activeProfile ? (
              <Alert variant="info">{t('sync.noProfileHint')}</Alert>
            ) : (
              <ul className="divide-y divide-border/60">
                {NAMESPACES.map((namespace) => {
                  const doc = docs.find((entry) => entry.namespace === namespace);
                  return (
                    <li key={namespace} className="flex flex-wrap items-center gap-2 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{namespace}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc?.conflict
                            ? t('sync.conflict', { version: doc.conflict.version })
                            : doc
                              ? t('sync.synced', { version: doc.baseVersion ?? 0 })
                              : t('sync.neverSynced')}
                          {doc?.dirty ? ` · ${t('sync.dirty')}` : ''}
                          {doc?.queued ? ` · ${t('sync.queued')}` : ''}
                        </p>
                      </div>
                      {doc?.conflict ? <Badge variant="destructive">{t('sync.conflictBadge')}</Badge> : null}
                      {doc && !doc.dirty && !doc.conflict ? (
                        <Badge variant="success">
                          <Cloud className="size-3" /> v{doc.baseVersion ?? 0}
                        </Badge>
                      ) : null}
                      {!doc || doc.dirty ? (
                        <Badge variant="warning">
                          <CloudOff className="size-3" /> {t('sync.local')}
                        </Badge>
                      ) : null}
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => void run(`push-${namespace}`, () => invoke('sync:push', { namespace }), t('sync.pushed'))}
                      >
                        <Upload className="size-4" /> {t('sync.push')}
                      </Button>
                      {doc?.conflict ? (
                        <>
                          <Button
                            disabled={busy !== null}
                            onClick={() => void run(`mine-${namespace}`, () => invoke('sync:resolve', { namespace, keep: 'mine' }), t('sync.resolved'))}
                          >
                            {t('sync.keepMine')}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy !== null}
                            onClick={() => void run(`theirs-${namespace}`, () => invoke('sync:resolve', { namespace, keep: 'theirs' }), t('sync.resolved'))}
                          >
                            {t('sync.keepTheirs')}
                          </Button>
                        </>
                      ) : null}
                      {doc && (doc.dirty || doc.conflict) ? (
                        <Button variant="ghost" disabled={busy !== null} onClick={() => void run(`revert-${namespace}`, () => invoke('sync:revert', { namespace }), t('sync.reverted'))}>
                          {t('sync.revert')}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
