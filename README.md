<div align="center">
  <video src="https://github.com/HA2345567/foOm/raw/main/public/foom-vedio.mp4" width="100%" autoplay loop muted playsinline style="border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); margin-bottom: 24px;"></video>
</div>

# foOm — Cinematic Screen Recorder with Auto-Zoom

> Beautiful screen recordings with cinematic auto-zoom. No downloads. No editing. Just hit record.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TanStack Router](https://img.shields.io/badge/TanStack_Router-1.x-FF4154?logo=react-query&logoColor=white)](https://tanstack.com/router)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-12-0055FF?logo=framer&logoColor=white)](https://www.framer.com/motion)

---

## What is foOm?

**foOm** is a browser-native screen recording studio that applies AI-driven cinematic post-production in real time. Founders, engineers, and product teams use it to ship polished demos, walkthroughs, and product updates — without spending hours in a video editor.

The core innovation is a **spring-physics zoom engine** that continuously tracks user interactions (clicks, scrolls, typing bursts, pauses) and applies butter-smooth cinematic zooms — the same way a professional camera operator would.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **AI Auto-Zoom** | Spring-physics engine tracks clicks, typing, and scrolls. Zooms in cinematically and breathes back out naturally. Zero hard cuts. |
| **Gemini Vision Analysis** | Sends sampled video frames to Gemini 1.5 Flash for semantic "point of interest" detection — smarter than pixel-diffing. |
| **AI Transcription** | Audio is extracted, downsampled to 16kHz mono WAV, and sent to Gemini for subtitle generation, summary, and a suggested title. |
| **Silence Removal** | Detects and trims dead pauses to keep pacing tight and professional. |
| **Cursor Intelligence** | Highlights intentional clicks, filters accidental drift, and adds subtle glow animations. |
| **Webcam Overlay (PiP)** | Floating webcam bubble with circle / rounded / square shape options. Supports Picture-in-Picture mode across browser tabs. |
| **Browser-Native** | Runs entirely in the browser. No install, no Electron, no extensions required. |
| **MP4 Export** | High-fidelity MP4 export powered by FFmpeg WASM with the full zoom keyframe curve baked in via `zoompan` filters. |
| **Polar Payments** | Embedded Pro checkout via [Polar.sh](https://polar.sh) with server-side subscription verification. |

---

## 🧠 The Zoom Engine — How It Works

> `src/lib/autoZoom.ts` — ~765 lines of precision-tuned physics

Most zoom engines produce jarring transitions. foOm works differently:

```
User interactions → ZoomIntent queue
                 ↓
        Intent resolver picks the dominant intent at each moment in time
                 ↓
        Critically-damped spring simulation at 120 Hz
        (two separate springs: tight for scale, soft for position)
                 ↓
        Ramer-Douglas-Peucker simplification
        (keeps only meaningful inflection points, not 120 samples/s)
                 ↓
        ZoomKeyframe[] → Canvas renderer / FFmpeg zoompan export
```

### Feel Presets

| Preset | Stiffness `k` | Damping `c` | Mass `m` | Character |
|--------|--------------|------------|---------|-----------|
| `glass` | 3.2 | 3.6 | 1.0 | Glacial, near-floating cinematic drift |
| `velvet` | 4.5 | 4.8 | 1.2 | Heavier inertia, ultra luxurious |
| `silk` | 7.0 | 5.3 | 1.0 | **Default** — pro-smooth |
| `snap` | 18.0 | 8.5 | 1.0 | Quicker, still spring-based |

The position spring runs at **55% of the scale spring stiffness** and is slightly under-damped (`×0.92`) — this is what makes camera pans read as smooth dollies rather than hard cuts.

---

## 🗂 Project Structure

```
src/
├── components/
│   ├── AutoZoomEditor.tsx     # Full editor UI — timeline, controls, preview
│   ├── RecordingStudio.tsx    # Recording flow (idle → countdown → recording → stopped)
│   ├── WebcamOverlay.tsx      # Draggable floating webcam bubble
│   ├── HeroSection.tsx        # Landing page hero with Mux video background
│   ├── FeaturesSection.tsx    # Feature grid
│   ├── PricingSection.tsx     # Free / Pro plans with Polar embedded checkout
│   ├── Navbar.tsx             # Fixed top navigation
│   └── ...
├── hooks/
│   └── useScreenRecording.ts  # All MediaRecorder, stream, and event-tracking logic
├── lib/
│   ├── autoZoom.ts            # Spring-physics zoom engine (the core IP)
│   ├── gemini.ts              # Gemini 1.5 Flash — frame analysis & transcription
│   ├── composite.ts           # Canvas compositor — merges screen + webcam streams
│   ├── backgrounds.ts         # Background presets for the editor
│   └── subscription.ts        # Polar subscription verification & local state
├── routes/
│   ├── index.tsx              # Landing page
│   └── record.tsx             # Recording studio page
└── styles.css                 # Global design system (Tailwind v4 + custom tokens)
```

---

## 🛠 Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | React 19 + Vite 7 |
| **Routing** | TanStack Router v1 (file-based) |
| **Styling** | Tailwind CSS v4 + Framer Motion 12 |
| **UI Primitives** | Radix UI + shadcn/ui |
| **AI** | Google Gemini 1.5 Flash (`@google/generative-ai`) |
| **Video Processing** | FFmpeg WASM (`@ffmpeg/ffmpeg`) + `mp4-muxer` + `webm-muxer` |
| **Payments** | Polar.sh (`@polar-sh/checkout`) |
| **Database** | Prisma (Cloudflare D1) |
| **Deployment** | Cloudflare Pages + Cloudflare Workers |
| **Runtime** | Bun |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 20 or [Bun](https://bun.sh) ≥ 1.1
- A [Google AI Studio](https://aistudio.google.com) API key (for Gemini features)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/foom.git
cd foom
bun install
# or: npm install
```

### 2. Environment Variables

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

```env
# Required — Google Gemini API for AI zoom analysis & transcription
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# Required — Polar.sh for Pro subscription payments
VITE_POLAR_CHECKOUT_URL=https://polar.sh/checkout/...
```

### 3. Run Locally

```bash
bun run dev
# or: npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Note:** The app requires `Cross-Origin-Embedder-Policy: credentialless` headers for SharedArrayBuffer support (used by FFmpeg WASM). These are set automatically by the Vite dev server in `vite.config.ts`.

---

## 📦 Available Scripts

```bash
bun run dev          # Start local dev server
bun run build        # Production build
bun run build:dev    # Development build (with source maps)
bun run preview      # Preview production build locally
bun run lint         # ESLint
bun run format       # Prettier
```

---

## 🔑 Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GEMINI_API_KEY` | Yes | Google Gemini API key for AI frame analysis and audio transcription |
| `VITE_POLAR_CHECKOUT_URL` | Yes | Polar.sh checkout link for Pro plan upgrades |

---

## 🏗 Architecture Notes

### Recording Flow

```
useScreenRecording hook
  │
  ├── MediaRecorder (screen / window / tab capture)
  ├── getUserMedia (webcam + microphone)
  ├── Event tracking: clicks, scrolls, keystrokes, pauses
  └── On stop → { blob, duration, clicks, scrolls, pauses, typeBursts }
           │
           └── AutoZoomEditor
                 ├── generateZoomKeyframes() → spring simulation
                 ├── Gemini frame analysis (optional AI enhancement)
                 ├── Canvas compositor (screen + webcam overlay)
                 └── FFmpeg WASM export → MP4
```

### Spring Simulation

The zoom engine runs a **semi-implicit (symplectic) Euler integrator** at `1/120s` steps. It auto-sub-steps internally to guarantee stability for any spring parameters — the spring **never explodes** regardless of how fast events fire.

After simulation, the resulting ~120 keyframes/second array is compressed with **Ramer-Douglas-Peucker** (ε = 0.0004) so the renderer only stores meaningful inflection points.

### Canvas Compositor

`composite.ts` merges the screen capture stream and the webcam stream onto a single `OffscreenCanvas`, then applies the zoom transform per-frame using `ctx.setTransform()` before handing the composited pixels to `mp4-muxer` / `webm-muxer`.

---

## 💳 Pricing

| Plan | Price | Recordings | Resolution | Watermark |
|------|-------|-----------|-----------|----------|
| Free | $0/mo | 5/month | 720p | Yes |
| Pro | $25/mo | Unlimited | 1080p HD | No |

Pro includes: AI Subtitles, Smart Trim, and Custom Branding.

---

## 📄 License

MIT © foOm Team

---

<div align="center">
  <strong>Built with precision by engineers who hate bad demos.</strong>
</div>
