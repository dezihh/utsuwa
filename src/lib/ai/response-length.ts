export type ResponseLengthMode = 'brief' | 'longform' | 'balanced';

export function inferResponseLengthMode(userMessage: string): ResponseLengthMode {
	const message = userMessage.toLowerCase();

	const briefHints = [
		'kurz',
		'brief',
		'concise',
		'one sentence',
		'eine satz',
		'ein satz',
		'in 1',
		'knapp'
	];
	if (briefHints.some((hint) => message.includes(hint))) return 'brief';

	const longformHints = [
		'geschichte',
		'story',
		'write',
		'write me',
		'tell me',
		'erzäh',
		'erzae',
		'ausführ',
		'ausfuehr',
		'detail',
		'detailed',
		'explain',
		'erkl',
		'bericht',
		'zusammenhäng',
		'zusammenhaeng'
	];
	if (longformHints.some((hint) => message.includes(hint))) return 'longform';

	return 'balanced';
}
