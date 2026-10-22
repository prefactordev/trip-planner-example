/**
 * Tools for the trip planner, backed by free public APIs that need no key.
 *
 * - Nominatim (OpenStreetMap) for geocoding and reverse geocoding
 * - OSRM for driving routes
 * - Wikipedia for place summaries and nearby attractions
 * - Open-Meteo for weather forecasts
 *
 * Responses are cached in memory for the life of the process, and Nominatim
 * requests are spaced at least one second apart to respect its usage policy.
 */

import { tool } from 'langchain';
import { z } from 'zod';

const USER_AGENT =
	'trip-planner-example/1.0 (https://github.com/prefactordev/trip-planner-example)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org';
const WIKIPEDIA_URL = 'https://en.wikipedia.org';
const OPEN_METEO_URL = 'https://api.open-meteo.com';

type Params = Record<string, string | number>;
type Point = { lat: number; lon: number; km_from_start: number };

class HttpError extends Error {
	constructor(public status: number) {
		super(`HTTP ${status}`);
	}
}

const cache = new Map<string, unknown>();
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimRequest = 0;

function urlFor(url: string, params: Params = {}): string {
	const query = new URLSearchParams(
		Object.entries(params).map(([key, value]) => [key, String(value)])
	);
	return query.size ? `${url}?${query}` : url;
}

/** GET a JSON document, using the in-memory cache. */
async function getJson<T>(url: string, params?: Params): Promise<T> {
	const full = urlFor(url, params);
	if (cache.has(full)) return cache.get(full) as T;

	const response = await fetch(full, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new HttpError(response.status);
	const data = (await response.json()) as T;
	cache.set(full, data);
	return data;
}

/** GET from Nominatim, at most one request per second. */
function getNominatim<T>(path: string, params: Params): Promise<T> {
	const url = `${NOMINATIM_URL}${path}`;
	if (cache.has(urlFor(url, params))) return getJson<T>(url, params);

	const request = nominatimQueue.then(async () => {
		const wait = 1000 - (Date.now() - lastNominatimRequest);
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		try {
			return await getJson<T>(url, params);
		} finally {
			lastNominatimRequest = Date.now();
		}
	});
	nominatimQueue = request.catch(() => undefined);
	return request;
}

/** Great-circle distance between two points in kilometres. */
function haversineKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
	const rad = Math.PI / 180;
	const h =
		Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
		Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
	return 2 * 6371 * Math.asin(Math.sqrt(h));
}

type Route = { distance: number; duration: number; geometry: { coordinates: [number, number][] } };

/** Fetch the OSRM driving route between two points. */
async function route(
	originLat: number,
	originLon: number,
	destLat: number,
	destLon: number
): Promise<Route> {
	const data = await getJson<{ code: string; routes?: Route[] }>(
		`${OSRM_URL}/route/v1/driving/${originLon},${originLat};${destLon},${destLat}`,
		{ overview: 'simplified', geometries: 'geojson' }
	);
	if (data.code !== 'Ok' || !data.routes?.length) {
		throw new Error(`No driving route found: ${data.code}`);
	}
	return data.routes[0];
}

/**
 * Return points along a route roughly every `everyKm` kilometres.
 *
 * @param coordinates GeoJSON `[lon, lat]` pairs.
 */
export function sampleRoute(coordinates: [number, number][], everyKm: number): Point[] {
	const points = coordinates.map(([lon, lat]): [number, number] => [lat, lon]);
	const samples: Point[] = [];
	let travelled = 0;
	let nextSample = everyKm;
	for (let i = 1; i < points.length; i++) {
		travelled += haversineKm(points[i - 1], points[i]);
		if (travelled >= nextSample) {
			const [lat, lon] = points[i];
			samples.push({ lat, lon, km_from_start: Math.round(travelled) });
			nextSample += everyKm;
		}
	}
	return samples;
}

// Nominatim address types that name a settlement rather than a region
const SETTLEMENT_TYPES = new Set([
	'city',
	'town',
	'village',
	'hamlet',
	'suburb',
	'city_district',
	'locality',
	'municipality'
]);

// Address fields that name a settlement, from largest to smallest
const SETTLEMENT_ADDRESS_KEYS = ['city', 'town', 'village', 'hamlet'];

type Reverse = { addresstype?: string; name?: string; address?: Record<string, string> };

/** Name the settlement at a point, or null when there is none nearby. */
async function settlementNear(lat: number, lon: number): Promise<string | null> {
	const params = { lat, lon, format: 'json' };
	const result = await getNominatim<Reverse>('/reverse', { ...params, zoom: 12 });
	if (result.addresstype && SETTLEMENT_TYPES.has(result.addresstype) && result.name) {
		return result.name;
	}
	// On rural roads zoom 12 names the county; a closer look finds small towns
	const { address = {} } = await getNominatim<Reverse>('/reverse', { ...params, zoom: 14 });
	const key = SETTLEMENT_ADDRESS_KEYS.find((k) => address[k]);
	return key ? address[key] : null;
}

