# Trip planner

A command-line agent that plans a road trip between two places, with a guide to demonstrating it in Prefactor.

Give the agent a start and an end. It finds a driving route, chooses towns to stop at, looks up things to see, the weather and places to stay, and writes a day-by-day plan. Prefactor judges review each draft before the agent hands it over. When a judge fails a draft, the agent rewrites it using the judge's explanation. Prefactor records every step of the run, so you can follow what the agent did and read why each judge passed or failed the plan.

For more about agents, runs and quality in Prefactor, see the [Prefactor docs](https://docs.prefactor.ai).

The agent uses these free public services:

- [OpenStreetMap](https://www.openstreetmap.org/) for places, towns along the route and places to stay
- [OSRM](https://project-osrm.org/) for driving routes
- [Wikipedia](https://www.wikipedia.org/) for place summaries and nearby attractions
- [Open-Meteo](https://open-meteo.com/) for weather forecasts

## Requirements

- [uv](https://docs.astral.sh/uv/) and Python 3.11 or later
- an [Anthropic API key](https://platform.claude.com/) and a Claude model that supports tool calling
- a Prefactor account at [app.prefactorai.com](https://app.prefactorai.com)

## Set up

Do these steps once. Run each command in a terminal, from this folder. The `prefactor` commands in steps 3 to 5 print their result as JSON, except `prefactor setup`. Where a step asks for an ID, copy the `id` value from the `details` part of the result, and use it in place of the matching `<...>` in a later command.

### 1. Install the Prefactor CLI and sign in

```bash
curl -fsSL https://prefactor.tech/install.sh | bash
prefactor login
```

`prefactor login` opens the Prefactor sign-in page in your browser. After you sign in, paste the API token it shows into the terminal. For Windows, see [Getting started with the CLI](https://docs.prefactor.ai/cli/getting-started).

### 2. Set the model

```bash
uv sync
cp .env.example .env
```

Fill in the model settings in `.env`:

| Setting | Value |
|---|---|
| `LLM_API_KEY` | your Anthropic API key |
| `LLM_MODEL` | the Claude model name, for example `claude-sonnet-5-5`; the model must support tool calling |

### 3. Create the agent

```bash
prefactor setup --create --name "Trip planner"
```

This creates the agent and a deployment for it, and prints some settings. Copy the `PREFACTOR_API_URL`, `PREFACTOR_API_TOKEN`, and `PREFACTOR_AGENT_ID` lines into `.env`.

`PREFACTOR_API_TOKEN` is a deployment token for this agent. The trip planner uses it to record the run and to ask the judges to review each draft.

### 4. Add a model for the judges

Judges run inside Prefactor, so Prefactor needs a model provider of its own. Add Anthropic, using the `LLM_API_KEY` from `.env`:

```bash
prefactor llm_providers create --name "Trip planner models" --provider anthropic \
  --api_key <LLM_API_KEY>
```

Then add a model for the judges, using the provider ID from the result:

```bash
prefactor llm_provider_models create --llm_provider_id <provider_id> \
  --api_name claude-haiku-5-5
```

Claude Haiku 5.5 is a fast model, which suits a judge that reads the whole record of a run. Keep the model ID from the result for step 5.

If Prefactor already has an Anthropic provider you want to use, find a model ID with `prefactor llm_providers list` and `prefactor llm_provider_models list --llm_provider_id <provider_id>` instead.

### 5. Create the judges

The [`judges/`](judges/) folder holds one criterion for each judge, and the [judges table](#judges) gives each judge's name. Each judge takes three commands. For the rules judge:

```bash
prefactor judges create --name "Trip plan rules"
prefactor judges create_version --agent_id <judge_id> \
  --hosted_llm_provider_model_id <model_id> --criterion @judges/rules.md
prefactor agent_associations create --from_agent_id <judge_id> --to_agent_id <agent_id> \
  --association_type judge --trigger on_completion
```

1. `judges create` creates the judge. Use the judge ID from its result in the next two commands.
2. `judges create_version` gives the judge its criterion and the model from step 4.
3. `agent_associations create` adds the judge to the Trip planner agent, using the `PREFACTOR_AGENT_ID` from step 3.

Repeat the three commands for each judge you want, with its name and criterion file. To change what a judge checks, edit its criterion before you create it. For more about judges, see [Set up a judge](https://docs.prefactor.ai/cli/judges).

The agent asks every judge added to it to review each draft during the run. The `on_completion` trigger makes each judge review the run once more after it finishes.

Alternatively, you can set up steps 4 and 5 in the web app at [app.prefactorai.com](https://app.prefactorai.com):

1. In **Account settings**, open **LLM providers**, add Anthropic, and add Claude Haiku 5.5 to it.
2. Open **Judges**, choose **Register judge**, and enter the judge's name.
3. On the judge's page, choose **Create judge**, select the model, choose **Write your own**, paste the criterion file into **Criterion**, and choose **Create judge**.
4. Open the Trip planner agent. On the **Overview** tab, in the **Judges** box, choose **Add judge**, choose the judge, and set **Trigger** to **On completion**.

Repeat the last three steps for each judge.

## Judges

| Judge | Criterion | Fails the plan when |
|---|---|---|
| Trip plan rules | [`rules.md`](judges/rules.md) | the plan does not start and end where asked, has the wrong number of days, stops somewhere off the route, has a day with more than 400 km of driving, or gives a date or weather that does not match the forecast |
| Trip plan accommodation | [`accommodation.md`](judges/accommodation.md) | a night has nowhere to stay, names a place to stay that the agent did not find near that stop, or links a website that does not load |
| Trip plan hallucination | [`hallucination.md`](judges/hallucination.md) | the plan states something about a place that the agent did not look up |
| Trip plan locations | [`locations.md`](judges/locations.md) | a place could not be found, was mistaken for another place, or cannot be reached by road, and the plan does not say so |
| Trip worth taking | [`worth_taking.md`](judges/worth_taking.md) | the trip is a poor idea as asked and the plan does not warn the traveller; a trip is a poor idea when it needs more than 400 km or less than 250 km of driving a day, when rain is likely on most days, when the weather is extreme, or when there are few places to stop or stay |
| Trip plan makes sense | [`makes_sense.md`](judges/makes_sense.md) | the plan suggests something a traveller would not choose to do, such as visiting a hospital, a prison or a plain railway station, or filler such as "stock up on food" |

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
| The terminal shows a score of 0 and no judges | No judges are added to the agent. Follow step 5 |
| The run fails at the start with an error about the agent | Check `PREFACTOR_AGENT_ID`, and check that `PREFACTOR_API_TOKEN` is the deployment token from step 3 |
| A route lookup fails | The public map and routing services are sometimes slow or unavailable. Wait a minute and try again |
