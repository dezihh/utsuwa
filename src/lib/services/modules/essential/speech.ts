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
				key: 'speed',
				type: 'number',
				label: 'Speed',
				description: 'Speech rate (0.5-2.0)',
				defaultValue: 1.0
			},
			{
				key: 'language',
				type: 'text',
				label: 'Primary language',
				description: 'Default language for multilingual TTS (ISO 639-1 code, e.g. en, de, es)',
				defaultValue: 'en'
			},
			{
				key: 'enableAltLanguage',
				type: 'boolean',
				label: 'Enable alternative language',
				description: 'Switch to a second voice when the model wraps text in <lang=xx> tags',
				defaultValue: false
			},
			{
				key: 'altLanguage',
				type: 'text',
				label: 'Alternative language',
				description: 'ISO 639-1 code that triggers the alternative voice',
				dependsOnField: 'enableAltLanguage'
			},
			{
				key: 'altVoiceId',
				type: 'text',
				label: 'Alternative voice',
				description: 'Voice to use for the alternative language',
				dependsOnField: 'enableAltLanguage'
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
