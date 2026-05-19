import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "../components/Navbar";
import { HeroSection } from "../components/HeroSection";
import { FeaturesSection } from "../components/FeaturesSection";
import { HowItWorks } from "../components/HowItWorks";
import { PricingSection } from "../components/PricingSection";
import { CtaSection } from "../components/CtaSection";
import { DemoSection } from "../components/DemoSection";
import { Footer } from "../components/Footer";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "foOm — Beautiful Screen Recorder with Cinematic Auto-Zoom" },
      {
        name: "description",
        content:
          "Record your screen in the browser. Cinematic auto-zoom, silence removal, and focus tracking make every demo look pro. No downloads required.",
      },
      { property: "og:title", content: "foOm — Cinematic Screen Recorder" },
      {
        property: "og:description",
        content: "Beautiful screen recordings with cinematic auto-zoom. No downloads, no editing.",
      },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <HeroSection />
      <DemoSection />
      <FeaturesSection />
      <HowItWorks />
      {/* <PricingSection /> */}
      <CtaSection />
      <Footer />
    </div>
  );
}
