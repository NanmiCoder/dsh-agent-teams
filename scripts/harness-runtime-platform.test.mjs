import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { linkDirectory } from './harness-runtime-scenarios.mjs';
import { inspectRuntimeCohort } from './harness-runtime-cohort.mjs';

test('cohort inspection admits only platform-excluded optional omissions and still rejects missing or mixed packages', t => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-cohort-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const version = '0.2.2-rc.2';
    const host = 'node_modules/@deepseek-ai/dsh';
    const macos = 'node_modules/@deepseek-ai/dsh-experimental-cua-macos';
    const cpu = 'node_modules/@deepseek-ai/dsh-native-fixture';
    const packages = {
        [host]: { version },
        [macos]: { version, optional: true, os: ['darwin'] },
        [cpu]: { version, optional: true, cpu: ['arm64'] },
    };
    mkdirSync(join(root, host), { recursive: true });
    writeFileSync(join(root, host, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }));
    const inspect = (platform = 'linux', arch = 'x64') => {
        writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages }));
        return inspectRuntimeCohort(root, version, { platform, arch });
    };
    for (const platform of ['linux', 'win32']) {
        const result = inspect(platform);
        assert.equal(result.count, 1);
        assert.deepEqual(result.skipped.map(entry => entry.path), [macos, cpu]);
    }
    assert.throws(() => inspect('darwin'), /Missing host package.*cua-macos/);
    assert.throws(() => inspect('linux', 'arm64'), /Missing host package.*native-fixture/);
    packages[macos].optional = false;
    assert.throws(() => inspect(), /Missing host package.*cua-macos/);
    packages[macos].optional = true;
    packages[macos].version = '0.2.2-rc.1';
    assert.throws(() => inspect(), /Mixed host cohort.*lock/);
    packages[macos].version = version;
    packages[macos].os = ['!linux'];
    assert.equal(inspect().skipped.length, 2);
    packages[macos].os = ['any'];
    assert.throws(() => inspect(), /Missing host package.*cua-macos/);
    mkdirSync(join(root, macos), { recursive: true });
    writeFileSync(join(root, macos, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-experimental-cua-macos', version: '0.2.2-rc.1' }));
    assert.throws(() => inspect(), /Mixed host cohort.*disk/);
});

test('fixture package links work without Windows symlink privileges and replace stale links', t => {
    const root = mkdtempSync(join(tmpdir(), 'runtime link test '));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const first = join(root, 'first'), second = join(root, 'second'), link = join(root, 'profile package');
    for (const target of [first, second]) {
        mkdirSync(target);
        writeFileSync(join(target, 'package.json'), JSON.stringify({ name: target }));
    }
    linkDirectory(first, link);
    assert.equal(readFileSync(join(link, 'package.json'), 'utf8'), readFileSync(join(first, 'package.json'), 'utf8'));
    rmSync(first, { recursive: true });
    linkDirectory(second, link);
    assert.equal(readFileSync(join(link, 'package.json'), 'utf8'), readFileSync(join(second, 'package.json'), 'utf8'));
});

test('fixture linking refuses to replace real files or directories', t => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-link-preserve-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'file'), directory = join(root, 'directory');
    writeFileSync(file, 'keep');
    mkdirSync(directory);
    for (const path of [file, directory]) assert.throws(() => linkDirectory(root, path), /non-link fixture path/);
    assert.equal(readFileSync(file, 'utf8'), 'keep');
});
