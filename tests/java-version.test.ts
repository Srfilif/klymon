import { describe, expect, it } from 'vitest';
import { parseJavaMajor, parseJavaVendor, parseJavaVersionString } from '@klymon/core';
import { requiredJavaMajor } from '@klymon/version-manager';

const MODERN = 'openjdk version "21.0.11" 2026-04-21 LTS\nOpenJDK Runtime Environment Temurin-21.0.11+10 (build 21.0.11+10-LTS)';
const LEGACY = 'java version "1.8.0_402"\nJava(TM) SE Runtime Environment (build 1.8.0_402-b06)';
const CORRETTO = 'openjdk version "17.0.10" 2024-01-16\nOpenJDK Runtime Environment Corretto-17.0.10.7.1 (build 17.0.10+7-LTS)';

describe('Java version parsing', () => {
  it('parses modern version numbers', () => {
    expect(parseJavaMajor(MODERN)).toBe(21);
    expect(parseJavaMajor(CORRETTO)).toBe(17);
  });

  it('normalises legacy 1.x schemes to the real major', () => {
    expect(parseJavaMajor(LEGACY)).toBe(8);
  });

  it('extracts vendors from the runtime header', () => {
    expect(parseJavaVendor(MODERN)).toBe('Eclipse Temurin');
    expect(parseJavaVendor(CORRETTO)).toBe('Amazon Corretto');
    expect(parseJavaVendor('java version "1.8.0_402"\nJava(TM) SE Runtime Environment')).toBe('Oracle JDK');
    expect(parseJavaVendor('garbage')).toBe('Unknown');
  });

  it('extracts the raw version string', () => {
    expect(parseJavaVersionString(MODERN)).toBe('21.0.11');
    expect(parseJavaMajor('no version here')).toBeNull();
  });
});

describe('required Java per Minecraft version', () => {
  it('prefers the version metadata when present', () => {
    expect(requiredJavaMajor('1.20.1', 17)).toBe(17);
    expect(requiredJavaMajor('1.16.5', 8)).toBe(8);
  });

  it('falls back to Mojang’s documented requirements', () => {
    expect(requiredJavaMajor('1.21.4')).toBe(21);
    expect(requiredJavaMajor('1.20.6')).toBe(21);
    expect(requiredJavaMajor('1.18.2')).toBe(17);
    expect(requiredJavaMajor('1.17.1')).toBe(16);
    expect(requiredJavaMajor('1.12.2')).toBe(8);
    expect(requiredJavaMajor('1.8.9')).toBe(8);
    // 2026-preview style version numbers are modern releases, so they need Java 21.
    expect(requiredJavaMajor('26.4-snapshot-8')).toBe(21);
  });
});
