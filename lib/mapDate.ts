/**
 * The selected date, shared between the scrubber and the relief.
 *
 * The scrubber sits above the map in the server-rendered tree and paints the
 * flat map by touching the DOM directly, which deck.gl cannot use — it needs
 * the values in React. Rather than restructure the tree to thread props through
 * a server component, both sides talk to this tiny store via
 * useSyncExternalStore. The scrubber already fetches the data; this just
 * publishes what it got.
 */
export interface MapDateState {
  date: string;
  /** fips -> price and source for that date */
  byFips: Map<string, { p: number; s?: string }>;
  /** the rank domain the current colour scale uses */
  domain: number[];
  /** height baseline, fixed across dates so the terrain rises over time */
  base: number;
}

/** Provenance shown on hover, per row source. Shared so the flat map and the
 *  relief never describe the same row differently. */
export const SOURCE_NOTE: Record<string, string | undefined> = {
  aaa: undefined,
  dc: "District-wide AAA average",
  ak: "AK community fuel survey",
  archive: "archived snapshot \u00B7 weekly sample",
};

let state: MapDateState | null = null;
const subs = new Set<() => void>();

export function setMapDate(next: MapDateState) {
  state = next;
  subs.forEach((f) => f());
}

export function subscribeMapDate(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export const getMapDate = () => state;
export const getMapDateServer = () => null;
