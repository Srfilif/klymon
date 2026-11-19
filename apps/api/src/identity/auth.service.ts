import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinecraftService } from './minecraft.service';
import { UsersService, type PublicUser } from './users.service';
import type { LoginInput } from './dto/login.dto';
import type { RegisterInput } from './dto/register.dto';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const HANDOFF_CODE_TTL_MS = 60 * 1000;
export const HANDOFF_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

export interface RequestContext {
  userAgent?: string;
  ip?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
  sessionId: string;
  expiresAt: Date;
}

export interface PublicSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  clientSession: boolean;
  createdAt: Date;
  expiresAt: Date;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256Hex(token) };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly minecraft: MinecraftService,
  ) {}

  private accessTtlSeconds(): number {
    return Number(this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS'));
  }

  private refreshTtlMs(): number {
    return Number(this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS')) * 24 * 60 * 60 * 1000;
  }

  private signAccess(userId: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, type: 'access' },
      { expiresIn: this.accessTtlSeconds() },
    );
  }

  private fingerprint(ctx: RequestContext): string {
    return sha256Hex((ctx.userAgent ?? 'unknown').slice(0, 512));
  }

  private async ensureDevice(userId: string, ctx: RequestContext): Promise<string> {
    const fingerprint = this.fingerprint(ctx);
    const device = await this.prisma.device.upsert({
      where: { userId_fingerprint: { userId, fingerprint } },
      create: {
        userId,
        fingerprint,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        ip: ctx.ip?.slice(0, 64) ?? null,
      },
      update: {
        lastSeenAt: new Date(),
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        ip: ctx.ip?.slice(0, 64) ?? null,
        revokedAt: null,
      },
    });
    return device.id;
  }

  private async issueSession(userId: string, ctx: RequestContext, refreshTtlMs = this.refreshTtlMs(), clientSession = false): Promise<SessionTokens> {
    const { token, hash } = newRefreshToken();
    const expiresAt = new Date(Date.now() + refreshTtlMs);
    const deviceId = await this.ensureDevice(userId, ctx);
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        refreshHash: hash,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        ip: ctx.ip?.slice(0, 64) ?? null,
        clientSession,
        expiresAt,
      },
    });
    const user = (await this.users.findPublicById(userId)) as PublicUser;
    return { accessToken: await this.signAccess(userId, session.id), refreshToken: token, user, sessionId: session.id, expiresAt };
  }

  /** Limited client session shared by the handoff exchange and the device flow. */
  issueClientSession(userId: string, ctx: RequestContext): Promise<SessionTokens> {
    return this.issueSession(userId, ctx, HANDOFF_REFRESH_TTL_MS, true);
  }

  async register(input: RegisterInput, ctx: RequestContext): Promise<SessionTokens> {
    let user: PublicUser;
    try {
      user = await this.users.create(input);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(',') ?? '';
        const field = target.includes('email') ? 'Email' : target.includes('username') ? 'Username' : 'Account';
        throw new ConflictException(`${field} is already taken.`);
      }
      throw error;
    }
    return this.issueSession(user.id, ctx);
  }

  async login(input: LoginInput, ctx: RequestContext): Promise<SessionTokens> {
    const record = await this.users.findByIdentifier(input.identifier);
    // Same message either way: never reveal whether the identifier exists.
    if (!record || !(await this.users.verifyPassword(record.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    return this.issueSession(record.id, ctx);
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<SessionTokens> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({ where: { refreshHash: sha256Hex(refreshToken) } });
    if (!session || session.expiresAt <= now) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    if (session.revokedAt) {
      // Reuse of a rotated token signals theft: revoke the whole family.
      if (session.replacedBy) {
        await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: now } });
      }
      throw new UnauthorizedException('Invalid refresh token.');
    }
    const next = newRefreshToken();
    const nextId = randomUUID();
    // Client sessions keep their short TTL across rotation (limited by design).
    const ttlMs = session.clientSession ? HANDOFF_REFRESH_TTL_MS : this.refreshTtlMs();
    const expiresAt = new Date(Date.now() + ttlMs);
    const deviceId = session.deviceId ?? (await this.ensureDevice(session.userId, ctx));
    await this.prisma.$transaction([
      this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: now, replacedBy: nextId } }),
      this.prisma.session.create({
        data: {
          id: nextId,
          userId: session.userId,
          deviceId,
          refreshHash: next.hash,
          userAgent: ctx.userAgent?.slice(0, 512) ?? session.userAgent,
          ip: ctx.ip?.slice(0, 64) ?? session.ip,
          clientSession: session.clientSession,
          expiresAt,
        },
      }),
      this.prisma.device.updateMany({ where: { id: deviceId }, data: { lastSeenAt: now } }),
    ]);
    const user = (await this.users.findPublicById(session.userId)) as PublicUser;
    return {
      accessToken: await this.signAccess(session.userId, nextId),
      refreshToken: next.token,
      user,
      sessionId: nextId,
      expiresAt,
    };
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /**
   * Mints a short-lived single-use code so the launcher can hand its platform
   * session to the game client without exposing passwords or refresh tokens.
   */
  async createHandoff(userId: string, sessionId: string): Promise<{ code: string; expiresAt: Date }> {
    await this.prisma.handoffCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + HANDOFF_CODE_TTL_MS);
    await this.prisma.handoffCode.create({ data: { userId, sessionId, codeHash: sha256Hex(code), expiresAt } });
    return { code, expiresAt };
  }

  /**
   * Exchanges a handoff code for a LIMITED client session (24 h refresh TTL,
   * preserved on rotation). Uniform 401 for missing/used/expired codes and
   * lost claim races — codes are unguessable, but enumeration gets nothing.
   */
  async exchangeHandoff(code: string, ctx: RequestContext): Promise<SessionTokens> {
    const row = await this.prisma.handoffCode.findUnique({ where: { codeHash: sha256Hex(code) } });
    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired handoff code.');
    }
    const claimed = await this.prisma.handoffCode.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException('Invalid or expired handoff code.');
    }
    return this.issueClientSession(row.userId, ctx);
  }

  listSessions(userId: string): Promise<PublicSession[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, clientSession: true, createdAt: true, expiresAt: true },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const updated = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Session not found.');
    }
  }

  private devToken(token: string): { devToken?: string } {
    return this.config.get('DEV_EXPOSE_TOKENS') === 'true' ? { devToken: token } : {};
  }

  private static newSingleUseToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, hash: sha256Hex(token) };
  }

  async requestEmailVerification(userId: string): Promise<{ alreadyVerified: boolean; devToken?: string }> {
    const user = await this.users.findPublicById(userId);
    if (!user || user.emailVerified) return { alreadyVerified: true };
    const { token, hash } = AuthService.newSingleUseToken();
    await this.prisma.emailVerificationToken.deleteMany({ where: { userId, consumedAt: null } });
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: hash, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
    });
    const webUrl = this.config.getOrThrow<string>('PUBLIC_WEB_URL');
    await this.mailer.send({
      to: user.email,
      subject: 'Verify your Klymon email',
      text: `Verify your Klymon email (valid 24 hours): ${webUrl}/verify-email?token=${token}`,
    });
    return { alreadyVerified: false, ...this.devToken(token) };
  }

  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || row.consumedAt || row.expiresAt <= new Date()) {
      throw new BadRequestException('Invalid or expired verification token.');
    }
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return { verified: true };
  }

  async requestPasswordReset(email: string): Promise<{ requested: boolean; devToken?: string }> {
    // Always 200-shaped: never reveal whether the email exists.
    const record = await this.users.findByIdentifier(email);
    if (!record) return { requested: true };
    const { token, hash } = AuthService.newSingleUseToken();
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: record.id, consumedAt: null } });
    await this.prisma.passwordResetToken.create({
      data: { userId: record.id, tokenHash: hash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
    });
    const webUrl = this.config.getOrThrow<string>('PUBLIC_WEB_URL');
    await this.mailer.send({
      to: email,
      subject: 'Reset your Klymon password',
      text: `Reset your Klymon password (valid 1 hour): ${webUrl}/reset-password?token=${token}\nIf you did not ask for this, ignore this email.`,
    });
    return { requested: true, ...this.devToken(token) };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || row.consumedAt || row.expiresAt <= new Date()) {
      throw new BadRequestException('Invalid or expired reset token.');
    }
    await this.users.setPassword(row.userId, newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<void> {
    const record = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!record || !(await this.users.verifyPassword(record.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    await this.users.setPassword(userId, newPassword);
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, NOT: { id: sessionId } },
      data: { revokedAt: new Date() },
    });
  }

  listDevices(userId: string): Promise<PublicDevice[]> {
    return this.prisma.device
      .findMany({
        where: { userId },
        orderBy: { lastSeenAt: 'desc' },
        include: { _count: { select: { sessions: { where: { revokedAt: null } } } } },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          userAgent: row.userAgent,
          ip: row.ip,
          lastSeenAt: row.lastSeenAt,
          revoked: row.revokedAt !== null,
          activeSessions: row._count.sessions,
        })),
      );
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) {
      throw new NotFoundException('Device not found.');
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id: device.id }, data: { revokedAt: now } }),
      this.prisma.session.updateMany({ where: { deviceId: device.id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
  }

  async listMinecraftAccounts(userId: string): Promise<PublicMinecraftAccount[]> {
    const rows = await this.prisma.minecraftAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, uuid: true, username: true, verifiedAt: true, createdAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      uuid: row.uuid,
      username: row.username,
      verified: row.verifiedAt !== null,
      createdAt: row.createdAt,
    }));
  }

  async linkMinecraftAccount(
    userId: string,
    input: { uuid: string; username: string; minecraftAccessToken?: string },
  ): Promise<PublicMinecraftAccount> {
    const verified = Boolean(input.minecraftAccessToken);
    if (verified) {
      await this.minecraft.verifyOwnership(input.uuid, input.minecraftAccessToken as string);
    }
    try {
      const row = await this.prisma.minecraftAccount.create({
        data: {
          userId,
          uuid: input.uuid.toLowerCase(),
          username: input.username,
          verifiedAt: verified ? new Date() : null,
        },
        select: { id: true, uuid: true, username: true, verifiedAt: true, createdAt: true },
      });
      return { id: row.id, uuid: row.uuid, username: row.username, verified: row.verifiedAt !== null, createdAt: row.createdAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This Minecraft account is already linked.');
      }
      throw error;
    }
  }

  async unlinkMinecraftAccount(userId: string, id: string): Promise<void> {
    const deleted = await this.prisma.minecraftAccount.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new NotFoundException('Minecraft account not found.');
    }
  }
}

export interface PublicDevice {
  id: string;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: Date;
  revoked: boolean;
  activeSessions: number;
}

export interface PublicMinecraftAccount {
  id: string;
  uuid: string;
  username: string;
  verified: boolean;
  createdAt: Date;
}
