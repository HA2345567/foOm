import React, { useState } from "react";
import StarBorder from "./StarBorder";
import { Download, Loader2, ExternalLink, ShieldCheck, X } from "lucide-react";
import { WindowsIcon } from "./WindowsIcon";

interface DownloadButtonProps {
  className?: string;
  innerClassName?: string;
  label?: string;
  showIcon?: boolean;
  useWindowsIcon?: boolean;
  color?: string;
  speed?: string;
  onClick?: () => void;
}

// Global analytics event dispatcher
function trackDownloadEvent(platform = "windows") {
  try {
    // 1. Google Analytics 4 (GA4)
    if (typeof window !== "undefined" && typeof (window as any).gtag === "function") {
      (window as any).gtag("event", "download_app", {
        event_category: "desktop_app",
        event_label: platform,
        os: platform,
      });
    }
    // 2. PostHog Analytics
    if (typeof window !== "undefined" && (window as any).posthog?.capture) {
      (window as any).posthog.capture("app_download_clicked", { platform, os: "windows" });
    }
    // 3. Google Tag Manager / GTM DataLayer
    if (typeof window !== "undefined" && Array.isArray((window as any).dataLayer)) {
      (window as any).dataLayer.push({ event: "download_desktop_app", platform });
    }
  } catch (err) {
    console.warn("Analytics track failed:", err);
  }
}

export function DownloadButton({
  className = "",
  innerClassName = "px-6 py-3 flex items-center gap-2",
  label = "Download for Windows",
  showIcon = true,
  useWindowsIcon = true,
  color = "white",
  speed = "4s",
  onClick,
}: DownloadButtonProps) {
  const [loading] = useState(false);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);

  const envDownloadUrl = import.meta.env.VITE_DOWNLOAD_URL;
  const githubRepo = import.meta.env.VITE_GITHUB_REPO || "HA2345567/foOm";
  const defaultDownloadUrl = "/downloads/foom-setup.exe";
  const targetDownloadUrl =
    envDownloadUrl && (envDownloadUrl.startsWith("http://") || envDownloadUrl.startsWith("https://"))
      ? envDownloadUrl
      : defaultDownloadUrl;
  const githubReleaseUrl = `https://github.com/${githubRepo}/releases/latest`;

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) onClick();

    // Fire download tracking analytics event
    trackDownloadEvent("windows");

    // Direct browser navigation / download trigger (bypasses cross-origin anchor blocks)
    window.open(targetDownloadUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <StarBorder
        as="button"
        type="button"
        onClick={handleDownloadClick}
        disabled={loading}
        className={`cursor-pointer transition-all hover:scale-105 active:scale-95 ${className}`}
        innerClassName={innerClassName}
        color={color}
        speed={speed}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-white" />
        ) : showIcon ? (
          useWindowsIcon ? (
            <WindowsIcon className="w-4 h-4 text-white" />
          ) : (
            <Download className="w-4 h-4 text-white" />
          )
        ) : null}
        <span className="font-bold text-sm tracking-tight text-white">{label}</span>
      </StarBorder>

      {/* Production-Grade Release Modal */}
      {releaseModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-zinc-950 border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl text-left overflow-hidden">
            <div className="absolute top-0 right-0 p-3">
              <button
                onClick={() => setReleaseModalOpen(false)}
                className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 text-emerald-400 mb-5">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white leading-tight">Windows installer</h3>
                <p className="text-xs text-zinc-400 font-medium">Windows-first desktop build</p>
              </div>
            </div>

            <p className="text-zinc-300 text-sm leading-relaxed mb-6">
              Download the current Windows installer (<strong>foom-setup.exe • 318 MB</strong>). Native macOS and Linux capture are still in development.
            </p>

            <p className="-mt-3 mb-6 text-xs text-zinc-400">
              The Windows installer includes FFmpeg under GPLv3. See the{" "}
              <a
                href="/THIRD_PARTY_NOTICES.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                third-party license details
              </a>
              .
            </p>
            <p className="-mt-4 mb-6 text-xs text-zinc-400">
              foOom source is licensed under{" "}
              <a
                href="/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                MIT
              </a>
              .
            </p>

            <div className="space-y-3 mb-6">
              <a
                href={githubReleaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackDownloadEvent("windows_github_release")}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-white text-black font-semibold text-sm rounded-xl hover:bg-zinc-200 transition-all shadow-lg group"
              >
                <span className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-black" />
                  Download Windows installer
                </span>
                <ExternalLink className="w-4 h-4 text-zinc-600 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>

            <div className="p-3.5 bg-zinc-900/80 rounded-xl border border-white/5 text-xs text-zinc-400 space-y-1 font-mono">
              <div className="text-zinc-300 font-semibold mb-1">Production Environment Setup:</div>
              <div>Set <code className="text-emerald-400">VITE_DOWNLOAD_URL</code> in your deployment dashboard to link direct installer URLs.</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
