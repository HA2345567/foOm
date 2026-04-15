import { motion } from "framer-motion";

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
        <path d="M11 8v6M8 11h6" />
      </svg>
    ),
    title: "AI Auto-Zoom",
    description:
      "Automatically zooms into clicks, typing, and UI interactions. Smart enough to stay wide during fast movement.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 10h8M8 14h4" />
      </svg>
    ),
    title: "Auto Subtitles",
    description:
      "Speech-to-text powered by Whisper, running entirely in your browser. Edit before export.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 20h9" />
        <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838.838-2.872a2 2 0 0 1 .506-.855Z" />
      </svg>
    ),
    title: "Cursor Intelligence",
    description:
      "Highlights intentional clicks, filters accidental drift. Adds subtle glow and pulse animations.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="m10 8 6 4-6 4z" />
      </svg>
    ),
    title: "Browser-Native",
    description:
      "No downloads, no extensions. Open a tab and start recording. Works on Chrome and Edge.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </svg>
    ),
    title: "Client-Side Processing",
    description:
      "Everything runs in your browser. Your recordings never leave your device unless you choose to share.",
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 md:py-32 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-display-section text-foreground">
            Everything happens in the browser
          </h2>
          <p className="mt-4 text-body-large text-muted-foreground max-w-2xl mx-auto">
            No uploads. No server processing. Record, enhance, and export — all from a single tab.
          </p>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className="group p-6 rounded-xl bg-card border border-border shadow-card hover:shadow-card-hover transition-shadow duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                {feature.icon}
              </div>
              <h3 className="mt-4 text-display-feature text-foreground">{feature.title}</h3>
              <p className="mt-2 text-caption text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
