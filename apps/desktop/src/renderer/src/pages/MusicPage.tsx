import { useEffect, useState } from 'react';
import { FolderOpen, ListMusic, Music2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import type { Playlist } from '@klymon/shared-types';
import { invoke, useAsync, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { useMusic } from '../lib/music-context';
import { Alert, EmptyState, PageHeader } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Field, Input } from '../components/ui/input';
import { Slider } from '../components/ui/slider';
import { formatDuration } from '../lib/utils';

export function MusicPage(): React.JSX.Element {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const music = useMusic();
  const [playlistName, setPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState<string | null>(null);
  const playlists = useAsync<Playlist[]>(() => invoke('music:playlists'), []);

  useEffect(() => {
    void music.refreshLibrary().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseFolder = async (): Promise<void> => {
    try {
      const directory = await invoke('app:pick-directory', { title: t('music.chooseFolder') });
      if (!directory) return;
      await updateSettings({ musicDirectory: directory, musicEnabled: true });
      await invoke('music:scan');
      await music.refreshLibrary();
      playlists.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const scan = async (): Promise<void> => {
    try {
      await invoke('music:scan');
      await music.refreshLibrary();
      toast(t('music.tracks'), 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const createPlaylist = async (): Promise<void> => {
    try {
      await invoke('music:create-playlist', { name: playlistName });
      setPlaylistName('');
      setCreating(false);
      playlists.reload();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const addToPlaylist = async (trackId: string): Promise<void> => {
    if (!playlistTarget) return;
    try {
      const playlist = playlists.data?.find((entry) => entry.id === playlistTarget);
      if (!playlist) return;
      await invoke('music:set-playlist-tracks', { id: playlist.id, trackIds: [...playlist.trackIds, trackId] });
      playlists.reload();
      toast(`✓ ${playlist.name}`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setPlaylistTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('music.title')}
        subtitle={t('music.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={() => void chooseFolder()}>
              <FolderOpen className="size-4" /> {t('music.chooseFolder')}
            </Button>
            <Button onClick={() => void scan()} disabled={!settings?.musicDirectory}>
              <Music2 className="size-4" /> {t('music.rescan')}
            </Button>
          </>
        }
      />

      {!settings?.musicDirectory ? <Alert variant="info">{t('music.empty')}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="flex min-h-[320px] flex-col">
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('music.tracks')}</p>
              <Badge variant="muted">{music.tracks.length}</Badge>
            </div>
            {music.tracks.length === 0 ? (
              <EmptyState icon={<Music2 className="size-5" />} title={t('music.noTracks')} description={t('music.empty')} />
            ) : (
              <div className="max-h-[48vh] overflow-y-auto">
                {music.tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`flex items-center gap-2 border-b border-border/40 py-1.5 last:border-0 ${
                      music.current?.id === track.id ? 'text-primary' : ''
                    }`}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void music.playTrack(track.id, music.tracks.map((entry) => entry.id))}
                      aria-label={t('common.play')}
                    >
                      {music.current?.id === track.id && music.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs">{track.title}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {track.artist || '—'} {track.album ? `· ${track.album}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{formatDuration(track.durationSec)}</span>
                    <Button variant="ghost" size="icon" onClick={() => setPlaylistTarget(track.id)} aria-label={t('music.addToPlaylist')}>
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{t('music.nowPlaying')}</p>
                <Badge variant={music.playing ? 'success' : 'muted'}>{music.playing ? t('common.enabled') : t('common.disabled')}</Badge>
              </div>
              <p className="truncate text-xs">{music.current?.title ?? '—'}</p>
              <p className="truncate text-[11px] text-muted-foreground">{music.current?.artist ?? ''}</p>
              <div className="flex items-center gap-2">
                <Button size="icon" onClick={music.toggle} disabled={!music.current}>
                  {music.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${Math.round(music.progress * 100)}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground">{formatDuration(music.duration)}</span>
              </div>
              <Field label={t('music.volume')}>
                <Slider min={0} max={1} step={0.01} value={[music.volume]} onValueChange={([value]) => music.setVolume(value ?? 0)} />
              </Field>
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{t('music.playlists')}</p>
                <Button variant="ghost" size="icon" onClick={() => setCreating(true)} aria-label={t('music.newPlaylist')}>
                  <Plus className="size-4" />
                </Button>
              </div>
              {(playlists.data ?? []).length === 0 ? <p className="text-[11px] text-muted-foreground">{t('common.empty')}</p> : null}
              {(playlists.data ?? []).map((playlist) => (
                <div key={playlist.id} className="flex items-center gap-2 border-b border-border/40 py-1 last:border-0">
                  <ListMusic className="size-3.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">{playlist.name}</p>
                    <p className="text-[10px] text-muted-foreground">{playlist.trackIds.length}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.play')}
                    onClick={() => {
                      const first = playlist.trackIds[0];
                      if (first) void music.playTrack(first, playlist.trackIds);
                    }}
                  >
                    <Play className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.delete')}
                    onClick={() =>
                      void invoke('music:delete-playlist', { id: playlist.id })
                        .then(() => playlists.reload())
                        .catch((error: unknown) => toast(errorMessage(error), 'error'))
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('music.newPlaylist')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void createPlaylist()} disabled={playlistName.trim().length === 0}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <Field label={t('instances.name')}>
          <Input value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} maxLength={80} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={playlistTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPlaylistTarget(null);
        }}
        title={t('music.addToPlaylist')}
        footer={
          <Button variant="ghost" onClick={() => setPlaylistTarget(null)}>
            {t('common.cancel')}
          </Button>
        }
      >
        <div className="flex flex-col gap-1">
          {(playlists.data ?? []).map((playlist) => (
            <Button key={playlist.id} variant="secondary" onClick={() => void addToPlaylist(playlistTarget ?? '')}>
              {playlist.name}
            </Button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
