import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getUserStatus } from "../lib/subscription";
import { LoginModal } from "./LoginModal";
import { Logo } from "./Logo";
import StarBorder from "./StarBorder";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  // { label: "Pricing", href: "#pricing" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [status, setStatus] = useState(getUserStatus());

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 flex items-center justify-center transition-all duration-500 group-hover:-translate-y-0.5 relative overflow-hidden">
            <Logo className="w-9 h-9 text-[#f5f5f7] relative z-10" />
          </div>
          <span className="font-brand text-[24px] font-semibold tracking-[-0.03em] text-foreground">
            foOm
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-10">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[14px] font-medium text-muted-foreground hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-6">
          {/* We are in waitlist-only launch mode, so we hide login and pro status
          {status.isPro ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[12px] font-bold text-primary uppercase tracking-wider">Pro</span>
            </div>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="text-[14px] font-medium text-muted-foreground hover:text-white transition-colors"
            >
              Log in
            </button>
          )}
          */}
          <StarBorder
            as="a"
            href="#waitlist"
            className="transition-all active:scale-95 hover:scale-105"
            innerClassName="px-5 py-2 text-[14px]"
            color="white"
            speed="5s"
          >
            <span className="font-bold">Join Waitlist</span>
          </StarBorder>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {mobileOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 8h16M4 16h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden border-b border-border bg-black"
          >
            <div className="px-6 py-6 flex flex-col gap-6">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-[16px] font-medium text-muted-foreground hover:text-white transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <StarBorder
                as="a"
                href="#waitlist"
                className="w-full"
                innerClassName="px-4 py-3.5 text-[15px]"
                color="white"
                speed="5s"
                onClick={() => setMobileOpen(false)}
              >
                <span className="font-bold">Join Waitlist</span>
              </StarBorder>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => setStatus(getUserStatus())}
        />
      )}
    </nav>
  );
}

