import type { CrashDiagnosis, CrashHint, CrashHintId, LoaderType } from '@klymon/shared-types';

export interface CrashTextInput {
  text: string;
  source: 'crash-report' | 'latest-log';
  exitCode: number | null;
  mcVersion: string;
  loaderType: LoaderType;
  memoryMb: number;
  reportPath: string | null;
  logPath: string | null;
}

/** Patterns are matched against the whole crash text; order is only for evidence priority. */
const HINT_PATTERNS: { id: CrashHintId; patterns: RegExp[] }[] = [
  {
    id: 'memory',
    patterns: [
      /OutOfMemoryError/i,
      /Java heap space/i,
      /GC overhead limit exceeded/i,
      /Could not reserve enough space/i,
      /insufficient memory/i,
      /Cannot allocate memory/i,
    ],
  },
  {
    id: 'args',
    patterns: [
      /Invalid maximum heap size/i,
      /Unrecognized VM option/i,
      /Unrecognized option:/i,
      /Could not create the Java Virtual Machine/i,
    ],
  },
  {
    id: 'java',
    patterns: [
      /UnsupportedClassVersionError/i,
      /class file version \d+/i,
      /requires Java \d+/i,
      /does not support class file version/i,
    ],
  },
  {
    id: 'mods',
    patterns: [
      /Mixin apply failed/i,
      /MixinTransformerError/i,
      /InvalidMixinException/i,
      /InvalidInjectionException/i,
      /ModResolutionException/i,
      /Missing or unsupported mandatory dependencies/i,
      /Duplicate mods/i,
      /Incompatible mod set/i,
      /is not a valid mod file/i,
    ],
  },
  {
    id: 'client-menu',
    patterns: [/provided by 'klymon-menu'/i, /com\.klymon\.clientmenu/i],
  },
  {
    id: 'graphics',
    patterns: [
      /Pixel format not accelerated/i,
      /Failed to create window/i,
      /GLFW error/i,
      /Couldn't set pixel format/i,
      /OpenGL is not supported/i,
      /WGL: Failed to make context current/i,
    ],
  },
  {
    id: 'repair',
    patterns: [
      /ClassNotFoundException/i,
      /NoClassDefFoundError/i,
      /ZipException/i,
      /invalid LOC header/i,
      /Invalid or corrupt jarfile/i,
      /error in opening zip file/i,
      /checksum mismatch/i,
    ],
  },
  {
    id: 'permissions',
    patterns: [
      /AccessDeniedException/i,
      /Permission denied/i,
      /FileSystemException/i,
      /being used by another process/i,
      /The process cannot access the file/i,
    ],
  },
];

const EXCEPTION_PATTERN = /(?:^|\n)([a-zA-Z_$][\w$]*(?:\.[\w$]+)+(?:Exception|Error))(?::\s*([^\n]+))?/;
const CAUSE_PATTERN = /Caused by:\s*([^\n]+)/;
const DESCRIPTION_PATTERN = /^Description:\s*([^\n]+)$/m;
// Latest.log lines look like `[10:00:00] [Render thread/ERROR]: message`.
const LOG_ERROR_PATTERN = /\[[^\]]*\/?(?:FATAL|ERROR)\]\s*([^\n]+)/;

function firstLineMatching(text: string, patterns: RegExp[]): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (patterns.some((pattern) => pattern.test(trimmed))) return trimmed.slice(0, 300);
  }
  return null;
}

/** Keeps the log lines a human would actually look at, in order and bounded. */
function buildExcerpt(text: string): string {
  const relevant = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) =>
      /Exception|Error|Caused by|^\s+at |\.\.\. \d+ more|Description:|Minecraft Crash Report|\[FATAL\]|\[ERROR\]|Mod List|-- System Details|Java Version|Operating System|Launched Version/.test(
        line,
      ),
    );
  const excerpt = relevant.length > 0 ? relevant : text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-25);
  return excerpt.slice(-40).join('\n').slice(-6000);
}

/**
 * Extracts a human-usable diagnosis from a Mojang crash report or the tail of
 * latest.log. Pure so it can be unit-tested without touching the filesystem.
 */
export function analyzeCrash(input: CrashTextInput): Omit<CrashDiagnosis, 'instanceId' | 'instanceName' | 'occurredAt'> {
  const text = input.text.slice(-400_000);
  const description = DESCRIPTION_PATTERN.exec(text)?.[1]?.trim() ?? null;

  const exceptionMatch = EXCEPTION_PATTERN.exec(text);
  const exception = exceptionMatch
    ? `${exceptionMatch[1]}${exceptionMatch[2] ? `: ${exceptionMatch[2].trim().slice(0, 200)}` : ''}`
    : null;

  const cause = CAUSE_PATTERN.exec(text)?.[1]?.trim().slice(0, 300) ?? null;

  const hints: CrashHint[] = [];
  for (const rule of HINT_PATTERNS) {
    const evidence = firstLineMatching(text, rule.patterns);
    if (evidence) hints.push({ id: rule.id, evidence });
  }
  if (hints.length === 0) {
    const evidence =
      cause ??
      exception ??
      firstLineMatching(text, [/\[(?:FATAL|ERROR)\]/]) ??
      `Minecraft exited with code ${input.exitCode ?? 'unknown'}`;
    hints.push({ id: 'unknown', evidence: evidence.slice(0, 300) });
  }

  let headline: string;
  if (description) {
    headline = description;
  } else if (input.source === 'latest-log') {
    headline = firstLineMatching(text, [LOG_ERROR_PATTERN]) ?? exception ?? `Minecraft exited with code ${input.exitCode ?? 'unknown'}`;
  } else {
    headline = exception ?? cause ?? `Minecraft exited with code ${input.exitCode ?? 'unknown'}`;
  }

  return {
    exitCode: input.exitCode,
    found: true,
    source: input.source,
    headline: headline.slice(0, 300),
    exception,
    cause,
    reportPath: input.reportPath,
    logPath: input.logPath,
    excerpt: buildExcerpt(text),
    hints,
    mcVersion: input.mcVersion,
    loaderType: input.loaderType,
    memoryMb: input.memoryMb,
  };
}
