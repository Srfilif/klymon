import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

interface AuthedRequest {
  headers: Record<string, string | undefined>;
  user?: unknown;
}

/** Bearer guard that additionally requires `role === 'admin'` (checked live per request). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing access token.');
    }
    let payload: { sub?: unknown; sid?: unknown; type?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
    if (payload.type !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new UnauthorizedException('Invalid access token.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true } });
    if (!user) {
      throw new UnauthorizedException('Invalid access token.');
    }
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin access required.');
    }
    request.user = { id: payload.sub, sessionId: payload.sid };
    return true;
  }
}
