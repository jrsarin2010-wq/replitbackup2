import { describe, it, expect } from "vitest";
import { isWhatsappDisconnectionError } from "../lib/whatsapp-disconnection-alert";

describe("isWhatsappDisconnectionError", () => {
  it("detects Evolution API 'Connection Closed' response", () => {
    const body = { status: 400, error: "Bad Request", response: { message: ["Error: Connection Closed"] } };
    expect(isWhatsappDisconnectionError(body)).toBe(true);
  });

  it("detects 'Connection Closed' inside string body", () => {
    expect(isWhatsappDisconnectionError("Error: Connection Closed")).toBe(true);
  });

  it("detects case-insensitive 'connection lost'", () => {
    expect(isWhatsappDisconnectionError({ error: "CONNECTION LOST" })).toBe(true);
  });

  it("detects 'instance not connected'", () => {
    expect(isWhatsappDisconnectionError({ message: "Instance not connected" })).toBe(true);
  });

  it("ignores unrelated 4xx errors", () => {
    expect(isWhatsappDisconnectionError({ status: 400, error: "Bad Request", message: "Invalid number" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isWhatsappDisconnectionError(null)).toBe(false);
    expect(isWhatsappDisconnectionError(undefined)).toBe(false);
    expect(isWhatsappDisconnectionError("")).toBe(false);
  });
});
