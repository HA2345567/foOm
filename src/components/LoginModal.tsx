import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Loader2, ArrowRight, X } from "lucide-react";
import { checkSubscriptionByEmail, setProStatus, getUserStatus } from "../lib/subscription";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export function LoginModal({ onClose, onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    setError("");

    try {
      const result = await checkSubscriptionByEmail(email);
      if (result.success && result.isPro) {
        setProStatus(true, email);
        setStatus("success");
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      } else {
        setStatus("error");
        setError(result.error || "No active Pro subscription found for this email.");
      }
    } catch (err) {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-card border border-white/10 rounded-[32px] overflow-hidden shadow-2xl relative"
      >
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/5 text-muted-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8 md:p-10">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-8 mx-auto">
            <Mail className="w-8 h-8 text-primary" />
          </div>

          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white mb-3">Connect with Polar</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Enter the email you used for your Polar subscription to sync your Pro status.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>

            {status === "error" && (
              <p className="text-xs font-medium text-destructive bg-destructive/10 p-4 rounded-xl border border-destructive/20 text-center">
                {error}
              </p>
            )}

            {status === "success" && (
              <p className="text-xs font-medium text-primary bg-primary/10 p-4 rounded-xl border border-primary/20 text-center">
                Subscription verified! Welcome back.
              </p>
            )}

            <button
              type="submit"
              disabled={status === "loading" || status === "success"}
              className="w-full py-4 rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-3 hover:bg-[#f5f5f7] transition-all disabled:opacity-50"
            >
              {status === "loading" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Verify Subscription
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-[10px] text-center text-muted-foreground uppercase tracking-[0.2em]">
            Secure verification via Polar.sh
          </p>
        </div>
      </motion.div>
    </div>
  );
}
