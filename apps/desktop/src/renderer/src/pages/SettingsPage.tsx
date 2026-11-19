import { useEffect, useState } from 'react';
import { Cpu, Download, HardDrive, Languages, Palette, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import type { DiagnosticIssue, JavaRuntime, JvmPreset, MemoryAdvice, Settings, SystemInfo, UpdateStatus } from '@klymon/shared-types';
import { invoke, useAsync, useEvent, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { formatBytes } from '../lib/utils';
import { Alert, PageHeader, Spinner, Stat } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Field, Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';

export function SettingsPage(): React.JSX.Element {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntime[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticIssue[] | null>(null);
  const [updates, setUpdates] = useState<UpdateStatus | null>(null);
  const [installingJava, setInstallingJava] = useState(false);

  const systemInfo = useAsync<SystemInfo>(() => invoke('system:info'), []);
  const memoryAdvice = useAsync<MemoryAdvice>(() => invoke('system:memory-advice'), []);
  const presets = useAsync<JvmPreset[]>(() => invoke('system:java-presets'), []);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void invoke('java:detect').then(setJavaRuntimes).catch(() => undefined);
    void invoke('update:status').then(setUpdates).catch(() => undefined);
  }, []);

  useEvent('update:status', (status) => setUpdates(status));

  if (!draft) return <Spinner label={t('common.loading')} />;

  const patch = (next: Partial<Settings>): void => setDraft((current) => (current ? { ...current, ...next } : current));

  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      await updateSettings({
        language: draft.language,
        theme: draft.theme,
        accentColor: draft.accentColor,
        backgroundImage: draft.backgroundImage,
        closeLauncherOnGameStart: draft.closeLauncherOnGameStart,
        showLogConsole: draft.showLogConsole,
        reducedMotion: draft.reducedMotion,
        fontScale: draft.fontScale,
        maxConcurrentDownloads: draft.maxConcurrentDownloads,
        defaultMemoryMb: draft.defaultMemoryMb,
        autoUpdateJava: draft.autoUpdateJava,
        enableBetaUpdates: draft.enableBetaUpdates,
        updateFeedUrl: draft.updateFeedUrl,
        curseforgeApiKey: draft.curseforgeApiKey,
        musicEnabled: draft.musicEnabled,
        musicVolume: draft.musicVolume,
        musicDirectory: draft.musicDirectory,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={
          <Button onClick={() => void save()} loading={saving}>
            {t('common.save')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Palette className="size-4" /> {t('settings.appearance')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('settings.language')}>
                <Select
                  value={draft.language}
                  onValueChange={(value) => patch({ language: value as Settings['language'] })}
                  options={[
                    { value: 'es', label: 'Español' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Field>
              <Field label={t('settings.theme')}>
                <Select
                  value={draft.theme}
                  onValueChange={(value) => patch({ theme: value as Settings['theme'] })}
                  options={[
                    { value: 'dark', label: t('settings.dark') },
                    { value: 'light', label: t('settings.light') },
                  ]}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('settings.accent')}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.accentColor}
                    onChange={(event) => patch({ accentColor: event.target.value })}
                    className="h-9 w-12 cursor-pointer rounded-md border border-border bg-input"
                    aria-label={t('settings.accent')}
                  />
                  <Input value={draft.accentColor} onChange={(event) => patch({ accentColor: event.target.value })} />
                </div>
              </Field>
              <Field label={t('settings.background')} hint={t('settings.backgroundHint')}>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void invoke('app:import-background')
                        .then((url) => {
                          if (url) patch({ backgroundImage: url });
                        })
                        .catch((error: unknown) => toast(errorMessage(error), 'error'))
                    }
                  >
                    {t('common.browse')}
                  </Button>
                  {draft.backgroundImage ? (
                    <Button variant="ghost" onClick={() => patch({ backgroundImage: null })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </Field>
            </div>
            <Field label={`${t('settings.fontScale')} · ${Math.round(draft.fontScale * 100)}%`}>
              <Slider min={0.75} max={1.5} step={0.05} value={[draft.fontScale]} onValueChange={([value]) => patch({ fontScale: value ?? 1 })} />
            </Field>
            <label className="flex items-center justify-between text-xs">
              {t('settings.reducedMotion')}
              <Switch checked={draft.reducedMotion} onCheckedChange={(value) => patch({ reducedMotion: value })} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Download className="size-4" /> {t('settings.downloads')} · {t('settings.behaviour')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label={`${t('settings.concurrency')} · ${draft.maxConcurrentDownloads}`}>
              <Slider
                min={1}
                max={16}
                step={1}
                value={[draft.maxConcurrentDownloads]}
                onValueChange={([value]) => patch({ maxConcurrentDownloads: value ?? 6 })}
              />
            </Field>
            <Field label={t('settings.defaultMemory')}>
              <Input
                type="number"
                min={512}
                step={256}
                value={draft.defaultMemoryMb}
                onChange={(event) => patch({ defaultMemoryMb: Number(event.target.value) })}
              />
            </Field>
            <label className="flex items-center justify-between text-xs">
              {t('settings.closeOnLaunch')}
              <Switch checked={draft.closeLauncherOnGameStart} onCheckedChange={(value) => patch({ closeLauncherOnGameStart: value })} />
            </label>
            <label className="flex items-center justify-between text-xs">
              {t('settings.autoJava')}
              <Switch checked={draft.autoUpdateJava} onCheckedChange={(value) => patch({ autoUpdateJava: value })} />
            </label>
            <label className="flex items-center justify-between text-xs">
              {t('nav.console')}
              <Switch checked={draft.showLogConsole} onCheckedChange={(value) => patch({ showLogConsole: value })} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu className="size-4" /> {t('settings.java')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void invoke('java:detect')
                    .then(setJavaRuntimes)
                    .catch((error: unknown) => toast(errorMessage(error), 'error'))
                }
              >
                <RefreshCw className="size-3.5" /> {t('settings.detectJava')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={installingJava}
                onClick={() => {
                  setInstallingJava(true);
                  void invoke('java:install', { major: 21 })
                    .then((runtime) => {
                      toast(`✓ Java ${runtime.major} ${runtime.vendor}`, 'success');
                      return invoke('java:detect').then(setJavaRuntimes);
                    })
                    .catch((error: unknown) => toast(errorMessage(error), 'error'))
                    .finally(() => setInstallingJava(false));
                }}
              >
                <Download className="size-3.5" /> {t('settings.installJava')} 21
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void invoke('java:pick')
                    .then((runtime) => {
                      if (runtime) {
                        setJavaRuntimes((current) => [runtime, ...current]);
                        toast(`✓ ${runtime.vendor} ${runtime.version}`, 'success');
                      }
                    })
                    .catch((error: unknown) => toast(errorMessage(error), 'error'))
                }
              >
                {t('settings.pickJava')}
              </Button>
            </div>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {javaRuntimes.length === 0 ? <p className="text-[11px] text-muted-foreground">{t('common.empty')}</p> : null}
              {javaRuntimes.map((runtime) => (
                <div key={runtime.path} className="flex items-center justify-between gap-2 rounded-sm border border-border/60 px-2 py-1 text-[11px]">
                  <span className="truncate">
                    Java {runtime.major} · {runtime.vendor} · {runtime.version}
                  </span>
                  <Badge variant={runtime.source === 'mojang' ? 'default' : 'muted'}>{runtime.source}</Badge>
                </div>
              ))}
            </div>
            {presets.data ? (
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-[11px] font-medium">{t('settings.optimization')}</p>
                {presets.data.map((preset) => (
                  <div key={preset.name} className="mt-1">
                    <p className="text-[11px]">{preset.name}</p>
                    <p className="break-all font-mono text-[10px] text-muted-foreground">{preset.args.join(' ') || '—'}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <HardDrive className="size-4" /> {t('settings.storage')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t('settings.dataDirectory')} hint={t('settings.dataDirectoryHint')}>
              <div className="flex gap-2">
                <Input readOnly value={draft.dataDirectory} />
                <Button
                  variant="outline"
                  onClick={() =>
                    void invoke('app:pick-directory')
                      .then((directory) => {
                        if (!directory) return;
                        return updateSettings({ dataDirectory: directory }).catch(() => undefined);
                      })
                      .catch((error: unknown) => toast(errorMessage(error), 'error'))
                  }
                >
                  {t('common.browse')}
                </Button>
              </div>
            </Field>
            <Field label={t('settings.cleanCache')} hint={t('settings.cleanCacheHint')}>
              <Button
                variant="outline"
                onClick={() =>
                  void invoke('system:clean-cache')
                    .then((result) => toast(`${formatBytes(result.freedBytes)} ✓`, 'success'))
                    .catch((error: unknown) => toast(errorMessage(error), 'error'))
                }
              >
                <Trash2 className="size-3.5" /> {t('settings.cleanCache')}
              </Button>
            </Field>
            <Field label={t('settings.integrations')} hint={t('settings.curseforgeHint')}>
              <Input
                type="password"
                placeholder="CurseForge API key"
                value={draft.curseforgeApiKey}
                onChange={(event) => patch({ curseforgeApiKey: event.target.value })}
                autoComplete="off"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <RefreshCw className="size-4" /> {t('settings.updates')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t('settings.updateFeed')} hint="GitHub releases (default) — set a generic feed URL to override">
              <Input
                value={draft.updateFeedUrl}
                placeholder="https://updates.example.com/klymon"
                onChange={(event) => patch({ updateFeedUrl: event.target.value })}
              />
            </Field>
            <label className="flex items-center justify-between text-xs">
              {t('settings.betaUpdates')}
              <Switch checked={draft.enableBetaUpdates} onCheckedChange={(value) => patch({ enableBetaUpdates: value })} />
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void invoke('update:check')
                    .then(setUpdates)
                    .catch((error: unknown) => toast(errorMessage(error), 'error'))
                }
              >
                {t('settings.checkUpdates')}
              </Button>
              {updates ? <Badge variant={updates.state === 'error' ? 'destructive' : updates.state === 'downloaded' ? 'success' : 'muted'}>{updates.state}</Badge> : null}
            </div>
            {updates?.message ? <p className="text-[11px] text-muted-foreground">{updates.message}</p> : null}
            {updates?.state === 'available' ? (
              <Button size="sm" onClick={() => void invoke('update:download')}>
                {t('common.download')}
              </Button>
            ) : null}
            {updates?.state === 'downloaded' ? (
              <Button size="sm" onClick={() => void invoke('update:install')}>
                {t('settings.updates')}
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Stethoscope className="size-4" /> {t('settings.diagnostics')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t('settings.memoryAdvice')} value={`${memoryAdvice.data?.recommendedMb ?? '—'} MB`} hint={memoryAdvice.data?.profile} />
              <Stat label="RAM" value={`${systemInfo.data?.totalMemoryMb ?? '—'} MB`} hint={systemInfo.data?.cpuModel} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void invoke('system:diagnostics', {})
                  .then(setDiagnostics)
                  .catch((error: unknown) => toast(errorMessage(error), 'error'))
              }
            >
              {t('settings.runDiagnostics')}
            </Button>
            {diagnostics ? (
              <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {diagnostics.length === 0 ? <Alert variant="success">{t('home.ready')}</Alert> : null}
                {diagnostics.map((issue) => (
                  <Alert key={issue.id} variant={issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'} title={issue.title}>
                    <p>{issue.description}</p>
                    {issue.solution ? <p className="mt-1 opacity-80">{issue.solution}</p> : null}
                  </Alert>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Languages className="size-4" /> {t('settings.music')} · {t('settings.about')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-3">
              <label className="flex items-center justify-between text-xs">
                {t('settings.musicEnabled')}
                <Switch checked={draft.musicEnabled} onCheckedChange={(value) => patch({ musicEnabled: value })} />
              </label>
              <Field label={`${t('music.volume')} · ${Math.round(draft.musicVolume * 100)}%`}>
                <Slider min={0} max={1} step={0.01} value={[draft.musicVolume]} onValueChange={([value]) => patch({ musicVolume: value ?? 0.6 })} />
              </Field>
              <Field label={t('music.chooseFolder')}>
                <div className="flex gap-2">
                  <Input readOnly value={draft.musicDirectory ?? ''} />
                  <Button
                    variant="outline"
                    onClick={() =>
                      void invoke('app:pick-directory', { title: t('music.chooseFolder') })
                        .then((directory) => {
                          if (directory) patch({ musicDirectory: directory });
                        })
                        .catch((error: unknown) => toast(errorMessage(error), 'error'))
                    }
                  >
                    {t('common.browse')}
                  </Button>
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Stat label="Klymon" value={systemInfo.data?.versions.app ?? '0.1.0'} />
              <Stat label="Electron" value={systemInfo.data?.versions.electron ?? '—'} />
              <Stat label="Node" value={systemInfo.data?.versions.node ?? '—'} />
              <Stat label="Chrome" value={systemInfo.data?.versions.chrome ?? '—'} />
              <Stat label={t('settings.systemInfo')} value={`${systemInfo.data?.platform ?? ''} ${systemInfo.data?.arch ?? ''}`} hint={systemInfo.data?.release} />
              <Stat label="GPU" value={systemInfo.data?.gpus[0] ?? '—'} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
