export interface VersionRule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}

export interface VersionLibrary {
  name: string;
  rules?: VersionRule[];
  downloads?: {
    artifact?: { path?: string; url?: string; size?: number; sha1?: string };
    classifiers?: Record<string, { path?: string; url?: string; size?: number; sha1?: string }>;
  };
  url?: string;
  size?: number;
  sha1?: string;
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
}

export type VersionArgumentEntry = string | { rules?: VersionRule[]; value: string | string[] };

export interface VersionJavaRequirement {
  component: string;
  majorVersion: number;
}

export interface VersionDetails {
  id: string;
  type?: string;
  mainClass?: string;
  assets?: string;
  assetIndex?: { id: string; url: string; sha1?: string; size?: number; totalSize?: number };
  downloads?: { client?: { url: string; size?: number; sha1?: string } };
  libraries: VersionLibrary[];
  arguments?: { game?: VersionArgumentEntry[]; jvm?: VersionArgumentEntry[] };
  minecraftArguments?: string;
  logging?: { client?: { argument: string; file: { id: string; url: string; size?: number; sha1?: string } } };
  javaVersion?: VersionJavaRequirement;
  inheritsFrom?: string;
  jar?: string;
}

export interface ResolvedVersion extends VersionDetails {
  clientVersionId: string;
  libraries: VersionLibrary[];
}

export interface LaunchAccount {
  type: 'microsoft' | 'offline';
  name: string;
  uuid: string;
  accessToken: string;
  userType: 'msa' | 'legacy';
  xuid?: string | null;
}

export interface LaunchRequest {
  instanceRoot: string;
  gameDir: string;
  javaPath: string;
  account: LaunchAccount;
  minMemoryMb: number;
  maxMemoryMb: number;
  jvmArgs?: string[];
  gameArgs?: string[];
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

export interface InstallProgress {
  stage: string;
  message: string;
  completed: number;
  total: number;
}

export interface MinecraftManifestEntry {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
}

export interface MinecraftManifest {
  latest: { release: string; snapshot: string };
  versions: MinecraftManifestEntry[];
}
