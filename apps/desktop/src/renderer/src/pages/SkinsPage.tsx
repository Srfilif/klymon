import { useEffect, useRef, useState } from 'react';
import { Box, Check, Focus, Image as ImageIcon, ImagePlus, Pencil, RotateCcw, RotateCw, Trash2, Upload, UserRoundSearch, ZoomIn, ZoomOut } from 'lucide-react';
import type { SkinRecord } from '@klymon/shared-types';
import { invoke, useAsync, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { Alert, EmptyState, PageHeader } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Field, Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { SkinViewer, type SkinAnimation, type SkinViewerHandle } from '../components/SkinViewer';
import { SkinPreview2D } from '../components/SkinPreview2D';
import { formatDate } from '../lib/utils';

type Variant = 'classic' | 'slim';
type PreviewMode = '3d' | '2d';
type ConfirmAction = 'delete' | 'reset';

export function SkinsPage(): React.JSX.Element {
  const { t } = useI18n();
  const { accounts, activeAccount, refreshAccounts, toast } = useApp();
  const [accountId, setAccountId] = useState(activeAccount?.id ?? '');
  const [selectedSkin, setSelectedSkin] = useState<string | null>(null);
  const [variant, setVariant] = useState<Variant>('classic');
  const [animation, setAnimation] = useState<SkinAnimation>('idle');
  const [autoRotate, setAutoRotate] = useState(true);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('3d');
  const viewerRef = useRef<SkinViewerHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [playerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [renaming, setRenaming] = useState<SkinRecord | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);

  const skins = useAsync<SkinRecord[]>(() => invoke('skins:list'), []);
  const preview = useAsync<{ skinUrl: string | null; capeUrl: string | null; variant: Variant; isLocal: boolean }>(
    () =>
      accountId
        ? invoke('accounts:skin-preview', { id: accountId })
        : Promise.resolve({ skinUrl: null, capeUrl: null, variant: 'classic' as const, isLocal: false }),
    [accountId],
  );

  useEffect(() => {
    if (!accountId && activeAccount) setAccountId(activeAccount.id);
  }, [activeAccount, accountId]);

  const account = accounts.find((entry) => entry.id === accountId) ?? null;
  const isPremium = account?.type === 'microsoft';
  const library = skins.data ?? [];
  const appliedSkin = library.find((skin) => skin.accountId === accountId && skin.isActive) ?? null;
  const activeSkin = library.find((skin) => skin.id === selectedSkin) ?? appliedSkin ?? library[0] ?? null;

  // Keep the variant toggle in sync with whatever skin is being previewed.
  useEffect(() => {
    if (activeSkin) setVariant(activeSkin.variant);
    else if (preview.data) setVariant(preview.data.variant);
  }, [activeSkin?.id, preview.data?.variant]);

  const previewUrl = useSkinAssetUrl(activeSkin?.filePath ?? null);
  const remoteUrl = preview.data?.skinUrl ?? null;
  const shownUrl = activeSkin ? previewUrl : remoteUrl;
  const capeUrl = preview.data?.capeUrl ?? null;

  const reloadAll = async (): Promise<void> => {
    skins.reload();
    preview.reload();
    await refreshAccounts();
  };

  const importSkin = async (): Promise<void> => {
    setBusy('import');
    try {
      const record = await invoke('skins:import', { accountId: accountId || null, variant });
      if (record) {
        setSelectedSkin(record.id);
        skins.reload();
        toast(`✓ ${record.name}`, 'success');
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const importPlayer = async (): Promise<void> => {
    if (!playerName.trim()) return;
    setBusy('player');
    try {
      const record = await invoke('skins:import-player', { username: playerName.trim(), accountId: accountId || null });
      setSelectedSkin(record.id);
      setPlayerName('');
      setPlayerDialogOpen(false);
      skins.reload();
      toast(`✓ ${record.name}`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const applyLocal = async (): Promise<void> => {
    if (!activeSkin || !accountId) return;
    setBusy('apply');
    try {
      await invoke('skins:apply-local', { skinId: activeSkin.id, accountId });
      toast(t('skins.apply'), 'success');
      await reloadAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const upload = async (): Promise<void> => {
    if (!activeSkin || !accountId) return;
    setBusy('upload');
    try {
      await invoke('skins:upload-microsoft', { skinId: activeSkin.id, accountId, variant });
      toast(t('skins.uploadDone'), 'success');
      await reloadAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const resetOfficial = async (): Promise<void> => {
    if (!accountId) return;
    setBusy('reset');
    try {
      await invoke('skins:reset-microsoft', { accountId });
      toast(t('skins.resetDone'), 'success');
      await reloadAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const deleteSkin = async (): Promise<void> => {
    if (!activeSkin) return;
    setBusy('delete');
    try {
      await invoke('skins:delete', { skinId: activeSkin.id });
      setSelectedSkin(null);
      toast(t('skins.deleted'), 'success');
      await reloadAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const changeVariant = async (next: Variant): Promise<void> => {
    setVariant(next);
    if (!activeSkin || activeSkin.variant === next) return;
    try {
      await invoke('skins:update', { skinId: activeSkin.id, variant: next });
      skins.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const rename = async (): Promise<void> => {
    if (!renaming || !renameValue.trim()) return;
    try {
      await invoke('skins:update', { skinId: renaming.id, name: renameValue.trim() });
      setRenaming(null);
      skins.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const rotateNow = (): void => {
    setAutoRotate((value) => !value);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('skins.title')}
        subtitle={t('skins.subtitle')}
        actions={
          <>
            <Select
              className="w-44"
              value={accountId}
              onValueChange={setAccountId}
              options={accounts.map((entry) => ({ value: entry.id, label: entry.name }))}
              placeholder={t('accounts.empty')}
            />
            <Button variant="outline" onClick={() => setPlayerDialogOpen(true)}>
              <UserRoundSearch className="size-4" /> {t('skins.importPlayer')}
            </Button>
            <Button onClick={() => void importSkin()} loading={busy === 'import'}>
              <ImagePlus className="size-4" /> {t('skins.import')}
            </Button>
          </>
        }
      />

      {!account ? <Alert variant="info">{t('skins.noAccount')}</Alert> : null}
      {account?.type === 'offline' ? <Alert variant="info">{t('skins.offlineNote')}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t('skins.previewMode')}>
              <Button
                variant={previewMode === '3d' ? 'secondary' : 'outline'}
                size="sm"
                role="tab"
                aria-selected={previewMode === '3d'}
                onClick={() => setPreviewMode('3d')}
              >
                <Box className="size-3.5" /> {t('skins.view3d')}
              </Button>
              <Button
                variant={previewMode === '2d' ? 'secondary' : 'outline'}
                size="sm"
                role="tab"
                aria-selected={previewMode === '2d'}
                onClick={() => setPreviewMode('2d')}
              >
                <ImageIcon className="size-3.5" /> {t('skins.view2d')}
              </Button>
            </div>

            <div className="relative flex h-[360px] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-primary/10 to-transparent p-2">
              {previewMode === '3d' ? (
                <SkinViewer
                  ref={viewerRef}
                  skinUrl={shownUrl}
                  capeUrl={capeUrl}
                  variant={variant}
                  width={300}
                  height={360}
                  animation={animation}
                  autoRotate={autoRotate}
                  label={t('skins.preview3dLabel')}
                />
              ) : (
                <SkinPreview2D skinUrl={shownUrl} variant={variant} maxHeight={344} label={t('skins.preview2dLabel')} />
              )}
              {appliedSkin?.id === activeSkin?.id && activeSkin ? (
                <Badge variant="success" className="absolute left-2 top-2 gap-1">
                  <Check className="size-3" /> {t('skins.applied')}
                </Badge>
              ) : null}
            </div>

            {previewMode === '3d' ? (
              <>
                <div className="flex items-end gap-2">
                  <Select
                    className="min-w-0 flex-1"
                    value={animation}
                    onValueChange={(value) => setAnimation(value as SkinAnimation)}
                    options={[
                      { value: 'idle', label: t('skins.animationIdle') },
                      { value: 'walk', label: t('skins.animationWalk') },
                      { value: 'run', label: t('skins.animationRun') },
                      { value: 'fly', label: t('skins.animationFly') },
                      { value: 'none', label: t('skins.animationNone') },
                    ]}
                  />
                  <Button
                    variant={autoRotate ? 'secondary' : 'outline'}
                    size="icon"
                    onClick={rotateNow}
                    aria-pressed={autoRotate}
                    title={t('skins.autoRotate')}
                    aria-label={t('skins.autoRotate')}
                  >
                    {autoRotate ? <RotateCw className="size-4" /> : <RotateCcw className="size-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => viewerRef.current?.zoomOut()}
                    title={t('skins.zoomOut')}
                    aria-label={t('skins.zoomOut')}
                  >
                    <ZoomOut className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => viewerRef.current?.zoomIn()}
                    title={t('skins.zoomIn')}
                    aria-label={t('skins.zoomIn')}
                  >
                    <ZoomIn className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => viewerRef.current?.resetView()}
                    title={t('skins.resetView')}
                    aria-label={t('skins.resetView')}
                  >
                    <Focus className="size-4" />
                  </Button>
                </div>
                <p className="text-center text-[10px] text-muted-foreground">{t('skins.controlsHint')}</p>
              </>
            ) : (
              <p className="text-center text-[10px] text-muted-foreground">{t('skins.preview2dHint')}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('skins.variant')}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={variant === 'classic' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => void changeVariant('classic')}
                  aria-pressed={variant === 'classic'}
                >
                  {t('skins.classic')}
                </Button>
                <Button
                  variant={variant === 'slim' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => void changeVariant('slim')}
                  aria-pressed={variant === 'slim'}
                >
                  {t('skins.slim')}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <Button onClick={() => void applyLocal()} loading={busy === 'apply'} disabled={!activeSkin || !accountId}>
                {t('skins.apply')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void upload()}
                loading={busy === 'upload'}
                disabled={!activeSkin || !isPremium}
              >
                <Upload className="size-3.5" /> {t('skins.upload')}
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">{t('skins.uploadHint')}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming('reset')}
                  disabled={!isPremium}
                >
                  <RotateCcw className="size-3.5" /> {t('skins.reset')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirming('delete')}
                  disabled={!activeSkin}
                >
                  <Trash2 className="size-3.5" /> {t('common.delete')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('skins.gallery')}</p>
              <span className="text-[11px] text-muted-foreground">{library.length}</span>
            </div>
            {library.length === 0 ? (
              <EmptyState
                icon={<ImagePlus className="size-5" />}
                title={t('skins.empty')}
                action={<Button onClick={() => void importSkin()}>{t('skins.import')}</Button>}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {library.map((skin) => (
                  <div
                    key={skin.id}
                    className={`group flex items-center gap-2 rounded-md border p-2 transition-colors ${
                      activeSkin?.id === skin.id ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-border/80'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSkin(skin.id)}
                      className="focus-ring flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-label={skin.name}
                    >
                      <SkinFace filePath={skin.filePath} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="truncate text-xs font-medium">{skin.name}</span>
                          {skin.isActive ? <Check className="size-3 shrink-0 text-emerald-400" aria-hidden /> : null}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {formatDate(skin.createdAt)} · {skin.variant === 'slim' ? t('skins.slim') : t('skins.classic')}
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t('skins.rename')}
                        onClick={() => {
                          setRenaming(skin);
                          setRenameValue(skin.name);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        aria-label={t('common.delete')}
                        onClick={() => {
                          setSelectedSkin(skin.id);
                          setConfirming('delete');
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={playerDialogOpen}
        onOpenChange={setPlayerDialogOpen}
        title={t('skins.importPlayer')}
        description={t('skins.playerHint')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlayerDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void importPlayer()} loading={busy === 'player'} disabled={!playerName.trim()}>
              {t('skins.importPlayer')}
            </Button>
          </>
        }
      >
        <Field label={t('skins.playerName')}>
          <Input
            autoFocus
            value={playerName}
            maxLength={16}
            placeholder="Notch"
            onChange={(event) => setPlayerName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void importPlayer();
            }}
          />
        </Field>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title={t('skins.renameTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void rename()} disabled={!renameValue.trim()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('skins.name')}>
          <Input
            autoFocus
            value={renameValue}
            maxLength={60}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename();
            }}
          />
        </Field>
      </Dialog>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming === 'reset' ? t('skins.resetTitle') : t('skins.deleteTitle')}
        description={confirming === 'reset' ? t('skins.resetConfirm') : t('skins.deleteConfirm')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={confirming === 'reset' ? 'outline' : 'destructive'}
              loading={busy === 'reset' || busy === 'delete'}
              onClick={() => void (confirming === 'reset' ? resetOfficial() : deleteSkin())}
            >
              {confirming === 'reset' ? t('skins.reset') : t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">{confirming === 'reset' ? t('skins.resetHint') : t('skins.deleteHint')}</p>
      </Dialog>
    </div>
  );
}

/** Resolves an absolute skin path into an `klymon-media://` URL. */
function useSkinAssetUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    invoke('app:asset-url', { path })
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

/** Renders the 8x8 head (with its hat overlay) from a skin texture, pixel-crisp. */
function SkinFace({ filePath }: { filePath: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const url = useSkinAssetUrl(filePath);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = new Image();
    image.onload = () => {
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height);
      // Hat/head overlay; absent or transparent on skins without one.
      context.drawImage(image, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height);
    };
    image.src = url;
  }, [url]);

  return <canvas ref={canvasRef} width={48} height={48} className="size-12 shrink-0 rounded border border-border/60 bg-muted" aria-hidden />;
}
