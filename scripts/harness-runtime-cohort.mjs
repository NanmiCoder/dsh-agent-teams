/** Inspect the installed cohort; npm locks optional packages for other platforms too. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

function admits(values, actual) {
    if (values === undefined) return true;
    const list = typeof values === 'string' ? [values] : values;
    if (!Array.isArray(list) || !list.every(value => typeof value === 'string')) throw Error('Invalid package platform constraint');
    if (list.includes('!' + actual)) return false;
    const positive = list.filter(value => !value.startsWith('!'));
    return positive.length === 0 || positive.includes('any') || positive.includes(actual);
}

export function inspectRuntimeCohort(runtime, version, { platform = process.platform, arch = process.arch } = {}) {
    const bytes = readFileSync(join(runtime, 'package-lock.json'));
    const lock = JSON.parse(bytes), cohort = [], skipped = [];
    for (const [path, entry] of Object.entries(lock.packages)) {
        if (!/node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path)) continue;
        if (entry.version !== version) throw Error(`Mixed host cohort ${path}: lock ${entry.version}, expected ${version}`);
        const manifest = join(runtime, path, 'package.json');
        if (!existsSync(manifest)) {
            if (entry.optional === true && (!admits(entry.os, platform) || !admits(entry.cpu, arch))) {
                skipped.push({ path, version: entry.version, os: entry.os, cpu: entry.cpu, reason: 'optional-platform' });
                continue;
            }
            throw Error(`Missing host package ${path} on ${platform}/${arch}`);
        }
        const installed = JSON.parse(readFileSync(manifest, 'utf8'));
        if (installed.version !== version) throw Error(`Mixed host cohort ${path}: disk ${installed.version}, expected ${version}`);
        cohort.push({ path, name: installed.name, version: entry.version, integrity: entry.integrity });
    }
    if (!cohort.some(entry => entry.name === '@deepseek-ai/dsh')) throw Error('No actual Harness installation');
    return { version, count: cohort.length, lockSha256: createHash('sha256').update(bytes).digest('hex'), cohort, skipped };
}
