import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	TOGETHER_API_KEY: {
		description: 'Together AI API key. Optional at build time; planning fails without it',
		schema: (value) => value
	},
	TOGETHER_MODEL: {
		description: 'Together AI model. It must support tool calling',
		schema: (value) => value || 'moonshotai/Kimi-K3'
	}
});
