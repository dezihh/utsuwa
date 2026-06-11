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
		}
	}

	const cleanedText = text.replace(regex, '').trim();
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
