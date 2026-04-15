import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-24 md:pt-44 md:pb-32 px-6 overflow-hidden">
      {/* Subtle radial glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-glow blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-surface mb-8"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-caption text-muted-foreground">Now in public beta</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-display-hero text-foreground"
        >
          Record your screen.
          <br />
          <span className="text-muted-foreground">AI makes it look pro.</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 text-body-large text-muted-foreground max-w-2xl mx-auto"
        >
          ZoomCast automatically applies smart zoom, focus, and cinematic editing
          to your screen recordings. No downloads. No editing. Just hit record.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to="/record"
            className="px-8 py-3.5 rounded-lg bg-primary text-primary-foreground font-medium shadow-button hover:opacity-90 transition-opacity text-sm"
          >
            Start Recording — Free
          </Link>
          <a
            href="#how-it-works"
            className="px-8 py-3.5 rounded-lg border border-border bg-surface text-foreground font-medium hover:bg-accent transition-colors text-sm"
          >
            See how it works
          </a>
        </motion.div>

        {/* Product preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-16 md:mt-20 relative"
        >
          <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
            {/* Fake browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-muted" />
                <div className="w-3 h-3 rounded-full bg-muted" />
                <div className="w-3 h-3 rounded-full bg-muted" />
              </div>
              <div className="flex-1 mx-4">
                <div className="h-6 rounded-md bg-muted/50 max-w-xs mx-auto" />
              </div>
            </div>
            {/* Recording UI mockup */}
            <div className="aspect-video bg-secondary/50 flex items-center justify-center relative">
              <div className="flex flex-col items-center gap-4">
                {/* Record button */}
                <div className="w-16 h-16 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-destructive/80" />
                </div>
                <span className="text-caption text-muted-foreground">Click to start recording</span>
              </div>
              {/* Fake zoom indicator */}
              <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-md bg-background/80 backdrop-blur border border-border">
                <span className="text-xs font-medium text-muted-foreground font-display">AI Zoom: Active</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
