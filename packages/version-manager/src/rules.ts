import type { VersionLibrary, VersionRule } from './types';

export interface RuleContext {
  features: Record<string, boolean>;
  osName: string;
  osVersion?: string;
  osArch: string;
}

export function defaultRuleContext(features: Record<string, boolean> = {}): RuleContext {
  return {
    features,
    osName: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux',
    osVersion: undefined,
    osArch: process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64',
  };
}

export function osNativesKey(): string {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
}

function osMatches(rule: NonNullable<VersionRule['os']>, context: RuleContext): boolean {
  const name = context.osName ?? '';
  if (rule.name && rule.name !== name) return false;
  if (rule.arch && rule.arch !== context.osArch) return false;
  if (rule.version) {
    try {
      return new RegExp(rule.version).test(context.osVersion ?? '');
    } catch {
      return true;
    }
  }
  return true;
}

function featuresMatch(required: VersionRule['features'], context: RuleContext): boolean {
  if (!required) return true;
  return Object.entries(required).every(([key, expected]) => (context.features[key] ?? false) === expected);
}

export function isAllowed(rules: VersionRule[] | undefined, context: RuleContext): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    const applies = (!rule.os || osMatches(rule.os, context)) && featuresMatch(rule.features, context);
    if (!applies) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

export function nativeClassifierKey(library: VersionLibrary): string | null {
  const template = library.natives?.[osNativesKey()];
  if (!template) return null;
  return template.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
}

export function requiredJavaMajor(mcVersion: string, declared?: number | null): number {
  if (declared && declared > 0) return declared;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(mcVersion);
  if (!match) return 8;
  const major = Number.parseInt(match[1] ?? '1', 10);
  const minor = Number.parseInt(match[2] ?? '0', 10);
  const patch = Number.parseInt(match[3] ?? '0', 10);
  if (major > 1) return 21;
  if (minor >= 21) return 21;
  if (minor === 20 && patch >= 5) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

export function mavenPath(coordinate: string, classifierFromKey?: string | null): string {
  const [group, artifact, version, classifier] = coordinate.split(':');
  if (!group || !artifact || !version) return coordinate.replace(/:/g, '/');
  const effectiveClassifier = classifier ?? classifierFromKey;
  const fileName = `${artifact}-${version}${effectiveClassifier ? `-${effectiveClassifier}` : ''}.jar`;
  return [group.replace(/\./g, '/'), artifact, version, fileName].join('/');
}
