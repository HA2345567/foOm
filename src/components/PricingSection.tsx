import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Link } from "@tanstack/react-router";

const plans = [
  {
    name: "Free",
    price: "$0",
    description: "Perfect for quick product walkthroughs.",
    features: [
      "5 recordings per month",
      "720p max resolution",
      "Product watermark",
      "Basic auto-zoom",
    ],
    cta: "Start for free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$18",
    description: "For founders and power users.",
    features: [
      "Unlimited recordings",
      "1080p HD export",
      "No watermark",
      "AI Subtitles & Smart Trim",
      "Custom branding",
    ],
    cta: "Go Pro",
    highlight: true,
  },
  {
    name: "Team",
    price: "$45",
    description: "Scale your product demos together.",
    features: [
      "Everything in Pro",
      "Shared team library",
      "Admin controls",
      "Priority processing",
      "Custom domains",
    ],
    cta: "Contact Sales",
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 md:py-32 px-6 bg-background">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl mb-20 md:mb-24">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-display-section"
          >
            Simple pricing.
            <br />
            <span className="text-muted-foreground">Pro demos shouldn't break the bank.</span>
          </motion.h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={`p-10 rounded-2xl border ${
                plan.highlight ? "border-white" : "border-border"
              } bg-card shadow-card relative flex flex-col`}
            >
              <div className="mb-8">
                <h3 className="text-[14px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-display-section">
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground text-sm">/month</span>
                </div>
                <p className="text-body text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              <ul className="space-y-4 mb-10 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-[14px] text-white/90">
                    <Check className="w-4 h-4 text-white" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/record"
                className={`w-full py-4 rounded-lg font-bold text-sm transition-all text-center ${
                  plan.highlight
                    ? "bg-white text-black shadow-button hover:opacity-90"
                    : "border border-border text-white hover:bg-secondary"
                }`}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
