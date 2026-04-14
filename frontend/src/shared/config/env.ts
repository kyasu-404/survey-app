const DEFAULT_SUPABASE_URL = "http://localhost:8000";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveSupabaseUrl(
  configuredUrl: string,
  currentLocationHref?: string,
  isDev = import.meta.env.DEV,
) {
  const normalizedConfiguredUrl = trimTrailingSlash(configuredUrl || DEFAULT_SUPABASE_URL);

  if (!isDev || !currentLocationHref) {
    return normalizedConfiguredUrl;
  }

  try {
    const supabaseUrl = new URL(normalizedConfiguredUrl);
    const currentUrl = new URL(currentLocationHref);

    if (!LOCAL_HOSTNAMES.has(supabaseUrl.hostname) || LOCAL_HOSTNAMES.has(currentUrl.hostname)) {
      return normalizedConfiguredUrl;
    }

    supabaseUrl.hostname = currentUrl.hostname;
    return trimTrailingSlash(supabaseUrl.toString());
  } catch {
    return normalizedConfiguredUrl;
  }
}

const currentLocationHref = typeof window !== "undefined" ? window.location.href : undefined;

export const SUPABASE_URL = resolveSupabaseUrl(
  import.meta.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
  currentLocationHref,
);

export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "ANON_PUBLIC_KEY";

export const SUPABASE_STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ?? "survey-files";
