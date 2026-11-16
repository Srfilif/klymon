import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LauncherError, pathExists, sha1File, type LauncherLogger } from '@klymon/core';
import type { InstanceManager } from '@klymon/instance-manager';
import { ModrinthClient, type ContentManager } from '@klymon/mod-manager';
import type { ClientStatus, Instance as InstanceModel, LoaderType } from '@klymon/shared-types';
import type { SettingsService } from './settings';
import type { GameService } from './game';
import type { ProgressionService } from './progression';
import { installBranding } from './branding';

/** File name of the bundled Fabric menu mod inside `resources/client-mod`. */
export const CLIENT_MOD_FILE = 'klymon-menu.jar';

/**
 * The bundled client profile. Every entry is a real Modrinth project verified
 * for this Minecraft version + Fabric; dependencies (Fabric API, …) are pulled
 * in automatically by the content manager.
 */
export const KLYMON_CLIENT = {
  name: 'Klymon Client',
  description: 'Perfil de rendimiento y PvP de Klymon (Fabric, mods verificados en Modrinth).',
  mcVersion: '1.21.1',
  loaderType: 'fabric' as LoaderType,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  jvmArgs: ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200'],
  /**
   * Slugs that shipped in earlier profiles and must be pruned during install.
   * `cull-less-leaves` declares Sodium <0.6 and hard-fails the launch once the
   * bundle moved to the Sodium 0.8 line. `toggle-sprint` was superseded by the
   * built-in Toggle Sprint/Sneak addon (klymon-menu 1.2): keeping both would
   * fight over the same vanilla key states.
   */
  retiredSlugs: ['cull-less-leaves', 'toggle-sprint'],
  /**
   * Performance bundle (all verified for MC 1.21.1 + Fabric; required
   * dependencies such as Cloth Config are pulled automatically).
   *
   * Deliberately excluded: `modernfix` ships a Fabric 1.21.1 build, but its
   * scope fully overlaps FerriteCore/Krypton/BadOptimizations already in the
   * bundle, its dynamic-resources rewrite stays off by default upstream for
   * compatibility, and it has the highest mixin-conflict surface of the
   * candidates. It is still listed in the in-game Performance tab as an
   * optional install instead of being silently omitted.
   */
  mods: [
    { slug: 'sodium', title: 'Sodium' },
    { slug: 'lithium', title: 'Lithium' },
    { slug: 'ferrite-core', title: 'FerriteCore' },
    { slug: 'krypton', title: 'Krypton' },
    { slug: 'immediatelyfast', title: 'ImmediatelyFast' },
    { slug: 'entityculling', title: 'Entity Culling' },
    { slug: 'moreculling', title: 'More Culling' },
    { slug: 'dynamic-fps', title: 'Dynamic FPS' },
    { slug: 'badoptimizations', title: 'BadOptimizations' },
    { slug: 'threadtweak', title: 'ThreadTweak' },
    { slug: 'no-telemetry', title: 'No Telemetry' },
    { slug: 'iris', title: 'Iris Shaders' },
    { slug: 'sodium-extra', title: 'Sodium Extra' },
    { slug: 'zoomify', title: 'Zoomify' },
    { slug: 'modmenu', title: 'Mod Menu' },
    { slug: 'mouse-tweaks', title: 'Mouse Tweaks' },
  ],
} as const;

export interface ClientServiceDeps {
  settings: SettingsService;
  instances: InstanceManager;
  content: ContentManager;
  game: GameService;
  logger: LauncherLogger;
  /** Absolute path of the bundled menu mod, or null when it was not packaged. */
  clientModPath: string | null;
  progression: ProgressionService | null;
  emit: (status: ClientStatus) => void;
}

export class ClientService {
  private state: ClientStatus;
  private run: Promise<ClientStatus> | null = null;
  private readonly modrinth = new ModrinthClient();

  constructor(private readonly deps: ClientServiceDeps) {
    this.state = this.compute();
  }

