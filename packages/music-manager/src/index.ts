import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseFile } from 'music-metadata';
import { isInside, listFilesRecursive, notFound, pathExists, type LauncherLogger } from '@klymon/core';
import type { MusicRepository } from '@klymon/database';
import type { MusicTrack, Playlist } from '@klymon/shared-types';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus']);

export function trackIdFor(path: string): string {
  return createHash('sha1').update(path).digest('hex');
}

export class MusicManager {
  constructor(
    private readonly repo: MusicRepository,
    private readonly logger: LauncherLogger,
  ) {}

  async scan(directory: string): Promise<MusicTrack[]> {
    if (!(await pathExists(directory))) throw notFound('The selected music folder does not exist.');
    const files = (await listFilesRecursive(directory)).filter((file) => {
      const lower = file.toLowerCase();
      return [...AUDIO_EXTENSIONS].some((extension) => lower.endsWith(extension));
    });
    const records: MusicTrack[] = [];
    for (const file of files) {
      try {
        const metadata = await parseFile(file, { duration: true });
        records.push({
          id: trackIdFor(file),
          path: file,
          title: metadata.common.title ?? basename(file).replace(/\.[^.]+$/, ''),
          artist: metadata.common.artist ?? '',
          album: metadata.common.album ?? '',
          durationSec: Math.round(metadata.format.duration ?? 0),
        });
      } catch (error) {
        this.logger.warn('music', `Skipping unreadable file ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.repo.upsertTracks(records);
    this.logger.info('music', `Indexed ${records.length} tracks from ${directory}`);
    return this.tracks();
  }

  tracks(): MusicTrack[] {
    return this.repo.tracks().map((track) => ({
      id: track.id,
      path: track.path,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSec: track.durationSec,
    }));
  }

  playlists(): Playlist[] {
    return this.repo.playlists().map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      createdAt: playlist.createdAt,
      trackIds: this.repo.playlistTrackIds(playlist.id),
    }));
  }

  createPlaylist(name: string): Playlist {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.repo.createPlaylist(id, name.trim() || 'Playlist', createdAt);
    return { id, name: name.trim() || 'Playlist', createdAt, trackIds: [] };
  }

  deletePlaylist(id: string): void {
    this.repo.deletePlaylist(id);
  }

  setPlaylistTracks(id: string, trackIds: string[]): Playlist {
    const playlist = this.playlists().find((entry) => entry.id === id);
    if (!playlist) throw notFound('Playlist not found.');
    const valid = trackIds.filter((trackId) => this.repo.findTrack(trackId) !== null);
    this.repo.setPlaylistTracks(id, valid);
    return { ...playlist, trackIds: valid };
  }

  /** Resolves a track path, refusing files outside the indexed library. */
  resolveTrackPath(trackId: string, allowedRoot: string): string {
    const track = this.repo.findTrack(trackId);
    if (!track) throw notFound('Track not found.');
    if (allowedRoot && !isInside(allowedRoot, track.path)) {
      throw notFound('Track is outside the configured music folder.');
    }
    return track.path;
  }
}
