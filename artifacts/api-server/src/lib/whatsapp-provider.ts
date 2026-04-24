import axios from "axios";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { isWhatsappDisconnectionError, notifyWhatsappDisconnected } from "./whatsapp-disconnection-alert";

export interface WhatsappProvider {
  sendMessage(phone: string, message: string, instanceName: string): Promise<void>;
  sendAudio(phone: string, audioBase64: string, instanceName: string, mimetype?: string): Promise<void>;
  sendVideo(phone: string, videoUrl: string, caption: string, instanceName: string): Promise<void>;
  sendImage(phone: string, imageUrl: string, caption: string, instanceName: string): Promise<void>;
  sendImageBase64(phone: string, imageBase64: string, caption: string, instanceName: string): Promise<void>;
  sendPresence(phone: string, instanceName: string, state: "composing" | "paused"): Promise<void>;
  sendReaction(phone: string, messageId: string, emoji: string, instanceName: string): Promise<void>;
  getQRCode(instanceName: string): Promise<{ qrCode: string | null; status: string }>;
  getStatus(instanceName: string): Promise<{ connected: boolean; status: string; phone?: string }>;
  disconnect(instanceName: string): Promise<void>;
  downloadMedia(messageId: string, instanceName: string): Promise<Buffer | null>;
  getProfilePicture(phone: string, instanceName: string): Promise<string | null>;
  resolvePhoneFromLid?(lid: string, instanceName: string): Promise<string | null>;
}

