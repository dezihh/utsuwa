/**
 * Shared memory utility functions used by engine/memory.ts and memory services.
 * Kept in utils/ to avoid circular imports between engine and services layers.
 */

export function determineFactCategory(content: string): 'user' | 'relationship' | 'shared_experience' {
	const lowerContent = content.toLowerCase();

	// Check for user-related content
	if (
		lowerContent.includes('user') ||
		lowerContent.includes('their') ||
		lowerContent.includes('they') ||
		lowerContent.match(/\b(name|job|work|live|family|hobby|favorite)\b/)
	) {
		return 'user';
	}

	// Check for shared experience
	if (
		lowerContent.match(/\b(we|together|our|shared|both)\b/) ||
		lowerContent.match(/\b(talked about|discussed|laughed|cried)\b/)
	) {
		return 'shared_experience';
	}

	// Default to relationship
	return 'relationship';
}

export function calculateFactImportance(content: string, sentiment: number = 0): number {
	let importance = 50; // Base

	// Length bonus (longer = more detailed = more important)
	if (content.length > 50) importance += 10;
	if (content.length > 100) importance += 5;

	// Emotional content bonus
	const emotionalWords = ['love', 'hate', 'fear', 'dream', 'hope', 'wish', 'important', 'special'];
	for (const word of emotionalWords) {
		if (content.toLowerCase().includes(word)) {
			importance += 10;
			break;
		}
	}

	// Personal info bonus
	const personalWords = ['name', 'birthday', 'family', 'job', 'home', 'secret'];
	for (const word of personalWords) {
		if (content.toLowerCase().includes(word)) {
			importance += 15;
			break;
		}
	}

	// Sentiment bonus
	if (Math.abs(sentiment) > 0.5) {
		importance += 10;
	}

	return Math.min(100, importance);
}
