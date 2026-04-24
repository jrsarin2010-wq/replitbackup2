/**
 * Task #15 + #17 — Documentos legais versionados com aceite obrigatório.
 *
 * Suporta dois tipos (kind) de documento:
 *   - "tos"          → Termo de Uso da Secretária IA (task #15)
 *   - "subscription" → Contrato de Assinatura e Condições Comerciais (task #17)
 *
 * Endpoints (autenticados como tenant/dentista):
 *   GET  /current?kind=tos|subscription   — versão ativa do documento
 *   GET  /needs-acceptance                 — lista de documentos pendentes em ordem
 *   POST /accept  { kind }                 — registra aceite com timestamp/IP/user-agent
 *
 * Compatibilidade: GET /current sem `kind` continua devolvendo o `tos`.
 */

import { Router, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { db } from "@workspace/db";
import { tosVersionsTable, tosAcceptancesTable, tenantsTable, dentalSettingsTable } from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { tenantMiddleware } from "../../middlewares/tenant";
import { invalidateTosCacheForTenant } from "../../middlewares/tos-gate";
import { logger } from "../../lib/logger";
import { sendContractAcceptedEmail } from "../../lib/email";
import {
  ODONTOFLOW_COMPANY,
  formatCompanyAddress,
  formatCompanyLegalName,
  formatCompanyTaxId,
} from "../../lib/company-info";

type AcceptanceRow = typeof tosAcceptancesTable.$inferSelect;
type VersionRow = typeof tosVersionsTable.$inferSelect;
type TenantRow = typeof tenantsTable.$inferSelect;
type DentalSettingsRow = typeof dentalSettingsTable.$inferSelect;

function safeFilename(docTitle: string, acceptedAt: Date): string {
  const slug = docTitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug}-${acceptedAt.toISOString().slice(0, 10)}.pdf`;
}

/**
 * Builds the official PDF for an acceptance and returns it as a Buffer.
 * Used by both the download endpoint and the post-accept email dispatch.
 */
function buildAcceptancePdfBuffer(
  acc: AcceptanceRow,
  version: VersionRow,
  tenant: TenantRow | undefined,
  settings: DentalSettingsRow | undefined,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const docTitle = KIND_LABEL[acc.kind] ?? version.title;
    const acceptedAt = acc.acceptedAt;

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 70, bottom: 70, left: 64, right: 64 },
      info: {
        Title: docTitle,
        Author: ODONTOFLOW_COMPANY.brandName,
        Subject: docTitle,
        CreationDate: acceptedAt,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PRIMARY = "#0f172a";
    const ACCENT = "#0ea5e9";
    const MUTED = "#64748b";
    const RULE = "#e2e8f0";

    let pageNumber = 0;
    const paintFrame = () => {
      pageNumber += 1;
      const { width, height } = doc.page;
      doc.save();
      doc.lineWidth(0.6).strokeColor(RULE).moveTo(64, 48).lineTo(width - 64, 48).stroke();
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(PRIMARY).text("ODONTOFLOW", 64, 34, { lineBreak: false });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(docTitle, 64, 34, { width: width - 128, align: "right", lineBreak: false });
      doc
        .lineWidth(0.6)
        .strokeColor(RULE)
        .moveTo(64, height - 48)
        .lineTo(width - 64, height - 48)
        .stroke();
      const footerLeft =
        `Aceite nº ${acc.id} · ${acceptedAt.toISOString()} · IP ${acc.ipAddress ?? "—"} · ` +
        `Ref. doc. ${version.version} · UA ${(acc.userAgent ?? "—").slice(0, 40)}`;
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(footerLeft, 64, height - 40, {
          width: width - 200,
          align: "left",
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`Página ${pageNumber}`, 64, height - 40, {
          width: width - 128,
          align: "right",
          lineBreak: false,
        });
      doc.restore();
    };

    doc.on("pageAdded", paintFrame);

    paintFrame();
    doc.fillColor(ACCENT).rect(64, 95, 60, 4).fill();
    doc.moveDown(1);
    doc.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(22).text(docTitle, 64, 115, { width: doc.page.width - 128 });
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor(MUTED)
      .text(
        "Cópia oficial fornecida ao contratante para arquivo pessoal e fins probatórios " +
          "(cláusula 11.3 do contrato de assinatura).",
        { width: doc.page.width - 128 },
      );
    doc.moveDown(1.5);

    const labelValue = (label: string, value: string) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(label.toUpperCase(), { continued: false });
      doc.font("Helvetica").fontSize(11).fillColor(PRIMARY).text(value);
      doc.moveDown(0.5);
    };

    doc.font("Helvetica-Bold").fontSize(12).fillColor(PRIMARY).text("Contratada");
    doc.moveDown(0.3);
    labelValue("Razão social", formatCompanyLegalName(ODONTOFLOW_COMPANY));
    labelValue("CNPJ", formatCompanyTaxId(ODONTOFLOW_COMPANY));
    labelValue("Endereço", formatCompanyAddress(ODONTOFLOW_COMPANY));
    if (ODONTOFLOW_COMPANY.email) labelValue("E-mail", ODONTOFLOW_COMPANY.email);
    if (ODONTOFLOW_COMPANY.phone) labelValue("Telefone", ODONTOFLOW_COMPANY.phone);
    doc.moveDown(0.3);

    doc.font("Helvetica-Bold").fontSize(12).fillColor(PRIMARY).text("Contratante");
    doc.moveDown(0.3);
    labelValue("Clínica", settings?.clinicName ?? tenant?.name ?? "(não informado)");
    labelValue("Responsável", tenant?.name ?? "(não informado)");
    labelValue("E-mail", tenant?.email ?? "(não informado)");
    if (tenant?.cro) labelValue("CRO", tenant.cro);

    doc.addPage();
    doc.fillColor(ACCENT).rect(64, 70, 40, 3).fill();
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(PRIMARY).text("Conteúdo integral do documento", 64, 85);
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(10.5).fillColor(PRIMARY).text(version.content, {
      width: doc.page.width - 128,
      align: "justify",
      lineGap: 2,
    });

    doc.addPage();
    doc.fillColor(ACCENT).rect(64, 70, 40, 3).fill();
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY).text("Comprovante de aceite eletrônico", 64, 85);
    doc.moveDown(0.4);
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor(MUTED)
      .text(
        "Os dados abaixo foram registrados no momento em que o contratante manifestou " +
          "concordância com o documento, dentro da plataforma OdontoFlow.",
        { width: doc.page.width - 128 },
      );
    doc.moveDown(1);

    const boxX = 64;
    const boxW = doc.page.width - 128;
    const boxY = doc.y;
    const rows: Array<[string, string]> = [
      ["Documento aceito", docTitle],
      [
        "Referência interna do documento",
        `${version.version} (publicado em ${new Date(version.publishedAt).toLocaleDateString("pt-BR")})`,
      ],
      [
        "Data e hora do aceite",
        acceptedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (BRT)",
      ],
      ["Data e hora (UTC)", acceptedAt.toISOString()],
      ["Endereço IP de origem", acc.ipAddress ?? "(não capturado)"],
      ["User-agent do dispositivo", acc.userAgent ?? "(não capturado)"],
      ["Identificador do contratante", `Tenant #${acc.tenantId}`],
      ["Nº do registro de aceite", `#${acc.id}`],
    ];
    const rowH = 26;
    const boxH = rowH * rows.length + 16;
    doc.save();
    doc.roundedRect(boxX, boxY, boxW, boxH, 6).lineWidth(0.8).strokeColor(RULE).stroke();
    let y = boxY + 10;
    for (const [k, v] of rows) {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(MUTED)
        .text(k.toUpperCase(), boxX + 12, y, { width: 190, lineBreak: false });
      doc
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor(PRIMARY)
        .text(v, boxX + 210, y - 1, { width: boxW - 222, lineBreak: false, ellipsis: true });
      y += rowH;
    }
    doc.restore();
    doc.y = boxY + boxH + 14;

    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(
        "Este documento equivale, para todos os efeitos jurídicos, à manifestação " +
          "de vontade do contratante prevista nos artigos 219 e 425 do Código Civil " +
          "Brasileiro e no artigo 10, § 2º, da MP 2.200-2/2001. Sua autenticidade " +
          "pode ser verificada cruzando os dados acima com os registros de auditoria " +
          "armazenados pela OdontoFlow.",
        { width: doc.page.width - 128, align: "justify" },
      );

    doc.end();
  });
}