export class EvolutionApiProvider implements WhatsappProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private get headers() {
    return { apikey: this.apiKey, "Content-Type": "application/json" };
  }

  private normalizePhone(phone: string): string {
    return phone.replace("@s.whatsapp.net", "").replace("@lid", "");
  }

  async sendMessage(phone: string, message: string, instanceName: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(phone);
    try {
      const response = await axios.post(
        `${this.baseUrl}/message/sendText/${instanceName}`,
        { number: normalizedPhone, text: message },
        { headers: this.headers }
      );
      logger.info(
        { instanceName, phone: normalizedPhone, status: response.status, responseBody: JSON.stringify(response.data ?? null) },
        "Evolution API sendMessage success"
      );
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const responseBody = err.response?.data;
        logger.error(
          {
            instanceName,
            phone: normalizedPhone,
            status: err.response?.status,
            responseBody: JSON.stringify(responseBody ?? null),
            message: err.message,
          },
          "Evolution API sendMessage failed"
        );
        if (isWhatsappDisconnectionError(responseBody)) {
          const detail = typeof responseBody === "object" && responseBody !== null
            ? JSON.stringify(responseBody).slice(0, 200)
            : String(responseBody ?? "").slice(0, 200);
          void notifyWhatsappDisconnected(instanceName, detail);
        }
      } else {
        logger.error({ instanceName, phone: normalizedPhone, err }, "Evolution API sendMessage failed (non-axios)");
      }
      throw err;
    }
  }

  async sendAudio(phone: string, audioBase64: string, instanceName: string, mimetype = "audio/ogg"): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendMedia/${instanceName}`,
      { number: this.normalizePhone(phone), mediatype: "audio", mimetype, media: audioBase64 },
      { headers: this.headers }
    );
  }

  async sendVideo(phone: string, videoUrl: string, caption: string, instanceName: string): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendMedia/${instanceName}`,
      { number: this.normalizePhone(phone), mediatype: "video", mediaUrl: videoUrl, caption },
      { headers: this.headers }
    );
  }

  async sendImage(phone: string, imageUrl: string, caption: string, instanceName: string): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendMedia/${instanceName}`,
      { number: this.normalizePhone(phone), mediatype: "image", mediaUrl: imageUrl, caption },
      { headers: this.headers }
    );
  }

  async sendImageBase64(phone: string, imageBase64: string, caption: string, instanceName: string): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendMedia/${instanceName}`,
      { number: this.normalizePhone(phone), mediatype: "image", mimetype: "image/jpeg", media: imageBase64, caption },
      { headers: this.headers }
    );
  }

  async sendPresence(phone: string, instanceName: string, state: "composing" | "paused"): Promise<void> {
    try {
      const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
      await axios.post(
        `${this.baseUrl}/chat/updatePresence/${instanceName}`,
        { number: jid, presence: state },
        { headers: this.headers }
      );
    } catch (err) {
      logger.debug({ err, phone, state, instanceName }, "Failed to send presence update (non-critical)");
    }
  }

  async sendReaction(phone: string, messageId: string, emoji: string, instanceName: string): Promise<void> {
    try {
      const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
      await axios.post(
        `${this.baseUrl}/message/sendReaction/${instanceName}`,
        { key: { remoteJid: jid, fromMe: false, id: messageId }, reaction: emoji },
        { headers: this.headers }
      );
    } catch (err) {
      logger.debug({ err, phone, messageId, emoji, instanceName }, "Failed to send reaction (non-critical)");
    }
  }

  async getQRCode(instanceName: string): Promise<{ qrCode: string | null; status: string }> {
    try {
      const res = await axios.get(`${this.baseUrl}/instance/connect/${instanceName}`, { headers: this.headers });
      const data = res.data as Record<string, unknown>;
      const instance = (data.instance as Record<string, unknown>) || {};
      const state = (instance.state as string) || (data.state as string) || "qr_pending";
      const qrCode = (data.base64 as string) || (data.qrcode as string) || (data.code as string) || null;
      return { qrCode, status: state };
    } catch {
      return { qrCode: null, status: "error" };
    }
  }

  async getStatus(instanceName: string): Promise<{ connected: boolean; status: string; phone?: string }> {
    try {
      const res = await axios.get(`${this.baseUrl}/instance/connectionState/${instanceName}`, { headers: this.headers });
      const data = res.data as Record<string, unknown>;
      const instance = (data.instance as Record<string, unknown>) || {};
      const state = (instance.state as string) || (data.state as string) || "disconnected";
      let phone: string | undefined;
      if (state === "open") {
        try {
          const infoRes = await axios.get(`${this.baseUrl}/instance/fetchInstances`, { headers: this.headers, params: { instanceName } });
          const instances = Array.isArray(infoRes.data) ? infoRes.data : [infoRes.data];
          const inst = instances.find((i: Record<string, unknown>) => i.name === instanceName) || instances[0];
          const ownerJid = (inst?.ownerJid as string) || "";
          phone = ownerJid.split("@")[0] || undefined;
        } catch {}
      }
      return { connected: state === "open", status: state, phone };
    } catch {
      return { connected: false, status: "disconnected" };
    }
  }

  async disconnect(instanceName: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/instance/logout/${instanceName}`, { headers: this.headers });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        const msg = JSON.stringify(err.response?.data || "");
        if (msg.includes("not connected") || msg.includes("disconnected")) {
          logger.info({ instanceName }, "Instance already disconnected — treating as success");
          return;
        }
      }
      throw err;
    }
  }

  async downloadMedia(messageId: string, instanceName: string): Promise<Buffer | null> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
        { message: { key: { id: messageId } } },
        { headers: this.headers }
      );
      const data = res.data as Record<string, unknown>;
      const base64 = (data.base64 as string) || "";
      if (!base64) return null;
      return Buffer.from(base64, "base64");
    } catch (err) {
      logger.error({ err, messageId, instanceName }, "Failed to download media from Evolution API");
      return null;
    }
  }

  async getProfilePicture(phone: string, instanceName: string): Promise<string | null> {
    try {
      const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
      const res = await axios.post(
        `${this.baseUrl}/chat/fetchProfilePictureUrl/${instanceName}`,
        { number: jid },
        { headers: this.headers }
      );
      const data = res.data as Record<string, unknown>;
      const url = (data.profilePictureUrl as string) || (data.profilePicUrl as string) || (data.url as string) || null;
      return url || null;
    } catch (err) {
      logger.debug({ err, phone, instanceName }, "Could not fetch profile picture");
      return null;
    }
  }

  async resolvePhoneFromLid(lid: string, instanceName: string): Promise<string | null> {
    try {
      const cleanLid = lid.replace("@lid", "").replace("@s.whatsapp.net", "");
      const jid = `${cleanLid}@lid`;
      const res = await axios.post(
        `${this.baseUrl}/chat/findContacts/${instanceName}`,
        { where: { id: jid } },
        { headers: this.headers }
      );
      const contacts = Array.isArray(res.data) ? res.data : [res.data];
      for (const contact of contacts) {
        const c = contact as Record<string, unknown>;
        const contactId = (c.id as string) || "";
        const notify = (c.notify as string) || "";
        const verifiedName = (c.verifiedName as string) || "";
        const pushName = (c.pushName as string) || "";
        const phone = (c.number as string) || (c.phone as string) || "";
        if (phone) return phone;
        if (contactId && contactId.includes("@s.whatsapp.net")) {
          return contactId.replace("@s.whatsapp.net", "");
        }
      }

      const res2 = await axios.post(
        `${this.baseUrl}/chat/findContacts/${instanceName}`,
        { where: { id: `${cleanLid}@s.whatsapp.net` } },
        { headers: this.headers }
      );
      const contacts2 = Array.isArray(res2.data) ? res2.data : [res2.data];
      for (const contact of contacts2) {
        const c = contact as Record<string, unknown>;
        const phone = (c.number as string) || (c.phone as string) || "";
        if (phone) return phone;
      }

      return null;
    } catch (err) {
      logger.debug({ err, lid, instanceName }, "Could not resolve phone from LID");
      return null;
    }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/instance/delete/${instanceName}`, { headers: this.headers });
      logger.info({ instanceName }, "Evolution API instance deleted");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        logger.info({ instanceName }, "Instance not found during delete — treating as success");
        return;
      }
      throw err;
    }
  }

  async instanceExists(instanceName: string): Promise<boolean> {
    try {
      const res = await axios.get(`${this.baseUrl}/instance/fetchInstances`, { headers: this.headers });
      const instances = res.data as { name: string }[];
      return instances.some((i) => i.name === instanceName);
    } catch {
      return false;
    }
  }

  async createInstance(instanceName: string): Promise<{ qrCode: string | null }> {
    const res = await axios.post(
      `${this.baseUrl}/instance/create`,
      {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        rejectCall: true,
        storeMessages: true,
        msgCall: "Não aceitamos chamadas por este número. Por favor, envie uma mensagem de texto.",
      },
      { headers: this.headers }
    );
    logger.info({ instanceName }, "Evolution API instance created");
    const data = res.data as Record<string, unknown>;
    const qrcodeObj = (data.qrcode as Record<string, unknown>) || {};
    const qrCode = (qrcodeObj.base64 as string) || (data.base64 as string) || null;
    return { qrCode };
  }

  async ensureMessageStorage(instanceName: string): Promise<void> {
    try {
      const settingsResp = await axios.get(
        `${this.baseUrl}/settings/find/${instanceName}`,
        { headers: this.headers, timeout: 10000 }
      );
      const current = settingsResp.data || {};
      const body = {
        ...current,
        rejectCall: current.rejectCall ?? true,
        groupsIgnore: current.groupsIgnore ?? true,
        alwaysOnline: current.alwaysOnline ?? true,
        readMessages: current.readMessages ?? true,
        readStatus: current.readStatus ?? false,
        syncFullHistory: current.syncFullHistory ?? false,
        storeMessages: true,
      };
      await axios.post(
        `${this.baseUrl}/settings/set/${instanceName}`,
        body,
        { headers: this.headers, timeout: 10000 }
      );
      logger.info({ instanceName }, "Evolution API: storeMessages enabled via settings");
      return;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      logger.debug({ instanceName, status }, "Evolution API: could not enable storeMessages — webhook delivery is primary path");
    }
  }

  async setupWebhook(instanceName: string, webhookUrl: string): Promise<void> {
    const buildBody = (eventFormat: "v2" | "v1") => ({
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: true,
        events: eventFormat === "v2"
          ? ["messages.upsert", "connection.update"]
          : ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    });
    try {
      await axios.post(
        `${this.baseUrl}/webhook/set/${instanceName}`,
        buildBody("v2"),
        { headers: this.headers }
      );
      logger.info({ instanceName, webhookUrl, eventFormat: "v2" }, "Evolution API webhook configured");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400 || status === 422) {
        logger.warn({ instanceName, status }, "Evolution API webhook v2 format rejected, retrying with v1 uppercase format");
        await axios.post(
          `${this.baseUrl}/webhook/set/${instanceName}`,
          buildBody("v1"),
          { headers: this.headers }
        );
        logger.info({ instanceName, webhookUrl, eventFormat: "v1" }, "Evolution API webhook configured");
      } else {
        throw err;
      }
    }
  }
}

