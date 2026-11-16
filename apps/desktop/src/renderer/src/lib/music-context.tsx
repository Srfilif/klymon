import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MusicTrack } from '@klymon/shared-types';
import { invoke, errorMessage } from './api';
import { useApp } from './app-context';

interface MusicValue {
  tracks: MusicTrack[];
  current: MusicTrack | null;
  playing: boolean;
  volume: number;
  progress: number;
  duration: number;
  queue: string[];
  refreshLibrary: () => Promise<void>;
  playTrack: (trackId: string, queue?: string[]) => Promise<void>;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  setVolume: (value: number) => void;
  seek: (ratio: number) => void;
}

const MusicContext = createContext<MusicValue | null>(null);

export function MusicProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { settings, toast } = useApp();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(settings?.musicVolume ?? 0.6);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const current = useMemo(() => tracks.find((track) => track.id === currentId) ?? null, [tracks, currentId]);

  const refreshLibrary = useCallback(async () => {
    const loaded = await invoke('music:tracks');
    setTracks(loaded);
  }, []);

  useEffect(() => {
    void refreshLibrary().catch(() => undefined);
  }, [refreshLibrary]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const playTrack = useCallback(
    async (trackId: string, nextQueue?: string[]) => {
      try {
        const track = tracks.find((entry) => entry.id === trackId);
        if (!track) return;
        const url = await invoke('music:read-file', { path: track.path });
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = url;
        audio.volume = volume;
        await audio.play();
        setCurrentId(trackId);
        setQueue(nextQueue && nextQueue.length > 0 ? nextQueue : tracks.map((entry) => entry.id));
        setPlaying(true);
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    },
    [toast, tracks, volume],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, [current]);

  const next = useCallback(() => {
    if (!current || queue.length === 0) return;
    const index = queue.indexOf(current.id);
    const nextId = queue[(index + 1) % queue.length];
    if (nextId) void playTrack(nextId, queue);
  }, [current, playTrack, queue]);

  const previous = useCallback(() => {
    if (!current || queue.length === 0) return;
    const index = queue.indexOf(current.id);
    const previousId = queue[(index - 1 + queue.length) % queue.length];
    if (previousId) void playTrack(previousId, queue);
  }, [current, playTrack, queue]);

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    if (audioRef.current) audioRef.current.volume = value;
  }, []);

  const seek = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.duration * ratio));
  }, []);

  const value: MusicValue = {
    tracks,
    current,
    playing,
    volume,
    progress,
    duration,
    queue,
    refreshLibrary,
    playTrack,
    toggle,
    next,
    previous,
    setVolume,
    seek,
  };

  return (
    <MusicContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={next}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
          setDuration(audio.duration || 0);
        }}
        onError={() => setPlaying(false)}
      />
    </MusicContext.Provider>
  );
}

export function useMusic(): MusicValue {
  const value = useContext(MusicContext);
  if (!value) throw new Error('useMusic must be used inside MusicProvider');
  return value;
}
