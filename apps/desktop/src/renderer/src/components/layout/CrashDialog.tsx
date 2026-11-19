import { useState } from 'react';
import { ClipboardCopy, ExternalLink, FileText, FolderOpen, MemoryStick, RefreshCw, RotateCcw, Wrench } from 'lucide-react';
import type { CrashDiagnosis, CrashHintId } from '@klymon/shared-types';
import { invoke, useEvent, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { crashHintUrl } from '../../lib/crash-hints';
import { Alert } from '../ui/misc';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { cn } from '../../lib/utils';

const HINT_KEYS: Record<CrashHintId, { title: TranslationKey; body: TranslationKey }> = {
  memory: { title: 'crash.hint.memory.title', body: 'crash.hint.memory.body' },
  args: { title: 'crash.hint.args.title', body: 'crash.hint.args.body' },
  java: { title: 'crash.hint.java.title', body: 'crash.hint.java.body' },
  mods: { title: 'crash.hint.mods.title', body: 'crash.hint.mods.body' },
  'client-menu': { title: 'crash.hint.clientMenu.title', body: 'crash.hint.clientMenu.body' },
  graphics: { title: 'crash.hint.graphics.title', body: 'crash.hint.graphics.body' },
  repair: { title: 'crash.hint.repair.title', body: 'crash.hint.repair.body' },
  permissions: { title: 'crash.hint.permissions.title', body: 'crash.hint.permissions.body' },
  unknown: { title: 'crash.hint.unknown.title', body: 'crash.hint.unknown.body' },
};

export function CrashDialog(): React.JSX.Element {
  const { t } = useI18n();
  const { instances, toast } = useApp();
  const [diagnosis, setDiagnosis] = useState<CrashDiagnosis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEvent('game:crash', (payload) => setDiagnosis(payload));

  const close = (): void => setDiagnosis(null);
  const instance = diagnosis ? instances.find((entry) => entry.id === diagnosis.instanceId) ?? null : null;

  const copy = async (): Promise<void> => {
    if (!diagnosis) return;
    const hintLines = diagnosis.hints.map(
      (hint) => `- ${t(HINT_KEYS[hint.id].title)}: ${t(HINT_KEYS[hint.id].body, { memory: diagnosis.memoryMb, mc: diagnosis.mcVersion })}`,
    );
    const text = [
      `Klymon Launcher — ${t('crash.copyHeader')}`,
      `${t('crash.instance')}: ${diagnosis.instanceName} (${diagnosis.mcVersion}, ${diagnosis.loaderType})`,
      `${t('crash.exitCode')}: ${diagnosis.exitCode ?? 'unknown'}`,
      `${t('crash.source')}: ${diagnosis.source ? t(`crash.source.${diagnosis.source}` as TranslationKey) : t('crash.source.none')}`,
      '',
      diagnosis.headline,
      diagnosis.exception ? `\n${diagnosis.exception}` : '',
      diagnosis.cause ? `\nCaused by: ${diagnosis.cause}` : '',
      '',
      ...hintLines,
      '',
      diagnosis.excerpt,
      diagnosis.reportPath ? `\n${t('crash.openReport')}: ${diagnosis.reportPath}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n');
    try {
      await invoke('app:copy', { text });
      toast(t('crash.copied'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const openLogs = async (): Promise<void> => {
    if (!diagnosis) return;
    try {
      await invoke('crash:open', { instanceId: diagnosis.instanceId, target: 'logs' });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const openReport = async (): Promise<void> => {
    if (!diagnosis) return;
    try {
      await invoke('crash:open', { instanceId: diagnosis.instanceId, target: 'report' });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const repair = async (): Promise<void> => {
    if (!diagnosis) return;
    setBusy('repair');
    try {
      await invoke('instances:install', { id: diagnosis.instanceId });
      toast(t('crash.repaired'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const increaseMemory = async (): Promise<void> => {
    if (!diagnosis || !instance) return;
    const next = Math.min(16384, Math.max(instance.maxMemoryMb, diagnosis.memoryMb) + 1024);
    setBusy('memory');
    try {
      await invoke('instances:update', { id: instance.id, patch: { maxMemoryMb: next } });
      setDiagnosis({ ...diagnosis, memoryMb: next });
      toast(t('crash.memoryDone', { memory: next }), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const retry = async (): Promise<void> => {
    if (!diagnosis) return;
    setBusy('retry');
    try {
      await invoke('instances:launch', { id: diagnosis.instanceId });
      close();
    } catch (error) {
      toast(errorMessage(error), 'error');
      setBusy(null);
    }
  };

  const reanalyze = async (): Promise<void> => {
    if (!diagnosis) return;
    setBusy('reanalyze');
    try {
      const fresh = await invoke('crash:diagnose', { instanceId: diagnosis.instanceId });
      setDiagnosis(fresh);
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const canIncreaseMemory = Boolean(instance) && (instance?.maxMemoryMb ?? 0) < 16384;

  return (
    <Dialog
      open={diagnosis !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      className="w-[min(720px,94vw)]"
      title={t('crash.title')}
      description={diagnosis ? `${diagnosis.instanceName} · ${diagnosis.mcVersion}${diagnosis.loaderType !== 'vanilla' ? ` · ${diagnosis.loaderType}` : ''}` : undefined}
      footer={
        diagnosis ? (
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.close')}
            </Button>
            <Button variant="outline" onClick={() => void reanalyze()} loading={busy === 'reanalyze'}>
              <RefreshCw className="size-3.5" /> {t('crash.reanalyze')}
            </Button>
            <Button onClick={() => void retry()} loading={busy === 'retry'}>
              <RotateCcw className="size-3.5" /> {t('crash.retry')}
            </Button>
          </>
        ) : undefined
      }
    >
      {diagnosis ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">{t('crash.exitCode')}: {diagnosis.exitCode ?? '?'}</Badge>
            <Badge variant="muted">
              {diagnosis.source ? t(`crash.source.${diagnosis.source}` as TranslationKey) : t('crash.source.none')}
            </Badge>
            {diagnosis.loaderType !== 'vanilla' ? <Badge variant="outline">{diagnosis.loaderType}</Badge> : null}
            <span className="text-[11px] text-muted-foreground">{t('crash.memoryNow', { memory: diagnosis.memoryMb })}</span>
          </div>

          <div className="rounded-md border border-border bg-surface-raised/60 p-3">
            <p className="text-sm font-medium">{diagnosis.headline}</p>
            {diagnosis.exception ? (
              <p className="mt-2 break-words font-mono text-[11px] text-destructive">{diagnosis.exception}</p>
            ) : null}
            {diagnosis.cause ? (
              <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">Caused by: {diagnosis.cause}</p>
            ) : null}
          </div>

          {!diagnosis.found ? <Alert variant="warning">{t('crash.notFound')}</Alert> : null}

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('crash.hints')}</p>
            <div className="flex flex-col gap-2">
              {diagnosis.hints.map((hint, index) => (
                <div key={`${hint.id}-${index}`} className="rounded-md border border-border p-2.5">
                  <p className="text-xs font-semibold">{t(HINT_KEYS[hint.id].title)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t(HINT_KEYS[hint.id].body, { memory: diagnosis.memoryMb, mc: diagnosis.mcVersion })}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/70">{hint.evidence}</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-0.5 h-auto p-0 text-[11px]"
                    onClick={() => void invoke('app:open-external', { url: crashHintUrl(hint.id) }).catch(() => undefined)}
                  >
                    <ExternalLink className="size-3" /> {t('crash.learnMore')}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {diagnosis.excerpt ? (
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">{t('crash.excerpt')}</summary>
              <pre className="max-h-40 overflow-auto border-t border-border bg-black/30 p-3 text-[10px] leading-relaxed text-muted-foreground">
                {diagnosis.excerpt}
              </pre>
            </details>
          ) : null}

          <div className={cn('flex flex-wrap gap-2', busy ? 'opacity-80' : '')}>
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <ClipboardCopy className="size-3.5" /> {t('crash.copy')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void openLogs()}>
              <FolderOpen className="size-3.5" /> {t('crash.openLogs')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void openReport()} disabled={!diagnosis.reportPath}>
              <FileText className="size-3.5" /> {t('crash.openReport')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void repair()} loading={busy === 'repair'}>
              <Wrench className="size-3.5" /> {t('crash.repair')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void increaseMemory()} loading={busy === 'memory'} disabled={!canIncreaseMemory}>
              <MemoryStick className="size-3.5" /> {t('crash.memory')}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
