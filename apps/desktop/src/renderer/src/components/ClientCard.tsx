import { useEffect, useState } from 'react';
import { Gauge, Gamepad2, Palette, Play, RefreshCw, Rocket, ShieldCheck, Wrench } from 'lucide-react';
import type { ClientStatus } from '@klymon/shared-types';
import { DEFAULT_CLIENT_VERSION, KLYMON_CLIENT_VERSIONS } from '@klymon/shared-types';
import { invoke, useEvent, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { Alert, Progress } from './ui/misc';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Select } from './ui/select';

/** Klymon Client: bundled Fabric profile with curated performance/PvP mods. */
export function ClientCard(): React.JSX.Element {
  const { t } = useI18n();
  const { toast, refreshInstances } = useApp();
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<string>(DEFAULT_CLIENT_VERSION);

  useEffect(() => {
    void invoke('client:status')
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEvent('client:progress', (next) => setStatus(next));

  useEffect(() => {
    if (status && (KLYMON_CLIENT_VERSIONS as readonly string[]).includes(status.mcVersion)) {
      setVersion(status.mcVersion);
    }
  }, [status?.mcVersion]);

  const install = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await invoke('client:install', { mcVersion: version });
      setStatus(next);
      await refreshInstances();
      toast(t('client.ready'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const launch = async (): Promise<void> => {
    try {
      await invoke('client:launch');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  if (!status) return <></>;

  const installing = status.phase === 'installing' || busy;
  const switching = status.installed && version !== status.mcVersion;

  return (
    <Card className="relative overflow-hidden border-accent/25">
      <div className="absolute inset-0 bg-gradient-to-r from-accent/15 via-primary/10 to-transparent" aria-hidden />
      <CardContent className="relative flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30">
            <Rocket className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{status.name}</h2>
              <Badge variant="success">{t('client.recommended')}</Badge>
              <Badge variant="outline">Minecraft {status.mcVersion}</Badge>
              <Badge variant="muted">Fabric</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('client.subtitle', { mods: status.modsExpected })}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Gauge className="size-3" /> {t('client.modsInstalled', { installed: status.modsInstalled, expected: status.modsExpected })}
              </span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="size-3" /> {t('client.verified')}
              </span>
              <span className="flex items-center gap-1">
                <Gamepad2 className="size-3" /> {t('client.menu')}
              </span>
              <span className="flex items-center gap-1">
                <Palette className="size-3" /> {t('client.branding')}
              </span>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:w-64">
          {installing ? (
            <div className="flex flex-col gap-1.5">
              <Progress value={status.progress} />
              <p className="truncate text-[11px] text-muted-foreground">{status.message || t('client.installing')}</p>
            </div>
          ) : null}

          {status.phase === 'error' && status.error ? (
            <Alert variant="error">{t('client.failed')}: {status.error}</Alert>
          ) : null}

          <Select
            aria-label={t('client.version')}
            value={version}
            onValueChange={setVersion}
            disabled={installing}
            options={KLYMON_CLIENT_VERSIONS.map((entry) => ({ value: entry, label: `Minecraft ${entry}` }))}
          />
          <div className="flex gap-2">
            {status.installed && !switching ? (
              <>
                <Button className="flex-1" onClick={() => void launch()} disabled={installing}>
                  <Play className="size-4" /> {t('client.play')}
                </Button>
                <Button variant="outline" onClick={() => void install()} loading={installing} aria-label={t('client.repair')} title={t('client.repair')}>
                  <Wrench className="size-4" />
                </Button>
              </>
            ) : (
              <Button className="flex-1" onClick={() => void install()} loading={installing}>
                {status.phase === 'error' ? <RefreshCw className="size-4" /> : <Rocket className="size-4" />}
                {switching ? t('client.switch') : status.modsInstalled > 0 ? t('client.repair') : t('client.install')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
