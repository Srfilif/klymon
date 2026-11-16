import { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import type { LogLine } from '@klymon/shared-types';
import { invoke, useEvent, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/misc';
import { cn } from '../../lib/utils';

const LEVEL_COLORS: Record<LogLine['level'], string> = {
  trace: 'text-muted-foreground',
  debug: 'text-muted-foreground',
  info: 'text-foreground/90',
  warn: 'text-warning',
  error: 'text-destructive',
};

export function ConsoleDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element | null {
  const { t } = useI18n();
  const { activeInstance, toast } = useApp();
  const [launcherLines, setLauncherLines] = useState<LogLine[]>([]);
  const [gameLines, setGameLines] = useState<string[]>([]);
  const [loadingGame, setLoadingGame] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    invoke('logs:tail', { limit: 300 })
      .then(setLauncherLines)
      .catch(() => undefined);
  }, [open]);

  useEvent('log:line', (line) => setLauncherLines((current) => [...current.slice(-499), line]));

  useEvent('game:log', ({ instanceId, line }) => {
    if (activeInstance && instanceId !== activeInstance.id) return;
    setGameLines((current) => [...current.slice(-1999), line]);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [launcherLines, gameLines, open]);

  if (!open) return null;

  const loadGameLog = async (): Promise<void> => {
    if (!activeInstance) return;
    setLoadingGame(true);
    try {
      const text = await invoke('logs:read-game-log', { instanceId: activeInstance.id });
      setGameLines(text.split(/\r?\n/).filter(Boolean));
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setLoadingGame(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="dialog" aria-label={t('console.title')}>
      <button type="button" className="flex-1" aria-label={t('common.close')} onClick={() => onOpenChange(false)} />
      <div className="flex h-full w-[min(680px,80vw)] flex-col border-l border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t('console.title')}</p>
            <p className="text-[11px] text-muted-foreground">{activeInstance ? activeInstance.name : t('common.none')}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void loadGameLog()} loading={loadingGame}>
              <RefreshCw className="size-3.5" /> latest.log
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!activeInstance) return;
                await invoke('logs:open-game-log', { instanceId: activeInstance.id }).catch(() => undefined);
              }}
              disabled={!activeInstance}
            >
              <FolderOpen className="size-3.5" /> {t('console.openLog')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="launcher" className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-3">
            <TabsList>
              <TabsTrigger value="launcher">{t('console.launcher')}</TabsTrigger>
              <TabsTrigger value="game">{t('console.game')}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="launcher" className="min-h-0 flex-1">
            <ScrollArea className="h-full px-4 py-3 font-mono text-[11px] leading-relaxed">
              {launcherLines.length === 0 ? <p className="text-muted-foreground">{t('console.empty')}</p> : null}
              {launcherLines.map((line, index) => (
                <p key={`${line.time}-${index}`} className={cn('whitespace-pre-wrap break-all', LEVEL_COLORS[line.level])}>
                  <span className="mr-2 text-muted-foreground/70">{new Date(line.time).toLocaleTimeString()}</span>
                  <span className="mr-2 text-accent">[{line.scope}]</span>
                  {line.message}
                </p>
              ))}
              <div ref={bottomRef} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="game" className="min-h-0 flex-1">
            <ScrollArea className="h-full px-4 py-3 font-mono text-[11px] leading-relaxed">
              {gameLines.length === 0 ? <p className="text-muted-foreground">{t('console.empty')}</p> : null}
              {gameLines.map((line, index) => (
                <p key={index} className="whitespace-pre-wrap break-all text-foreground/80">
                  {line}
                </p>
              ))}
              <div ref={bottomRef} />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
