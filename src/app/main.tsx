import React from "react";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { initializeSentry } from "./sentry.client";
import '@fontsource-variable/work-sans';
import "./styles.css";

const queryClient = new QueryClient();

const bootstrap = async () => {
  await initializeSentry();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary fallback={<div className="centered">An unexpected error occurred.</div>}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
};

void bootstrap();
