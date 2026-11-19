/**
 * Type surface of the client-mod build script for TypeScript importers.
 * The script only executes its build when invoked directly
 * (`node scripts/build-client-mod.mjs`); importing it is side-effect free.
 */
export declare const GSON_VERSION: string;
/** Pinned SHA-256 per `.tools/` file name (see TOOLCHAIN_SHA256 in the build script). */
export declare const TOOLCHAIN_SHA256: Record<string, string>;
