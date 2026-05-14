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
          <p className="mt-4 text-body text-muted-foreground">Watch how foOm transforms raw recordings into professional demos.</p>
        </div>

        {/* Cinematic Mockup with Live Animation Effect */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="relative aspect-video w-full rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden group shadow-[0_0_100px_rgba(0,0,0,0.8)]"
        >
          <motion.div
            animate={{ 
              scale: [1, 1.1, 1],
              x: [0, -20, 0],
              y: [0, -10, 0]
            }}
            transition={{ 
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="w-full h-full"
          >
            <img 
              src="/C:/Users/Harsh/.gemini/antigravity/brain/902c05e7-e534-400d-9cbb-a6e58b263390/foom_editor_mockup_1778731419154.png" 
              alt="foOm Editor Mockup"
              className="w-full h-full object-cover"
            />
          </motion.div>
          
          {/* Play Button Overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] group-hover:bg-black/10 transition-all duration-500">
             <div className="w-20 h-20 rounded-full border border-white/20 flex items-center justify-center bg-white/10 backdrop-blur-xl shadow-2xl transition-all group-hover:scale-110 group-hover:bg-white/20">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" className="ml-1">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
             </div>
          </div>

          {/* Feature Badges */}
          <div className="absolute bottom-6 left-6 flex gap-3">
             <div className="px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                AI Vision Active
             </div>
             <div className="px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-bold text-white uppercase tracking-widest">
                4K Export Ready
             </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
