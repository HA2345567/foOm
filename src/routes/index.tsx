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
      { title: "ZoOmly — AI Screen Recorder That Makes Demos Look Pro" },
      {
        name: "description",
        content:
          "Record your screen in the browser. AI auto-zoom, silence removal, and subtitles make every demo look cinematic. No downloads required.",
      },
      { property: "og:title", content: "ZoOmly — AI Screen Recorder" },
      {
        property: "og:description",
        content: "Record your screen. AI makes it look pro. No downloads, no editing.",
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
      <PricingSection />
      <CtaSection />
      <Footer />
    </div>
  );
}
