
import { useState } from "react";
import { motion } from "framer-motion";
import { VideoBackground } from "./VideoBackground";
import StarBorder from "./StarBorder";
import { toast } from "sonner";

export function HeroSection(){
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [isJoined, setIsJoined] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("You're on the list!", {
          description: "We'll be in touch soon.",
        });
        setEmail("");
        setIsJoined(true);
        
        // Revert the green confirmation box back to the input form after 5 seconds
        setTimeout(() => {
          setIsJoined(false);
        }, 5000);
      } else {
        toast.error("Failed to join", {
          description: data.error || "Please try again later.",
        });
      }
    } catch (err) {
      toast.error("Network error", {
        description: "Please check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <section id="waitlist" className="relative h-screen w-full flex items-center justify-center overflow-hidden bg-black">
      {/* Cinematic Background Video - The Space Vortex */}
      <VideoBackground src="https://stream.mux.com/Aa02T7oM1wH5Mk5EEVDYhbZ1ChcdhRsS2m1NYyx4Ua1g.m3u8" />

      <div className="relative z-20 mx-auto max-w-4xl px-6 text-center pt-32">

        {/* High-Contrast Cinematic Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-display-hero"
        >
          Beautiful Screen Recordings
          <br />
          <span className="text-muted-foreground">with autozoom.</span>
        </motion.h1>

        {/* Sophisticated Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-8 text-body-large max-w-2xl mx-auto"
        >
          foOm automatically applies smart zoom, focus, and cinematic editing to your screen recordings. No downloads. No editing. Just hit record.
        </motion.p>

        {/* Senior Minimalist CTA / Success State */}
        {!isJoined ? (
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="mt-16 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md mx-auto"
            onSubmit={handleSubmit}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              disabled={loading}
              className="w-full flex-1 px-6 py-4 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all text-sm disabled:opacity-50"
            />
            <StarBorder
              as="button"
              type="submit"
              className="w-full sm:w-auto shrink-0 transition-all hover:scale-105 active:scale-95"
              innerClassName="px-8 py-4"
              color="white"
              speed="5s"
            >
              <span className="font-bold text-sm tracking-tight uppercase">
                {loading ? "Joining..." : "Join waitlist"}
              </span>
            </StarBorder>
          </motion.form>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="mt-16 p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 max-w-md mx-auto flex flex-col items-center gap-3 backdrop-blur-md"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-2xl font-bold animate-pulse">
              ✓
            </div>
            <div>
              <p className="text-emerald-400 font-bold text-lg">You are confirmed!</p>
              <p className="text-emerald-400/80 text-sm mt-1">We've sent a welcome email highlighting your features.</p>
            </div>
          </motion.div>
        )}

      </div>

      {/* Decorative Bottom Vignette to ground the section */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black via-black/80 to-transparent z-10" />
    </section>
  );
}
