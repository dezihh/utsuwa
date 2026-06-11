import { browser } from '$app/environment';
import { db } from '$lib/db';
import type { Reminder } from '$lib/types/memory';
import { getWorkingMemory } from '$lib/engine/memory';

let upcoming = $state<Reminder[]>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let onReminderFired: ((reminder: Reminder) => void) | null = null;

async function loadUpcoming() {
	const sessionId = getWorkingMemory().currentSessionId;
	if (!sessionId) {
		upcoming = [];
		return;
	}

	const now = new Date();
	const items = await db.reminders
		.where('sessionId')
		.equals(sessionId)
		.and((r) => !r.executed && r.triggerAt > now)
		.toArray();

	items.sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());
	upcoming = items;
}

async function checkReminders() {
	const sessionId = getWorkingMemory().currentSessionId;
	if (!sessionId) return;

	const now = new Date();
	const due = await db.reminders
		.where('sessionId')
		.equals(sessionId)
		.and((r) => !r.executed && r.triggerAt <= now)
		.toArray();

	for (const reminder of due) {
		if (reminder.id !== undefined) {
			await db.reminders.update(reminder.id, { executed: true });
		}
		onReminderFired?.(reminder);
	}

	await loadUpcoming();
}

export function startPolling() {
	if (!browser || pollTimer) return;
	pollTimer = setInterval(() => {
		checkReminders().catch((e) => console.error('[Reminders] Poll error:', e));
	}, 10000);
	checkReminders().catch((e) => console.error('[Reminders] Initial check error:', e));
}

export function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

export function setOnReminderFired(callback: ((reminder: Reminder) => void) | null) {
	onReminderFired = callback;
}

export async function addReminder(
	content: string,
	triggerAt: Date,
	sessionId: number
): Promise<Reminder> {
	const id = await db.reminders.add({
		content,
		triggerAt,
		sessionId,
		executed: false,
		createdAt: new Date()
	});
	const reminder = await db.reminders.get(id);
	if (!reminder) throw new Error('Failed to create reminder');
	await loadUpcoming();
	return reminder as Reminder;
}

export async function deleteReminder(id: number) {
	await db.reminders.delete(id);
	await loadUpcoming();
}

export const reminderStore = {
	get upcoming() {
		return upcoming;
	},
	startPolling,
	stopPolling,
	setOnReminderFired,
	addReminder,
	deleteReminder
};
