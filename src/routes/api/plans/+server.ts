import { error, json } from '@sveltejs/kit';
import { plans } from '#lib/server/planner.ts';
import { TooManyPlansError } from '#lib/server/plans.ts';
import type { RequestHandler } from './$types';

function place(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= 200 ? trimmed : null;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const origin = place(body.origin);
	const destination = place(body.destination);
	if (!origin || !destination) error(422, 'Enter both places.');

	try {
		return json({ id: plans.start(origin, destination) }, { status: 202 });
	} catch (e) {
		if (e instanceof TooManyPlansError) error(429, e.message);
		throw e;
	}
};