  private findInstance(): InstanceModel | null {
    const storedId = this.deps.settings.get().clientInstanceId;
    if (storedId) {
      try {
        return this.deps.instances.get(storedId);
      } catch {
        // The instance was deleted: fall back to a name lookup below.
      }
    }
    return (
      this.deps.instances
        .list()
        .find((instance) => instance.name === KLYMON_CLIENT.name || instance.description === KLYMON_CLIENT.description) ?? null
    );
  }

  private compute(): ClientStatus {
    const instance = this.findInstance();
    const modsInstalled = instance
      ? this.deps.content.installed(instance.id, 'mod').length
      : 0;
    const clientMenu = this.clientMenuInstalled(instance);
    const installed = Boolean(instance?.installed) && modsInstalled >= KLYMON_CLIENT.mods.length && clientMenu;
    return {
      name: KLYMON_CLIENT.name,
      mcVersion: KLYMON_CLIENT.mcVersion,
      loaderType: KLYMON_CLIENT.loaderType,
      instanceId: instance?.id ?? null,
      installed,
      phase: this.state?.phase === 'error' ? 'error' : this.state?.phase === 'installing' ? 'installing' : installed ? 'ready' : 'idle',
      message: this.state?.message ?? '',
      progress: this.state?.progress ?? 0,
      modsExpected: KLYMON_CLIENT.mods.length,
      modsInstalled,
      clientMenu,
      error: this.state?.phase === 'error' ? (this.state.error ?? null) : null,
    };
  }

  /** True when the packaged menu mod exists in the instance (or was not shipped). */
  private clientMenuInstalled(instance: InstanceModel | null): boolean {
    if (!instance) return false;
    if (!this.deps.clientModPath || !existsSync(this.deps.clientModPath)) return true;
    return existsSync(join(instance.gameDir, 'mods', CLIENT_MOD_FILE));
  }

  /** Copies the bundled Fabric menu mod into the instance, when it changed. */
  private async installClientMod(instance: InstanceModel): Promise<void> {
    const source = this.deps.clientModPath;
    if (!source || !(await pathExists(source))) {
      return;
    }
    const folder = join(instance.gameDir, 'mods');
    await mkdir(folder, { recursive: true });
    const destination = join(folder, CLIENT_MOD_FILE);
    const sourceHash = await sha1File(source);
    const destinationHash = (await pathExists(destination)) ? await sha1File(destination) : null;
    if (sourceHash === destinationHash) return;
    await copyFile(source, destination);
    this.deps.logger.info('client', `Installed the Klymon menu mod at ${destination}`);
  }

