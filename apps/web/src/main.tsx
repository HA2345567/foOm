import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRouter,
  RouterProvider,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import App from "./App";
import "./index.css";
import { Navbar } from "./componects/Navbar";
import { HeroSection } from "./componects/HeroSection";
import { FeaturesSection } from "./componects/FeaturesSection";
import { HowItWorks } from "./componects/HowItWorks";
import { CtaSection } from "./componects/CtaSection";
import { Footer } from "./componects/Footer";

function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-white/20">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorks />
      <CtaSection />
      <Footer />
    </div>
  );
}

const rootRoute = createRootRoute({
  component: App,
});

// Create index route
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});

// Record route (redirection info to Desktop App)
const recordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/record",
  component: () => (
    <div className="flex h-screen items-center justify-center bg-black text-white px-6">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold tracking-tight font-brand">Launching foOm Studio...</h1>
        <p className="text-sm text-zinc-400 mt-4 leading-relaxed">
          Make sure you have downloaded, installed, and launched the desktop app. If it is already open, recording toolbar is active.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <a
            href="/"
            className="px-6 py-3 bg-white text-black font-bold rounded-full hover:bg-zinc-200 transition-all active:scale-95 text-sm"
          >
            Back to Home
          </a>
        </div>
      </div>
    </div>
  ),
});

const routeTree = rootRoute.addChildren([indexRoute, recordRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
