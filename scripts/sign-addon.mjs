// Publisher signing helper for Klymon addons (ADR-028).
//
//   node scripts/sign-addon.mjs gen-key                    # new Ed25519 keypair (JSON to stdout)
//   node scripts/sign-addon.mjs sign --addon ID --version V --sha256 H --file-size N --key SEED
//                                                          # signature JSON for publishVersion
//
// The private seed is read from --key or the KLYMON_SIGNING_KEY env var and
// never leaves this process except on stdout. Register the public key first:
// POST /v1/addons/keys { name, publicKey }.
//
// NOTE: no shebang line on purpose (see build-client-mod.mjs header).
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = 'klymon-addon-v1';

export function canonicalPayload({ addonId, version, sha256, fileSize }) {
  return `${PREFIX}\n${addonId}\n${version}\n${String(sha256).toLowerCase()}\n${fileSize}\n`;
}

export function fingerprintOf(publicKeyBase64Url) {
  return createHash('sha256').update(Buffer.from(publicKeyBase64Url, 'base64url')).digest('hex');
}

export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyRaw = publicKey.export({ format: 'jwk' }).x;
  return {
    publicKey: publicKeyRaw,
    privateKey: privateKey.export({ format: 'jwk' }).d,
    fingerprint: fingerprintOf(publicKeyRaw),
  };
}

export function signPayload({ addonId, version, sha256, fileSize }, privateKeyBase64Url) {
  const raw = Buffer.from(privateKeyBase64Url, 'base64url');
  if (raw.length !== 32) throw new Error('Private seed must decode to exactly 32 bytes.');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw]);
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const payload = canonicalPayload({ addonId, version, sha256, fileSize });
  return {
    payload,
    signature: sign(null, Buffer.from(payload, 'utf8'), key).toString('base64url'),
  };
}

function usage(exitCode) {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/sign-addon.mjs gen-key',
      '  node scripts/sign-addon.mjs sign --addon ID --version V --sha256 H --file-size N [--key SEED]',
      '',
      'Reads the private seed from --key or KLYMON_SIGNING_KEY. Prints JSON.',
      '',
    ].join('\n'),
  );
  process.exit(exitCode);
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

// Importing this module (e.g. from tests) must not run the CLI.
const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'gen-key') {
      process.stdout.write(`${JSON.stringify(generateKeypair(), null, 2)}\n`);
    } else if (command === 'sign') {
      const addonId = flagValue(args, '--addon');
      const version = flagValue(args, '--version');
      const sha256 = flagValue(args, '--sha256');
      const fileSize = Number(flagValue(args, '--file-size'));
      const key = flagValue(args, '--key') ?? process.env.KLYMON_SIGNING_KEY;
      if (!addonId || !version || !sha256 || !Number.isInteger(fileSize) || fileSize < 1 || !key) usage(2);
      const { signature } = signPayload({ addonId, version, sha256, fileSize }, key);
      process.stdout.write(`${JSON.stringify({ signature }, null, 2)}\n`);
    } else {
      usage(command === '--help' || command === '-h' ? 0 : 2);
    }
  } catch (error) {
    process.stderr.write(`sign-addon: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
