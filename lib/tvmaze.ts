const BASE_URL = "https://api.tvmaze.com";

export interface TVMazeShow {
  id: number;
  name: string;
  summary: string | null;
  status: string;
  premiered: string | null;
  ended: string | null;
  rating: { average: number | null };
  genres: string[];
  image: { medium: string; original: string } | null;
  network: { name: string; country: { name: string } | null } | null;
  webChannel: { name: string } | null;
  schedule: { time: string; days: string[] };
}

export interface TVMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate: string;
  airstamp: string;
  runtime: number | null;
  summary: string | null;
  image: { medium: string; original: string } | null;
}

export interface ScheduleEntry {
  id: number;
  airdate: string;
  airtime: string;
  season: number;
  number: number;
  name: string;
  show: TVMazeShow;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`TVmaze request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

export function searchShows(query: string) {
  return get<{ score: number; show: TVMazeShow }[]>(
    `/search/shows?q=${encodeURIComponent(query)}`
  );
}

export function getShow(id: number) {
  return get<TVMazeShow>(`/shows/${id}`);
}

export function getShowEpisodes(id: number) {
  return get<TVMazeEpisode[]>(`/shows/${id}/episodes`);
}

export function getTodaySchedule(countryCode = "US", date?: string) {
  const dateParam = date ? `&date=${date}` : "";
  return get<ScheduleEntry[]>(`/schedule?country=${countryCode}${dateParam}`);
}

export function getShowsIndex(page = 0) {
  return get<TVMazeShow[]>(`/shows?page=${page}`);
}

export function getEpisode(id: number) {
  return get<TVMazeEpisode>(`/episodes/${id}`);
}
