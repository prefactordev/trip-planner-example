# Trip planner

A command-line agent that plans a road trip between two places, with a guide to demonstrating it in Prefactor.

Give the agent a start and an end. It finds a driving route, chooses towns to stop at, looks up things to see, the weather and places to stay, and writes a day-by-day plan. Prefactor judges review each draft before the agent hands it over. When a judge fails a draft, the agent rewrites it using the judge's explanation. Prefactor records every step of the run, so you can follow what the agent did and read why each judge passed or failed the plan.

For more about agents, runs and quality in Prefactor, see the [Prefactor docs](https://docs.prefactor.tech).

The agent uses these free public services:

- [OpenStreetMap](https://www.openstreetmap.org/) for places, towns along the route and places to stay
- [OSRM](https://project-osrm.org/) for driving routes
- [Wikipedia](https://www.wikipedia.org/) for place summaries and nearby attractions
- [Open-Meteo](https://open-meteo.com/) for weather forecasts

## Requirements

- [uv](https://docs.astral.sh/uv/) and Python 3.11 or later
- an API key for a model provider with an OpenAI-compatible API, such as [Together AI](https://docs.together.ai/docs/openai-api-compatibility), and a model there that supports tool calling
- a Prefactor account at [app.prefactorai.com](https://app.prefactorai.com)

## Set up Prefactor

Do these steps once, at [app.prefactorai.com](https://app.prefactorai.com).

### 1. Register the agent

1. Open **Agents** and choose **Register agent**.
2. Name the agent "Trip planner" and choose **Register agent**.
3. Open the agent and copy its ID from the header.

### 2. Copy an environment ID and create an API token

1. Open **Account settings**, then **Environments**, and copy the ID of the environment to run the agent in.
2. In **Account settings**, open **API tokens** and create a token. Copy the token now, because Prefactor shows it only once.

### 3. Add a model for the judges

Judges need a language model. In **Account settings**, open **LLM providers**, add a provider with its API key, then add a model to that provider. Choose a fast model, such as GLM-5.3 Flash on Together AI, because each judge reads the whole record of a run.

### 4. Create the judges

The [`judges/`](judges/) folder holds one criterion for each judge. For each file:

1. Open **Judges** and choose **Register judge**.
2. Enter the judge's name from the [judges table](#judges) and choose **Register judge**.
3. On the judge's page, choose **Create judge**.
4. Select the model from step 3, choose **Write your own**, paste the contents of the file into **Criterion**, and choose **Create judge**.

Leave out any judge you do not need for your demo, or edit a criterion to change what the judge checks.

### 5. Add the judges to the agent

1. Open the Trip planner agent.
2. On the **Overview** tab, in the **Judges** box, choose **Add judge**.
3. Choose a judge, set **Trigger** to **On completion**, and add it.
4. Repeat for each judge.

The agent asks every judge added to it to review each draft during the run. The **On completion** trigger makes each judge review the run once more after it finishes.

## Judges

| Judge | Criterion | Fails the plan when |
|---|---|---|
| Trip plan rules | [`rules.md`](judges/rules.md) | the plan does not start and end where asked, has the wrong number of days, stops somewhere off the route, has a day with more than 400 km of driving, or gives a date or weather that does not match the forecast |
| Trip plan accommodation | [`accommodation.md`](judges/accommodation.md) | a night has nowhere to stay, names a place to stay that the agent did not find near that stop, or links a website that does not load |
| Trip plan hallucination | [`hallucination.md`](judges/hallucination.md) | the plan states something about a place that the agent did not look up |
| Trip plan locations | [`locations.md`](judges/locations.md) | a place could not be found, was mistaken for another place, or cannot be reached by road, and the plan does not say so |
| Trip worth taking | [`worth_taking.md`](judges/worth_taking.md) | the trip is a poor idea as asked and the plan does not warn the traveller; a trip is a poor idea when it needs more than 400 km or less than 250 km of driving a day, when rain is likely on most days, when the weather is extreme, or when there are few places to stop or stay |
| Trip plan makes sense | [`makes_sense.md`](judges/makes_sense.md) | the plan suggests something a traveller would not choose to do, such as visiting a hospital, a prison or a plain railway station, or filler such as "stock up on food" |

## Set up the trip planner

```bash
uv sync
cp .env.example .env
```

Fill in `.env`:

| Setting | Value |
|---|---|
| `OPENAI_BASE_URL` | the base URL of your provider's OpenAI-compatible API, for example `https://api.together.ai/v1` for Together AI |
| `OPENAI_API_KEY` | your API key for that provider |
| `OPENAI_MODEL` | the model name, for example `moonshotai/Kimi-K3` on Together AI; the model must support tool calling |
| `PREFACTOR_API_URL` | `https://app.prefactorai.com` |
| `PREFACTOR_API_TOKEN` | the API token from step 2 |
| `PREFACTOR_AGENT_ID` | the agent ID from step 1 |
| `PREFACTOR_ENVIRONMENT_ID` | the environment ID from step 2 |

## Plan a trip

```bash
uv run --env-file .env python main.py Melbourne Adelaide
uv run --env-file .env python main.py "San Francisco" "Los Angeles" --days 3
```

Without `--days`, the agent plans the fewest days that keep each day to 400 km of driving or less.

A run takes a few minutes. When it finishes, the terminal shows the plan and each judge's verdict on the final draft, and the agent saves the plan as a Markdown file in `out/`.

Each plan has:

- a short summary
- a "Before you go" note, when the trip is a poor idea as asked or cannot be done
- an "At a glance" list with the date, route, driving distance, weather and place to stay for each day
- a section for each day, with things to see and do and up to two places to stay

## Review a run in Prefactor

Open the Trip planner agent. Prefactor lists each run under the agent's instances. Open a run.

The **Activity** tab shows the run as a conversation:

- the request, as the user's message
- each step of the agent in order: reading the request, planning the route, researching each stop, writing the plan and asking the judges
- under each step, the model's messages and reasoning, each lookup and its result
- the plan, as the agent's reply

The **Quality** tab shows:

- a "Trip plan quality" score out of 100 for each draft, with each judge's verdict and explanation
- each judge's latest verdict, with a link to the judge's own run

## Run a demo

These trips each show a different behaviour. To run several at once, use a separate terminal for each. Start each command with `uv run --env-file .env python`.

| Command | What to show |
|---|---|
| `main.py Melbourne Adelaide` | an ordinary trip that every judge passes, often on the first draft |
| `main.py Melbourne Brisbane` | a long trip with more days and stops, and a place to stay each night |
| `main.py Sydney Perth --days 1` | a trip with too much driving for one day; the plan warns about it, and the "Trip worth taking" judge checks the warning |
| `main.py Melbourne Manila` | a trip with no road between the places; the agent writes a short note explaining why instead of a plan |
| `main.py Melbourne Xyzzyville` | a place that does not exist; the agent says it could not find it, and the "Trip plan locations" judge checks that |

When a judge fails a draft, read its explanation on the **Quality** tab, then follow the agent's rewrite on the **Activity** tab. The agent writes at most 3 drafts. If the third draft still fails, the agent saves it and the terminal shows which judges failed it.

## Run the evals

`run_evals.py` plans three fixed trips one after another and reports whether each final plan passed:

```bash
uv run --env-file .env python run_evals.py
```

The script exits with status 1 if any plan fails, so you can run it in CI. Prefactor labels these runs as evals in the agent's instances, to keep them apart from other runs.

## Fix common problems

| Problem | Fix |
|---|---|
| A run stops with a timeout or a "service unavailable" error from the model provider | The model is busy. The agent retries a few times; if the run still fails, start it again |
| The terminal shows a score of 0 and no judges | No judges are added to the agent. Follow steps 4 and 5 |
| The run fails at the start with an error about the agent or environment | Check `PREFACTOR_AGENT_ID` and `PREFACTOR_ENVIRONMENT_ID`, and check that the API token is from the same account |
| A route lookup fails | The public map and routing services are sometimes slow or unavailable. Wait a minute and try again |
