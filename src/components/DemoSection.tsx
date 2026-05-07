import { motion } from "framer-motion";
import { BackgroundStars } from "./BackgroundStars";

export function DemoSection() {
  return (
    <section className="pt-12 pb-24 md:pt-16 md:pb-32 px-6 bg-black relative overflow-hidden">
      {/* Dynamic Star Field Backdrop */}
      <BackgroundStars count={200} />

      {/* Deep Mesh Glow for depth */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-white/[0.01] blur-[160px] rounded-full pointer-events-none" />

      <div className="mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-display-section text-foreground">See it in action.</h2>
          <p className="mt-4 text-body text-muted-foreground">Watch how ZoOmly transforms raw recordings into professional demos.</p>
        </div>

        {/* Empty Video Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative aspect-video w-full rounded-2xl border border-dashed border-white/10 bg-white/[0.02] flex items-center justify-center group"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center bg-white/5 transition-transform group-hover:scale-110">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/20">Demo Video Coming Soon</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
