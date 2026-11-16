import { useEffect, useState } from 'react';
import {
  Archive,
  Boxes,
  Copy,
  Download,
  FolderOpen,
  HardDriveDownload,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Account, Instance, JavaRuntime, LoaderType, MinecraftVersionSummary } from '@klymon/shared-types';
import { invoke, useAsync, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { formatDuration } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Field, Input, Textarea } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { EmptyState, PageHeader, Stat } from '../components/ui/misc';

const LOADERS: { value: LoaderType; label: string }[] = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'legacy-fabric', label: 'Legacy Fabric' },
];

interface FormState {
  name: string;
  description: string;
  mcVersion: string;
  loaderType: LoaderType;
  loaderVersion: string;
  minMemoryMb: number;
  maxMemoryMb: number;
  jvmArgs: string;
  gameArgs: string;
  javaPath: string;
  accountId: string;
}

const emptyForm = (defaults: { mcVersion: string; memory: number }): FormState => ({
  name: '',
  description: '',
  mcVersion: defaults.mcVersion,
  loaderType: 'vanilla',
  loaderVersion: '',
  minMemoryMb: 1024,
  maxMemoryMb: defaults.memory,
  jvmArgs: '',
  gameArgs: '',
  javaPath: '',
  accountId: '',
});

export function InstancesPage(): React.JSX.Element {
  const { t } = useI18n();
  const { instances, accounts, refreshInstances, setActiveInstanceId, toast, settings } = useApp();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Instance | null>(null);
  const [deleting, setDeleting] = useState<Instance | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm({ mcVersion: '', memory: settings?.defaultMemoryMb ?? 4096 }));
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaderOptions, setLoaderOptions] = useState<{ value: string; label: string }[]>([]);
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntime[]>([]);

  const versions = useAsync<MinecraftVersionSummary[]>(() => invoke('versions:list', { includeSnapshots: false }), []);
  const backups = useAsync(() => (editing ? invoke('instances:backups', { id: editing.id }) : Promise.resolve([])), [editing?.id]);

  useEffect(() => {
    void invoke('java:detect').then(setJavaRuntimes).catch(() => undefined);
  }, []);

  const openCreate = (): void => {
    setForm(emptyForm({ mcVersion: versions.data?.[0]?.id ?? '1.21.1', memory: settings?.defaultMemoryMb ?? 4096 }));
    setLoaderOptions([]);
    setCreating(true);
  };

  const openEdit = (instance: Instance): void => {
    setForm({
      name: instance.name,
      description: instance.description,
      mcVersion: instance.mcVersion,
      loaderType: instance.loaderType,
      loaderVersion: instance.loaderVersion ?? '',
      minMemoryMb: instance.minMemoryMb,
      maxMemoryMb: instance.maxMemoryMb,
      jvmArgs: instance.jvmArgs.join(' '),
      gameArgs: instance.gameArgs.join(' '),
      javaPath: instance.javaPath ?? '',
      accountId: instance.accountId ?? '',
    });
    setEditing(instance);
  };

  const loadLoaders = async (loaderType: LoaderType, mcVersion: string): Promise<void> => {
    setForm((current) => ({ ...current, loaderType, loaderVersion: '' }));
    if (loaderType === 'vanilla' || !mcVersion) {
      setLoaderOptions([]);
      return;
    }
    try {
      const options = await invoke('loaders:versions', { loaderType, mcVersion });
      setLoaderOptions(options.map((option) => ({ value: option.version, label: `${option.version}${option.recommended ? ' ★' : ''}` })));
      const recommended = options.find((option) => option.recommended) ?? options[0];
      if (recommended) setForm((current) => ({ ...current, loaderVersion: recommended.version }));
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      if (editing) {
        await invoke('instances:update', {
          id: editing.id,
          patch: {
            name: form.name,
            description: form.description,
            mcVersion: form.mcVersion,
            loaderType: form.loaderType,
            loaderVersion: form.loaderType === 'vanilla' ? null : form.loaderVersion || null,
            minMemoryMb: form.minMemoryMb,
            maxMemoryMb: form.maxMemoryMb,
            jvmArgs: form.jvmArgs.split(/\s+/).filter(Boolean),
            gameArgs: form.gameArgs.split(/\s+/).filter(Boolean),
            javaPath: form.javaPath || null,
            accountId: form.accountId || null,
          },
        });
        toast(t('instances.saved'), 'success');
        setEditing(null);
      } else {
        const created = await invoke('instances:create', {
          name: form.name,
          description: form.description,
          mcVersion: form.mcVersion,
          loaderType: form.loaderType,
          loaderVersion: form.loaderType === 'vanilla' ? null : form.loaderVersion || null,
          minMemoryMb: form.minMemoryMb,
          maxMemoryMb: form.maxMemoryMb,
          jvmArgs: form.jvmArgs.split(/\s+/).filter(Boolean),
          gameArgs: form.gameArgs.split(/\s+/).filter(Boolean),
          javaPath: form.javaPath || null,
          accountId: form.accountId || null,
        });
        setActiveInstanceId(created.id);
        toast(t('instances.created'), 'success');
        setCreating(false);
      }
      await refreshInstances();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (id: string, action: () => Promise<unknown>, successMessage?: string): Promise<void> => {
    setBusyId(id);
    try {
      await action();
      if (successMessage) toast(successMessage, 'success');
      await refreshInstances();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const accountOptions = [{ value: '', label: t('common.none') }, ...accounts.map((account: Account) => ({ value: account.id, label: account.name }))];
  const javaOptions = [{ value: '', label: t('settings.autoJava') }, ...javaRuntimes.map((runtime) => ({ value: runtime.path, label: `Java ${runtime.major} · ${runtime.vendor}` }))];

  const formFields = (
    <div className="grid gap-3">
      <Field label={t('instances.name')}>
        <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={48} />
      </Field>
      <Field label={t('instances.description')}>
        <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={500} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('instances.mcVersion')}>
          <Select
            value={form.mcVersion}
            onValueChange={(value) => {
              setForm((current) => ({ ...current, mcVersion: value }));
              void loadLoaders(form.loaderType, value);
            }}
            options={(versions.data ?? []).slice(0, 80).map((version) => ({ value: version.id, label: version.id }))}
          />
        </Field>
        <Field label={t('instances.loader')}>
          <Select value={form.loaderType} onValueChange={(value) => void loadLoaders(value as LoaderType, form.mcVersion)} options={LOADERS} />
        </Field>
      </div>
      {form.loaderType !== 'vanilla' ? (
        <Field label={t('instances.loaderVersion')}>
          <Select
            value={form.loaderVersion}
            onValueChange={(value) => setForm((current) => ({ ...current, loaderVersion: value }))}
            options={loaderOptions}
            placeholder={t('common.none')}
            disabled={loaderOptions.length === 0}
          />
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('instances.minMemory')}>
          <Input
            type="number"
            min={512}
            step={256}
            value={form.minMemoryMb}
            onChange={(event) => setForm((current) => ({ ...current, minMemoryMb: Number(event.target.value) }))}
          />
        </Field>
        <Field label={t('instances.maxMemory')}>
          <Input
            type="number"
            min={512}
            step={256}
            value={form.maxMemoryMb}
            onChange={(event) => setForm((current) => ({ ...current, maxMemoryMb: Number(event.target.value) }))}
          />
        </Field>
      </div>
      <Field label={t('instances.jvmArgs')} hint="-XX:+UseG1GC …">
        <Input value={form.jvmArgs} onChange={(event) => setForm((current) => ({ ...current, jvmArgs: event.target.value }))} />
      </Field>
      <Field label={t('instances.gameArgs')}>
        <Input value={form.gameArgs} onChange={(event) => setForm((current) => ({ ...current, gameArgs: event.target.value }))} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('instances.java')}>
          <Select value={form.javaPath} onValueChange={(value) => setForm((current) => ({ ...current, javaPath: value }))} options={javaOptions} />
        </Field>
        <Field label={t('instances.account')}>
          <Select value={form.accountId} onValueChange={(value) => setForm((current) => ({ ...current, accountId: value }))} options={accountOptions} />
        </Field>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('instances.title')}
        subtitle={t('instances.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => void invoke('instances:import').then(() => refreshInstances()).catch((error: unknown) => toast(errorMessage(error), 'error'))}>
              <Upload className="size-4" /> {t('common.import')}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" /> {t('instances.new')}
            </Button>
          </>
        }
      />

      {instances.length === 0 ? (
        <EmptyState icon={<Boxes className="size-6" />} title={t('instances.empty')} action={<Button onClick={openCreate}>{t('instances.new')}</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {instances.map((instance) => (
            <Card key={instance.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{instance.name}</p>
                    <p className="line-clamp-1 text-[11px] text-muted-foreground">{instance.description || '—'}</p>
                  </div>
                  <Badge variant={instance.installed ? 'success' : 'warning'}>{instance.installed ? t('common.installed') : t('common.notInstalled')}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Minecraft" value={instance.mcVersion} />
                  <Stat label={t('instances.loader')} value={instance.loaderType} hint={instance.loaderVersion ?? undefined} />
                  <Stat label={t('instances.playtime')} value={formatDuration(instance.playTimeSeconds)} />
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => {
                      setActiveInstanceId(instance.id);
                      void runAction(instance.id, () => invoke('instances:launch', { id: instance.id }));
                    }}
                    loading={busyId === instance.id}
                  >
                    <Play className="size-3.5" /> {t('common.play')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void runAction(
                        instance.id,
                        async () => {
                          const result = await invoke('instances:install', { id: instance.id });
                          toast(`✓ ${result.versionId}`, 'success');
                        },
                      )
                    }
                  >
                    <Download className="size-3.5" /> {instance.installed ? t('common.repair') : t('common.install')}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(instance)} aria-label={t('common.edit')}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void invoke('instances:open-folder', { id: instance.id }).catch((error: unknown) => toast(errorMessage(error), 'error'))}
                    aria-label={t('common.openFolder')}
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      void runAction(instance.id, async () => {
                        const target = await invoke('instances:duplicate', { id: instance.id, name: `${instance.name} copy` });
                        setActiveInstanceId(target.id);
                      }, t('instances.created'))
                    }
                    aria-label={t('common.duplicate')}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void runAction(instance.id, () => invoke('instances:export', { id: instance.id }), t('common.export'))}
                    aria-label={t('common.export')}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void runAction(instance.id, () => invoke('instances:backup', { id: instance.id }), t('instances.backup'))}
                    aria-label={t('instances.backup')}
                  >
                    <HardDriveDownload className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="ml-auto text-destructive" onClick={() => setDeleting(instance)} aria-label={t('common.delete')}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('instances.new')}
        description={t('instances.subtitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!form.name.trim() || !form.mcVersion}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        {formFields}
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={t('common.edit')}
        description={editing?.gameDir}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {formFields}
        <div className="rounded-md border border-border bg-surface-raised/50 p-3">
          <p className="text-[11px] font-medium">{t('instances.backup')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!editing) return;
                void invoke('instances:backup', { id: editing.id })
                  .then(() => backups.reload())
                  .catch((error: unknown) => toast(errorMessage(error), 'error'));
              }}
            >
              <HardDriveDownload className="size-3.5" /> {t('instances.backup')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!editing) return;
                void invoke('instances:export', { id: editing.id }).catch((error: unknown) => toast(errorMessage(error), 'error'));
              }}
            >
              <Archive className="size-3.5" /> {t('common.export')}
            </Button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {(backups.data ?? []).map((backup) => (
              <div key={backup.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate">{backup.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void invoke('instances:restore-backup', { backupId: backup.id })
                      .then(() => toast(t('instances.restore'), 'success'))
                      .catch((error: unknown) => toast(errorMessage(error), 'error'))
                  }
                >
                  {t('instances.restore')}
                </Button>
              </div>
            ))}
            {(backups.data ?? []).length === 0 ? <p className="text-[11px] text-muted-foreground">{t('common.empty')}</p> : null}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('instances.confirmDelete')}
        description={deleting?.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                const id = deleting.id;
                setDeleting(null);
                void runAction(id, () => invoke('instances:delete', { id, deleteFiles: true }));
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">{t('instances.deleteFiles')}: {t('common.yes')}.</p>
      </Dialog>
    </div>
  );
}
