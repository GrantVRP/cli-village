// `cli-village emit '<json>'` and `... | cli-village emit -`: how AI agents and
// scripts tell the village what they're doing. Each event is checked here
// first (so mistakes are explained even when no village is open), then sent
// to the open village over the local socket. See docs/EVENTS.md.

import { createInterface } from "node:readline";
import { parseEvent, type EventBody } from "../events/validate.js";
import { BUILDING_NAMES } from "../events/types.js";
import { HubSender, type Ack } from "../hub/client.js";
import { MAX_LINE } from "../hub/server.js";
import { dim, green, symbols } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";
import { count, Output } from "./output.js";

const EXAMPLE = `cli-village emit '{"type":"start","agent":"claude-code","task":"r1","kind":"research","title":"Reading the Stripe docs"}'`;
const NOBODY = "No village is open right now, so nobody saw it. Open one with cli-village (in a terminal) or cli-village open (3D).";

/** "start · claude-code at the LIBRARY: Reading the Stripe docs" */
function describe(body: EventBody): string {
  if (body.type === "start") return `${body.type} · ${body.agent} at the ${BUILDING_NAMES[body.building]}: ${body.title}`;
  return `${body.type} · ${body.agent}`;
}

type Checked = { ok: true; body: EventBody } | { ok: false; error: string };

function check(text: string): Checked {
  if (text.length > MAX_LINE) return { ok: false, error: `That's longer than ${MAX_LINE / 1024} KB. An event is a small JSON object.` };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `That isn't valid JSON (${(err as Error).message}). An event looks like: {"type":"start","agent":"claude-code",...}` };
  }
  return parseEvent(input);
}

export async function runEmit(input: string | undefined, ui: Ui): Promise<number> {
  const out = new Output(ui);
  if (input === "-" || (input === undefined && !process.stdin.isTTY)) return emitStream(out);
  if (input === undefined) {
    return out.problem({ error: "Give me an event as JSON (in single quotes), or - to read one event per line from stdin.", hint: EXAMPLE });
  }

  const checked = check(input);
  if (!checked.ok) return out.problem({ error: checked.error, hint: "See the event format: docs/EVENTS.md" });
  const sender = await HubSender.open();
  if (!sender) {
    out.result({ delivered: false });
    out.line(dim(`${symbols.warn} ${NOBODY}`));
    return 0;
  }
  const ack = await sender.send(checked.body);
  await sender.close();
  if (!ack.ok && ack.lost) {
    // Like no village at all: not your agent's problem, so it isn't stopped.
    out.result({ delivered: false });
    out.line(dim(`${symbols.warn} ${ack.error} Nobody saw it.`));
    return 0;
  }
  if (!ack.ok) return out.problem({ error: `The village refused it: ${ack.error}` });
  out.result({ delivered: true, seq: ack.seq });
  out.line(`${green(symbols.ok)} Sent to the village: ${describe(checked.body)}`);
  return 0;
}

/** One event per line, sent as each line arrives (so a long-running agent can pipe into it). */
async function emitStream(out: Output): Promise<number> {
  const sender = await HubSender.open();
  if (!sender) out.warn(dim(`${symbols.warn} ${NOBODY} (Still checking each line.)`));
  const refused: { line: number; error: string }[] = [];
  const answers: Promise<void>[] = [];
  let sent = 0;
  let lost = 0; // sent, but the village closed (or stopped answering) first
  let n = 0;
  const refuse = (line: number, error: string) => {
    refused.push({ line, error });
    out.warn(`${symbols.fail} line ${line}: ${error}`);
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = ++n;
    if (!raw.trim()) continue;
    const checked = check(raw);
    if (!checked.ok) {
      refuse(line, checked.error);
      continue;
    }
    if (!sender) continue;
    answers.push(
      sender.send(checked.body).then((ack: Ack) => {
        if (ack.ok) sent++;
        else if (ack.lost) {
          if (!lost++) out.warn(dim(`${symbols.warn} ${ack.error} Later events aren't seen. (Still checking each line.)`));
        } else refuse(line, `the village refused it: ${ack.error}`);
      }),
    );
  }
  await Promise.all(answers);
  await sender?.close();

  refused.sort((a, b) => a.line - b.line);
  if (out.json) process.stdout.write(`${JSON.stringify({ ok: refused.length === 0, delivered: Boolean(sender), sent, lost, refused })}\n`);
  if (sender) {
    const notes = [refused.length ? `${refused.length} refused (see above)` : "", lost ? `${lost} not seen (the village closed)` : ""].filter(Boolean);
    out.line(`${green(symbols.ok)} Sent ${count(sent, "event")} to the village${notes.length ? `, ${notes.join(", ")}` : ""}.`);
  }
  else out.line(dim(`  Checked ${count(n, "line")}: ${refused.length ? `${refused.length} had problems (see above)` : "all fine"}.`));
  return refused.length ? 1 : 0;
}
