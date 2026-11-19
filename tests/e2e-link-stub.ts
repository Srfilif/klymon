/**
 * Scripted platform API for the live link suite. Pure request router so the
 * contract is unit-tested without sockets (see tests/e2e-link-stub.test.ts);
 * tests/e2e-link.test.ts serves it over loopback, which CI allows.
 */
export interface StubState {
  tokenPolls: number;
  calls: string[];
}

export interface StubRoute {
  status: number;
  body: unknown;
}

export function createStubState(): StubState {
  return { tokenPolls: 0, calls: [] };
}

function tokens(): Record<string, unknown> {
  return {
    accessToken: 'e2e-access',
    refreshToken: 'e2e-refresh',
    user: { id: 'u-e2e', username: 'E2EUser', email: 'e2e@klymon.example', emailVerified: true, createdAt: '' },
    sessionId: 's-e2e',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

export function routeStubRequest(method: string, url: string, body: string, state: StubState, baseUrl: string): StubRoute {
  const path = url.split('?')[0] ?? url;
  const answer = (status: number, payload: unknown): StubRoute => {
    state.calls.push(`${method} ${path} -> ${status}`);
    return { status, body: payload };
  };
  if (method === 'POST' && path === '/v1/auth/device/code') {
    return answer(201, {
      deviceCode: 'e2e-device-code',
      userCode: 'ABCD-2345',
      verificationUri: `${baseUrl}/devices`,
      expiresIn: 600,
      interval: 1,
    });
  }
  if (method === 'POST' && path === '/v1/auth/device/token') {
    state.tokenPolls += 1;
    if (state.tokenPolls <= 2) return answer(202, { status: 'pending', interval: 1 });
    return answer(200, tokens());
  }
  if (method === 'POST' && path === '/v1/auth/handoff/exchange') {
    let code: unknown;
    try {
      code = (JSON.parse(body || '{}') as { code?: unknown }).code;
    } catch {
      code = null;
    }
    if (code !== 'e2e-handoff-1') {
      return answer(401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired handoff code.' });
    }
    return answer(201, tokens());
  }
  return answer(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Stub has no such route.' });
}
