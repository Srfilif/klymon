import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LauncherError, pathExists, sha1File, type LauncherLogger } from '@klymon/core';
import type { InstanceManager } from '@klymon/instance-manager';
import { ModrinthClient, type ContentManager } from '@klymon/mod-manager';
import type { ClientStatus, Instance as InstanceModel } from '@klymon/shared-types';
import {
  DEFAULT_CLIENT_VERSION,
  KLYMON_CLIENTS,
  clientModSourceFile,
  isClientVersion,
  type KlymonClientProfile,
} from '@klymon/shared-types';
import type { SettingsService } from './settings';
import type { GameService } from './game';
import type { ProgressionService } from './progression';
import { installBranding } from './branding';

/** Default profile (1.21.1); versioned profiles live in `KLYMON_CLIENTS`. */
export const KLYMON_CLIENT: KlymonClientProfile = KLYMON_CLIENTS[DEFAULT_CLIENT_VERSION];

/** File name of the menu mod inside the instance `mods/` dir (content varies per version). */
export const INSTALLED_MOD_FILE = 'klymon-menu.jar';

export interface ClientServiceDeps {
  settings: SettingsService;
  instances: InstanceManager;
  content: ContentManager;
  game: GameService;
  modrinth: Pick<ModrinthClient, 'project'>;
  logger: LauncherLogger;
  /** Directory holding the per-version menu mods (`klymon-menu-<mc>.jar`), or null when unpackaged. */
  clientModDir: string | null;
  progression: ProgressionService | null;
  emit: (status: ClientStatus) => void;
}

export class ClientService {
  private state: ClientStatus;
  private run: Promise<ClientStatus> | null = null;

  constructor(private readonly deps: ClientServiceDeps) {
    this.state = this.compute();
  }

  private get modrinth(): Pick<ModrinthClient, 'project'> {
    return this.deps.modrinth;
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
    const profile = instance && isClientVersion(instance.mcVersion) ? KLYMON_CLIENTS[instance.mcVersion] : null;
    const modsInstalled = instance
      ? this.deps.content.installed(instance.id, 'mod').length
      : 0;
    const clientMenu = this.clientMenuInstalled(instance);
    const installed = Boolean(profile && instance?.installed) && modsInstalled >= (profile?.mods.length ?? 0) && clientMenu;
    return {
      name: profile?.name ?? KLYMON_CLIENT.name,
      mcVersion: instance?.mcVersion ?? KLYMON_CLIENT.mcVersion,
      loaderType: profile?.loaderType ?? KLYMON_CLIENT.loaderType,
      instanceId: instance?.id ?? null,
      installed,
      phase: this.state?.phase === 'error' ? 'error' : this.state?.phase === 'installing' ? 'installing' : installed ? 'ready' : 'idle',
      message: this.state?.message ?? '',
      progress: this.state?.progress ?? 0,
      modsExpected: profile?.mods.length ?? 0,
      modsInstalled,
      clientMenu,
      error: this.state?.phase === 'error' ? (this.state.error ?? null) : null,
    };
  }

  /** True when the packaged menu mod exists in the instance (or was not shipped). */
  private clientMenuInstalled(instance: InstanceModel | null): boolean {
    if (!instance) return false;
    if (!this.deps.clientModDir || !existsSync(join(this.deps.clientModDir, clientModSourceFile(instance.mcVersion)))) return true;
    return existsSync(join(instance.gameDir, 'mods', INSTALLED_MOD_FILE));
  }

  /** Copies the version-matched Fabric menu mod into the instance, when it changed. */
  private async installClientMod(instance: InstanceModel): Promise<void> {
    if (!this.deps.clientModDir) return;
    const source = join(this.deps.clientModDir, clientModSourceFile(instance.mcVersion));
    if (!(await pathExists(source))) {
      this.deps.logger.warn('client', `No menu mod shipped for Minecraft ${instance.mcVersion}; skipping.`);
      return;
    }
    const folder = join(instance.gameDir, 'mods');
    await mkdir(folder, { recursive: true });
    const destination = join(folder, INSTALLED_MOD_FILE);
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
  private async pruneRetiredMods(instance: InstanceModel, profile: KlymonClientProfile): Promise<void> {
    const installed = this.deps.content.installed(instance.id, 'mod');
    if (installed.length === 0) return;
    for (const slug of profile.retiredSlugs) {
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
  async install(mcVersion: string = DEFAULT_CLIENT_VERSION): Promise<ClientStatus> {
    if (!isClientVersion(mcVersion)) {
      throw new LauncherError('INVALID_INPUT', `Unsupported Klymon Client version "${mcVersion}".`);
    }
    if (this.run) return this.run;
    this.run = this.doInstall(KLYMON_CLIENTS[mcVersion]).finally(() => {
      this.run = null;
    });
    return this.run;
  }

  private async doInstall(profile: KlymonClientProfile): Promise<ClientStatus> {
    this.update({ phase: 'installing', progress: 0.01, message: 'Preparando Klymon Client', error: null });

    try {
      let instance = this.findInstance();
      if (!instance) {
        instance = await this.deps.instances.create({
          name: profile.name,
          description: profile.description,
          mcVersion: profile.mcVersion,
          loaderType: profile.loaderType,
          loaderVersion: null,
          minMemoryMb: profile.minMemoryMb,
          maxMemoryMb: profile.maxMemoryMb,
          jvmArgs: [...profile.jvmArgs],
        });
        await this.deps.settings.update({ clientInstanceId: instance.id });
        this.deps.logger.info('client', `Created ${profile.name} instance ${instance.id}`);
      } else if (instance.loaderType !== profile.loaderType || instance.mcVersion !== profile.mcVersion) {
        instance = await this.deps.instances.update(instance.id, {
          mcVersion: profile.mcVersion,
          loaderType: profile.loaderType,
          loaderVersion: null,
        });
        // Version switch: old-version jars would crash the new loader, so wipe
        // every installed mod (worlds and config stay) before the fresh install.
        this.update({ progress: 0.03, message: `Cambiando a Minecraft ${profile.mcVersion}: limpiando mods` });
        for (const entry of this.deps.content.installed(instance.id, 'mod')) {
          await this.deps.content.remove(entry.id);
        }
        this.deps.logger.info('client', `Switched client instance to Minecraft ${profile.mcVersion}`);
      }

      this.update({ progress: 0.03, message: 'Limpiando mods obsoletos del perfil' });
      await this.pruneRetiredMods(instance, profile);

      if (!instance.installed) {
        this.update({ progress: 0.05, message: `Instalando Minecraft ${profile.mcVersion} + Fabric` });
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

      const total = profile.mods.length;
      for (const [index, mod] of profile.mods.entries()) {
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
