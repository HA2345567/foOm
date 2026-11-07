import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Circle,
  Clapperboard,
  FolderOpen,
  HardDrive,
  Layers3,
  MousePointer2,
  Plus,
  Settings2,
  Sparkles,
  Video,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import "./studio-home.css";

export function StudioHome() {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const record = () =>
    run(async () => {
      if ("__TAURI_INTERNALS__" in window) {
        const result = await window.foomNative.switchToOverlay();
        if (result?.success === false) throw new Error(result.error || "Could not open recorder");
      } else window.location.search = "?windowType=hud-overlay";
    });
  const importVideo = () =>
    run(async () => {
      const result = await window.foomNative.openVideoFilePicker();
      if (result?.canceled) return;
      if (!result?.success || !result.path)
        throw new Error(result?.error || "Could not open video");
      const saved = await window.foomNative.invokeNativeBridge({
        domain: "project",
        action: "setCurrentVideoPath",
        payload: { path: result.path },
      });
      if (saved?.ok === false || saved?.data?.success === false) throw new Error(saved?.error?.message || saved?.data?.error || "Could not prepare this video for editing");
      await window.foomNative.switchToEditor();
    });
  const openProject = () =>
    run(async () => {
      const result = await window.foomNative.invokeNativeBridge({
        domain: "project",
        action: "loadProjectFile",
      });
      if (result?.data?.canceled) return;
      if (!result?.data?.success) throw new Error(result?.data?.error || "Could not open project");
      await window.foomNative.switchToEditor();
    });
  return (
    <div className="studio-home">
      <aside className="studio-nav">
        <a href="/" className="studio-brand">
          <span className="studio-brand-mark">
            <Clapperboard size={23} />
          </span>
          foOom<span className="studio-beta">STUDIO</span>
        </a>
        <button className="studio-primary studio-new" onClick={record} disabled={busy}>
          <Plus size={17} /> New recording <ArrowUpRight size={15} aria-hidden="true" />
        </button>
        <p className="studio-nav-label">WORKSPACE</p>
        <nav>
          <a className="studio-nav-active" href="/">
            <Layers3 size={18} /> My studio
          </a>
          <button onClick={openProject} disabled={busy}>
            <FolderOpen size={18} /> Open project
          </button>
          <button onClick={importVideo} disabled={busy}>
            <ArrowDownToLine size={18} /> Import video
          </button>
        </nav>
        <div className="studio-nav-bottom">
          <div className="studio-local">
            <span className="studio-status-dot" /> Local. Private. Yours.
            <p>Your recordings stay on your device.</p>
          </div>
          <Link to="/settings">
            <Settings2 size={18} /> Settings
          </Link>
          <div className="studio-profile">
            <span>f</span>
            <div>
              Your workspace<small>Free & open source</small>
            </div>
            <HardDrive size={17} />
          </div>
        </div>
      </aside>
      <main className="studio-main">
        <header className="studio-topbar">
          <div>
            <span className="studio-breadcrumb">Workspace</span>
            <span>/</span>
            <strong>My studio</strong>
          </div>
          <span className="studio-system">
            <span className="studio-status-dot" /> Local workspace
          </span>
        </header>
        <div className="studio-content">
          <div className="studio-page-heading">
            <div>
              <p className="studio-eyebrow">LESS EDITING. MORE CREATING.</p>
              <h1>Your ideas, in motion.</h1>
              <p>Beautiful screen recordings. Without the busywork.</p>
            </div>
            <button className="studio-outline" onClick={openProject} disabled={busy}>
              <FolderOpen size={16} /> Open project
            </button>
          </div>
          <section className="studio-hero">
            <div className="studio-hero-copy">
              <span className="studio-pill">
                <Sparkles size={13} /> A LITTLE MOTION. A BIG DIFFERENCE.
              </span>
              <h2>
                Hit record.
                <br />
                Make it <em>cinematic.</em>
              </h2>
              <p>
                Capture your screen. Let smart zoom bring the important details into focus. Make it
                yours, then share it anywhere.
              </p>
              <button className="studio-primary" onClick={record} disabled={busy}>
                <span className="studio-record-dot" /> Start a recording <ArrowUpRight size={17} />
              </button>
              <span className="studio-hero-note">No account. No watermark. Just your story.</span>
            </div>
            <div
              className="studio-illustration"
              aria-label="Illustration of a polished screen recording"
            >
              <div className="studio-demo-window">
                <div className="studio-demo-bar">
                  <i />
                  <i />
                  <i />
                  <span>your next big idea</span>
                  <span><ArrowUpRight size={10} aria-hidden="true" /></span>
                </div>
                <div className="studio-demo-body">
                  <div className="studio-demo-rail">
                    <Clapperboard size={18} />
                    <div />
                    <div />
                    <div />
                  </div>
                  <div className="studio-demo-canvas">
                    <span className="studio-demo-tag">THE CREATIVE SPACE</span>
                    <h3>
                      Small details.
                      <br />
                      Big impact.
                    </h3>
                    <div className="studio-demo-cards">
                      <div>
                        <span>01</span>
                        <b>Find your focus</b>
                        <small>Give every detail its moment.</small>
                      </div>
                      <div>
                        <Sparkles size={24} />
                        <b>Make it flow</b>
                        <small>Motion that feels natural.</small>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="studio-demo-player">
                  <Circle size={10} />
                  <span>00:12</span>
                  <div />
                  <span>00:42</span>
                </div>
              </div>
              <span className="studio-zoom-badge">
                <WandSparkles size={15} /> Auto-zoom, on point
              </span>
              <MousePointer2 className="studio-demo-pointer" size={37} fill="#eeeeee" />
              <span className="studio-cursor-label">Your audience, focused.</span>
            </div>
          </section>
          <div className="studio-section-heading">
            <h2>Choose your starting point</h2>
            <span>A simple workflow. A polished result.</span>
          </div>
          <section className="studio-action-grid">
            <button onClick={record} disabled={busy}>
              <span className="studio-action-icon lime">
                <Video size={22} />
              </span>
              <strong>
                Record something great <ArrowRight size={17} />
              </strong>
              <p>
                Screen, window, or a selected area.
                <br />
                Your next walkthrough starts here.
              </p>
              <small>START RECORDING</small>
            </button>
            <button onClick={importVideo} disabled={busy}>
              <span className="studio-action-icon teal">
                <ArrowDownToLine size={22} />
              </span>
              <strong>
                Give a video a new look <ArrowRight size={17} />
              </strong>
              <p>
                Bring your footage into the editor.
                <br />
                Frame, trim, and make it shine.
              </p>
              <small>IMPORT A VIDEO</small>
            </button>
            <button onClick={openProject} disabled={busy}>
              <span className="studio-action-icon lilac">
                <FolderOpen size={22} />
              </span>
              <strong>
                Pick up where you left off <ArrowRight size={17} />
              </strong>
              <p>
                Open a saved foOom project.
                <br />
                Keep every creative decision editable.
              </p>
              <small>OPEN A PROJECT</small>
            </button>
          </section>
          <footer className="studio-footer">
            <span>
              <span className="studio-status-dot" /> Built for your creative flow
            </span>
            <span>
              Made with care. Open to everyone. <span className="studio-footer-brand">foOom</span>
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