export interface CapturedMessage {
  phone: string;
  message: string;
  instanceName: string;
  timestamp: Date;
}

export class MockWhatsappProvider implements WhatsappProvider {
  public capturedMessages: CapturedMessage[] = [];

  async sendMessage(phone: string, message: string, instanceName: string): Promise<void> {
    logger.info({ phone, message, instanceName }, "[MockWhatsApp] sendMessage");
    this.capturedMessages.push({ phone, message, instanceName, timestamp: new Date() });
  }
  async sendAudio(phone: string, _audioBase64: string, instanceName: string, _mimetype?: string): Promise<void> {
    logger.info({ phone, instanceName }, "[MockWhatsApp] sendAudio");
  }
  async sendVideo(phone: string, videoUrl: string, caption: string, instanceName: string): Promise<void> {
    logger.info({ phone, videoUrl, caption, instanceName }, "[MockWhatsApp] sendVideo");
  }
  async sendImage(phone: string, imageUrl: string, caption: string, instanceName: string): Promise<void> {
    logger.info({ phone, imageUrl, caption, instanceName }, "[MockWhatsApp] sendImage");
  }
  async sendImageBase64(phone: string, _imageBase64: string, caption: string, instanceName: string): Promise<void> {
    logger.info({ phone, caption, instanceName }, "[MockWhatsApp] sendImageBase64");
  }
  async sendPresence(_phone: string, _instanceName: string, _state: "composing" | "paused"): Promise<void> {}
  async sendReaction(_phone: string, _messageId: string, _emoji: string, _instanceName: string): Promise<void> {}
  async getQRCode(_instanceName: string): Promise<{ qrCode: string | null; status: string }> {
    return { qrCode: "MOCK_QR_CODE_DATA", status: "qr_pending" };
  }
  async getStatus(_instanceName: string): Promise<{ connected: boolean; status: string }> {
    return { connected: false, status: "disconnected" };
  }
  async disconnect(_instanceName: string): Promise<void> {}
  async downloadMedia(_messageId: string, _instanceName: string): Promise<Buffer | null> {
    logger.info({ _messageId }, "[MockWhatsApp] downloadMedia");
    return null;
  }
  async getProfilePicture(_phone: string, _instanceName: string): Promise<string | null> {
    return null;
  }

