import test from 'node:test';
import assert from 'node:assert/strict';

import {
	extractHostname,
	extractImageUrls,
	pickSearchTool,
	queryArgKey,
	toDataUrl
} from './image-search.ts';

test('extractHostname returns the host or a safe fallback', () => {
	assert.equal(extractHostname('https://example.com/a/b.png'), 'example.com');
	assert.equal(extractHostname('not a url'), 'unknown');
});

test('toDataUrl builds a data URL and defaults an empty MIME type', () => {
	assert.equal(toDataUrl('image/png', 'AAAA'), 'data:image/png;base64,AAAA');
	assert.equal(toDataUrl('', 'AAAA'), 'data:application/octet-stream;base64,AAAA');
});

test('extractImageUrls reads img_src/thumbnail fields from JSON', () => {
	const json = JSON.stringify({
		results: [
			{ url: 'https://page/1', img_src: 'https://cdn/a.jpg', title: 'A' },
			{ url: 'https://page/2', thumbnail_src: 'https://cdn/b.png' }
		]
	});
	const urls = extractImageUrls(json);
	assert.ok(urls.includes('https://cdn/a.jpg'));
	assert.ok(urls.includes('https://cdn/b.png'));
});

test('extractImageUrls falls back to image-extension URLs in plain text', () => {
	const urls = extractImageUrls('see https://x/y.webp?w=2 and https://z/p.jpg');
	assert.deepEqual(urls.sort(), ['https://x/y.webp?w=2', 'https://z/p.jpg'].sort());
});

test('extractImageUrls ignores page URLs and caps at 12', () => {
	assert.equal(extractImageUrls('{"url":"https://page/no-ext"}').length, 0);
	const json = JSON.stringify({
		results: Array.from({ length: 20 }, (_, i) => ({ url: `https://page/${i}`, img_src: `https://cdn/${i}.jpg` }))
	});
	assert.equal(extractImageUrls(json).length, 12);
});

test('extractImageUrls returns nothing for empty or non-image text', () => {
	assert.deepEqual(extractImageUrls(''), []);
	assert.deepEqual(extractImageUrls('no links here'), []);
});

test('queryArgKey finds the query parameter, or null without one', () => {
	assert.equal(queryArgKey({ name: 'x', inputSchema: { properties: { q: {} } } }), 'q');
	assert.equal(queryArgKey({ name: 'x', inputSchema: { properties: { url: {} } } }), null);
	assert.equal(queryArgKey({ name: 'x' }), null);
});

test('pickSearchTool prefers image-search tools and excludes file-fetch tools', () => {
	const tools = [
		{ name: 'fetch_image_from_url', inputSchema: { properties: { url: {} } } },
		{ name: 'web_search', inputSchema: { properties: { query: {} } } },
		{ name: 'brave_image_search', inputSchema: { properties: { q: {} } } }
	];
	assert.equal(pickSearchTool(tools)?.name, 'brave_image_search');
	assert.equal(
		pickSearchTool([{ name: 'fetch_file_from_url', inputSchema: { properties: { url: {} } } }]),
		undefined
	);
	assert.equal(pickSearchTool([]), undefined);
});
