import { motion } from "framer-motion";
import { Mic, MousePointer2, Type, Zap } from "lucide-react";
import { BackgroundStars } from "./BackgroundStars";

const features = [
  {
    icon: (props: any) => (
      <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
        <path d="M11 8v6M8 11h6" />
      </svg>
    ),
    title: "Smart Auto-Zoom",
    description:
      "Automatically zooms into clicks, typing, and UI interactions. Smart enough to stay wide during fast movement.",
  },
  {
    icon: (props: any) => (
      <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    ),
    title: "Silence Removal",
    description:
      "Detects and removes dead pauses from your recordings. Keeps the pace tight and professional.",
  },
  {
    icon: Type,
    title: "Auto Subtitles",
    description:
      "Generate editable captions for your recordings before export.",
  },
  {
    icon: MousePointer2,
    title: "Cursor Intelligence",
    description:
      "Highlights intentional clicks, filters accidental drift. Adds subtle glow and pulse animations.",
  },
  {
    icon: Zap,
    title: "Desktop-Native",
    description: "Follows clicks and keyboard focus with cinematic easing inside the Windows app.",
  },
  {
    icon: Mic,
    title: "Crystal Clear Audio",
    description: "Capture microphone and system audio with controls built into the recording toolbar.",
  },
];


export function FeaturesSection() {
  return (
    <section id="features" className="py-24 md:py-32 px-6 bg-black relative overflow-hidden">
      {/* Premium Backdrop */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.02)_0%,transparent_100%)]" />
        <BackgroundStars count={100} />
      </div>

      <div className="mx-auto max-w-7xl relative z-10">
        <div className="max-w-3xl mb-20 md:mb-24">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-display-section"
          >
            Everything you need
            <br />
            <span className="text-muted-foreground">to ship pro demos.</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="mt-6 text-body-large"
          >
            Stop spending hours in video editors. foOom handles the heavy lifting
            so you can focus on building and sharing.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group p-8 rounded-2xl border border-border bg-card shadow-card hover:shadow-card-hover transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-6 border border-border group-hover:bg-white group-hover:text-black transition-colors">
                <feature.icon className="w-6 h-6" />
              </div>
              <h3 className="text-display-feature mb-3">
                {feature.title}
              </h3>
              <p className="text-body text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
