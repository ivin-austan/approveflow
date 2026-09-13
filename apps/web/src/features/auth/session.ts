let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetchWithToken(input, init);
  if (response.status !== 401) return response;
  const refreshed = await refreshAccessToken();
  return refreshed ? fetchWithToken(input, init) : response;
}

async function fetchWithToken(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  return fetch(input, { ...init, credentials: "include", headers });
}

async function refreshAccessToken() {
  refreshPromise ??= fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const value: unknown = await response.json();
      if (
        typeof value === "object" &&
        value !== null &&
        "data" in value &&
        typeof value.data === "object" &&
        value.data !== null &&
        "accessToken" in value.data &&
        typeof value.data.accessToken === "string"
      ) {
        setAccessToken(value.data.accessToken);
        return value.data.accessToken;
      }
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export function safeReturnPath(value: string | null) {
  if (!value || value.startsWith("//")) return "/";
  const path = value.split("?", 1)[0] ?? "";
  return /^\/organizations\/[0-9a-f-]{36}\/(approvals|requests(?:\/[0-9a-f-]{36})?)$/i.test(
    path,
  )
    ? value
    : "/";
}
