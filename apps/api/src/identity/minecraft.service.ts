import { BadGatewayException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MINECRAFT_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';
const VERIFY_TIMEOUT_MS = 10000;

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

interface MojangProfile {
  id: string;
  name: string;
  properties: Array<{ name: string; value: string }>;
}

/**
 * Proves Minecraft account ownership: the caller's access token must resolve
 * to the claimed UUID via the official session profile endpoint.
 */
@Injectable()
export class MinecraftService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchProfile(minecraftAccessToken: string): Promise<MojangProfile> {
    let response: Response;
    try {
      response = await fetch(MINECRAFT_PROFILE_URL, {
        headers: { Authorization: `Bearer ${minecraftAccessToken}` },
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Mojang services are unreachable; try again later.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ForbiddenException('Minecraft ownership could not be verified with that token.');
    }
    if (!response.ok) {
      throw new BadGatewayException('Mojang services are unreachable; try again later.');
    }
    const profile = (await response.json()) as { id?: unknown; name?: unknown; properties?: unknown };
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string') {
      throw new BadGatewayException('Mojang returned an unreadable profile; try again later.');
    }
    const properties = Array.isArray(profile.properties)
      ? profile.properties.filter(
          (entry): entry is { name: string; value: string } =>
            typeof entry === 'object' && entry !== null && typeof (entry as { name?: unknown }).name === 'string',
        )
      : [];
    return { id: profile.id, name: profile.name, properties };
  }

  async verifyOwnership(uuid: string, minecraftAccessToken: string): Promise<void> {
    const profile = await this.fetchProfile(minecraftAccessToken);
    if (normalizeUuid(profile.id) !== normalizeUuid(uuid)) {
      throw new ForbiddenException('That token belongs to a different Minecraft account.');
    }
  }

  /** Re-proves ownership and refreshes the stored Mojang username + textures. */
  async syncAccount(userId: string, accountId: string, minecraftAccessToken: string): Promise<void> {
    const account = await this.prisma.minecraftAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) {
      throw new NotFoundException('Minecraft account not found.');
    }
    const profile = await this.fetchProfile(minecraftAccessToken);
    if (normalizeUuid(profile.id) !== normalizeUuid(account.uuid)) {
      throw new ForbiddenException('That token belongs to a different Minecraft account.');
    }
    await this.prisma.minecraftAccount.update({
      where: { id: account.id },
      data: {
        username: profile.name.slice(0, 16),
        verifiedAt: new Date(),
        propertiesJson: JSON.stringify(profile.properties),
        lastSyncedAt: new Date(),
      },
    });
  }
}
