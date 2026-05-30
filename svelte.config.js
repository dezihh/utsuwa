import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { createHighlighter } from 'shiki/bundle/web';

const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const isProd = process.env.NODE_ENV === 'production';

const highlighter = await createHighlighter({
	themes: ['github-light', 'github-dark'],
	langs: ['js', 'ts', 'bash', 'json', 'svelte', 'html', 'css', 'md']
});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.md'],

	preprocess: [
		vitePreprocess(),
		mdsvex({
			extensions: ['.md'],
			rehypePlugins: [rehypeSlug],
			highlight: {
				highlighter: (code, lang) => {
					const html = highlighter.codeToHtml(code, {
						lang: lang || 'text',
						themes: { light: 'github-light', dark: 'github-dark' }
					});
					return `{@html \`${html.replace(/`/g, '\\`')}\`}`;
				}
			}
		})
	],

	kit: {
		adapter: isTauri
			? adapterStatic({ fallback: 'index.html' })
			: isProd
				? adapterNode()
				: adapterAuto()
	}
};

export default config;
