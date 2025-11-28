const API_BASE_URL = "https://api.injahow.cn/meting/";
const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;
const SAFE_RESPONSE_HEADERS = ["content-type", "cache-control", "accept-ranges", "content-length", "content-range", "etag", "last-modified", "expires"];

function createCorsHeaders(init?: Headers): Headers {
  const headers = new Headers();
  if (init) {
    for (const [key, value] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function isAllowedKuwoHost(hostname: string): boolean {
  if (!hostname) return false;
  return KUWO_HOST_PATTERN.test(hostname);
}

function normalizeKuwoUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.protocol = "http:";
    return parsed;
  } catch {
    return null;
  }
}

async function proxyKuwoAudio(targetUrl: string, request: Request): Promise<Response> {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    return new Response("Invalid target", { status: 400 });
  }

  const init: RequestInit = {
    method: request.method,
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Referer": "https://www.kuwo.cn/",
    },
  };

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    (init.headers as Record<string, string>)["Range"] = rangeHeader;
  }

  const upstream = await fetch(normalized.toString(), init);
  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxyApiRequest(url: URL, request: Request): Promise<Response> {
  const apiUrl = new URL(API_BASE_URL);

  // Map original API parameters to Meting API parameters
  const types = url.searchParams.get("types");
  const name = url.searchParams.get("name");
  const source = url.searchParams.get("source") || "netease";
  const count = url.searchParams.get("count") || "30";
  const pages = url.searchParams.get("pages") || "1";
  const id = url.searchParams.get("id");
  const br = url.searchParams.get("br");

  // Set default server for Meting API
  apiUrl.searchParams.set("server", source === "tencent" ? "tencent" : "netease");

  // Map API types to Meting API types
  if (types === "search") {
    if (name) {
      apiUrl.searchParams.set("type", "name");
      apiUrl.searchParams.set("name", name);
      apiUrl.searchParams.set("limit", count);
      apiUrl.searchParams.set("page", pages);
    } else {
      return new Response("Missing search name", { status: 400 });
    }
  } else if (types === "url") {
    apiUrl.searchParams.set("type", "url");
    if (!id) {
      return new Response("Missing song id", { status: 400 });
    }
    apiUrl.searchParams.set("id", id);
  } else if (types === "lyric") {
    apiUrl.searchParams.set("type", "lrc");
    if (!id) {
      return new Response("Missing song id", { status: 400 });
    }
    apiUrl.searchParams.set("id", id);
  } else if (types === "pic") {
    apiUrl.searchParams.set("type", "pic");
    if (!id) {
      return new Response("Missing song id", { status: 400 });
    }
    apiUrl.searchParams.set("id", id);
  } else {
    return new Response("Unsupported API type", { status: 400 });
  }

  const upstream = await fetch(apiUrl.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") ?? "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const headers = createCorsHeaders(upstream.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function onRequest({ request }: { request: Request }): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("target");

  if (target) {
    return proxyKuwoAudio(target, request);
  }

  return proxyApiRequest(url, request);
}
