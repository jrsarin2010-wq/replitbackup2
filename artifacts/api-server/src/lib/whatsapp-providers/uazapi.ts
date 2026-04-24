import axios from "axios";
import { logger } from "../logger";
import { isWhatsappDisconnectionError, notifyWhatsappDisconnected } from "../whatsapp-disconnection-alert";
import type { WhatsappProvider } from "../whatsapp-provider";

const UAZAPI_DISCONNECTION_PATTERNS = [
  "not connected",
  "disconnected",
  "connection_lost",
  "logged_out",
  "not logged in",
];

export function isUazapiDisconnectionError(responseBody: unknown): boolean {
  if (!responseBody) return false;
  const text = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
  const lower = text.toLowerCase();
  if (UAZAPI_DISCONNECTION_PATTERNS.some((p) => lower.includes(p))) return true;
  if (typeof responseBody === "object" && responseBody !== null) {
    const obj = responseBody as Record<string, unknown>;
    if (obj.error_source === "whatsapp_server") return true;
    if (typeof obj.provider_code === "number" && (obj.provider_code === 463 || obj.provider_code === 401)) return true;
  }
  return isWhatsappDisconnectionError(responseBody);
}

export class UazapiProvider implements WhatsappProvider {
  private host: string;
  private instanceToken: string;
  private adminToken: string | null;

  constructor(host: string, instanceToken: string, adminToken?: string | null) {
    this.host = host.replace(/\/$/, "");
    this.instanceToken = instanceToken;
    this.adminToken = adminToken ?? null;
  }

  private headers(useAdmin = false): Record<string, string> {
    if (useAdmin) {
      if (!this.adminToken) {
        throw new Error("uazapi admin token not configured for this operation");
      }
      return { admintoken: this.adminToken, "Content-Type": "application/json" };
    }
    return { token: this.instanceToken, "Content-Type": "application/json" };
  }

  private normalizePhone(phone: string): string {
    return phone.replace("@s.whatsapp.net", "").replace("@lid", "");
  }

  private handleSendError(operation: string, instanceName: string, phone: string, err: unknown): void {
    if (axios.isAxiosError(err)) {
      const responseBody = err.response?.data;
      logger.error(
        {
          provider: "uazapi",
          operation,
          instanceName,
          phone,
          status: err.response?.status,
          responseBody: JSON.stringify(responseBody ?? null),
          message: err.message,
        },
        `uazapi ${operation} failed`,
      );
      if (isUazapiDisconnectionError(responseBody)) {
        const detail = typeof responseBody === "object" && responseBody !== null
          ? JSON.stringify(responseBody).slice(0, 200)
          : String(responseBody ?? "").slice(0, 200);
        void notifyWhatsappDisconnected(instanceName, detail);
      }
    } else {
      logger.error({ provider: "uazapi", operation, instanceName, phone, err }, `uazapi ${operation} failed (non-axios)`);
    }
  }

  async sendMessage(phone: string, message: string, instanceName: string): Promise<void> {
    const number = this.normalizePhone(phone);
    try {
      const res = await axios.post(
        `${this.host}/send/text`,
        { number, text: message },
        { headers: this.headers() },
      );
      logger.info(
        { provider: "uazapi", instanceName, phone: number, status: res.status },
        "uazapi sendMessage success",
      );
    } catch (err) {
      this.handleSendError("sendMessage", instanceName, number, err);
      throw err;
    }
  }

  async sendAudio(phone: string, audioBase64: string, instanceName: string, mimetype = "audio/ogg"): Promise<void> {
    const number = this.normalizePhone(phone);
    try {
      const isPtt = mimetype.includes("ogg") || mimetype.includes("opus");
      await axios.post(
        `${this.host}/send/media`,
        { number, type: isPtt ? "ptt" : "audio", file: audioBase64, mimetype },
        { headers: this.headers() },
      );
    } catch (err) {
      this.handleSendError("sendAudio", instanceName, number, err);
      throw err;
    }
  }

