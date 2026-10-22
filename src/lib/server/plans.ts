/**
 * Trip plans, running or finished.
 *
 * A plan takes a minute or two, so the API starts one in the background and
 * the page polls until it is done. Plans are kept in memory, so they are lost
 * when the server restarts.
 */

import MarkdownIt from 'markdown-it';

export type PlanTrip = (origin: string, destination: string) => Promise<string>;

export type PlanView = {
	status: 'running' | 'done' | 'failed';
	markdown: string | null;
	html: string | null;
	error: string | null;
};

type Plan = Omit<PlanView, 'html'>;

export class TooManyPlansError extends Error {
	constructor() {
		super('Too many trips are being planned. Try again soon.');
	}
}

// Raw HTML in the model's output is escaped, not rendered
const markdown = new MarkdownIt('commonmark', { html: false });

export class PlanStore {
	private plans = new Map<string, Plan>();

	/**
	 * @param planTrip Plans a trip and returns it as Markdown.
	 * @param maxRunning How many plans may run at once. More are refused, to
	 *   limit model spend on a public deployment.
	 */
	constructor(
		private planTrip: PlanTrip,
		private maxRunning = 3
	) {}

	/** Start planning a trip and return the plan's ID. */
	start(origin: string, destination: string): string {
		const running = [...this.plans.values()].filter((p) => p.status === 'running').length;
		if (running >= this.maxRunning) throw new TooManyPlansError();

		const id = crypto.randomUUID();
		const plan: Plan = { status: 'running', markdown: null, error: null };
		this.plans.set(id, plan);
		this.planTrip(origin, destination).then(
			(result) => {
				plan.markdown = result;
				plan.status = 'done';
			},
			(error) => {
				console.error(`Planning ${origin} to ${destination} failed`, error);
				plan.error = 'The planner could not finish this trip. Please try again.';
				plan.status = 'failed';
			}
		);
		return id;
	}

	/** Get a plan by ID, with its Markdown rendered as HTML. */
	get(id: string): PlanView | undefined {
		const plan = this.plans.get(id);
		if (!plan) return undefined;
		return { ...plan, html: plan.markdown ? markdown.render(plan.markdown) : null };
	}
}
