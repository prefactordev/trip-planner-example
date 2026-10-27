# Trip planner

A command-line agent that plans a road trip between two places, and a guide to demonstrating it with Prefactor.

You give it a start and an end point. It finds a driving route, picks towns to stop at, looks up things to see, the weather and places to stay, and writes a day-by-day plan. Before it hands the plan over, a set of Prefactor judges review it. If a judge finds a problem, such as a made-up attraction or a day with too much driving, the agent rewrites the plan with the judge's feedback. Every step it takes is recorded in Prefactor, so you can follow the whole run and see why each judge passed or failed the plan.

The agent uses free public data:

- [OpenStreetMap](https://www.openstreetmap.org/) for places, towns along the route and places to stay
- [OSRM](https://project-osrm.org/) for driving routes
- [Wikipedia](https://www.wikipedia.org/) for place summaries and nearby attractions
- [Open-Meteo](https://open-meteo.com/) for weather forecasts

## What you need

- [uv](https://docs.astral.sh/uv/) and Python 3.11 or later
- A [Together AI](https://www.together.ai/) API key. The agent uses the Kimi K3 model by default.
- A Prefactor account

## Set up Prefactor

Do these steps once, in the Prefactor app.

### 1. Register the agent

1. Open **Agents** and choose **Register agent**.
2. Name it "Trip planner" and register it.
3. Copy the agent ID. It is the last part of the agent page's address, after `/agents/`.

### 2. Get an environment ID and an API token

1. Open **Account settings**, then **Environments**, and copy the ID of the environment the trip planner should run in.
2. In **Account settings**, open **API token** and create a token. Copy it, because you will not be able to see it again.

### 3. Add a language model for the judges

Judges need a model to run on. In **Account settings**, open **LLM providers**, add a provider with its API key, and add a model to it. Together AI with Kimi K3 works, but you can use any provider and model.

### 4. Create the judges

The [`judges/`](judges/) folder has one criterion for each judge. Create a judge for each file:

1. Open **Judges** and choose **Register judge**. Give it the name from the table below.
2. On the judge's page, choose **Create judge**, select the model from step 3, choose **Write your own**, and paste the contents of the file into **Criterion**.

| Judge | File | Fails the plan when |
|---|---|---|
| Trip plan rules | [`rules.md`](judges/rules.md) | The plan does not start and end where asked, has the wrong number of days, stops somewhere that is not on the route, has a day with more than 400 km of driving, or gives a date or weather that does not match the forecast |
| Trip plan accommodation | [`accommodation.md`](judges/accommodation.md) | A night has nowhere to stay, or names a place to stay that was not found near that stop, or links a website that does not load |
| Trip plan hallucination | [`hallucination.md`](judges/hallucination.md) | The plan states something about a place that the agent did not look up |
| Trip plan locations | [`locations.md`](judges/locations.md) | A place could not be found, was mistaken for another place, or cannot be reached by road, and the plan does not say so |
| Trip worth taking | [`worth_taking.md`](judges/worth_taking.md) | The trip is a poor idea as asked and the plan does not warn the traveller. A trip is a poor idea when it needs more than 400 km of driving a day or less than 250 km a day, when rain is likely on most days, when the weather is extreme, or when there are few places to stop or stay |
| Trip plan makes sense | [`makes_sense.md`](judges/makes_sense.md) | The plan suggests something a traveller would not choose to do, such as visiting a hospital, a prison or a plain railway station, or filler such as "stock up on food" |

You can leave out any judge you do not want to show, and you can change a criterion to suit your demo.

### 5. Attach the judges to the agent

1. Open the Trip planner agent.
2. On the **Overview** tab, in the **Judges** box, choose **Add judge**.
3. Pick a judge and set **Trigger** to **On completion**.
4. Repeat for each judge.

The agent asks every attached judge to review each draft while it runs. With the trigger set to **On completion**, each judge also reviews the run once it has finished.

## Set up the trip planner

```bash
uv sync
cp .env.example .env
```

Fill in `.env`:

| Setting | What to put |
|---|---|
| `TOGETHER_API_KEY` | Your Together AI API key |
| `PREFACTOR_API_URL` | The address of your Prefactor app |
| `PREFACTOR_API_TOKEN` | The API token from step 2 |
| `PREFACTOR_AGENT_ID` | The agent ID from step 1 |
| `PREFACTOR_ENVIRONMENT_ID` | The environment ID from step 2 |

You can also set `TOGETHER_MODEL` to use another Together AI model. It must support tool calling.

## Plan a trip

```bash
uv run --env-file .env python main.py Melbourne Adelaide
uv run --env-file .env python main.py "San Francisco" "Los Angeles" --days 3
```

Without `--days`, the agent uses the fewest days that keep each day to 400 km of driving or less.

A run takes a few minutes. When it finishes, the terminal shows the plan, then each judge's verdict on the final draft. The plan is also saved as a Markdown file in the `out/` folder.

A plan has:

- a short summary
- a "Before you go" note, when the trip is a poor idea as asked or cannot be done
- an "At a glance" list with one line for each day: date, route, driving distance, weather and where to stay
- a section for each day, with things to see and do and up to two places to stay

## What you see in Prefactor

Open the Trip planner agent. Each run appears in its list of instances. Open the latest one.

The **Activity** tab shows the run as a conversation:

- the request, as the user's message
- each step the agent took, in order: reading the request, planning the route, researching each stop, writing the plan, and the judges' review
- under each step, the model's messages and thinking, every lookup it made and what came back
- the plan itself, as the agent's reply

The **Quality** tab shows:

- a "Trip plan quality" score for each draft, out of 100, with every judge's verdict and explanation
- each judge's own verdict, with a link to the judge's run so you can see its reasoning

## Run a demo

These trips show different parts of the agent and the judges. You can run several at once in separate terminals. Put `uv run --env-file .env python` in front of each command.

| Trip | Command | What to look for |
|---|---|---|
| A normal trip | `main.py Melbourne Adelaide` | Every judge passes, often on the first draft |
| A long trip | `main.py Sydney Perth` | More days and stops, with a place to stay each night |
| A trip that is too short | `main.py Sydney Perth --days 1` | The plan warns that the driving is far too long for one day, and the "Trip worth taking" judge checks that it does |
| An impossible trip | `main.py Melbourne Manila` | There is no road between them, so the agent writes a short note explaining why instead of a plan |
| A place that does not exist | `main.py Melbourne Xyzzyville` | The agent says it could not find the place, and the "Trip plan locations" judge checks that it did |

When a judge fails a draft, open the **Quality** tab to read its explanation, then the **Activity** tab to see the agent rewrite the plan with that feedback. The agent writes at most 3 drafts. If the last draft still fails, it saves that draft and the terminal shows which judges failed it.

## Run the eval set

`run_evals.py` plans three fixed trips, one after another, and reports whether each final plan passed:

```bash
uv run --env-file .env python run_evals.py
```

It exits with status 1 if any plan fails, so you can run it in CI. In Prefactor, these runs are labelled as evals in the agent's list of instances, so you can tell them apart from normal runs.

## Troubleshooting

| Problem | What to do |
|---|---|
| A run stops with a timeout or a "service unavailable" error from Together AI | The model is busy. The agent retries a few times on its own; if it still fails, run it again |
| The terminal shows a score of 0 and no judges | No judges are attached to the agent. Follow steps 4 and 5 |
| The run fails at the start with an error about the agent or environment | Check `PREFACTOR_AGENT_ID` and `PREFACTOR_ENVIRONMENT_ID`, and check that the API token belongs to the same account |
| A route lookup fails | The public map and routing services are sometimes slow or unavailable. Wait a minute and try again |
