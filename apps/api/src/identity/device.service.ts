import { GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, type RequestContext, type SessionTokens } from './auth.service';

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_POLL_INTERVAL_S = 5;

/** Crockford-lite alphabet: no 0/O/1/I/L, unambiguous when read aloud. */
const USER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceTokenPending {
  status: 'pending';
  interval: number;
}

export interface DevicePreview {
  clientName: string | null;
  expiresAt: Date;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeUserCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private newUserCode(): { display: string; normalized: string } {
    let normalized = '';
    for (let i = 0; i < 8; i++) normalized += USER_ALPHABET[randomInt(USER_ALPHABET.length)];
    return { display: formatUserCode(normalized), normalized };
  }

  async startDeviceFlow(clientName?: string): Promise<DeviceCodeResponse> {
    await this.prisma.deviceCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    for (let attempt = 0; attempt < 5; attempt++) {
      const deviceCode = randomBytes(24).toString('base64url');
      const userCode = this.newUserCode();
      try {
        const row = await this.prisma.deviceCode.create({
          data: {
            deviceCodeHash: sha256Hex(deviceCode),
            userCodeHash: sha256Hex(userCode.normalized),
            clientName: clientName?.slice(0, 80) ?? null,
            expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_MS),
          },
        });
        const webUrl = this.config.getOrThrow<string>('PUBLIC_WEB_URL');
        return {
          deviceCode,
          userCode: userCode.display,
          verificationUri: `${webUrl}/devices`,
          expiresIn: Math.floor((row.expiresAt.getTime() - Date.now()) / 1000),
          interval: DEVICE_POLL_INTERVAL_S,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && attempt < 4) continue;
        throw error;
      }
    }
    throw new ServiceUnavailableException('Could not mint a device code. Retry.');
  }

  async pollDeviceToken(deviceCode: string, ctx: RequestContext): Promise<SessionTokens | DeviceTokenPending> {
    const now = new Date();
    const row = await this.prisma.deviceCode.findUnique({ where: { deviceCodeHash: sha256Hex(deviceCode) } });
    if (!row || row.expiresAt <= now || row.status === 'denied' || row.status === 'consumed') {
      throw new GoneException('Device authorization expired or denied.');
    }
    if (row.status !== 'approved') {
      if (row.lastPollAt && now.getTime() - row.lastPollAt.getTime() < DEVICE_POLL_INTERVAL_S * 1000) {
        throw new ThrottlerException('Slow down.');
      }
      await this.prisma.deviceCode.update({ where: { id: row.id }, data: { lastPollAt: now } });
      return { status: 'pending', interval: DEVICE_POLL_INTERVAL_S };
    }
    const claimed = await this.prisma.deviceCode.updateMany({
      where: { id: row.id, status: 'approved' },
      data: { status: 'consumed', decidedAt: now },
    });
    if (claimed.count === 0 || !row.userId) {
      throw new GoneException('Device authorization expired or denied.');
    }
    return this.auth.issueClientSession(row.userId, ctx);
  }

  private async requireDecidable(userCode: string): Promise<{ id: string; clientName: string | null; expiresAt: Date }> {
    const row = await this.prisma.deviceCode.findUnique({ where: { userCodeHash: sha256Hex(normalizeUserCode(userCode)) } });
    if (!row || row.expiresAt <= new Date()) {
      throw new NotFoundException('Unknown or expired code.');
    }
    if (row.status !== 'pending') {
      throw new GoneException('This code is no longer pending.');
    }
    return { id: row.id, clientName: row.clientName ?? null, expiresAt: row.expiresAt };
  }

  async previewDeviceCode(userCode: string): Promise<DevicePreview> {
    const row = await this.requireDecidable(userCode);
    return { clientName: row.clientName, expiresAt: row.expiresAt };
  }

  async approveDeviceCode(userId: string, userCode: string): Promise<{ approved: boolean }> {
    const row = await this.requireDecidable(userCode);
    const updated = await this.prisma.deviceCode.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'approved', userId, decidedAt: new Date() },
    });
    if (updated.count === 0) throw new GoneException('This code is no longer pending.');
    return { approved: true };
  }

  async denyDeviceCode(userCode: string): Promise<{ denied: boolean }> {
    const row = await this.requireDecidable(userCode);
    const updated = await this.prisma.deviceCode.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'denied', decidedAt: new Date() },
    });
    if (updated.count === 0) throw new GoneException('This code is no longer pending.');
    return { denied: true };
  }
}