  async sendVideo(phone: string, videoUrl: string, caption: string, instanceName: string): Promise<void> {
    const number = this.normalizePhone(phone);
    try {
      await axios.post(
        `${this.host}/send/media`,
        { number, type: "video", file: videoUrl, text: caption },
        { headers: this.headers() },
      );
    } catch (err) {
      this.handleSendError("sendVideo", instanceName, number, err);
      throw err;
    }
  }

  async sendImage(phone: string, imageUrl: string, caption: string, instanceName: string): Promise<void> {
    const number = this.normalizePhone(phone);
    try {
      await axios.post(
        `${this.host}/send/media`,
        { number, type: "image", file: imageUrl, text: caption },
        { headers: this.headers() },
      );
    } catch (err) {
      this.handleSendError("sendImage", instanceName, number, err);
      throw err;
    }
  }

  async sendImageBase64(phone: string, imageBase64: string, caption: string, instanceName: string): Promise<void> {
    const number = this.normalizePhone(phone);
    try {
      await axios.post(
        `${this.host}/send/media`,
        { number, type: "image", file: imageBase64, mimetype: "image/jpeg", text: caption },
        { headers: this.headers() },
      );
    } catch (err) {
      this.handleSendError("sendImageBase64", instanceName, number, err);
      throw err;
    }
  }

  async sendPresence(phone: string, _instanceName: string, state: "composing" | "paused"): Promise<void> {
    try {
      const number = this.normalizePhone(phone);
      const presence = state === "composing" ? "composing" : "paused";
      await axios.post(
        `${this.host}/message/presence`,
        { number, presence },
        { headers: this.headers() },
      );
    } catch (err) {
      logger.debug({ err, phone, state }, "uazapi sendPresence failed (non-critical)");
    }
  }

  async sendReaction(phone: string, messageId: string, emoji: string, _instanceName: string): Promise<void> {
    try {
      const number = this.normalizePhone(phone);
      await axios.post(
        `${this.host}/message/react`,
        { number, id: messageId, text: emoji },
        { headers: this.headers() },
      );
    } catch (err) {
      logger.debug({ err, phone, messageId, emoji }, "uazapi sendReaction failed (non-critical)");
    }
  }

  async getQRCode(_instanceName: string): Promise<{ qrCode: string | null; status: string }> {
    try {
      const res = await axios.post(
        `${this.host}/instance/connect`,
        {},
        { headers: this.headers() },
      );
      const data = res.data as Record<string, unknown>;
      const instance = (data.instance as Record<string, unknown>) || {};
      const status = (instance.status as string) || (data.status as string) || "qr_pending";
      const qrcode = (instance.qrcode as string) || (data.qrcode as string) || null;
      const normalizedStatus = status === "connected" ? "open" : status;
      return { qrCode: qrcode, status: normalizedStatus };
    } catch (err) {
      logger.debug({ err }, "uazapi getQRCode failed");
      return { qrCode: null, status: "error" };
    }
  }

  async getStatus(_instanceName: string): Promise<{ connected: boolean; status: string; phone?: string }> {
    try {
      const res = await axios.get(`${this.host}/instance/status`, { headers: this.headers() });
      const data = res.data as Record<string, unknown>;
      const instance = (data.instance as Record<string, unknown>) || {};
      const status = (instance.status as string) || (data.status as string) || "disconnected";
      const connected = status === "connected" || status === "open";
      const owner = (instance.owner as string) || (instance.wid as string) || "";
      const phone = owner ? owner.split("@")[0] : undefined;
      return { connected, status: connected ? "open" : status, phone: phone || undefined };
    } catch (err) {
      logger.debug({ err }, "uazapi getStatus failed");
      return { connected: false, status: "disconnected" };
    }
  }

