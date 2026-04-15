import { motion } from "framer-motion";

export function CtaSection() {
  return (
    <section className="py-24 md:py-32 px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="mx-auto max-w-3xl text-center"
      >
        <h2 className="text-display-section text-foreground">
          Stop editing. Start shipping.
        </h2>
        <p className="mt-4 text-body-large text-muted-foreground max-w-xl mx-auto">
          Your product deserves a demo that looks as good as the thing you built.
          ZoomCast makes it happen in one click.
        </p>
        <div className="mt-10">
          <button className="px-10 py-4 rounded-lg bg-primary text-primary-foreground font-medium shadow-button hover:opacity-90 transition-opacity text-sm">
            Start Recording — It's Free
          </button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          No account required. No downloads. Works in Chrome & Edge.
        </p>
      </motion.div>
    </section>
  );
}
