import { db, type DBCompletedEvent } from '$lib/db';
import type { CompletedEventRecord } from '$lib/types/events';

const DEFAULT_CHARACTER_ID = 'default';

export async function getCompletedEvents(
	options: { eventId?: string; limit?: number; characterId?: string } = {}
): Promise<CompletedEventRecord[]> {
	let events: DBCompletedEvent[];

	if (options.eventId) {
		events = await db.completedEvents.where('eventId').equals(options.eventId).toArray();
	} else {
		events = await db.completedEvents.toArray();
	}

	// Filter by characterId
	if (options.characterId) {
		events = events.filter((e) => e.characterId === options.characterId);
	}

	// Sort by completedAt descending (most recent first)
	events.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

	if (options.limit) {
		events = events.slice(0, options.limit);
	}

	return events.map(deserializeEvent);
}

export async function saveCompletedEvent(
	event: Omit<CompletedEventRecord, 'id'> & { characterId?: string }
): Promise<number> {
	const dbEvent: Omit<DBCompletedEvent, 'id'> = {
		...event,
		characterId: event.characterId ?? DEFAULT_CHARACTER_ID,
		completedAt: new Date(event.completedAt)
	};

	const id = await db.completedEvents.add(dbEvent);
	return id as number;
}

export async function isEventCompleted(eventId: string): Promise<boolean> {
	const count = await db.completedEvents.where('eventId').equals(eventId).count();
	return count > 0;
}

export async function getCompletedEventById(id: number): Promise<CompletedEventRecord | null> {
	const event = await db.completedEvents.get(id);
	if (!event) return null;
	return deserializeEvent(event);
}

export async function deleteAllEvents(): Promise<void> {
	await db.completedEvents.clear();
}

function deserializeEvent(event: DBCompletedEvent): CompletedEventRecord {
	return {
		...event,
		completedAt: new Date(event.completedAt)
	};
}
