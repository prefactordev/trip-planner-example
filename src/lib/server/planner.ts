import { TOGETHER_API_KEY, TOGETHER_MODEL } from '$app/env/private';
import { ChatOpenAI } from '@langchain/openai';
import { buildGraph, requestMessage } from './graph';
import { PlanStore } from './plans';

const TOGETHER_API_URL = 'https://api.together.xyz/v1';

/** Plan a road trip between two places and return it as Markdown. */
async function planTrip(origin: string, destination: string): Promise<string> {
	if (!TOGETHER_API_KEY) throw new Error('TOGETHER_API_KEY is not set');
	const model = new ChatOpenAI({
		model: TOGETHER_MODEL,
		apiKey: TOGETHER_API_KEY,
		configuration: { baseURL: TOGETHER_API_URL },
		maxTokens: 8000
	});
	const state = await buildGraph(model).invoke({
		origin,
		destination,
		messages: [requestMessage(origin, destination)]
	});
	return state.plan;
}

export const plans = new PlanStore(planTrip);
