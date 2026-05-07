import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { VideoBackground } from "./VideoBackground";

export function HeroSection() {
  return (
    <section className="relative h-screen w-full flex items-center justify-center overflow-hidden bg-black">
      {/* Cinematic Background Video - The Space Vortex */}
      <VideoBackground src="https://stream.mux.com/Aa02T7oM1wH5Mk5EEVDYhbZ1ChcdhRsS2m1NYyx4Ua1g.m3u8" />

      <div className="relative z-20 mx-auto max-w-4xl px-6 text-center pt-32">

        {/* High-Contrast Cinematic Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-display-hero"
        >
          Record your screen.
          <br />
          <span className="text-muted-foreground">AI makes it look pro.</span>
        </motion.h1>

        {/* Sophisticated Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-8 text-body-large max-w-2xl mx-auto"
        >
          ZoOmly automatically applies smart zoom, focus, and cinematic editing to your screen recordings. No downloads. No editing. Just hit record.
        </motion.p>

        {/* Senior Minimalist CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.23, 1, 0.32, 1] }}
          className="mt-16 flex flex-col sm:flex-row items-center justify-center gap-6"
        >
          <Link
            to="/record"
            className="px-10 py-4 rounded-full bg-[#E4E4E7] text-black font-bold text-sm tracking-tight hover:bg-white transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(255,255,255,0.1)]"
          >
            Start Recording — Free
          </Link>
          <a
            href="#how-it-works"
            className="px-10 py-4 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white font-semibold text-sm hover:bg-white/20 transition-all hover:scale-105 active:scale-95"
          >
            See how it works
          </a>
        </motion.div>
      </div>

      {/* Decorative Bottom Vignette to ground the section */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black via-black/80 to-transparent z-10" />
    </section>
  );
}
