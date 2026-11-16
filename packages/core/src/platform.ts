import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseJavaMajor(versionOutput: string): number | null {
  const match = /(?:java|openjdk) version "([^"]+)"/i.exec(versionOutput) ?? /version "([^"]+)"/i.exec(versionOutput);
  if (!match?.[1]) return null;
  const raw = match[1];
  const legacy = /^1\.(\d+)/.exec(raw);
  if (legacy?.[1]) return Number.parseInt(legacy[1], 10);
  const modern = /^(\d+)/.exec(raw);
  if (modern?.[1]) return Number.parseInt(modern[1], 10);
  return null;
}

export function parseJavaVendor(versionOutput: string): string {
  const text = versionOutput.toLowerCase();
  if (text.includes('temurin') || text.includes('adoptium') || text.includes('eclipse')) return 'Eclipse Temurin';
  if (text.includes('microsoft')) return 'Microsoft OpenJDK';
  if (text.includes('zulu') || text.includes('azul')) return 'Azul Zulu';
  if (text.includes('corretto') || text.includes('amazon')) return 'Amazon Corretto';
  if (text.includes('graal')) return 'GraalVM';
  if (text.includes('semeru') || text.includes('ibm')) return 'IBM Semeru';
  if (text.includes('openjdk')) return 'OpenJDK';
  if (text.includes('java(tm)') || text.includes('oracle')) return 'Oracle JDK';
  return 'Unknown';
}

export function parseJavaVersionString(versionOutput: string): string | null {
  const match = /version "([^"]+)"/i.exec(versionOutput);
  return match?.[1] ?? null;
}

export interface InspectedJava {
  path: string;
  version: string;
  major: number;
  vendor: string;
  arch: string;
  source: string;
}

export async function inspectJava(executable: string, source = 'system'): Promise<InspectedJava | null> {
  if (!existsSync(executable)) return null;
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['-version'], { timeout: 10_000, windowsHide: true });
    const output = `${stderr}${stdout}`;
    const major = parseJavaMajor(output);
    const version = parseJavaVersionString(output);
    if (major === null || version === null) return null;
    const arch = /64-bit/i.test(output) ? 'x64' : process.arch;
    return { path: executable, version, major, vendor: parseJavaVendor(output), arch, source };
  } catch {
    return null;
  }
}

export function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

export function javaSearchRoots(): string[] {
  const roots: string[] = [];
  if (process.env.JAVA_HOME) roots.push(process.env.JAVA_HOME);
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    roots.push(
      join(programFiles, 'Java'),
      join(programFiles, 'Eclipse Adoptium'),
      join(programFiles, 'Eclipse Foundation'),
      join(programFiles, 'Microsoft'),
      join(programFiles, 'Zulu'),
      join(programFiles, 'Amazon Corretto'),
      join(programFiles, 'BellSoft'),
      join(programFilesX86, 'Java'),
      join(localAppData, 'Programs', 'Eclipse Adoptium'),
    );
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines', join(homedir(), 'Library/Java/JavaVirtualMachines'), '/opt/homebrew/opt');
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt/java', '/opt', join(homedir(), '.sdkman/candidates/java'));
  }
  return roots;
}

export function scanJavaRoots(maxDepth = 3): string[] {
  const found: string[] = [];
  const exe = javaExecutableName();
  const visit = (dir: string, depth: number): void => {
    if (depth > maxDepth || !existsSync(dir)) return;
    const direct = join(dir, 'bin', exe);
    if (existsSync(direct)) {
      found.push(direct);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(dir, entry.name), depth + 1);
    }
  };
  for (const root of javaSearchRoots()) visit(root, 0);
  return found;
}

export function platformLabel(): string {
  switch (process.platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return process.platform;
  }
}
