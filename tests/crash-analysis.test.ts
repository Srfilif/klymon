import { describe, expect, it } from 'vitest';
import { analyzeCrash } from '@klymon/version-manager';

const base = {
  exitCode: 1,
  mcVersion: '1.21.1',
  loaderType: 'fabric' as const,
  memoryMb: 4096,
  reportPath: 'C:/data/instances/test/crash-reports/crash-2026-11-15.txt',
  logPath: 'C:/data/instances/test/logs/latest.log',
};

const crashReport = `---- Minecraft Crash Report ----
// I let you down. Sorry :(

Time: 2026-11-15 10:00:00
Description: Rendering screen

java.lang.OutOfMemoryError: Java heap space
	at java.base/java.util.Arrays.copyOf(Arrays.java:3537)
	at net.minecraft.client.renderer.chunk.RenderChunk.rebuild(RenderChunk.java:120)

-- System Details --
Minecraft Version: 1.21.1
Java Version: 21.0.2, Microsoft
Java VM Version: OpenJDK 64-Bit Server VM
Memory: 4096 MB
`;

describe('crash analysis', () => {
  it('detects out-of-memory crashes and keeps the report headline', () => {
    const result = analyzeCrash({ ...base, text: crashReport, source: 'crash-report' });
    expect(result.headline).toBe('Rendering screen');
    expect(result.exception).toContain('OutOfMemoryError: Java heap space');
    expect(result.hints.map((hint) => hint.id)).toContain('memory');
    expect(result.hints[0]?.evidence).toContain('OutOfMemoryError');
    expect(result.reportPath).toBe(base.reportPath);
    expect(result.excerpt).toContain('Minecraft Crash Report');
  });

  it('detects mod conflicts and uses the ERROR line from latest.log', () => {
    const log = `[10:00:00] [main/ERROR]: Mixin apply for mod sodium failed
org.spongepowered.asm.mixin.transformer.throwables.InvalidMixinException: Unexpected method
Caused by: java.lang.NoSuchMethodError: net.minecraft.client.Minecraft.method()
`;
    const result = analyzeCrash({ ...base, text: log, source: 'latest-log', exitCode: -1 });
    expect(result.source).toBe('latest-log');
    expect(result.headline).toContain('Mixin apply');
    expect(result.hints.map((hint) => hint.id)).toEqual(['mods']);
    expect(result.cause).toContain('NoSuchMethodError');
  });

  it('detects an incompatible Java version', () => {
    const log = 'java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version';
    const result = analyzeCrash({ ...base, text: log, source: 'crash-report' });
    expect(result.hints.map((hint) => hint.id)).toContain('java');
    expect(result.exception).toContain('UnsupportedClassVersionError');
  });

  it('detects graphics initialisation failures', () => {
    const log = '[10:00:00] [Render thread/ERROR]: GLFW error 65542: WGL: The driver does not appear to support OpenGL';
    const result = analyzeCrash({ ...base, text: log, source: 'latest-log' });
    expect(result.hints.map((hint) => hint.id)).toContain('graphics');
  });

  it('detects invalid JVM arguments and access denied errors', () => {
    const args = analyzeCrash({ ...base, text: 'Error: Could not create the Java Virtual Machine.\nUnrecognized VM option \'UseG1GCX\'', source: 'latest-log' });
    expect(args.hints.map((hint) => hint.id)).toEqual(expect.arrayContaining(['args']));

    const permissions = analyzeCrash({
      ...base,
      text: 'java.nio.file.AccessDeniedException: C:\\data\\instances\\test\\options.txt',
      source: 'crash-report',
    });
    expect(permissions.hints.map((hint) => hint.id)).toContain('permissions');
  });

  it('recognizes a stale klymon-menu entrypoint crash', () => {
    const report = `---- Minecraft Crash Report ----
Description: Initializing game

java.lang.RuntimeException: Could not execute entrypoint stage 'client' due to errors, provided by 'klymon-menu' at 'com.klymon.clientmenu.KlymonMenuClient'!
Caused by: java.lang.NullPointerException: Cannot invoke "net.minecraft.class_315.method_42473()" because "<parameter1>.field_1690" is null
	at knot//com.klymon.clientmenu.KlymonHud.applyFullbright(KlymonHud.java:124)
`;
    const result = analyzeCrash({ ...base, text: report, source: 'crash-report' });
    expect(result.hints.map((hint) => hint.id)).toContain('client-menu');
    expect(result.hints.map((hint) => hint.id)).not.toContain('unknown');
  });

  it('falls back to an unknown hint with the exit code', () => {
    const result = analyzeCrash({ ...base, exitCode: 3, text: 'Something odd happened.\nNothing recognisable here.', source: 'latest-log' });
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]?.id).toBe('unknown');
    expect(result.hints[0]?.evidence).toMatch(/3/);
    expect(result.headline).toContain('code 3');
    expect(result.found).toBe(true);
  });

  it('bounds the excerpt so the UI never receives an unbounded log', () => {
    const noisy = `${crashReport}\n${'[10:00:00] [main/ERROR]: filler line\n'.repeat(500)}`;
    const result = analyzeCrash({ ...base, text: noisy, source: 'crash-report' });
    expect(result.excerpt.length).toBeLessThanOrEqual(6000);
    expect(result.excerpt.split('\n').length).toBeLessThanOrEqual(40);
  });
});