  clearCaptured(): void {
    this.capturedMessages = [];
  }

  getCapturedFor(phone: string): CapturedMessage[] {
    return this.capturedMessages.filter((m) => m.phone === phone);
  }
}

export type WhatsappProviderKind = "evolution" | "uazapi";

export function getDefaultProviderKind(): WhatsappProviderKind {
  const v = (process.env.WHATSAPP_PROVIDER || "evolution").toLowerCase();
  return v === "uazapi" ? "uazapi" : "evolution";
}

export function getGlobalProvider(): EvolutionApiProvider | null {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (url && key) return new EvolutionApiProvider(url, key);
  return null;
}

let testProviderOverride: WhatsappProvider | null = null;

export function setTestProvider(provider: WhatsappProvider | null): void {
  testProviderOverride = provider;
}

export async function getProviderForTenant(tenantId: number): Promise<{ provider: WhatsappProvider; instanceName: string; kind: WhatsappProviderKind }> {
  const { getTenantWithDecryptedKeys } = await import("./tenant-helpers");
  const tenant = await getTenantWithDecryptedKeys(tenantId);
  if (!tenant) throw new Error("Tenant not found");

  const instanceName = tenant.evolutionInstanceName || `dental-${tenantId}`;

  if (testProviderOverride) {
    return { provider: testProviderOverride, instanceName, kind: "evolution" };
  }

  const kind: WhatsappProviderKind = (tenant.whatsappProvider as WhatsappProviderKind) || getDefaultProviderKind();

  if (kind === "uazapi") {
    const { UazapiProvider, getGlobalUazapiAdmin } = await import("./whatsapp-providers/uazapi");
    const host = tenant.uazapiHost || process.env.UAZAPI_HOST;
    const instanceToken = tenant.uazapiInstanceToken || "";
    const adminToken = tenant.uazapiAdminToken || process.env.UAZAPI_ADMIN_TOKEN || null;
    if (host && instanceToken) {
      return {
        provider: new UazapiProvider(host, instanceToken, adminToken),
        instanceName,
        kind: "uazapi",
      };
    }
    const globalAdmin = getGlobalUazapiAdmin();
    if (globalAdmin && instanceToken) {
      return {
        provider: new UazapiProvider(globalAdmin.host, instanceToken, globalAdmin.adminToken),
        instanceName,
        kind: "uazapi",
      };
    }
    logger.error({ tenantId, hasHost: !!host, hasInstanceToken: !!instanceToken, hasAdmin: !!adminToken }, "uazapi provider selected for tenant but required credentials are missing");
    throw new Error(
      `WhatsApp provider 'uazapi' is selected for tenant ${tenantId} but credentials are missing. ` +
      `Configure tenants.uazapi_host + tenants.uazapi_instance_token (or global UAZAPI_HOST + UAZAPI_ADMIN_TOKEN), ` +
      `then call POST /api/dental/whatsapp/recreate to provision the instance.`,
    );
  }

  if (tenant.evolutionApiUrl && tenant.evolutionApiKey) {
    return {
      provider: new EvolutionApiProvider(tenant.evolutionApiUrl, tenant.evolutionApiKey),
      instanceName,
      kind: "evolution",
    };
  }

  const globalProvider = getGlobalProvider();
  if (globalProvider) {
    return { provider: globalProvider, instanceName, kind: "evolution" };
  }

  return { provider: new MockWhatsappProvider(), instanceName, kind: "evolution" };
}

export function getWebhookUrl(): string {
  let base: string;
  if (process.env.WEBHOOK_BASE_URL) {
    base = process.env.WEBHOOK_BASE_URL.replace(/\/$/, "");
  } else if (process.env.REPLIT_DEPLOYMENT_URL) {
    base = process.env.REPLIT_DEPLOYMENT_URL.replace(/\/$/, "");
  } else if (process.env.REPLIT_DOMAINS) {
    base = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
  } else {
    base = "http://localhost:8080";
  }
  return `${base}/api/dental/webhook/whatsapp`;
}
