import type { CharacterState, StateUpdates, Emotion } from '$lib/types/character';
import type { MessageAnalysis, TopicDepth } from '$lib/types/memory';
import { calculateMessageImpact } from './state-updates.ts';

// Word-level sentiment keywords (matched with word boundary)
const POSITIVE_WORDS = [
	'happy', 'glad', 'love', 'great', 'awesome', 'amazing', 'wonderful',
	'thank', 'thanks', 'appreciate', 'enjoy', 'fun', 'excited', 'nice',
	'good', 'best', 'beautiful', 'cute', 'sweet', 'kind', 'funny',
	'haha', 'lol', 'lmao'
];

const NEGATIVE_WORDS = [
	'sad', 'sorry', 'hate', 'bad', 'awful', 'terrible', 'angry',
	'upset', 'annoyed', 'frustrated', 'disappointed', 'worry', 'worried',
	'scared', 'afraid', 'hurt', 'pain', 'lonely', 'alone', 'cry', 'crying'
];

// Symbol/emoji keywords that don't appear as tokens in word-split text
const POSITIVE_SYMBOLS = [':)', ':D', '<3', '❤', '😊', '😄', '🥰', '💕'];
const NEGATIVE_SYMBOLS = [':(', '😢', '😔', '😞'];

// Combine all for building regexes
const ALL_POSITIVE = [...POSITIVE_WORDS, ...POSITIVE_SYMBOLS];
const ALL_NEGATIVE = [...NEGATIVE_WORDS, ...NEGATIVE_SYMBOLS];

// Build word-boundary regex from word lists
const POSITIVE_WORD_RE = new RegExp('\\b(' + POSITIVE_WORDS.join('|') + ')\\b', 'gi');
const NEGATIVE_WORD_RE = new RegExp('\\b(' + NEGATIVE_WORDS.join('|') + ')\\b', 'gi');

// Deep conversation markers
const DEPTH_MARKERS = [
	'feel', 'feeling', 'feelings', 'think', 'believe', 'hope', 'dream',
	'wish', 'fear', 'scared', 'worry', 'love', 'hate', 'care', 'mean',
	'matter', 'important', 'understand', 'remember', 'miss', 'future',
	'past', 'life', 'death', 'relationship', 'family', 'friend',
	'trust', 'honest', 'truth', 'secret'
];

// Emotional content markers
const EMOTIONAL_MARKERS = [
	'feel', 'feeling', 'emotion', 'emotional', 'heart', 'soul', 'cry',
	'tears', 'happy', 'sad', 'angry', 'scared', 'love', 'hate', 'miss',
	'hurt', 'pain', 'joy', 'excited', 'nervous', 'anxious', 'worried'
];

// Analyze a message for sentiment, depth, and other characteristics
export function analyzeMessage(content: string): MessageAnalysis {
	const lowerContent = content.toLowerCase();

	// Calculate sentiment using word-boundary regex for proper matching
	const positiveMatches = lowerContent.match(POSITIVE_WORD_RE) || [];
	const negativeMatches = lowerContent.match(NEGATIVE_WORD_RE) || [];

	let positiveCount = positiveMatches.length;
	let negativeCount = negativeMatches.length;

	// Check for emoticon/emoji symbols (these don't match word boundary patterns)
	for (const sym of POSITIVE_SYMBOLS) {
		if (lowerContent.includes(sym)) positiveCount++;
	}
	for (const sym of NEGATIVE_SYMBOLS) {
		if (lowerContent.includes(sym)) negativeCount++;
	}

	const totalSentiment = positiveCount + negativeCount;
	const sentiment = totalSentiment > 0 ? (positiveCount - negativeCount) / totalSentiment : 0;

	// Calculate topic depth
	let depthMarkerCount = 0;
	for (const marker of DEPTH_MARKERS) {
		if (lowerContent.includes(marker)) depthMarkerCount++;
	}

	let topicDepth: TopicDepth = 'shallow';
	if (depthMarkerCount >= 3 || content.length > 200) {
		topicDepth = 'deep';
	} else if (depthMarkerCount >= 1 || content.length > 80) {
		topicDepth = 'moderate';
	}

	// Check for emotional content
	let hasEmotionalContent = false;
	for (const marker of EMOTIONAL_MARKERS) {
		if (lowerContent.includes(marker)) {
			hasEmotionalContent = true;
			break;
		}
	}

	// Check if it's a question
	const isQuestion = content.includes('?') || /^(what|who|where|when|why|how|do|does|did|is|are|was|were|can|could|would|will|should)\b/i.test(content);

	// Extract potential facts (very basic)
	const extractedFacts: string[] = [];

	// Look for "I am/I'm" statements — capture multi-word facts
	const iAmMatches = content.match(/\b(i'?m|i am|my name is)\s+(?:a |an )?([^.!?,\n]+)/gi);
	if (iAmMatches) {
		extractedFacts.push(...iAmMatches.map((m) => `User said: ${m}`));
	}

	// Look for "I like/love/hate" statements
	const preferenceMatches = content.match(/\b(i (?:really )?(like|love|hate|enjoy|prefer))\s+([^.!?,\n]+)/gi);
	if (preferenceMatches) {
		extractedFacts.push(...preferenceMatches.map((m) => `User preference: ${m}`));
	}

	// Detect emotion from content
	let detectedEmotion: string | undefined;
	if (sentiment > 0.5) {
		detectedEmotion = 'happy';
	} else if (sentiment < -0.5) {
		detectedEmotion = 'sad';
	} else if (isQuestion && depthMarkerCount > 0) {
		detectedEmotion = 'curious';
	}

	const words = lowerContent.split(/\s+/);
	return {
		sentiment,
		topicDepth,
		detectedEmotion,
		extractedFacts,
		isQuestion,
		hasEmotionalContent
	};
}

// Calculate baseline state updates from a user message
export function calculateBaselineUpdates(content: string, state: CharacterState): StateUpdates {
	const analysis = analyzeMessage(content);

	const impact = calculateMessageImpact(
		analysis.sentiment,
		analysis.topicDepth,
		analysis.hasEmotionalContent,
		analysis.isQuestion,
		state
	);

	const updates: StateUpdates = {
		energyDelta: impact.energyDelta,
		affectionDelta: impact.affectionDelta,
		trustDelta: impact.trustDelta,
		intimacyDelta: impact.intimacyDelta,
		comfortDelta: impact.comfortDelta,
		respectDelta: impact.respectDelta
	};

	if (Math.abs(analysis.sentiment) > 0.3) {
		let emotion: Emotion = 'neutral';
		if (analysis.sentiment > 0.5) {
			emotion = 'happy';
		} else if (analysis.sentiment > 0.3) {
			emotion = 'content';
		} else if (analysis.sentiment < -0.5) {
			emotion = 'sad';
		} else if (analysis.sentiment < -0.3) {
			emotion = 'anxious';
		}

		updates.moodChange = {
			emotion,
			intensityDelta: Math.floor(Math.abs(analysis.sentiment) * 20),
			cause: analysis.sentiment > 0 ? 'positive conversation' : 'concerning conversation'
		};
	}

	if (analysis.extractedFacts.length > 0) {
		updates.newMemory = analysis.extractedFacts[0];
	}

	return updates;
}