async function dispatchAcceptanceEmail(acc: AcceptanceRow, version: VersionRow): Promise<void> {
  try {
    const tenant = await db.query.tenantsTable.findFirst({ where: eq(tenantsTable.id, acc.tenantId) });
    if (!tenant?.email) {
      logger.warn(
        { tenantId: acc.tenantId, acceptanceId: acc.id, kind: acc.kind },
        "Skipping acceptance email — tenant has no email on file",
      );
      return;
    }
    const settings = await db.query.dentalSettingsTable.findFirst({
      where: eq(dentalSettingsTable.tenantId, acc.tenantId),
    });
    const pdf = await buildAcceptancePdfBuffer(acc, version, tenant, settings);
    const docTitle = KIND_LABEL[acc.kind] ?? version.title;
    const ok = await sendContractAcceptedEmail({
      to: tenant.email,
      clinicName: settings?.clinicName ?? tenant.name ?? "Cliente OdontoFlow",
      documentTitle: docTitle,
      versionLabel: version.version,
      acceptedAt: acc.acceptedAt,
      pdf,
      pdfFilename: safeFilename(docTitle, acc.acceptedAt),
    });
    logger.info(
      { tenantId: acc.tenantId, acceptanceId: acc.id, kind: acc.kind, sent: ok, to: tenant.email },
      "Post-acceptance contract email dispatched",
    );
  } catch (err) {
    logger.error(
      { err, tenantId: acc.tenantId, acceptanceId: acc.id, kind: acc.kind },
      "Failed to dispatch post-acceptance contract email",
    );
  }
}