  async disconnect(_instanceName: string): Promise<void> {
    try {
      await axios.post(`${this.host}/instance/disconnect`, {}, { headers: this.headers() });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const body = JSON.stringify(err.response?.data || "");
        if (status === 400 && (body.includes("not connected") || body.includes("disconnected"))) {
          return;
        }
      }
      throw err;
    }
  }

  async downloadMedia(messageId: string, instanceName: string): Promise<Buffer | null> {
    try {
      const res = await axios.post(
        `${this.host}/message/download`,
        { id: messageId, return_base64: true },
        { headers: this.headers() },
      );
      const data = res.data as Record<string, unknown>;
      const base64 = (data.base64Data as string) || (data.base64 as string) || "";
      if (base64) return Buffer.from(base64, "base64");
      const fileUrl = (data.fileURL as string) || (data.fileUrl as string) || "";
      if (fileUrl) {
        const dl = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 30000 });
        return Buffer.from(dl.data as ArrayBuffer);
      }
      return null;
    } catch (err) {
      logger.error({ err, messageId, instanceName }, "uazapi downloadMedia failed");
      return null;
    }
  }

  async getProfilePicture(phone: string, _instanceName: string): Promise<string | null> {
    try {
      const number = this.normalizePhone(phone);
      const res = await axios.post(
        `${this.host}/chat/getProfilePicture`,
        { number, preview: false },
        { headers: this.headers() },
      );
      const data = res.data as Record<string, unknown>;
      const url = (data.url as string) || (data.imgURL as string) || (data.picture as string) || null;
      return url || null;
    } catch (err) {
      logger.debug({ err, phone }, "uazapi getProfilePicture failed");
      return null;
    }
  }

  async resolvePhoneFromLid(_lid: string, _instanceName: string): Promise<string | null> {
    return null;
  }

  async createInstance(instanceName: string): Promise<{ qrCode: string | null; instanceId?: string; instanceToken?: string }> {
    if (!this.adminToken) {
      throw new Error("uazapi admin token required to create an instance");
    }
    const res = await axios.post(
      `${this.host}/instance/init`,
      { name: instanceName, systemName: "DentalAI" },
      { headers: this.headers(true) },
    );
    const data = res.data as Record<string, unknown>;
    const instance = (data.instance as Record<string, unknown>) || data;
    const instanceId = (instance.id as string) || (instance.instanceId as string) || "";
    const instanceToken = (instance.token as string) || "";
    logger.info({ provider: "uazapi", instanceName, instanceId }, "uazapi instance created");
    return { qrCode: null, instanceId, instanceToken };
  }

  async instanceExists(_instanceName: string): Promise<boolean> {
    try {
      const res = await axios.get(`${this.host}/instance/status`, { headers: this.headers() });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    try {
      await axios.delete(`${this.host}/instance`, { headers: this.headers() });
      logger.info({ provider: "uazapi", instanceName }, "uazapi instance deleted");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return;
      throw err;
    }
  }

  async ensureMessageStorage(_instanceName: string): Promise<void> {
    return;
  }

  async setupWebhook(instanceName: string, webhookUrl: string): Promise<void> {
    try {
      await axios.post(
        `${this.host}/webhook`,
        {
          url: webhookUrl,
          enabled: true,
          events: ["messages", "connection"],
          excludeMessages: ["wasSentByApi"],
        },
        { headers: this.headers() },
      );
      logger.info({ provider: "uazapi", instanceName, webhookUrl }, "uazapi webhook configured");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        logger.error(
          { provider: "uazapi", instanceName, status: err.response?.status, body: JSON.stringify(err.response?.data ?? null) },
          "uazapi setupWebhook failed",
        );
      }
      throw err;
    }
  }
}

export function getGlobalUazapiAdmin(): { host: string; adminToken: string } | null {
  const host = process.env.UAZAPI_HOST;
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
  if (host && adminToken) return { host, adminToken };
  return null;
}
