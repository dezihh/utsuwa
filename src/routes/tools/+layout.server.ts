import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * The tools area (Prompt Workbench, Speech Workbench, etc.) is intended for
 * local development only. It is disabled in production unless explicitly
 * enabled via `UTSUWA_TOOLS_ENABLED=true`.
 */
export const load: LayoutServerLoad = ({ url }) => {
	const enabled =
		process.env.UTSUWA_TOOLS_ENABLED === 'true' || process.env.NODE_ENV === 'development';

	if (!enabled) {
		error(404, 'Not Found');
	}

	return {
		toolsEnabled: true
	};
};
