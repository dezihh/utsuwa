import type { ModuleDefinition } from '$lib/types/module';

export const speechModule: ModuleDefinition = {
	metadata: {
		id: 'speech',
		name: 'Speech',
		description: 'Text-to-Speech for voice output',
		category: 'essential',
		icon: 'volume'
	},

	settingsSchema: {
		fields: [
			{
				key: 'activeProvider',
				type: 'provider-select',
				label: 'TTS Provider',
				description: 'Select from your configured TTS providers',
				providerCategory: 'tts',
				defaultValue: ''
			},
			{
				key: 'activeModel',
				type: 'model-select',
				label: 'Model',
				description: 'Select a TTS model from the chosen provider',
				dependsOnField: 'activeProvider',
				providerCategory: 'tts'
			},
			{
				key: 'activeVoiceId',
				type: 'text',
				label: 'Voice ID',
				description: 'Voice identifier for the selected provider',
				placeholder: 'Select a voice'
			},
			{
				key: 'instructions',
				type: 'text',
				label: 'Voice Instructions',
				description: 'Voice design instructions (e.g. "female, british accent")',
				placeholder: 'e.g. female, british accent, young adult',
				defaultValue: ''
			},
			{
				key: 'altInstructions',
				type: 'text',
				label: 'Alternative Voice Instructions',
				description: 'Voice design instructions for the alternative language',
				placeholder: 'e.g. male, middle-aged',
				defaultValue: ''
			},
			{
				key: 'speed',
				type: 'number',
				label: 'Speed',
				description: 'Speech rate (0.5-2.0)',
				defaultValue: 1.0
			},
			{
				key: 'primaryLanguage',
				type: 'text',
				label: 'Primary Language',
				description: 'Default spoken language (ISO 639-1 code: de, en, es, fr, ...)',
				placeholder: 'en',
				defaultValue: ''
			},
			{
				key: 'enableAltLanguage',
				type: 'boolean',
				label: 'Enable Alternative Language',
				description: 'Use a different voice for foreign-language text',
				defaultValue: false
			},
			{
				key: 'altLanguage',
				type: 'text',
				label: 'Alternative Language',
				description: 'ISO 639-1 code for the alternative language',
				placeholder: 'es',
				defaultValue: ''
			},
			{
				key: 'altVoiceId',
				type: 'text',
				label: 'Alternative Voice',
				description: 'Voice ID for the alternative language',
				placeholder: 'Select a voice',
				defaultValue: ''
			},
			{
				key: 'numStep',
				type: 'number',
				label: 'Diffusion Steps',
				description: 'Quality vs speed (4-64, default 32). Higher = better quality, slower.',
				defaultValue: 32
			},
			{
				key: 'positionTemperature',
				type: 'number',
				label: 'Voice Diversity',
				description: 'Voice variation (0-10, default 5). 0 = deterministic.',
				defaultValue: 5
			},
			{
				key: 'classTemperature',
				type: 'number',
				label: 'Token Temperature',
				description: 'Token sampling (0-2, default 0). Higher = more variation.',
				defaultValue: 0
			}
		]
	},

	isConfigured(settings: Record<string, unknown>): boolean {
		// Speech is configured if a provider is selected
		// Some providers (like browser TTS) don't require voice ID
		return !!settings.activeProvider;
	},

	async onEnable() {
	},

	async onDisable() {
	},

	onSettingsChange(settings: Record<string, unknown>) {
	}
};
