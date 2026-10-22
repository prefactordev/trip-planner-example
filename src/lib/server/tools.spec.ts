import { describe, expect, it } from 'vitest';
import { sampleRoute } from './tools';

describe('sampleRoute', () => {
	it('returns a point roughly every interval along the route', () => {
		// Points along the equator, about 111 km apart
		const coordinates: [number, number][] = [0, 1, 2, 3, 4].map((lon) => [lon, 0]);

		const samples = sampleRoute(coordinates, 200);

		expect(samples).toEqual([
			{ lat: 0, lon: 2, km_from_start: 222 },
			{ lat: 0, lon: 4, km_from_start: 445 }
		]);
	});
});
