/**
 * The trip planner LangGraph graph.
 *
 * START -> plan_route -> research_stops -> draft_itinerary -> END
 *
 * Every model call sends the node's task as the system message and the trip
 * request as the only human message.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { createAgent, toolStrategy } from 'langchain';
import { z } from 'zod';
import { RESEARCH_TOOLS, ROUTE_TOOLS } from './tools';

export const DAILY_DRIVING_LIMIT_KM = 400;

const Stop = z.object({
	name: z.string(),
	lat: z.number(),
	lon: z.number(),
	km_from_start: z.number()
});

const RoutePlan = z.object({
	distance_km: z.number(),
	duration_hours: z.number(),
	stops: z.array(Stop).describe('One stop per day in driving order, ending at the destination')
});

const StopResearch = z.object({
	name: z.string(),
	summary: z.string().describe('Two or three sentences about the place'),
	attractions: z.array(z.string()).describe('Places worth visiting nearby'),
	weather: z.string().describe('One sentence on the forecast')
});

type Stop = z.infer<typeof Stop>;
type StopResearch = z.infer<typeof StopResearch>;

const TripState = Annotation.Root({
	messages: Annotation<BaseMessage[]>,
	origin: Annotation<string>,
	destination: Annotation<string>,
	route: Annotation<{ distance_km: number; duration_hours: number }>,
	stops: Annotation<Stop[]>,
	research: Annotation<Record<string, StopResearch>>,
	plan: Annotation<string>
});

type TripState = typeof TripState.State;

const ROUTE_PROMPT = (origin: string, destination: string) => `\
Plan the driving route for a road trip from ${origin} to ${destination}.

1. Geocode the origin and the destination.
2. Get the route between them.
3. Find the towns along the route.
4. Choose where each day of the trip ends, in driving order. No day may have \
more than ${DAILY_DRIVING_LIMIT_KM} km of driving, so use as few days as that \
allows. The last stop must be the destination. Use only towns returned by the \
tools, plus the destination.`;

const RESEARCH_PROMPT = ({ name, lat, lon }: Stop) => `\
Research ${name} (lat ${lat}, lon ${lon}) as a stop on a road trip.

Use the Wikipedia summary, the nearby attractions and the weather forecast. \
Report only what the tools returned.`;

const DRAFT_PROMPT = (state: TripState) => {
	const { origin, destination } = state;
	const days = state.stops.length;
	return `\
Write a ${days}-day road trip plan from ${origin} to ${destination} in Markdown.

Use exactly this structure:

# ${origin} to ${destination}

One short paragraph that sums up the trip.

## Day 1: <start town> to <end town>

Driving: <km> km

Then a few bullet points on what to see and do.

Repeat the day section for every day, numbered from 1 to ${days}. Day N ends \
at stop N below, so the last day ends at ${destination}. Work out each day's \
driving from the stops' km_from_start values. Put only stop names in **bold**, \
and mention at least one stop in bold in each day. Use only the facts in the \
research notes.

Stops, in driving order:
${JSON.stringify(state.stops, null, 2)}

Research notes:
${JSON.stringify(state.research, null, 2)}`;
};

/** The trip request as the user would say it. */
export function requestMessage(origin: string, destination: string): HumanMessage {
	return new HumanMessage(`Plan a road trip from ${origin} to ${destination}.`);
}

/**
 * Build and compile the trip planner graph.
 *
 * The graph takes `origin`, `destination` and `messages` (made with
 * `requestMessage`) and returns the plan as Markdown in `plan`.
 */
export function buildGraph(model: BaseChatModel) {
	async function planRoute(state: TripState, config: RunnableConfig) {
		const agent = createAgent({
			model,
			tools: ROUTE_TOOLS,
			systemPrompt: ROUTE_PROMPT(state.origin, state.destination),
			responseFormat: toolStrategy(RoutePlan)
		});
		const result = await agent.invoke({ messages: [state.messages[0]] }, config);
		const { distance_km, duration_hours, stops } = result.structuredResponse;
		return { route: { distance_km, duration_hours }, stops };
	}

	async function researchStops(state: TripState, config: RunnableConfig) {
		const research: Record<string, StopResearch> = {};
		for (const stop of state.stops) {
			const agent = createAgent({
				model,
				tools: RESEARCH_TOOLS,
				systemPrompt: RESEARCH_PROMPT(stop),
				responseFormat: toolStrategy(StopResearch)
			});
			const result = await agent.invoke({ messages: [state.messages[0]] }, config);
			research[stop.name] = result.structuredResponse;
		}
		return { research };
	}

	async function draftItinerary(state: TripState, config: RunnableConfig) {
		const response = await model.invoke(
			[new SystemMessage(DRAFT_PROMPT(state)), state.messages[0]],
			config
		);
		return { plan: response.text };
	}

	return new StateGraph(TripState)
		.addNode('plan_route', planRoute)
		.addNode('research_stops', researchStops)
		.addNode('draft_itinerary', draftItinerary)
		.addEdge(START, 'plan_route')
		.addEdge('plan_route', 'research_stops')
		.addEdge('research_stops', 'draft_itinerary')
		.addEdge('draft_itinerary', END)
		.compile();
}
