import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { MinecraftService } from './minecraft.service';
import { IdentityController } from './identity.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from './users.service';

describe('IdentityController', () => {
  it('delegates to AuthService with validated input and request context', async () => {
    const auth = {
      register: jest.fn(async () => 'registered'),
      login: jest.fn(async () => 'logged-in'),
      refresh: jest.fn(async () => 'refreshed'),
      logout: jest.fn(async () => undefined),
      listSessions: jest.fn(async () => []),
      revokeSession: jest.fn(async () => undefined),
    };
    const users = { findPublicById: jest.fn(async () => ({ id: 'u1' })) };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      controllers: [IdentityController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: UsersService, useValue: users },
        { provide: MinecraftService, useValue: { syncAccount: jest.fn() } },
      ],
    }).compile();
    const controller = module.get(IdentityController);
    const req = { headers: { 'user-agent': 'test-agent' }, ip: '127.0.0.1' };

    await controller.register({ username: 's', email: 's@x.com', password: 'long-enough' }, req);
    expect(auth.register).toHaveBeenCalledWith(expect.objectContaining({ username: 's' }), {
      userAgent: 'test-agent',
      ip: '127.0.0.1',
    });
    await controller.login({ identifier: 's', password: 'p' }, req);
    expect(auth.login).toHaveBeenCalled();
    await controller.refresh({ refreshToken: 'rt' }, req);
    expect(auth.refresh).toHaveBeenCalledWith('rt', expect.anything());
    await controller.logout({ ...req, user: { id: 'u1', sessionId: 's1' } });
    expect(auth.logout).toHaveBeenCalledWith('u1', 's1');
    await controller.me({ ...req, user: { id: 'u1', sessionId: 's1' } });
    expect(users.findPublicById).toHaveBeenCalledWith('u1');
    await controller.sessions({ ...req, user: { id: 'u1', sessionId: 's1' } });
    expect(auth.listSessions).toHaveBeenCalledWith('u1');
    await controller.revokeSession({ ...req, user: { id: 'u1', sessionId: 's1' } }, 's9');
    expect(auth.revokeSession).toHaveBeenCalledWith('u1', 's9');
  });
});

describe('JwtAuthGuard', () => {
  function guardWith(verify: (token: string) => Promise<unknown>) {
    return new JwtAuthGuard({ verifyAsync: verify } as unknown as JwtService);
  }

  function contextWith(authHeader?: string) {
    const request: { headers: Record<string, string | undefined>; user?: unknown } = { headers: {} };
    if (authHeader !== undefined) request.headers.authorization = authHeader;
    return { switchToHttp: () => ({ getRequest: () => request }), request } as never;
  }

  it('accepts a valid access token and attaches the user', async () => {
    const guard = guardWith(async () => ({ sub: 'u1', sid: 's1', type: 'access' }));
    const ctx = contextWith('Bearer good-token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx as unknown as { request: { user: unknown } }).request.user).toEqual({ id: 'u1', sessionId: 's1' });
  });

  it('rejects missing, malformed, wrong-type and expired tokens', async () => {
    const guard = guardWith(async () => ({ sub: 'u1', sid: 's1', type: 'access' }));
    await expect(guard.canActivate(contextWith(undefined))).rejects.toMatchObject({ status: 401 });
    await expect(guard.canActivate(contextWith('Basic abc'))).rejects.toMatchObject({ status: 401 });
    const wrongType = guardWith(async () => ({ sub: 'u1', sid: 's1', type: 'refresh' }));
    await expect(wrongType.canActivate(contextWith('Bearer x'))).rejects.toMatchObject({ status: 401 });
    const expired = guardWith(async () => {
      throw new Error('jwt expired');
    });
    await expect(expired.canActivate(contextWith('Bearer old'))).rejects.toMatchObject({ status: 401 });
  });
});
