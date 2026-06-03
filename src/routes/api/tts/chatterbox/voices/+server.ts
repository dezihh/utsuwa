import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CHATTERBOX_TIMEOUT_MS = 15000;

export const GET: RequestHandler = async ({ url }) => {
        // Always use internal URL for server-side fetch to chatterbox-ng.
        // The browser baseUrl setting is only relevant for direct WebSocket connections.
        const baseUrl = 'http://127.0.0.1:8765';

        let res: Response;
        try {
                res = await fetch(`${baseUrl}/api/voices`, {
                        signal: AbortSignal.timeout(CHATTERBOX_TIMEOUT_MS)
                });
        } catch (err) {
                const msg = err instanceof Error ? err.message : 'Connection failed';
                return json({ error: `Cannot reach Chatterbox NG at ${baseUrl}: ${msg}` }, { status: 502 });
        }

        if (!res.ok) {
                const body = await res.text().catch(() => '');
                return json(
                        { error: `Cannot reach Chatterbox NG voices endpoint (upstream ${res.status}). Check that chatterbox-ng is running on port 8765.${body ? ' ' + body : ''}` },
                        { status: 502 }
                );
        }

        const data = (await res.json()) as { voices: Array<{ id: string; filename: string; is_reference?: boolean }> };

        const voices = (data.voices || []).map((v) => ({
                id: v.is_reference ? `clone:${v.filename.replace(/\.wav$/, '')}` : v.filename.replace(/\.wav$/, ''),
                name: v.filename.replace(/\.wav$/, ''),
                type: v.is_reference ? 'clone' as const : 'predefined' as const
        }));

        return json({ voices });
};
