# Trip planner example

A road trip planner built with [SvelteKit](https://svelte.dev/docs/kit) and [LangGraph.js](https://github.com/langchain-ai/langgraphjs). Enter two places and it plans a driving trip between them, with one stop for each day.

The planner:

1. Finds the driving route and the towns along it, then chooses where each day ends so that no day has more than 400 km of driving.
2. Researches each stop: a Wikipedia summary, nearby attractions and the weather forecast.
3. Writes a day-by-day plan in Markdown, which the page shows.

It uses free public APIs that need no key: [Nominatim](https://nominatim.org) and [OSRM](https://project-osrm.org) for places and routes, [Wikipedia](https://www.mediawiki.org/wiki/API:Main_page) for research and [Open-Meteo](https://open-meteo.com) for weather. The model runs on [Together AI](https://www.together.ai).

## How it fits together

The page and the agent are one SvelteKit app. The agent runs in the server routes, so the Together key never reaches the browser.

| Path                                   | What it does                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| `src/routes/+page.svelte`              | The form and the plan                                                |
| `src/routes/api/plans/+server.ts`      | `POST` starts a plan in the background and returns its ID            |
| `src/routes/api/plans/[id]/+server.ts` | `GET` returns the plan's status, and its Markdown and HTML when done |
| `src/lib/server/graph.ts`              | The LangGraph graph                                                  |
| `src/lib/server/tools.ts`              | The tools the agents call                                            |
| `src/lib/server/plans.ts`              | Keeps plans in memory and renders their Markdown                     |

A plan takes a few minutes, so the page polls until it is done. Plans are kept in memory and lost when the server restarts. At most 3 plans run at once, to limit model spend.

## Graph

```
START -> plan_route -> research_stops -> draft_itinerary -> END
```

| Node              | What it does                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `plan_route`      | An agent with the `geocode`, `get_route` and `find_towns_along_route` tools picks the stops                   |
| `research_stops`  | An agent with the `wikipedia_summary`, `nearby_attractions` and `weather_forecast` tools researches each stop |
| `draft_itinerary` | A model call writes the plan from the stops and research                                                      |

## Run it locally

You need Node 24 and a Together AI API key.

```sh
npm install
cp .env.example .env   # then set TOGETHER_API_KEY
npm run dev
```

Then open http://localhost:5173.

| Variable           | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| `TOGETHER_API_KEY` | Together AI API key                                                                     |
| `TOGETHER_MODEL`   | Together AI model, `moonshotai/Kimi-K3` by default. The model must support tool calling |

## Deploy to Render

`render.yaml` describes the web service. In Render, create a new Blueprint from this repository and enter `TOGETHER_API_KEY` when asked.

## Checks

```sh
npm test
npm run check
npm run lint
```
