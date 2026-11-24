// How the robots react to their work: a wave when a job is done, a cheer when a problem is
// fixed or work is safe on GitHub, a slump while something they did failed, and a chat
// between robots resting at home. Only the rules live here (no three.js), so tests can
// load this file as it is; robot.ts does the moving.

/** A short gesture, acted out once. (Slumping is a lasting pose: robot.ts reads it from the status.) */
export type Gesture = "wave" | "cheer";

/** How long each gesture lasts, in seconds. Short: the next job often starts a second later. */
export const GESTURE_SECONDS: Record<Gesture, number> = { wave: 1.3, cheer: 1.6 };

/** The parts of a log entry the reactions need. */
export interface ReactionEntry {
  seq: number;
  type: string;
  agent: string;
  building?: string;
}

export interface Reaction {
  agent: string;
  gesture: Gesture;
  /** Seconds to wait first, so a crowd doesn't move as one. */
  delay: number;
}

/**
 * The gestures that log entries newer than `after` call for.
 * - done: the robot waves; if it cleared a problem at that building, it cheers.
 * - push: the robot that pushed cheers, and so do the robots resting nearby (`resting`).
 * `problemsBefore` and `problemsAfter` are the buildings with an unfixed problem before and
 * after these entries. Entries from before the page caught up are never acted out: the
 * caller passes the newest seq it has already seen.
 */
export function reactionsTo(
  entries: readonly ReactionEntry[],
  after: number,
  problemsBefore: ReadonlySet<string>,
  problemsAfter: ReadonlySet<string>,
  resting: readonly string[] = [],
): Reaction[] {
  const out = new Map<string, Reaction>();
  const put = (r: Reaction) => {
    const had = out.get(r.agent);
    // A cheer wins over a wave; otherwise the first reaction stands.
    if (!had || (had.gesture === "wave" && r.gesture === "cheer")) out.set(r.agent, r);
  };
  for (const e of entries) {
    if (e.seq <= after || !e.agent) continue;
    if (e.type === "done") {
      const fixed = e.building !== undefined && problemsBefore.has(e.building) && !problemsAfter.has(e.building);
      put({ agent: e.agent, gesture: fixed ? "cheer" : "wave", delay: 0 });
    } else if (e.type === "push") {
      put({ agent: e.agent, gesture: "cheer", delay: 0 });
      resting.filter((name) => name !== e.agent).forEach((name, i) => put({ agent: name, gesture: "cheer", delay: 0.2 + i * 0.17 }));
    }
  }
  return [...out.values()];
}

/** Robots resting at home chat in pairs: the first with the second, the third with the fourth. */
export function chatPairs(resting: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < resting.length; i += 2) pairs.push([resting[i]!, resting[i + 1]!]);
  return pairs;
}

/**
 * Whether pair number `pair` is chatting at time `t` (seconds), and who is talking.
 * Each pair talks for about four seconds in every eleven, turn about, and pairs don't
 * all start at once.
 */
export function chatAt(t: number, pair: number): { chatting: boolean; speaker: 0 | 1 } {
  const period = 11;
  const local = (((t + pair * 4.3) % period) + period) % period;
  if (local >= 4) return { chatting: false, speaker: 0 };
  return { chatting: true, speaker: Math.floor(local / 1.3) % 2 === 0 ? 0 : 1 };
}
