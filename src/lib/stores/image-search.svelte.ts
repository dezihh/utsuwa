import type { ImageSearchResult } from '$lib/utils/image-search';

let results = $state<ImageSearchResult[]>([]);
let isOpen = $state(false);
let currentQuery = $state('');
// Which result is focused. The first is focused automatically; a click moves
// it. The vision description and her "what is on screen" refer to this one.
let focusedIndex = $state(0);
// What the focused picture actually contains, from a separate vision model (if
// configured). Fed into her prompt so she can talk about what is on screen.
let currentDescription = $state<string | null>(null);

export function openModal(newResults: ImageSearchResult[], query: string) {
	results = newResults;
	currentQuery = query;
	isOpen = true;
	focusedIndex = 0;
	currentDescription = null;
}

export function closeModal() {
	isOpen = false;
	currentDescription = null;
}

export function setDescription(description: string | null) {
	currentDescription = description;
}

export function setFocus(index: number) {
	if (index < 0 || index >= results.length || index === focusedIndex) return;
	focusedIndex = index;
	// A new picture is in focus; the old description no longer applies.
	currentDescription = null;
}

export const imageSearchStore = {
	get results() {
		return results;
	},
	get isOpen() {
		return isOpen;
	},
	get currentQuery() {
		return currentQuery;
	},
	get focusedIndex() {
		return focusedIndex;
	},
	get currentDescription() {
		return currentDescription;
	},
	openModal,
	closeModal,
	setDescription,
	setFocus
};
