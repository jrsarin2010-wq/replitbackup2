export const AUTH_TOKEN_KEY = "authToken";

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem("tenantId");
  localStorage.removeItem("tenantPlan");
}

export function hasAuthToken(): boolean {
  return !!localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getTenantId(): string {
  return localStorage.getItem("tenantId") || "";
}

export function setTenantId(id: string) {
  localStorage.setItem("tenantId", id);
}

export function clearTenantId() {
  localStorage.removeItem("tenantId");
}

export function hasTenantId(): boolean {
  return !!localStorage.getItem(AUTH_TOKEN_KEY);
}

function normalizePlanAlias(plan: string | null): string | null {
  if (plan === "basico" || plan === "free") return "basic";
  return plan;
}

export function getTenantPlan(): string | null {
  return normalizePlanAlias(localStorage.getItem("tenantPlan"));
}

export function setTenantPlan(plan: string) {
  localStorage.setItem("tenantPlan", normalizePlanAlias(plan) ?? plan);
}

const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url.includes("/api/dental/")) {
    const headers = new Headers(init?.headers);
    if (!headers.has("Authorization")) {
      const token = getAuthToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return originalFetch(input, { ...init, headers });
  }

  return originalFetch(input, init);
};
