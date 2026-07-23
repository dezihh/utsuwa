import test from 'node:test';
import assert from 'node:assert/strict';

import { getFocusableElements, handleModalKeydown } from './tts-modal-a11y.ts';

function fakeEl(tag: string, disabled = false) {
	return {
		tagName: tag.toUpperCase(),
		hasAttribute: (name: string) => name === 'disabled' && disabled,
		focus: () => {}
	} as unknown as HTMLElement;
}

function fakeContainer(children: HTMLElement[]) {
	return { querySelectorAll: () => children } as unknown as HTMLElement;
}

function fakeKeyEvent(key: string, shiftKey = false) {
	const e = {
		key,
		shiftKey,
		prevented: false,
		preventDefault: () => {
			e.prevented = true;
		}
	} as unknown as KeyboardEvent & { prevented: boolean };
	return e;
}

test('getFocusableElements returns enabled focusable children', () => {
	const btn = fakeEl('button', false);
	const disabledBtn = fakeEl('button', true);
	const input = fakeEl('input', false);
	const container = fakeContainer([btn, disabledBtn, input]);
	assert.deepEqual(getFocusableElements(container), [btn, input]);
});

test('getFocusableElements returns empty array for empty container', () => {
	assert.deepEqual(getFocusableElements(fakeContainer([])), []);
});

test('Escape prevents default and calls onClose', () => {
	const e = fakeKeyEvent('Escape');
	let closed = false;
	handleModalKeydown(e, [], null, () => {
		closed = true;
	});
	assert.equal(closed, true);
	assert.equal(e.prevented, true);
});

test('Tab on last element wraps focus to first', () => {
	const first = { ...fakeEl('button'), focus: () => {} } as HTMLElement & {
		focused?: string;
	};
	const last = { ...fakeEl('input'), focus: () => {} } as HTMLElement & {
		focused?: string;
	};
	let focused: string | null = null;
	first.focus = () => {
		focused = 'first';
	};
	last.focus = () => {
		focused = 'last';
	};

	const e = fakeKeyEvent('Tab', false);
	handleModalKeydown(e, [first, last], last, () => {});
	assert.equal(e.prevented, true);
	assert.equal(focused, 'first');
});

test('Shift+Tab on first element wraps focus to last', () => {
	const first = { ...fakeEl('button'), focus: () => {} } as HTMLElement & {
		focused?: string;
	};
	const last = { ...fakeEl('input'), focus: () => {} } as HTMLElement & {
		focused?: string;
	};
	let focused: string | null = null;
	first.focus = () => {
		focused = 'first';
	};
	last.focus = () => {
		focused = 'last';
	};

	const e = fakeKeyEvent('Tab', true);
	handleModalKeydown(e, [first, last], first, () => {});
	assert.equal(e.prevented, true);
	assert.equal(focused, 'last');
});

test('Tab in the middle of focus order does nothing', () => {
	const a = fakeEl('button');
	const b = fakeEl('input');
	const c = fakeEl('button');
	const e = fakeKeyEvent('Tab', false);
	handleModalKeydown(e, [a, b, c], b, () => {});
	assert.equal(e.prevented, false);
});

test('non-Tab keys are ignored', () => {
	const e = fakeKeyEvent('ArrowDown');
	let closed = false;
	handleModalKeydown(e, [fakeEl('button')], null, () => {
		closed = true;
	});
	assert.equal(e.prevented, false);
	assert.equal(closed, false);
});