const KIND_LABEL: Record<string, string> = {
  tos: "Termo de Uso da Secretária IA",
  subscription: "Contrato de Assinatura e Condições Comerciais",
};

const router = Router();
router.use(tenantMiddleware);

const VALID_KINDS = ["tos", "subscription"] as const;
type DocKind = (typeof VALID_KINDS)[number];
const KIND_ORDER: DocKind[] = ["tos", "subscription"];

function isDocKind(raw: unknown): raw is DocKind {
  return typeof raw === "string" && (VALID_KINDS as readonly string[]).includes(raw);
}

function parseKindOrDefault(raw: unknown, fallback: DocKind = "tos"): DocKind {
  return isDocKind(raw) ? raw : fallback;
}

async function getActiveVersion(kind: DocKind) {
  return db.query.tosVersionsTable.findFirst({
    where: and(eq(tosVersionsTable.active, true), eq(tosVersionsTable.kind, kind)),
    orderBy: [desc(tosVersionsTable.publishedAt)],
  });
}

router.get("/current", async (req: Request, res: Response) => {
  const raw = req.query.kind;
  if (raw !== undefined && !isDocKind(raw)) {
    res.status(400).json({ error: "invalid_kind", message: "kind deve ser 'tos' ou 'subscription'." });
    return;
  }
  const kind = parseKindOrDefault(raw);
  const v = await getActiveVersion(kind);
  if (!v) {
    res.status(404).json({ error: `Nenhuma versão ativa para o documento '${kind}'.` });
    return;
  }
  res.json({
    id: v.id,
    kind: v.kind,
    version: v.version,
    title: v.title,
    content: v.content,
    publishedAt: v.publishedAt,
  });
});

router.get("/needs-acceptance", async (req: Request, res: Response) => {
  const pending: Array<{
    kind: DocKind;
    versionId: number;
    version: string;
    title: string;
    publishedAt: Date;
  }> = [];

  for (const kind of KIND_ORDER) {
    const v = await getActiveVersion(kind);
    if (!v) continue;
    const accepted = await db.query.tosAcceptancesTable.findFirst({
      where: and(
        eq(tosAcceptancesTable.tenantId, req.tenantId),
        eq(tosAcceptancesTable.tosVersionId, v.id),
      ),
    });
    if (!accepted) {
      pending.push({
        kind: v.kind as DocKind,
        versionId: v.id,
        version: v.version,
        title: v.title,
        publishedAt: v.publishedAt,
      });
    }
  }

  // Backward-compat: campos antigos (versionId/version/title) refletem o primeiro pendente
  // para clientes que ainda não conhecem o array `pending`.
  const first = pending[0];
  res.json({
    needsAcceptance: pending.length > 0,
    pending,
    versionId: first?.versionId,
    version: first?.version,
    title: first?.title,
    publishedAt: first?.publishedAt,
  });
});

