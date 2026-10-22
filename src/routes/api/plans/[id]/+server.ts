import { error, json } from '@sveltejs/kit';
import { plans } from '#lib/server/planner.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const plan = plans.get(params.id);
	if (!plan) error(404, 'No such plan.');
	return json(plan);
};
