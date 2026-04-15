import { motion } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Hit record",
    description: "Choose your screen, tab, or window. Optionally enable mic and webcam. No plugins needed.",
  },
  {
    number: "02",
    title: "AI enhances",
    description: "Our zoom engine analyzes your clicks, scrolls, and pauses to apply cinematic focus and timing.",
  },
  {
    number: "03",
    title: "Export & share",
    description: "Download a polished MP4 or generate a shareable link. Subtitles included. Zero editing required.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 md:py-32 px-6">
      <div className="mx-auto max-w-4xl">
        <div className="text-center mb-16">
          <h2 className="text-display-section text-foreground">
            Three steps to a pro demo
          </h2>
          <p className="mt-4 text-body-large text-muted-foreground max-w-xl mx-auto">
            From raw recording to polished video in under a minute.
          </p>
        </div>

        <div className="space-y-6">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="flex gap-6 p-6 rounded-xl border border-border bg-card shadow-card"
            >
              <div className="shrink-0">
                <span className="font-display text-3xl font-bold text-muted-foreground/30">
                  {step.number}
                </span>
              </div>
              <div>
                <h3 className="text-display-feature text-foreground">{step.title}</h3>
                <p className="mt-1 text-caption text-muted-foreground">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
