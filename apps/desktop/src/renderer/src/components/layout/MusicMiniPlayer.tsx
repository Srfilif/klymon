import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useApp } from '../../lib/app-context';
import { useMusic } from '../../lib/music-context';
import { useI18n } from '../../lib/i18n';
import { Slider } from '../ui/slider';
import { Button } from '../ui/button';

export function MusicMiniPlayer(): React.JSX.Element | null {
  const { t } = useI18n();
  const { settings } = useApp();
  const { current, playing, toggle, next, previous, volume, setVolume, progress } = useMusic();

  if (!settings?.musicEnabled || !current) return null;

  return (
    <div className="shrink-0 border-t border-border/60 bg-surface/85 px-4 py-2 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{current.title}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {current.artist || t('music.nowPlaying')} {current.album ? `· ${current.album}` : ''}
          </p>
        </div>
        <div className="hidden w-40 sm:block">
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={previous} aria-label="Previous">
            <SkipBack className="size-4" />
          </Button>
          <Button variant="default" size="icon" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={next} aria-label="Next">
            <SkipForward className="size-4" />
          </Button>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Volume2 className="size-3.5 text-muted-foreground" />
          <Slider className="w-24" min={0} max={1} step={0.01} value={[volume]} onValueChange={([value]) => setVolume(value ?? 0)} />
        </div>
      </div>
    </div>
  );
}