router.post("/accept", async (req: Request, res: Response) => {
  const raw = (req.body as { kind?: unknown } | undefined)?.kind;
  if (!isDocKind(raw)) {
    res.status(400).json({ error: "invalid_kind", message: "Body deve incluir kind = 'tos' ou 'subscription'." });
    return;
  }
  const kind: DocKind = raw;
  const v = await getActiveVersion(kind);
  if (!v) {
    res.status(404).json({ error: `Nenhuma versão ativa para o documento '${kind}'.` });
    return;
  }

  const ipRaw =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const ip = ipRaw ? ipRaw.slice(0, 64) : null;
  const ua = (req.headers["user-agent"] as string | undefined)?.slice(0, 500) || null;

  try {
    const inserted = await db
      .insert(tosAcceptancesTable)
      .values({
        tenantId: req.tenantId,
        tosVersionId: v.id,
        kind,
        versionLabel: v.version,
        ipAddress: ip,
        userAgent: ua,
      })
      .onConflictDoNothing()
      .returning();
    invalidateTosCacheForTenant(req.tenantId);
    logger.info({ tenantId: req.tenantId, kind, version: v.version, ip }, "Legal document acceptance recorded");

    // Task #21 — On a fresh acceptance, e-mail the official PDF to the tenant.
    // Failure to send must not block the acceptance response (only logged).
    const newAcceptance = inserted[0];
    if (newAcceptance) {
      void dispatchAcceptanceEmail(newAcceptance, v);
    }

    res.json({ ok: true, kind, version: v.version });
  } catch (err) {
    logger.error({ err, tenantId: req.tenantId, kind }, "Legal document acceptance failed");
    res.status(500).json({ error: "Não foi possível registrar o aceite." });
  }
});

// ─── Task #18 — Listar aceites do próprio tenant ────────────────────────────
router.get("/acceptances", async (req: Request, res: Response) => {
  const rows = await db
    .select({
      id: tosAcceptancesTable.id,
      kind: tosAcceptancesTable.kind,
      acceptedAt: tosAcceptancesTable.acceptedAt,
      ipAddress: tosAcceptancesTable.ipAddress,
      userAgent: tosAcceptancesTable.userAgent,
      tosVersionId: tosAcceptancesTable.tosVersionId,
      title: tosVersionsTable.title,
      publishedAt: tosVersionsTable.publishedAt,
    })
    .from(tosAcceptancesTable)
    .leftJoin(tosVersionsTable, eq(tosVersionsTable.id, tosAcceptancesTable.tosVersionId))
    .where(eq(tosAcceptancesTable.tenantId, req.tenantId))
    .orderBy(asc(tosAcceptancesTable.kind), desc(tosAcceptancesTable.acceptedAt));

  res.json({
    acceptances: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: KIND_LABEL[r.kind] ?? r.title ?? r.kind,
      title: r.title,
      acceptedAt: r.acceptedAt,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      publishedAt: r.publishedAt,
    })),
  });
});

// ─── Task #18 — Baixar PDF do contrato/termo aceito pelo próprio tenant ─────
router.get("/acceptance/:id/pdf", async (req: Request, res: Response) => {
  const acceptanceId = Number(req.params.id);
  if (!Number.isFinite(acceptanceId)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const acc = await db.query.tosAcceptancesTable.findFirst({
    where: and(
      eq(tosAcceptancesTable.id, acceptanceId),
      eq(tosAcceptancesTable.tenantId, req.tenantId),
    ),
  });
  if (!acc) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const version = await db.query.tosVersionsTable.findFirst({
    where: eq(tosVersionsTable.id, acc.tosVersionId),
  });
  if (!version) {
    res.status(404).json({ error: "version_not_found" });
    return;
  }

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, acc.tenantId),
  });
  const settings = await db.query.dentalSettingsTable.findFirst({
    where: eq(dentalSettingsTable.tenantId, acc.tenantId),
  });

  const docTitle = KIND_LABEL[acc.kind] ?? version.title;
  const acceptedAt = acc.acceptedAt;
  const filename = safeFilename(docTitle, acceptedAt);

  const pdfBuffer = await buildAcceptancePdfBuffer(acc, version, tenant, settings);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(pdfBuffer.length));
  res.end(pdfBuffer);
  logger.info(
    { tenantId: req.tenantId, acceptanceId: acc.id, kind: acc.kind },
    "Tenant downloaded acceptance PDF",
  );
});

export default router;
