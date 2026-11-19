import { describe, expect, it } from 'vitest';
import { createStubState, routeStubRequest } from './e2e-link-stub';

describe('live link stub contract', () => {
  it('issues device codes shaped like the real API', () => {
    const state = createStubState();
    const started = routeStubRequest('POST', '/v1/auth/device/code', '{}', state, 'http://127.0.0.1:9');
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      deviceCode: 'e2e-device-code',
      userCode: 'ABCD-2345',
      verificationUri: 'http://127.0.0.1:9/devices',
      expiresIn: 600,
      interval: 1,
    });
  });

  it('holds token polls as pending twice, then links', () => {
    const state = createStubState();
    expect(routeStubRequest('POST', '/v1/auth/device/token', '{}', state, '').status).toBe(202);
    expect(routeStubRequest('POST', '/v1/auth/device/token', '{}', state, '').body).toEqual({ status: 'pending', interval: 1 });
    const linked = routeStubRequest('POST', '/v1/auth/device/token', '{}', state, '');
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ user: { username: 'E2EUser' } });
    expect(state.calls).toHaveLength(3);
  });

  it('exchanges only the expected handoff code', () => {
    const state = createStubState();
    expect(routeStubRequest('POST', '/v1/auth/handoff/exchange', JSON.stringify({ code: 'nope' }), state, '').status).toBe(401);
    expect(routeStubRequest('POST', '/v1/auth/handoff/exchange', 'not-json', state, '').status).toBe(401);
    const ok = routeStubRequest('POST', '/v1/auth/handoff/exchange', JSON.stringify({ code: 'e2e-handoff-1' }), state, '');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ user: { username: 'E2EUser' } });
  });

  it('404s unknown routes', () => {
    const state = createStubState();
    expect(routeStubRequest('GET', '/v1/auth/me', '', state, '').status).toBe(404);
  });
});
