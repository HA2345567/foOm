import { motion } from "framer-motion";
import { Lock, Sparkles, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";

interface Props {
  onClose?: () => void;
}

export function PaywallModal({ onClose }: Props) {
  useEffect(() => {
    const timer = setTimeout(() => {
      PolarEmbedCheckout.init();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg bg-card border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative"
      >
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
        
        <div className="p-8 md:p-10">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-8 mx-auto">
            <Lock className="w-8 h-8 text-primary" />
          </div>

          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-white mb-3">Recording Limit Reached</h2>
            <p className="text-muted-foreground leading-relaxed">
              You've created 3 amazing recordings! To continue creating cinematic demos and unlock 1080p HD, please upgrade to Pro.
            </p>
          </div>

          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-primary/5 border border-primary/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3 text-primary">
                <Sparkles className="w-5 h-5" />
                <span className="text-sm font-bold uppercase tracking-wider">Pro Benefits Unlocked</span>
              </div>
              <ul className="space-y-3">
                {[
                  "Unlimited High-Quality Recordings",
                  "No ZoOmly Watermark",
                  "AI Subtitles & Smart Editing",
                  "Professional 1080p Export"
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-xs text-white/70">
                    <Check className="w-4 h-4 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <a 
              href="https://polar.sh/checkout/polar_c_0mPJOWfoIhDqTIEwCfQpquBgZHEXiFa8hzPTt0sN6yn?success_url=http://localhost:8080/record"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full block py-5 rounded-xl bg-primary text-primary-foreground font-bold text-center shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Get Access for $25/mo
            </a>
            
            <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest">
              Safe & Secure Checkout via Polar.sh
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