  /**
   * Removes mods that belonged to older Klymon Client profiles. They stay on
   * disk across updates and can hard-fail the loader (a retired slug pinning an
   * older Sodium), which is exactly what "Repair & update" must clean up.
   */
  private async pruneRetiredMods(instance: InstanceModel): Promise<void> {
    const installed = this.deps.content.installed(instance.id, 'mod');
    if (installed.length === 0) return;
    for (const slug of KLYMON_CLIENT.retiredSlugs) {
      try {
        const project = await this.modrinth.project(slug);
        for (const entry of installed.filter((item) => item.projectId === project.id)) {
          await this.deps.content.remove(entry.id);
          this.deps.logger.info('client', `Removed retired mod ${slug} (${entry.fileName})`);
        }
      } catch (error) {
        this.deps.logger.warn(
          'client',
          `Could not prune retired mod ${slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  status(): ClientStatus {
    this.state = this.compute();
    return this.state;
  }

  private update(patch: Partial<ClientStatus>): void {
    this.state = { ...this.state, ...patch };
    this.deps.emit(this.state);
  }

  /** Creates the instance when needed and installs (or repairs) the client. */
  async install(): Promise<ClientStatus> {
    if (this.run) return this.run;
    this.run = this.doInstall().finally(() => {
      this.run = null;
    });
    return this.run;
  }

  private async doInstall(): Promise<ClientStatus> {
    this.update({ phase: 'installing', progress: 0.01, message: 'Preparando Klymon Client', error: null });

    try {
      let instance = this.findInstance();
      if (!instance) {
        instance = await this.deps.instances.create({
          name: KLYMON_CLIENT.name,
          description: KLYMON_CLIENT.description,
          mcVersion: KLYMON_CLIENT.mcVersion,
          loaderType: KLYMON_CLIENT.loaderType,
          loaderVersion: null,
          minMemoryMb: KLYMON_CLIENT.minMemoryMb,
          maxMemoryMb: KLYMON_CLIENT.maxMemoryMb,
          jvmArgs: [...KLYMON_CLIENT.jvmArgs],
        });
        await this.deps.settings.update({ clientInstanceId: instance.id });
        this.deps.logger.info('client', `Created ${KLYMON_CLIENT.name} instance ${instance.id}`);
      } else if (instance.loaderType !== KLYMON_CLIENT.loaderType || instance.mcVersion !== KLYMON_CLIENT.mcVersion) {
        instance = await this.deps.instances.update(instance.id, {
          mcVersion: KLYMON_CLIENT.mcVersion,
          loaderType: KLYMON_CLIENT.loaderType,
          loaderVersion: null,
        });
      }

      this.update({ progress: 0.03, message: 'Limpiando mods obsoletos del perfil' });
      await this.pruneRetiredMods(instance);

      if (!instance.installed) {
        this.update({ progress: 0.05, message: `Instalando Minecraft ${KLYMON_CLIENT.mcVersion} + Fabric` });
        await this.deps.game.installInstance(instance.id, {
          onProgress: (progress) => {
            const fraction = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 0;
            this.update({
              progress: 0.05 + fraction * 0.06,
              message: `${progress.message}${progress.total > 0 ? ` (${progress.completed}/${progress.total})` : ''}`,
            });
          },
        });
      }

      const total = KLYMON_CLIENT.mods.length;
      for (const [index, mod] of KLYMON_CLIENT.mods.entries()) {
        this.update({
          progress: 0.12 + (index / total) * 0.85,
          message: `Instalando ${mod.title} (${index + 1}/${total})`,
        });
        // Resolve the slug to Modrinth's stable project id first, otherwise the
        // dependency resolver stores a second row for the same jar.
        const project = await this.modrinth.project(mod.slug);
        await this.deps.content.install({
          instanceId: instance.id,
          source: 'modrinth',
          projectId: project.id,
          versionId: null,
          kind: 'mod',
        });
      }

      this.update({ progress: 0.97, message: 'Instalando el menú de Klymon Client' });
      await this.installClientMod(instance);

      this.update({ progress: 0.98, message: 'Aplicando pack de marca Klymon' });
      await installBranding(instance.gameDir, this.deps.logger, { force: true });
      await this.deps.progression?.exportBridge();

      this.update({ phase: 'ready', progress: 1, message: 'Klymon Client listo', error: null, instanceId: instance.id });
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update({ phase: 'error', message: '', error: message, progress: 0 });
      this.deps.logger.error('client', `Klymon Client install failed: ${message}`);
      throw error instanceof LauncherError
        ? error
        : new LauncherError('INSTALL_FAILED', `Klymon Client could not be installed: ${message}`, undefined, error);
    }
  }

  async launch(): Promise<{ pid: number }> {
    const instance = this.findInstance();
    if (!instance) {
      throw new LauncherError('INVALID_INPUT', 'Install Klymon Client before launching it.');
    }
    // Older installs may predate the menu mod: copy it without blocking the play
    // button, then re-check the full installation state below.
    await this.installClientMod(instance).catch((error: unknown) =>
      this.deps.logger.warn('client', `Could not install the Klymon menu mod: ${error instanceof Error ? error.message : String(error)}`),
    );
    if (!this.status().installed) {
      throw new LauncherError('INVALID_INPUT', 'Klymon Client is not fully installed. Run the installer again.');
    }
    // Older installs may predate the branding pack: enable it without blocking.
    await installBranding(instance.gameDir, this.deps.logger).catch((error: unknown) =>
      this.deps.logger.warn('client', `Could not apply branding pack: ${error instanceof Error ? error.message : String(error)}`),
    );
    // Refresh the identity/cosmetics bridge so the mod shows the latest state.
    await this.deps.progression?.exportBridge();
    return this.deps.game.launch(instance.id);
  }
}
