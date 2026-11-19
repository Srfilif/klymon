import { ConflictException, GoneException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter', () => {
  function run(exception: unknown): { statusCode: number; body: Record<string, unknown> } {
    const seen: { code: number; body: unknown } = { code: 0, body: null };
    const res = { status: (code: number) => ({ json: (body: unknown) => { seen.code = code; seen.body = body; } }) };
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/v1/sync/profiles' }) }),
    };
    new AllExceptionsFilter().catch(exception, host as never);
    return { statusCode: seen.code, body: seen.body as Record<string, unknown> };
  }

  it('keeps the plain envelope without details', () => {
    const { statusCode, body } = run(new NotFoundException('Sync profile not found.'));
    expect(statusCode).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Sync profile not found.', path: '/v1/sync/profiles' });
    expect(body).not.toHaveProperty('details');
    expect(typeof body.timestamp).toBe('string');
  });

  it('maps gone to GONE', () => {
    const { statusCode, body } = run(new GoneException('Device authorization expired or denied.'));
    expect(statusCode).toBe(410);
    expect(body).toMatchObject({ code: 'GONE' });
  });

  it('passes an explicit details payload through', () => {
    const server = { version: 3, content: { cape: 'ember' } };
    const { statusCode, body } = run(new ConflictException({ message: 'Version mismatch.', details: { server } }));
    expect(statusCode).toBe(409);
    expect(body).toMatchObject({ code: 'CONFLICT', message: 'Version mismatch.', details: { server } });
  });

  it('sanitizes unknown failures to a 500 without details', () => {
    const { statusCode, body } = run(new InternalServerErrorException({ message: 'boom', details: { secret: 1 } }));
    expect(statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL');
    // Explicit details pass through even here by design (callers opt in);
    // unknown non-HTTP throws never carry any.
    expect(body).toHaveProperty('details');
    const thrown = run(new Error('raw'));
    expect(thrown.statusCode).toBe(500);
    expect(thrown.body).not.toHaveProperty('details');
  });
});
