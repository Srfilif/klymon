import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Package, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import type { ContentProject, ContentProjectType, ContentSearchResult, ContentSource, ContentVersion, InstalledContent } from '@klymon/shared-types';
import { invoke, useAsync, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { formatCount, formatDate } from '../lib/utils';
import { Alert, EmptyState, PageHeader, Spinner } from './ui/misc';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Switch } from './ui/switch';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'updated', label: 'Updated' },
  { value: 'newest', label: 'Newest' },
];

const KIND_FOR_TYPE: Record<ContentProjectType, 'mod' | 'resourcepack' | 'shader' | 'modpack'> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader',
  modpack: 'modpack',
  datapack: 'mod',
};

export function ContentBrowser({
  projectType,
  title,
  subtitle,
}: {
  projectType: ContentProjectType;
  title: string;
  subtitle: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const { activeInstance, toast } = useApp();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [source, setSource] = useState<ContentSource>('modrinth');
  const [sort, setSort] = useState('relevance');
  const [selected, setSelected] = useState<ContentProject | null>(null);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useAsync<ContentSearchResult>(
    () =>
      invoke('content:search', {
        query: debounced,
        projectType,
        gameVersion: activeInstance?.mcVersion ?? null,
        loader: activeInstance?.loaderType ?? null,
        sort: sort as 'relevance' | 'downloads' | 'updated' | 'newest',
        limit: 24,
      }),
    [debounced, projectType, activeInstance?.mcVersion, activeInstance?.loaderType, sort],
  );

  const versions = useAsync<ContentVersion[]>(
    () =>
      selected
        ? invoke('content:versions', {
            source: selected.source,
            projectId: selected.id,
            gameVersion: activeInstance?.mcVersion ?? null,
            loader: activeInstance?.loaderType ?? null,
          })
        : Promise.resolve([]),
    [selected?.id, activeInstance?.mcVersion, activeInstance?.loaderType],
  );

  const installed = useAsync<InstalledContent[]>(
    () => (activeInstance ? invoke('content:installed', { instanceId: activeInstance.id, kind: KIND_FOR_TYPE[projectType] }) : Promise.resolve([])),
    [activeInstance?.id, projectType],
  );

  useEffect(() => {
    if (!selected) return;
    const downloadable = (versions.data ?? []).find((version) => !version.blocked) ?? versions.data?.[0];
    setSelectedVersion(downloadable?.id ?? '');
  }, [versions.data, selected]);

  const installTarget = useMemo(() => {
    if (projectType === 'modpack') return null;
    return activeInstance;
  }, [activeInstance, projectType]);

  const install = async (): Promise<void> => {
    if (!selected) return;
    setInstalling(true);
    try {
      if (projectType === 'modpack') {
        const result = await invoke('content:install-modpack', {
          source: selected.source,
          projectId: selected.id,
          versionId: selectedVersion || null,
          name: selected.title.slice(0, 48),
        });
        toast(`✓ ${result.name} (${result.files})`, 'success');
      } else {
        if (!activeInstance) throw new Error(t('content.noInstance'));
        await invoke('content:install', {
          instanceId: activeInstance.id,
          source: selected.source,
          projectId: selected.id,
          versionId: selectedVersion || null,
          kind: projectType,
        });
        toast(`✓ ${selected.title}`, 'success');
      }
      setSelected(null);
      installed.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setInstalling(false);
    }
  };

  const importFile = async (): Promise<void> => {
    if (!activeInstance || projectType === 'modpack') return;
    try {
      const record = await invoke('content:import-file', { instanceId: activeInstance.id, kind: KIND_FOR_TYPE[projectType] as 'mod' | 'resourcepack' | 'shader' });
      if (record) {
        toast(`✓ ${record.title}`, 'success');
        installed.reload();
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {projectType !== 'modpack' ? (
              <Button variant="outline" onClick={() => void importFile()} disabled={!activeInstance}>
                <Package className="size-4" /> {t('content.importJar')}
              </Button>
            ) : null}
            <Select value={source} onValueChange={(value) => setSource(value as ContentSource)} options={[{ value: 'modrinth', label: 'Modrinth' }, { value: 'curseforge', label: 'CurseForge' }]} className="w-36" />
          </>
        }
      />

      {projectType !== 'modpack' && !activeInstance ? (
        <Alert variant="warning">
          {t('content.noInstance')}{' '}
          <Link to="/instances" className="underline underline-offset-2">
            {t('instances.new')}
          </Link>
        </Alert>
      ) : null}
      {projectType === 'modpack' ? <Alert variant="info">{t('content.modpacksNote')}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('content.searchPlaceholder')}
            className="pl-8"
            aria-label={t('common.search')}
          />
        </div>
        <Select value={sort} onValueChange={setSort} options={SORT_OPTIONS} className="w-36" />
        {activeInstance ? (
          <Badge variant="outline" className="h-8 px-3">
            {activeInstance.mcVersion} · {activeInstance.loaderType}
          </Badge>
        ) : null}
      </div>

      {results.loading ? <Spinner label={t('common.loading')} /> : null}
      {results.error ? <Alert variant="error">{results.error}</Alert> : null}
      {!results.loading && (results.data?.hits.length ?? 0) === 0 ? <EmptyState title={t('content.noResults')} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(results.data?.hits ?? []).map((project) => (
          <Card key={`${project.source}-${project.id}`} className="flex flex-col transition-colors hover:border-primary/40">
            <CardContent className="flex flex-1 flex-col gap-2 p-3">
              <div className="flex gap-2.5">
                {project.iconUrl ? (
                  <img src={project.iconUrl} alt="" className="size-11 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                  <div className="size-11 shrink-0 rounded-md bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{project.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t('content.by')} {project.author} · {formatCount(project.downloads)} ↓
                  </p>
                </div>
                <Badge variant="muted">{project.source === 'modrinth' ? 'MR' : 'CF'}</Badge>
              </div>
              <p className="line-clamp-3 text-[11px] text-muted-foreground">{project.description}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="truncate text-[10px] text-muted-foreground">{project.categories.slice(0, 2).join(' · ')}</span>
                <Button size="sm" onClick={() => setSelected(project)} disabled={projectType !== 'modpack' && !installTarget}>
                  <Download className="size-3.5" /> {t('common.install')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {activeInstance && projectType !== 'modpack' ? (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">{t('content.installedTitle')}</p>
              <Badge variant="muted">{installed.data?.length ?? 0}</Badge>
            </div>
            {(installed.data ?? []).length === 0 ? <p className="text-[11px] text-muted-foreground">{t('common.empty')}</p> : null}
            <div className="flex flex-col">
              {(installed.data ?? []).map((item) => (
                <div key={item.id} className="flex items-center gap-2 border-b border-border/40 py-1.5 last:border-0">
                  {item.iconUrl ? <img src={item.iconUrl} alt="" className="size-7 rounded-sm object-cover" loading="lazy" /> : <div className="size-7 rounded-sm bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{item.title}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {item.fileName} {item.versionNumber ? `· ${item.versionNumber}` : ''}
                    </p>
                  </div>
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={(enabled) => {
                      void invoke('content:toggle', { id: item.id, enabled })
                        .then(() => installed.reload())
                        .catch((error: unknown) => toast(errorMessage(error), 'error'));
                    }}
                    aria-label={t('common.enabled')}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      void invoke('content:pin', { id: item.id, pinned: !item.pinned })
                        .then(() => installed.reload())
                        .catch((error: unknown) => toast(errorMessage(error), 'error'));
                    }}
                    aria-label={item.pinned ? t('content.unpin') : t('content.pin')}
                    title={item.pinned ? t('content.unpin') : t('content.pin')}
                  >
                    {item.pinned ? <PinOff className="size-3.5 text-primary" /> : <Pin className="size-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      void invoke('content:remove', { id: item.id })
                        .then(() => installed.reload())
                        .catch((error: unknown) => toast(errorMessage(error), 'error'));
                    }}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.title ?? ''}
        description={selected ? `${t('content.by')} ${selected.author}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void install()}
              loading={installing}
              disabled={
                (selectedVersion === '' && versions.loading) ||
                (versions.data ?? []).find((version) => version.id === selectedVersion)?.blocked === true
              }
            >
              {t('common.install')}
            </Button>
          </>
        }
      >
        {selected ? (
          <>
            <p className="text-xs text-muted-foreground">{selected.description}</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <Badge variant="muted">{formatCount(selected.downloads)} ↓</Badge>
              <Badge variant="muted">{selected.license}</Badge>
              {selected.categories.slice(0, 3).map((category) => (
                <Badge key={category} variant="outline">
                  {category}
                </Badge>
              ))}
              <Button variant="link" size="sm" onClick={() => void invoke('app:open-external', { url: selected.projectUrl })}>
                <ExternalLink className="size-3" /> {selected.source}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('common.versions')}</p>
              {versions.loading ? <Spinner /> : null}
              {versions.error ? <Alert variant="error">{versions.error}</Alert> : null}
              <Select
                value={selectedVersion}
                onValueChange={setSelectedVersion}
                options={(versions.data ?? []).map((version) => ({
                  value: version.id,
                  label: `${version.versionNumber} · ${version.gameVersions.slice(0, 2).join(', ')} · ${version.releaseType}${
                    version.blocked ? ` · ${t('content.blocked')}` : ''
                  }`,
                  disabled: version.blocked === true,
                }))}
                placeholder={(versions.data ?? []).length === 0 ? t('common.none') : undefined}
              />
              {selectedVersion ? (
                <p className="text-[10px] text-muted-foreground">
                  {formatDate((versions.data ?? []).find((version) => version.id === selectedVersion)?.publishedAt ?? '')} ·{' '}
                  {(versions.data ?? []).find((version) => version.id === selectedVersion)?.fileName}
                </p>
              ) : null}
              {(versions.data ?? []).find((version) => version.id === selectedVersion)?.blocked ? (
                <Alert variant="warning">
                  {t('content.blockedHint')}{' '}
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void invoke('app:open-external', { url: selected.projectUrl })}>
                    <ExternalLink className="size-3" /> CurseForge
                  </Button>
                </Alert>
              ) : null}
            </div>
            {projectType === 'modpack' ? <Alert variant="info">{t('content.modpacksNote')}</Alert> : null}
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
