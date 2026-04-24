import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueIncomingMessage,
  drainPendingBatches,
  _resetForTests,
  type AggregatorResult,
} from "../lib/conversation-aggregator";

describe("conversation-aggregator drainPendingBatches", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("returns 0 when no batches are pending", async () => {
    const drained = await drainPendingBatches(1000);
    expect(drained).toBe(0);
  });

  it("flushes pending batches immediately without waiting for the debounce timer", async () => {
    const processor = vi.fn(async (combined: string) => `reply:${combined}`);
    const results: AggregatorResult[] = [];

    const p1 = enqueueIncomingMessage(1, "5511999999999", "oi", processor).then((r) => results.push(r));
    const p2 = enqueueIncomingMessage(1, "5511999999999", "tudo bem?", processor).then((r) => results.push(r));

    const drained = await drainPendingBatches(2000);
    await Promise.all([p1, p2]);

    expect(drained).toBe(1);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledWith("oi\ntudo bem?", 2);

    expect(results).toHaveLength(2);
    expect(results[0].shouldReply).toBe(false);
    expect(results[1].shouldReply).toBe(true);
    expect(results[1].reply).toBe("reply:oi\ntudo bem?");
    expect(results[1].aggregatedCount).toBe(2);
  });

  it("drains multiple conversations in parallel", async () => {
    const processor = vi.fn(async (combined: string) => `r:${combined}`);

    const a = enqueueIncomingMessage(1, "5511111111111", "a", processor);
    const b = enqueueIncomingMessage(1, "5522222222222", "b", processor);
    const c = enqueueIncomingMessage(2, "5533333333333", "c", processor);

    const drained = await drainPendingBatches(2000);
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    expect(drained).toBe(3);
    expect(processor).toHaveBeenCalledTimes(3);
    expect(ra.shouldReply).toBe(true);
    expect(rb.shouldReply).toBe(true);
    expect(rc.shouldReply).toBe(true);
  });
});
