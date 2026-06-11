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
// Patterns are ordered from most to least specific.  Group 1 = time, Group 2 = content.
const REMINDER_PATTERNS = [
	// ── German ────────────────────────────────────────────────
	// "in 20 sekunden einen reminder dass ich hüpfen soll"
	// "nach 5 minuten reminder: kaffee machen"
	/(?:in|nach)\s+(\d[\d\s]*(?:minuten?|min|sekunden?|sek|stunden?|h)?)\b[\s\S]*?(?:reminder|erinnern|erinnere|erinnerung|dass|zu|an|daran)\s*(.+)/i,

	// "erinnere mich in 90 sekunden daran Wasser zu trinken"
	// "erinnere mich bitte in 5 minuten an den kaffee"
	/erinn(?:ere|er)\s+mich\s+(?:bitte\s+)?(?:in|nach)\s+([\d\s]+(?:minuten?|min|sekunden?|sek|stunden?|h)?(?:\s+\d+\s*(?:minuten?|min|sekunden?|sek|stunden?|h))?)\s+(?:an|daran|zu|das|dass)?\s+(.+?)(?:\.|$)/i,

	// "erinnere mich daran Wasser zu trinken in 90 Sekunden"
	/erinn(?:ere|er)\s+mich\s+(?:bitte\s+)?(?:an|daran|zu|das|dass)?\s+(.+?)\s+(?:in|nach)\s+([\d\s]+(?:minuten?|min|sekunden?|sek|stunden?|h)?(?:\s+\d+\s*(?:minuten?|min|sekunden?|sek|stunden?|h))?)/i,

	// ── English ───────────────────────────────────────────────
	// "in 10 seconds remind me to jump"
	// "after 5 minutes reminder: call mom"
	/(?:in|after)\s+(\d[\d\s]*(?:minutes?|mins?|seconds?|secs?|hours?|h)?)\b[\s\S]*?(?:remind|reminder|to|about|that)\s*(.+)/i,

	// "remind me in 10 seconds to jump"
	/remind\s+me\s+(?:in|after)\s+([\d\s]+(?:minutes?|mins?|seconds?|secs?|hours?|h)?(?:\s+\d+\s*(?:minutes?|mins?|seconds?|secs?|hours?|h))?)\s+(?:to|about|that)?\s+(.+?)(?:\.|$)/i,

	// "remind me to jump in 10 seconds"
	/remind\s+me\s+(?:to|about|that)?\s+(.+?)\s+(?:in|after)\s+([\d\s]+(?:minutes?|mins?|seconds?|secs?|hours?|h)?(?:\s+\d+\s*(?:minutes?|mins?|seconds?|secs?|hours?|h))?)/i
];

/**
 * True if group 1 is time and group 2 is content for the given pattern.
 * False if group 1 is content and group 2 is time.
 */
function isGroup1Time(pattern: RegExp): boolean {
	const s = pattern.source;
	// Pattern starts with "(?:in|nach)" or "(?:in|after)" → group 1 = time
	if (s.startsWith('(?:in|nach)') || s.startsWith('(?:in|after)')) return true;
	// Pattern starts with "erinn" → check order
	if (s.startsWith('erinn')) {
		// "erinn... (?:in|nach)" → group 1 = time
		// "erinn... (?:an|daran)" → group 1 = content
		return s.includes('(?:in|nach)') && s.indexOf('(?:in|nach)') < s.indexOf('(?:an|daran|zu|das|dass)');
	}
	// Pattern starts with "remind" → check order
	if (s.startsWith('remind')) {
		return s.includes('(?:in|after)') && s.indexOf('(?:in|after)') < s.indexOf('(?:to|about|that)');
	}
	return true;
}

export function tryExtractReminderFromUserMessage(text: string): { content: string; triggerAt: Date } | null {
	for (const pattern of REMINDER_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			const g1Time = isGroup1Time(pattern);
			const timeStr = (g1Time ? match[1] : match[2]).trim();
			const content = (g1Time ? match[2] : match[1]).trim();
			const triggerAt = parseReminderTime(timeStr);
			if (triggerAt && content) {
				console.log('[Reminder] Pattern matched:', pattern.source.slice(0, 40) + '...');
				console.log('[Reminder] Parsed:', { timeStr, content, triggerAt });
				return { content, triggerAt };
			}
		}
	}
	return null;
}
