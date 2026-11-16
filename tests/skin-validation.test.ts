import { describe, expect, it } from 'vitest';
import { normalizeVariant, parseSkinProfile, validateSkinPng } from '@klymon/skin-manager';

/** Builds the minimum PNG structure the validator inspects. */
function pngHeader(width: number, height: number, bitDepth = 8, colorType = 6): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(bitDepth, 8);
  ihdr.writeUInt8(colorType, 9);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  return Buffer.concat([signature, length, Buffer.from('IHDR'), ihdr, Buffer.alloc(4)]);
}

describe('Minecraft skin validation', () => {
  it('accepts modern 64x64 RGBA skins', () => {
    const result = validateSkinPng(pngHeader(64, 64));
    expect(result).toMatchObject({ valid: true, width: 64, height: 64, variant: 'classic' });
  });

  it('accepts legacy 64x32 skins', () => {
    expect(validateSkinPng(pngHeader(64, 32)).valid).toBe(true);
  });

  it('rejects non-PNG data', () => {
    const result = validateSkinPng(Buffer.from('not an image at all, definitely not a png'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/PNG/);
  });

  it('rejects wrong dimensions', () => {
    const result = validateSkinPng(pngHeader(32, 32));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/64x64/);
  });

  it('rejects unsupported bit depths and colour types', () => {
    expect(validateSkinPng(pngHeader(64, 64, 16)).valid).toBe(false);
    expect(validateSkinPng(pngHeader(64, 64, 8, 0)).valid).toBe(false);
  });

  it('rejects PNGs without an IHDR chunk', () => {
    const truncated = pngHeader(64, 64).subarray(0, 20);
    expect(validateSkinPng(truncated).valid).toBe(false);
  });
});

/** Builds a session-server profile payload with an encoded textures property. */
function profilePayload(textures: unknown): Record<string, unknown> {
  return {
    id: '069a79f444e94726a5befca90e38aaf5',
    name: 'Notch',
    properties: [{ name: 'textures', value: Buffer.from(JSON.stringify({ textures })).toString('base64') }],
  };
}

describe('player skin lookup payloads', () => {
  it('reads the skin URL, cape and slim model from the textures blob', () => {
    const parsed = parseSkinProfile(
      profilePayload({
        SKIN: { url: 'http://textures.minecraft.net/texture/abc', metadata: { model: 'slim' } },
        CAPE: { url: 'http://textures.minecraft.net/texture/cape' },
      }),
    );
    expect(parsed).toEqual({
      name: 'Notch',
      uuid: '069a79f444e94726a5befca90e38aaf5',
      skinUrl: 'http://textures.minecraft.net/texture/abc',
      capeUrl: 'http://textures.minecraft.net/texture/cape',
      variant: 'slim',
    });
  });

  it('defaults to classic when the skin has no model metadata', () => {
    const parsed = parseSkinProfile(profilePayload({ SKIN: { url: 'http://textures.minecraft.net/texture/abc' } }));
    expect(parsed.variant).toBe('classic');
    expect(parsed.capeUrl).toBeNull();
  });

  it('returns no skin for a profile without textures', () => {
    expect(parseSkinProfile({ name: 'Steve' }).skinUrl).toBeNull();
    expect(parseSkinProfile({ properties: [{ name: 'textures', value: 'not-base64-json' }] }).skinUrl).toBeNull();
  });

  it('normalises unknown arm models to classic', () => {
    expect(normalizeVariant('slim')).toBe('slim');
    expect(normalizeVariant('classic')).toBe('classic');
    expect(normalizeVariant(null)).toBe('classic');
    expect(normalizeVariant('wide')).toBe('classic');
  });
});
