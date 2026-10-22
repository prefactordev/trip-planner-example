import { describe, expect, it } from 'vitest';
import { PlanStore, TooManyPlansError, type PlanView } from './plans';

async function waitFor(store: PlanStore, id: string): Promise<PlanView> {
	for (let i = 0; i < 100; i++) {
		const plan = store.get(id);
		if (plan && plan.status !== 'running') return plan;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error('The plan did not finish');
}

describe('PlanStore', () => {
	it('returns the markdown and the html', async () => {
		const store = new PlanStore(
			async (origin, destination) => `# ${origin} to ${destination}\n\n- **Ballarat**`
		);

		const plan = await waitFor(store, store.start('Melbourne', 'Adelaide'));

		expect(plan.status).toBe('done');
		expect(plan.markdown).toMatch(/^# Melbourne to Adelaide/);
		expect(plan.html).toContain('<h1>Melbourne to Adelaide</h1>');
		expect(plan.html).toContain('<strong>Ballarat</strong>');
	});

	it('escapes html in the markdown', async () => {
		const store = new PlanStore(
			async () => '<script>alert("hi")</script>\n\n[link](javascript:alert(1))'
		);

		const plan = await waitFor(store, store.start('A', 'B'));

		expect(plan.html).not.toContain('<script>');
		expect(plan.html).not.toContain('href="javascript:');
	});

	it('reports a failure without its details', async () => {
		const store = new PlanStore(async () => {
			throw new Error('secret upstream detail');
		});

		const plan = await waitFor(store, store.start('A', 'B'));

		expect(plan.status).toBe('failed');
		expect(plan.error).not.toContain('secret');
	});

	it('returns undefined for an unknown plan', () => {
		const store = new PlanStore(async () => '');

		expect(store.get('nope')).toBeUndefined();
	});

	it('refuses plans over the running limit', async () => {
		let release = () => {};
		const released = new Promise<void>((resolve) => (release = resolve));
		const store = new PlanStore(async () => {
			await released;
			return '';
		}, 1);

		const first = store.start('A', 'B');

		expect(() => store.start('A', 'B')).toThrow(TooManyPlansError);
		release();
		await waitFor(store, first);
		expect(() => store.start('A', 'B')).not.toThrow();
	});
});
