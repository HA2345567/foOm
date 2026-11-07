// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudioHome } from "./StudioHome";
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });

it("opens the native recorder from the primary studio action", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const open = vi.fn().mockResolvedValue({ success: true });
  window.foomNative = { switchToOverlay: open };
  render(<StudioHome />);
  fireEvent.click(screen.getByRole("button", { name: /Start a recording/ }));
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
});

it("imports through the bridge before navigating to the editor", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true });
  const editor = vi.fn();
  window.foomNative = { openVideoFilePicker: vi.fn().mockResolvedValue({ success: true, path: "C:/clip.mp4" }), invokeNativeBridge: invoke, switchToEditor: editor };
  render(<StudioHome />);
  fireEvent.click(screen.getByRole("button", { name: /Give a video a new look/ }));
  await waitFor(() => expect(editor).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith({ domain: "project", action: "setCurrentVideoPath", payload: { path: "C:/clip.mp4" } });
});

it("leaves the studio open when import is cancelled", async () => {
  const editor = vi.fn();
  window.foomNative = { openVideoFilePicker: vi.fn().mockResolvedValue({ canceled: true }), switchToEditor: editor };
  render(<StudioHome />);
  fireEvent.click(screen.getByRole("button", { name: /Give a video a new look/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Give a video a new look/ }).hasAttribute("disabled")).toBe(false));
  expect(editor).not.toHaveBeenCalled();
});
