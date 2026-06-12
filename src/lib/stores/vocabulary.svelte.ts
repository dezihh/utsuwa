import type { VocabularyEntry } from '$lib/types/vocabulary';
import { getVocabularyStats } from '$lib/services/storage/vocabulary';

function createVocabularyStore() {
	let entries = $state<VocabularyEntry[]>([]);
	let stats = $state<{ total: number; known: number; learning: number }>({
		total: 0,
		known: 0,
		learning: 0
	});
	let isModalOpen = $state(false);

	function openModal() {
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
	}

	async function loadStats(characterId: string) {
		stats = await getVocabularyStats(characterId);
	}

	return {
		get entries() {
			return entries;
		},
		set entries(value: VocabularyEntry[]) {
			entries = value;
		},
		get stats() {
			return stats;
		},
		get isModalOpen() {
			return isModalOpen;
		},
		openModal,
		closeModal,
		loadStats
	};
}

export const vocabularyStore = createVocabularyStore();
