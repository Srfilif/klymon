import { useState } from 'react';
import { Download, History, RefreshCw, Search, Wrench } from 'lucide-react';
import type { LoaderType, MinecraftVersionSummary, VersionInstallResult } from '@klymon/shared-types';
import { invoke, useAsync, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { formatDate } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Field, Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { EmptyState, PageHeader, Spinner } from '../components/ui/misc';

const LOADERS: { value: LoaderType; label: string }[] = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'legacy-fabric', label: 'Legacy Fabric' },
  { value: 'optifine', label: 'OptiFine' },
];

export function VersionsPage(): React.JSX.Element {
  const { t } = useI18n();
  const { toast, refreshInstances } = useApp();
  const [includeSnapshots, setIncludeSnapshots] = useState(false);
  const [includeOld, setIncludeOld] = useState(false);
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [target, setTarget] = useState<MinecraftVersionSummary | null>(null);
  const [loader, setLoader] = useState<LoaderType>('vanilla');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [loaderOptions, setLoaderOptions] = useState<{ value: string; label: string }[]>([]);
  const [loadingLoaders, setLoadingLoaders] = useState(false);

  const versions = useAsync<MinecraftVersionSummary[]>(
    () => invoke('versions:list', { includeSnapshots, includeOld, search }),
    [includeSnapshots, includeOld, search],
  );

  const installed = useAsync(() => invoke('versions:installed'), []);

  const openInstall = async (version: MinecraftVersionSummary): Promise<void> => {
    setTarget(version);
    setLoader('vanilla');
    setLoaderVersion('');
    setLoaderOptions([]);
  };

  const loadLoaderVersions = async (nextLoader: LoaderType, mcVersion: string): Promise<void> => {
    setLoader(nextLoader);
    setLoaderVersion('');
    setLoaderOptions([]);
    if (nextLoader === 'vanilla') return;
    setLoadingLoaders(true);
    try {
      const options = await invoke('loaders:versions', { loaderType: nextLoader, mcVersion });
      setLoaderOptions(options.map((option) => ({ value: option.version, label: `${option.version}${option.recommended ? ' ★' : ''}` })));
      const recommended = options.find((option) => option.recommended) ?? options[0];
      if (recommended) setLoaderVersion(recommended.version);
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setLoadingLoaders(false);
    }
  };

  const install = async (): Promise<void> => {
    if (!target) return;
    setInstalling(target.id);
    try {
      const result: VersionInstallResult = await invoke('versions:install', {
        mcVersion: target.id,
        loaderType: loader,
        loaderVersion: loader === 'vanilla' ? null : loaderVersion || null,
      });
      toast(`✓ ${result.versionId}`, 'success');
      setTarget(null);
      versions.reload();
      installed.reload();
      await refreshInstances();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setInstalling(null);
    }
  };

  const repair = async (mcVersion: string): Promise<void> => {
    setInstalling(mcVersion);
    try {
      await invoke('versions:repair', { mcVersion });
      toast(`✓ ${mcVersion}`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('versions.title')}
        subtitle={t('versions.subtitle')}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('versions.search')} className="w-52 pl-8" />
            </div>
            <Button variant="ghost" size="icon" onClick={() => versions.reload()} aria-label={t('common.retry')}>
              <RefreshCw className="size-4" />
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <Switch checked={includeSnapshots} onCheckedChange={setIncludeSnapshots} /> {t('versions.snapshots')}
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={includeOld} onCheckedChange={setIncludeOld} /> {t('versions.old')}
        </label>
        <span className="ml-auto flex items-center gap-2">
          <History className="size-3.5" /> {t('versions.installed')}: {installed.data?.length ?? 0}
        </span>
      </div>

      {versions.loading ? <Spinner label={t('common.loading')} /> : null}
      {versions.error ? <p className="text-xs text-destructive">{versions.error}</p> : null}

      <Card>
        <CardContent className="max-h-[62vh] overflow-y-auto p-2">
          {(versions.data ?? []).length === 0 && !versions.loading ? <EmptyState title={t('content.noResults')} /> : null}
          <div className="flex flex-col">
            {(versions.data ?? []).map((version) => {
              const isInstalled = version.installed;
              return (
                <div key={version.id} className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-0 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{version.id}</p>
                      <Badge variant={version.type === 'release' ? 'success' : version.type === 'snapshot' ? 'warning' : 'muted'}>
                        {version.type}
                      </Badge>
                      {isInstalled ? <Badge variant="default">{t('common.installed')}</Badge> : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(version.releaseTime)} · Java {version.javaMajor ?? '?'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isInstalled ? (
                      <Button variant="outline" size="sm" loading={installing === version.id} onClick={() => void repair(version.id)}>
                        <Wrench className="size-3.5" /> {t('common.repair')}
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => void openInstall(version)}>
                      <Download className="size-3.5" /> {t('common.install')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={`${t('common.install')} ${target?.id ?? ''}`}
        description={t('versions.subtitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void install()} loading={installing !== null} disabled={loader !== 'vanilla' && !loaderVersion}>
              {t('common.install')}
            </Button>
          </>
        }
      >
        <Field label={t('instances.loader')}>
          <Select
            value={loader}
            onValueChange={(value) => void loadLoaderVersions(value as LoaderType, target?.id ?? '')}
            options={LOADERS}
          />
        </Field>
        {loader !== 'vanilla' ? (
          <Field label={t('instances.loaderVersion')} hint={loadingLoaders ? t('common.loading') : undefined}>
            <Select
              value={loaderVersion}
              onValueChange={setLoaderVersion}
              options={loaderOptions}
              placeholder={loaderOptions.length === 0 ? t('common.none') : undefined}
              disabled={loadingLoaders || loaderOptions.length === 0}
            />
          </Field>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {loader === 'optifine'
            ? 'OptiFine requires a Fabric instance and your own OptiFine jar (optifine.net has no public API).'
            : 'Klymon downloads the official Mojang metadata, libraries and assets. Existing verified files are reused.'}
        </p>
      </Dialog>
    </div>
  );
}
