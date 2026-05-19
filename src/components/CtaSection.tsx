import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import StarBorder from "./StarBorder";

export function CtaSection() {
  return (
    <section className="py-24 md:py-40 px-6 bg-background relative overflow-hidden">
      {/* Decorative architectural grid */}
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none" 
        style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '64px 64px' }} 
      />
      
      <div className="mx-auto max-w-4xl text-center relative z-10">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-display-section"
        >
          Ready to make your 
          <br />
          <span className="text-muted-foreground">demos look professional?</span>
        </motion.h2>
        
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="mt-8 text-body-large max-w-xl mx-auto"
        >
          Join 2,000+ founders and engineers using foOm to ship better product updates.
        </motion.p>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-6"
        >
          <StarBorder
            as="a"
            href="#waitlist"
            className="w-full sm:w-auto shrink-0 transition-all hover:scale-105 active:scale-95"
            innerClassName="px-12 py-5"
            color="white"
            speed="5s"
          >
            <span className="font-bold text-sm tracking-tight uppercase">
              Join waitlist
            </span>
          </StarBorder>
          {/*
          <Link
            to="/record"
            className="text-sm font-semibold text-muted-foreground hover:text-white transition-colors"
          >
            Schedule a demo →
          </Link>
          */}
        </motion.div>
      </div>
    </section>
  );
}
