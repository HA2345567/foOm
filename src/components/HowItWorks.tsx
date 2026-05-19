import { motion } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Open a Tab",
    description: "No installation required. Just navigate to foOm in any modern browser.",
  },
  {
    number: "02",
    title: "Record Your Demo",
    description: "Capture your screen and audio. Our event tracker logs every interaction.",
  },
  {
    number: "03",
    title: "Auto-Zoom Does the Rest",
    description: "Our engine applies smart zoom and cuts dead time automatically.",
  },
  {
    number: "04",
    title: "Export & Share",
    description: "Download a high-fidelity MP4 and share it with your audience.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 md:py-32 px-6 bg-background">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-20 md:mb-24 gap-6">
          <div className="max-w-2xl">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-display-section"
            >
              Zero friction.
              <br />
              <span className="text-muted-foreground">From recording to demo in seconds.</span>
            </motion.h2>
          </div>
          <div className="pb-1">
             <a href="#pricing" className="text-sm font-semibold text-white hover:text-muted-foreground transition-colors underline decoration-border underline-offset-8">
               View Pricing
             </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              <span className="block text-[40px] font-bold text-muted/30 tracking-tighter mb-4">
                {step.number}
              </span>
              <h3 className="text-display-feature mb-3">
                {step.number}. {step.title}
              </h3>
              <p className="text-body text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
