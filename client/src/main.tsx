import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

/** Site session expired / missing — show login gate (not Manus OAuth). */
const showSiteLoginIfUnauthorized = (error: unknown) => {
  if (typeof window === "undefined") return;

  // Express site-auth middleware returns JSON 401 on /api/*
  if (error instanceof TRPCClientError) {
    const msg = error.message || "";
    const data = error.data as { httpStatus?: number; code?: string } | undefined;
    const isSiteAuth =
      data?.httpStatus === 401 ||
      msg.includes("SITE_AUTH_REQUIRED") ||
      msg.includes("Site authentication required") ||
      msg === UNAUTHED_ERR_MSG;
    if (isSiteAuth) {
      window.dispatchEvent(new Event("site-auth-required"));
    }
  }
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    showSiteLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    showSiteLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const COOKIE_STORAGE_KEY = 'freeroam_cookie';
const ACCOUNT_ID_STORAGE_KEY = 'freeroam_account_id';

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Inject the user's Freeroam cookie and accountId as headers.
        // The server uses these to load the user's characters and scope their data.
        const userCookie = localStorage.getItem(COOKIE_STORAGE_KEY);
        const accountId = localStorage.getItem(ACCOUNT_ID_STORAGE_KEY);
        const headers: Record<string, string> = {};
        if (userCookie && userCookie.trim()) {
          headers['x-freeroam-cookie'] = userCookie.trim();
        }
        if (accountId && accountId.trim()) {
          headers['x-freeroam-account-id'] = accountId.trim();
        }
        return headers;
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
