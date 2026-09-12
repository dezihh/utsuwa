import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStdioSession } from './client.server.ts';
import type { McpServerConfig } from '$lib/types/mcp';

function stdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
	return { id: 'test', name: 'Test', transport: 'stdio', command: '', enabled: true, ...overrides };
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`process ${pid} is still alive after SIGTERM/SIGKILL`);
}

test('a failed initialize handshake terminates the spawned process', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mcp-stdio-'));
	const stateFile = join(dir, 'pid');
	// Stays alive and ignores stdin EOF, so only the SIGTERM fallback can end it.
	const script =
		"require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000);";

	await assert.rejects(
		createStdioSession(stdioConfig({ command: process.execPath, args: ['-e', script, stateFile] }), {
			timeoutMs: 150
		}),
		/initialize timeout/
	);

	await waitForProcessExit(Number(readFileSync(stateFile, 'utf8')));
});

test('a stdio server that exits during the handshake rejects with its exit code', async () => {
	await assert.rejects(
		createStdioSession(stdioConfig({ command: process.execPath, args: ['-e', 'process.exit(3)'] }), {
			timeoutMs: 1000
		}),
		/exited with code 3/
	);
});

test('stdio servers receive a minimal environment plus their configured vars', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mcp-stdio-env-'));
	const stateFile = join(dir, 'env.json');
	const script =
		"require('node:fs').writeFileSync(process.argv[1], JSON.stringify({ db: process.env.DATABASE_URL ?? null, brave: process.env.BRAVE_API_KEY ?? null, path: Boolean(process.env.PATH) }));";

	process.env.DATABASE_URL = 'postgres://app-secret';
	try {
		await assert.rejects(
			createStdioSession(
				stdioConfig({
					command: process.execPath,
					args: ['-e', script, stateFile],
					env: { BRAVE_API_KEY: 'brave-secret' }
				}),
				{ timeoutMs: 1000 }
			)
		);
	} finally {
		delete process.env.DATABASE_URL;
	}

	const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
		db: string | null;
		brave: string | null;
		path: boolean;
	};
	assert.equal(state.db, null, 'app secrets must not leak into the stdio server');
	assert.equal(state.brave, 'brave-secret', 'per-server env reaches the child');
	assert.equal(state.path, true, 'PATH is required to spawn interpreters');
});
