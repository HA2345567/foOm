import { motion } from "framer-motion";
import { BackgroundStars } from "./BackgroundStars";

export function DemoSection() {
  return (
    <section className="pt-12 pb-24 md:pt-16 md:pb-32 px-6 bg-black relative overflow-hidden">
      <BackgroundStars 
        count={500} 
        edgeProbability={0.95} 
        maxMargin={12}
        minOpacity={0.1}
        maxOpacity={0.5}
        highMinOpacity={0.3}
        highMaxOpacity={0.9}
      />

      {/* Deep Mesh Glow for depth */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-white/[0.01] blur-[160px] rounded-full pointer-events-none" />

      <div className="mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-display-section text-foreground">See it in action.</h2>
          <p className="mt-4 text-body text-muted-foreground">Watch how foOm transforms raw recordings into professional demos.</p>
        </div>

        {/* Cinematic Mockup with Live Video Preview */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="relative aspect-video w-full rounded-2xl border border-white/10 bg-black overflow-hidden group shadow-[0_0_100px_rgba(0,0,0,0.8)]"
        >
          {/* Auto-Playing Demo Video */}
          <video
            src="/foom-demovedio.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        </motion.div>
      </div>
    </section>
  );
}
