/**
 * Task #15 — Trilha imutável de mensagens da IA com hash encadeado.
 *
 * Cada mensagem persistida em `dental_messages` recebe um hash SHA-256 do
 * conteúdo + timestamp do servidor + metadata + hash da mensagem anterior
 * da mesma conversa. Adulteração de qualquer linha quebra a cadeia e fica
 * detectável via `verifyConversationIntegrity`.
 */

import crypto from "crypto";
import { db } from "@workspace/db";
import { dentalMessagesTable } from "@workspace/db";
import type { DentalMessage } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger";

const GENESIS_HASH = "0".repeat(64);

export interface ChainedMessageInput {
  tenantId: number;
  conversationId: number;
  direction: "inbound" | "outbound";
  type?: string;
  content?: string | null;
  audioUrl?: string | null;
  audioTranscript?: string | null;
  externalId?: string | null;
  sentAt?: Date;
  aiModel?: string | null;
  promptVersion?: string | null;
}

/**
 * Computes the SHA-256 hex hash for a single chained message link.
 * Order of fields is fixed — any change here invalidates all existing
 * hashes, so update only with explicit migration.
 */
export function computeMessageHash(args: {
  prevHash: string;
  tenantId: number;
  conversationId: number;
  direction: string;
  type: string;
  content: string;
  externalId: string;
  serverTs: Date;
  aiModel: string;
  promptVersion: string;
}): string {
  const payload = [
    args.prevHash,
    String(args.tenantId),
    String(args.conversationId),
    args.direction,
    args.type,
    args.content,
    args.externalId,
    args.serverTs.toISOString(),
    args.aiModel,
    args.promptVersion,
  ].join("\u241F"); // unit-separator-ish glyph, very unlikely in user content
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Fetches the latest persisted hash for a conversation. Falls back to the
 * genesis hash for the first message in a conversation. Uses a quick query
 * ordered by id desc + sentAt desc — within a conversation, id is monotonic
 * since serial.
 */
async function getLastChainHash(conversationId: number): Promise<string> {
  const last = await db.query.dentalMessagesTable.findFirst({
    where: eq(dentalMessagesTable.conversationId, conversationId),
    orderBy: (m, { desc }) => [desc(m.id)],
    columns: { hash: true },
  });
  return last?.hash ?? GENESIS_HASH;
}

/**
 * Inserts a dental_messages row computing its hash from the previous link
 * in the same conversation. Returns the inserted row.
 *
 * Concurrency note: there is a small race between reading the last hash
 * and inserting. We accept it because (a) within a single conversation
 * messages are normally serialized by the WhatsApp processing pipeline
 * (one inbound, then one outbound batch), and (b) `verifyConversationIntegrity`
 * walks by id ascending and tolerates a single missing/old prev_hash by
 * reporting the first divergence. For stricter ordering, callers can wrap
 * in a tx with row-level locking on dental_conversations.
 */
export async function insertChainedMessage(
  input: ChainedMessageInput,
): Promise<DentalMessage> {
  const serverTs = new Date();
  const sentAt = input.sentAt ?? serverTs;
  const prevHash = await getLastChainHash(input.conversationId);

  const type = input.type ?? "text";
  const content = input.content ?? "";
  const externalId = input.externalId ?? "";
  const aiModel = input.aiModel ?? "";
  const promptVersion = input.promptVersion ?? "";

  const hash = computeMessageHash({
    prevHash,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    direction: input.direction,
    type,
    content,
    externalId,
    serverTs,
    aiModel,
    promptVersion,
  });

  const [row] = await db
    .insert(dentalMessagesTable)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: input.direction,
      type,
      content: input.content ?? null,
      audioUrl: input.audioUrl ?? null,
      audioTranscript: input.audioTranscript ?? null,
      externalId: input.externalId ?? null,
      sentAt,
      hash,
      prevHash,
      aiModel: input.aiModel ?? null,
      promptVersion: input.promptVersion ?? null,
      serverTs,
    })
    .returning();
  return row;
}

export interface IntegrityReport {
  conversationId: number;
  totalMessages: number;
  intact: boolean;
  brokenAtMessageId: number | null;
  brokenReason: string | null;
  finalHash: string | null;
  legacyMessages: number; // messages without hash (pre-Task#15)
}

/**
 * Walks every message in a conversation in id-ascending order and recomputes
 * each link. Returns the position of the first divergence, or `intact:true`
 * if the chain is whole. Messages without a `hash` column populated are
 * considered legacy (pre-feature) and counted separately so admins know how
 * much of the chain is verifiable.
 */
export async function verifyConversationIntegrity(
  conversationId: number,
): Promise<IntegrityReport> {
  const rows = await db.query.dentalMessagesTable.findMany({
    where: eq(dentalMessagesTable.conversationId, conversationId),
    orderBy: [asc(dentalMessagesTable.id)],
  });

  const report: IntegrityReport = {
    conversationId,
    totalMessages: rows.length,
    intact: true,
    brokenAtMessageId: null,
    brokenReason: null,
    finalHash: null,
    legacyMessages: 0,
  };

  let expectedPrev = GENESIS_HASH;
  let chainStarted = false;

  for (const m of rows) {
    if (!m.hash || !m.serverTs) {
      report.legacyMessages += 1;
      // Legacy messages do not break the chain — they predate the feature.
      // We resume the chain after the legacy messages with whatever the next
      // hashed message declares as prevHash.
      continue;
    }
    if (!chainStarted) {
      // first hashed message of conversation: its prevHash should be either
      // genesis, or the hash of the last legacy message (which we don't
      // recompute). Accept either.
      chainStarted = true;
      expectedPrev = m.prevHash ?? GENESIS_HASH;
    }
    if (m.prevHash !== expectedPrev) {
      report.intact = false;
      report.brokenAtMessageId = m.id;
      report.brokenReason = `prev_hash mismatch (stored=${m.prevHash ?? "null"}, expected=${expectedPrev})`;
      return report;
    }
    const recomputed = computeMessageHash({
      prevHash: m.prevHash ?? GENESIS_HASH,
      tenantId: m.tenantId,
      conversationId: m.conversationId,
      direction: m.direction,
      type: m.type,
      content: m.content ?? "",
      externalId: m.externalId ?? "",
      serverTs: m.serverTs,
      aiModel: m.aiModel ?? "",
      promptVersion: m.promptVersion ?? "",
    });
    if (recomputed !== m.hash) {
      report.intact = false;
      report.brokenAtMessageId = m.id;
      report.brokenReason = `content hash mismatch (stored=${m.hash}, recomputed=${recomputed})`;
      return report;
    }
    expectedPrev = m.hash;
    report.finalHash = m.hash;
  }
  return report;
}

// ─── Digital signature for export PDFs ──────────────────────────────────────

function getSigningKey(): Buffer {
  const k = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
  if (!k) {
    logger.error("audit-chain: no signing key available (DATA_ENCRYPTION_KEY / JWT_SECRET both empty)");
  }
  return Buffer.from(k, "utf8");
}

/**
 * Returns a hex HMAC-SHA-256 signature for the given payload, using the
 * server's data-encryption key as the secret. Used to sign PDF exports so
 * that any later tampering is detectable.
 */
export function signPayload(payload: string | Buffer): string {
  const key = getSigningKey();
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

export function verifyPayloadSignature(payload: string | Buffer, signatureHex: string): boolean {
  try {
    const expected = signPayload(payload);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signatureHex, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
