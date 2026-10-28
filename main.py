"""Plan a road trip between two places, traced in Prefactor.

Usage:
    python main.py Melbourne Adelaide
    python main.py Melbourne Adelaide --days 4

Environment:
    OPENAI_BASE_URL      Base URL of an OpenAI-compatible API
    OPENAI_API_KEY       API key for that API
    OPENAI_MODEL         Model name; it must support tool calling
    PREFACTOR_API_URL    Prefactor API URL
    PREFACTOR_API_TOKEN  Prefactor API token
    PREFACTOR_AGENT_ID   Prefactor agent ID (omit for deployment-scoped tokens)
    PREFACTOR_ENVIRONMENT_ID  Prefactor environment ID (needed for an agent
                         with no deployments yet)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from typing import Any, Literal

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from prefactor_core import PrefactorCoreConfig, SchemaRegistry
from prefactor_http.config import HttpClientConfig
from prefactor_langchain import PrefactorCallbackHandler, register_langchain_schemas
from pydantic import SecretStr
from rich.console import Console
from rich.markdown import Markdown
from rich.rule import Rule

from evals import QUALITY_SCHEMA, QUALITY_SCHEMA_NAME, PrefactorJudges
from graph import TripState, build_graph

AGENT_NAME = "Trip planner"

Purpose = Literal["live", "smoke_test", "eval"]


def build_registry() -> tuple[SchemaRegistry, dict[str, str]]:
    """Register the span and quality schemas the trip planner sends."""
    registry = SchemaRegistry()
    tool_span_types = register_langchain_schemas(registry)
    registry.register_quality_schema(
        QUALITY_SCHEMA_NAME,
        QUALITY_SCHEMA,
        title="Trip plan quality",
        description="Prefactor judge verdicts on each draft of the trip plan",
        template="{{score}}/100 on attempt {{attempt}}",
    )
    return registry, tool_span_types


def schema_version_id(registry: SchemaRegistry) -> str:
    """Derive a stable schema version ID from the registered schemas."""
    schemas = registry.to_agent_schema_version("trip-planner")
    digest = hashlib.sha1(json.dumps(schemas, sort_keys=True).encode()).hexdigest()[:8]
    return f"trip-planner-{digest}"


def chat_model() -> ChatOpenAI:
    """Create a chat model on the configured OpenAI-compatible API."""
    return ChatOpenAI(
        model=os.environ["OPENAI_MODEL"],
        base_url=os.environ["OPENAI_BASE_URL"],
        api_key=SecretStr(os.environ["OPENAI_API_KEY"]),
        # Reasoning models think before they answer, and a long trip can use
        # most of the budget on reasoning.
        max_completion_tokens=32000,
        # Hosted providers sometimes answer 503 when the model is busy.
        max_retries=5,
    )


async def run_trip(request: str, purpose: Purpose = "live") -> TripState:
    """Run the trip planner once as a Prefactor agent instance.

    Args:
        request: The user's trip request in plain language.
        purpose: Why this run happened, recorded on the agent instance.

    Returns:
        The final graph state.
    """
    registry, tool_span_types = build_registry()
    version_id = schema_version_id(registry)

    api_url = os.environ["PREFACTOR_API_URL"]
    api_token = os.environ["PREFACTOR_API_TOKEN"]
    client = PrefactorCallbackHandler.create_client(
        PrefactorCoreConfig(
            http_config=HttpClientConfig(api_url=api_url, api_token=api_token),
            schema_registry=registry,
        )
    )
    await client.initialize()

    try:
        instance = await client.create_agent_instance(
            agent_id=os.environ.get("PREFACTOR_AGENT_ID"),
            environment_id=os.environ.get("PREFACTOR_ENVIRONMENT_ID"),
            agent_version={"name": AGENT_NAME, "external_identifier": version_id},
            external_schema_version_id=version_id,
            purpose=purpose,
        )
        await instance.start()

        # Setup failures, such as a missing API key, also fail the instance.
        try:
            handler = PrefactorCallbackHandler(
                instance=instance, tool_span_types=tool_span_types
            )
            graph = build_graph(
                chat_model(),
                PrefactorJudges(api_url, api_token),
            )
            state = await graph.ainvoke(
                {"messages": [HumanMessage(request)]},
                config={
                    "callbacks": [handler],
                    "configurable": {"prefactor_instance": instance},
                },
            )
        except BaseException:
            await instance.finish("failed")
            raise
        await instance.finish("complete")
        return state
    finally:
        await client.close()


def trip_request(origin: str, destination: str, days: int | None) -> str:
    """Write the trip request the graph starts from."""
    if days is None:
        return f"Plan a road trip from {origin} to {destination}."
    return f"Plan a {days}-day road trip from {origin} to {destination}."


def main() -> None:
    """Parse the command line and run one trip."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("origin", help="Where the trip starts")
    parser.add_argument("destination", help="Where the trip ends")
    parser.add_argument(
        "--days", type=int, help="Number of days; the planner chooses if omitted"
    )
    args = parser.parse_args()

    console = Console()
    request = trip_request(args.origin, args.destination, args.days)
    console.print(request)
    with console.status("Planning the trip; this takes a few minutes"):
        state = asyncio.run(run_trip(request))

    console.print(Rule())
    console.print(Markdown(state["draft"]))
    console.print(Rule())
    print_quality(console, state["quality"])
    console.print(f"Saved to {state['output_path']}")


def print_quality(console: Console, quality: dict[str, Any]) -> None:
    """Print each judge's verdict on the final draft."""
    result = "passed" if quality["passed"] else "failed"
    console.print(
        f"[bold]Judges: {result}[/bold], {quality['score']}/100 "
        f"on draft {quality['attempt']}"
    )
    for check in quality["checks"]:
        mark = "[green]pass[/green]" if check["passed"] else "[red]fail[/red]"
        summary = check["detail"].split("\n")[0]
        console.print(f"  {mark}  {check['name']}: {summary}")


if __name__ == "__main__":
    main()
