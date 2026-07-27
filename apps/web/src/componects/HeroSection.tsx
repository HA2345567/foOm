import { motion } from "framer-motion";
import { DownloadButton } from "./DownloadButton";
import { BackgroundStars } from "./BackgroundStars";

export function HeroSection() {
  return (
    <section
      id="download"
      className="relative min-h-screen w-full flex flex-col items-center justify-start overflow-hidden bg-black pt-28 pb-24"
    >
      {/* Cinematic Background Video - The Space Vortex */}
      {/* <VideoBackground src="https://stream.mux.com/Aa02T7oM1wH5Mk5EEVDYhbZ1ChcdhRsS2m1NYyx4Ua1g.m3u8" /> */}

      {/* Ambient background stars from the demo section */}
      <BackgroundStars
        count={1200}
        edgeProbability={0.0}
        maxMargin={12}
        minOpacity={0.05}
        maxOpacity={0.8}
        highMinOpacity={0.1}
        highMaxOpacity={0.9}
        minSize={0.08}
        maxSize={0.45}
      />

      <div className="relative z-20 mx-auto max-w-4xl px-6 text-center w-full flex flex-col items-center">
        {/* High-Contrast Cinematic Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-display-hero text-white drop-shadow-lg"
        >
          Beautiful Screen Recordings
          <br />
          <span className="text-zinc-300">with smart autozoom.</span>
        </motion.h1>

        {/* Sophisticated High-Contrast Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-8 text-body-large text-zinc-100 font-medium max-w-2xl mx-auto drop-shadow-md"
        >
          foOm automatically applies smart autozoom, focus, and cinematic editing to your screen
          recordings. Record, polish, and export from a focused native desktop app.
        </motion.p>

        {/* Premium Download CTA Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="mt-12 flex justify-center"
        >
          <DownloadButton
            label="Download for Windows"
            innerClassName="px-8 py-4 flex items-center gap-3"
            speed="4s"
          />
        </motion.div>
      </div>

      {/* Cinematic Mockup with Live Video Preview (Wider Layout) */}
      <div className="relative z-20 mx-auto max-w-7xl px-6 w-full mt-16 flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: [0.23, 1, 0.32, 1] }}
          className="relative aspect-video w-full rounded-2xl border border-white/10 bg-black overflow-hidden group shadow-[0_0_100px_rgba(0,0,0,0.8)]"
        >
          {/* Auto-Playing Demo Video */}
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          >
            <source src="/foom-demovedio.mp4" type="video/mp4" />
            <source src="https://assets.mixkit.co/videos/preview/mixkit-computer-screen-with-code-being-typed-42352-large.mp4" type="video/mp4" />
          </video>
        </motion.div>
      </div>
    </section>
  );
}