const routeSchema = z.object({
	origin_lat: z.number().describe('Latitude of the start'),
	origin_lon: z.number().describe('Longitude of the start'),
	dest_lat: z.number().describe('Latitude of the destination'),
	dest_lon: z.number().describe('Longitude of the destination')
});

const pointSchema = z.object({
	lat: z.number().describe('Latitude'),
	lon: z.number().describe('Longitude')
});

export const geocode = tool(
	async ({ place }) => {
		const results = await getNominatim<{ display_name: string; lat: string; lon: string }[]>(
			'/search',
			{ q: place, format: 'json', limit: 1 }
		);
		if (!results.length) return { error: `No place found for "${place}"` };
		const [match] = results;
		return { name: match.display_name, lat: Number(match.lat), lon: Number(match.lon) };
	},
	{
		name: 'geocode',
		description: 'Find the coordinates of a place by name.',
		schema: z.object({
			place: z.string().describe('A place name, for example "Ballarat, Victoria"')
		})
	}
);

export const getRoute = tool(
	async ({ origin_lat, origin_lon, dest_lat, dest_lon }) => {
		const found = await route(origin_lat, origin_lon, dest_lat, dest_lon);
		return {
			distance_km: Math.round(found.distance / 1000),
			duration_hours: Math.round(found.duration / 360) / 10
		};
	},
	{
		name: 'get_route',
		description: 'Get the driving distance and time between two points.',
		schema: routeSchema
	}
);

export const findTownsAlongRoute = tool(
	async ({ origin_lat, origin_lon, dest_lat, dest_lon, every_km }) => {
		const found = await route(origin_lat, origin_lon, dest_lat, dest_lon);
		const towns: ({ name: string } & Point)[] = [];
		const seen = new Set<string>();
		for (const point of sampleRoute(found.geometry.coordinates, every_km)) {
			const name = await settlementNear(point.lat, point.lon);
			if (name && !seen.has(name)) {
				seen.add(name);
				towns.push({ name, ...point });
			}
		}
		return towns;
	},
	{
		name: 'find_towns_along_route',
		description: 'List towns along the driving route, with their distance from the start.',
		schema: routeSchema.extend({
			every_km: z
				.number()
				.default(80)
				.describe('How often to look for a town along the route, in kilometres')
		})
	}
);

export const wikipediaSummary = tool(
	async ({ title }) => {
		try {
			const data = await getJson<{ title?: string; description?: string; extract?: string }>(
				`${WIKIPEDIA_URL}/api/rest_v1/page/summary/${encodeURIComponent(title)}`
			);
			return { title: data.title, description: data.description, extract: data.extract };
		} catch (error) {
			if (error instanceof HttpError) {
				return { error: `No Wikipedia article for "${title}": ${error.status}` };
			}
			throw error;
		}
	},
	{
		name: 'wikipedia_summary',
		description: 'Get the Wikipedia summary for a place.',
		schema: z.object({
			title: z.string().describe('The Wikipedia article title, for example "Ballarat"')
		})
	}
);

export const nearbyAttractions = tool(
	async ({ lat, lon }) => {
		const data = await getJson<{ query?: { geosearch: { title: string; dist: number }[] } }>(
			`${WIKIPEDIA_URL}/w/api.php`,
			{
				action: 'query',
				list: 'geosearch',
				gscoord: `${lat}|${lon}`,
				gsradius: 10000,
				gslimit: 8,
				format: 'json'
			}
		);
		return (data.query?.geosearch ?? []).map((item) => ({
			title: item.title,
			distance_m: Math.round(item.dist)
		}));
	},
	{
		name: 'nearby_attractions',
		description: 'List Wikipedia articles about places within 10 km of a point.',
		schema: pointSchema
	}
);

type Forecast = {
	daily: {
		time: string[];
		temperature_2m_max: number[];
		temperature_2m_min: number[];
		precipitation_probability_max: number[];
	};
};

export const weatherForecast = tool(
	async ({ lat, lon }) => {
		const { daily } = await getJson<Forecast>(`${OPEN_METEO_URL}/v1/forecast`, {
			latitude: lat,
			longitude: lon,
			daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
			forecast_days: 7,
			timezone: 'auto'
		});
		return daily.time.map((date, i) => ({
			date,
			max_c: daily.temperature_2m_max[i],
			min_c: daily.temperature_2m_min[i],
			rain_chance_pct: daily.precipitation_probability_max[i]
		}));
	},
	{
		name: 'weather_forecast',
		description: 'Get the 7-day weather forecast for a point.',
		schema: pointSchema
	}
);

export const ROUTE_TOOLS = [geocode, getRoute, findTownsAlongRoute];
export const RESEARCH_TOOLS = [wikipediaSummary, nearbyAttractions, weatherForecast];
