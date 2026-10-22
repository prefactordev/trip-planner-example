<script lang="ts">
	import type { PlanView } from '#lib/server/plans.ts';

	const POLL_MS = 3000;

	let origin = $state('');
	let destination = $state('');
	let planning = $state(false);
	let status = $state('');
	let failed = $state(false);
	let html = $state('');

	async function waitForPlan(id: string): Promise<PlanView> {
		const started = Date.now();
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			const response = await fetch(`/api/plans/${id}`);
			if (!response.ok) throw new Error('The plan was lost. Please try again.');
			const plan: PlanView = await response.json();
			if (plan.status === 'done') return plan;
			if (plan.status === 'failed') throw new Error(plan.error ?? 'The plan failed.');
			const seconds = Math.round((Date.now() - started) / 1000);
			status = `Planning your trip. This takes a minute or two (${seconds} s so far).`;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		planning = true;
		failed = false;
		html = '';
		status = 'Planning your trip. This takes a minute or two.';
		try {
			const response = await fetch('/api/plans', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ origin, destination })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.message ?? 'Enter both places.');
			const plan = await waitForPlan(body.id);
			html = plan.html ?? '';
			status = '';
		} catch (error) {
			failed = true;
			status = error instanceof Error ? error.message : String(error);
		} finally {
			planning = false;
		}
	}
</script>

<svelte:head>
	<title>Trip planner</title>
</svelte:head>

<main>
	<h1>Trip planner</h1>
	<p>
		Enter two places. The planner finds a driving route, picks towns to stop at, researches them and
		writes a day-by-day plan.
	</p>

	<form onsubmit={submit}>
		<label>From <input name="origin" required placeholder="Melbourne" bind:value={origin} /></label>
		<label
			>To <input
				name="destination"
				required
				placeholder="Adelaide"
				bind:value={destination}
			/></label
		>
		<button type="submit" disabled={planning}>Plan trip</button>
	</form>

	<p class="status" class:error={failed} role="status">{status}</p>

	{#if html}
		<!-- The server renders the Markdown with raw HTML escaped -->
		<article>{@html html}</article>
	{/if}
</main>

<style>
	:global(:root) {
		--bg: #fafaf9;
		--fg: #1c1917;
		--muted: #78716c;
		--border: #d6d3d1;
		--accent: #0f766e;
		--error: #b91c1c;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg: #1c1917;
			--fg: #f5f5f4;
			--muted: #a8a29e;
			--border: #44403c;
			--accent: #2dd4bf;
			--error: #f87171;
		}
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		padding: 32px 16px;
		background: var(--bg);
		color: var(--fg);
		font:
			16px/1.6 system-ui,
			sans-serif;
	}

	main {
		max-width: 720px;
		margin: 0 auto;
	}

	h1 {
		margin-top: 0;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: end;
	}

	label {
		display: flex;
		flex: 1 1 200px;
		flex-direction: column;
		gap: 4px;
		color: var(--muted);
		font-size: 14px;
	}

	input {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--fg);
		font: inherit;
	}

	button {
		padding: 9px 18px;
		border: 0;
		border-radius: 6px;
		background: var(--accent);
		color: var(--bg);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.status {
		min-height: 1.6em;
		color: var(--muted);
	}

	.status.error {
		color: var(--error);
	}

	article {
		margin-top: 16px;
		border-top: 1px solid var(--border);
	}
</style>
