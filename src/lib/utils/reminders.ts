export interface ParsedReminder {
	content: string;
	triggerAt: Date;
}

export function extractReminderTags(text: string): { reminders: ParsedReminder[]; cleanedText: string } {
	const regex = /\[reminder:([^\]]+)\]([\s\S]*?)\[\/reminder\]/gi;
	const reminders: ParsedReminder[] = [];
	let match;

	while ((match = regex.exec(text)) !== null) {
		const timeStr = match[1].trim();
		const content = match[2].trim();
		const triggerAt = parseReminderTime(timeStr);
		if (triggerAt) {
			reminders.push({ content, triggerAt });
			console.log('[Reminder] Extracted tag:', { timeStr, content, triggerAt });
		} else {
			console.warn('[Reminder] Failed to parse time:', timeStr);
		}
	}

	const cleanedText = text.replace(regex, '').trim();
	if (reminders.length > 0) {
		console.log('[Reminder] Total extracted:', reminders.length);
	}
	return { reminders, cleanedText };
}

export function parseReminderTime(timeStr: string): Date | null {
	const now = Date.now();
	let totalMs = 0;

	const hMatch = timeStr.match(/(\d+)\s*h(?:our)?s?/i);
	const mMatch = timeStr.match(/(\d+)\s*m(?:in)?/i);
	const sMatch = timeStr.match(/(\d+)\s*s(?:ec)?/i);

	if (hMatch) totalMs += parseInt(hMatch[1], 10) * 60 * 60 * 1000;
	if (mMatch) totalMs += parseInt(mMatch[1], 10) * 60 * 1000;
	if (sMatch) totalMs += parseInt(sMatch[1], 10) * 1000;

	if (totalMs === 0) return null;
	return new Date(now + totalMs);
}

// Fallback: parse a natural-language reminder request directly from user text
// so reminders work even when the LLM doesn't output [reminder:xx] tags.
const REMINDER_PATTERNS = [
	// German
	/erinn(?:ere|er)\s+mich\s+(?:bitte\s+)?(?:in|nach)\s+([\d\s]+(?:minuten?|min|sekunden?|sek|stunden?|h)?(?:\s+\d+\s*(?:minuten?|min|sekunden?|sek|stunden?|h))?)\s+(?:an|daran|zu|das|dass)?\s+(.+?)(?:\.|$)/i,
	/erinn(?:ere|er)\s+mich\s+(?:bitte\s+)?(?:an|daran|zu|das|dass)?\s+(.+?)\s+(?:in|nach)\s+([\d\s]+(?:minuten?|min|sekunden?|sek|stunden?|h)?(?:\s+\d+\s*(?:minuten?|min|sekunden?|sek|stunden?|h))?)/i,
	// English
	/remind\s+me\s+(?:in|after)\s+([\d\s]+(?:minutes?|mins?|seconds?|secs?|hours?|h)?(?:\s+\d+\s*(?:minutes?|mins?|seconds?|secs?|hours?|h))?)\s+(?:to|about|that)?\s+(.+?)(?:\.|$)/i,
	/remind\s+me\s+(?:to|about|that)?\s+(.+?)\s+(?:in|after)\s+([\d\s]+(?:minutes?|mins?|seconds?|secs?|hours?|h)?(?:\s+\d+\s*(?:minutes?|mins?|seconds?|secs?|hours?|h))?)/i
];

export function tryExtractReminderFromUserMessage(text: string): { content: string; triggerAt: Date } | null {
	for (const pattern of REMINDER_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			// Determine which capture group is time vs content based on pattern order
			let timeStr: string;
			let content: string;
			if (pattern.source.includes('in|after') && pattern.source.indexOf('in|after') < pattern.source.indexOf('to|about')) {
				timeStr = match[1];
				content = match[2];
			} else {
				content = match[1];
				timeStr = match[2];
			}
			const triggerAt = parseReminderTime(timeStr.trim());
			if (triggerAt && content.trim()) {
				return { content: content.trim(), triggerAt };
			}
		}
	}
	return null;
}
