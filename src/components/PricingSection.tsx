import { motion } from "framer-motion";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Get started with the basics.",
    features: [
      "5 recordings / month",
      "720p export",
      "Basic MP4 download",
      "ZoomCast watermark",
    ],
    cta: "Start Free",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$18",
    period: "/month",
    description: "For builders who ship demos weekly.",
    features: [
      "Unlimited recordings",
      "AI auto-zoom engine",
      "Auto subtitles",
      "Silence removal",
      "1080p export",
      "Shareable link",
      "No watermark",
    ],
    cta: "Go Pro",
    highlighted: true,
  },
  {
    name: "Team",
    price: "$45",
    period: "/month",
    description: "For teams creating demo libraries.",
    features: [
      "Everything in Pro",
      "Team workspace",
      "Shared video library",
      "Brand kit",
      "Priority processing",
      "Admin controls",
    ],
    cta: "Start Team Trial",
    highlighted: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 md:py-32 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="text-display-section text-foreground">Simple pricing</h2>
          <p className="mt-4 text-body-large text-muted-foreground max-w-xl mx-auto">
            Start free. Upgrade when you need the AI engine.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`flex flex-col p-6 rounded-xl border shadow-card ${
                plan.highlighted
                  ? "border-foreground/20 bg-card shadow-card-hover"
                  : "border-border bg-card"
              }`}
            >
              {plan.highlighted && (
                <span className="self-start px-3 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground mb-4">
                  Most popular
                </span>
              )}
              <h3 className="font-display text-xl font-semibold text-foreground">{plan.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-foreground">{plan.price}</span>
                <span className="text-caption text-muted-foreground">{plan.period}</span>
              </div>
              <p className="mt-2 text-caption text-muted-foreground">{plan.description}</p>

              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-caption text-surface-foreground">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-muted-foreground">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                className={`mt-8 w-full py-3 rounded-lg text-sm font-medium transition-opacity ${
                  plan.highlighted
                    ? "bg-primary text-primary-foreground shadow-button hover:opacity-90"
                    : "bg-surface text-foreground border border-border hover:bg-accent"
                }`}
              >
                {plan.cta}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
