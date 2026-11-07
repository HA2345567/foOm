// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceSelector } from "./SourceSelector";

vi.mock("@/contexts/I18nContext", () => ({
  useScopedT: (namespace: string) => {
    if (namespace === "common") {
      return (key: string) => {
        if (key === "actions.cancel") return "Cancel";
        if (key === "actions.share") return "Share";
        if (key === "actions.reload") return "Reload";
        return key;
      };
    }

    return (key: string, vars?: Record<string, string>) => {
      if (key === "sourceSelector.loading") return "Loading sources...";
      if (key === "sourceSelector.emptyTitle") return "No screens or windows found";
      if (key === "sourceSelector.emptyDescription") {
        return "If you just granted screen recording permission, reload this picker. On macOS you may need to reopen OpenScreen.";
      }
      if (key === "sourceSelector.loadFailedDescription") {
        return "OpenScreen could not load capture sources. Reload this picker and try again.";
      }
      if (key === "sourceSelector.screens") return `Screens (${vars?.count ?? "0"})`;
      if (key === "sourceSelector.windows") return `Windows (${vars?.count ?? "0"})`;
      return key;
    };
  },
}));

describe("SourceSelector", () => {
  it("clears pending recording when source selection is cancelled", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    localStorage.setItem("foom-start-recording-after-select", "true");
    window.electronAPI = { ...window.electronAPI, getSources: vi.fn().mockResolvedValue([
      { id: "screen:1", name: "Display", display_id: "1", thumbnail: null, appIcon: null },
    ]), selectSource: vi.fn() } as typeof window.electronAPI;
    render(<SourceSelector />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(localStorage.getItem("foom-start-recording-after-select")).toBeNull();
    expect(close).toHaveBeenCalledOnce();
    close.mockRestore();
  });
  it("selects an exact region on a secondary display", async () => {
    const selectSource = vi.fn();
    window.electronAPI = {
      ...window.electronAPI,
      getSources: vi.fn().mockResolvedValue([{ id: "screen:2", name: "Left display", display_id: "2", thumbnail: null, appIcon: null,
        bounds: { x: -1920, y: -200, width: 1920, height: 1080 } }]),
      selectSource,
    } as typeof window.electronAPI;
    render(<SourceSelector />);
    fireEvent.click(await screen.findByText("Left display"));
    fireEvent.click(screen.getByRole("button", { name: "Choose region" }));
    fireEvent.change(screen.getByLabelText("Region x"), { target: { value: "-1800" } });
    fireEvent.change(screen.getByLabelText("Region y"), { target: { value: "-100" } });
    fireEvent.change(screen.getByLabelText("Region width"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Region height"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Use region" }));
    expect(selectSource).toHaveBeenCalledWith(expect.objectContaining({
      id: "custom_area", type: "region", display_id: "2",
      region: { x: -1800, y: -100, width: 800, height: 600 },
    }));
  });
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      getSources: vi.fn().mockResolvedValue([]),
      selectSource: vi.fn(),
    } as typeof window.electronAPI;
  });

  it("shows a retry state when no capture sources are available", async () => {
    render(<SourceSelector />);

    await screen.findByText("No screens or windows found");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("reloads capture sources from the empty state", async () => {
    const getSources = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "screen:1:0",
          name: "Display 1",
          thumbnail: "data:image/png;base64,abc",
          display_id: "1",
          appIcon: null,
        },
      ]);
    window.electronAPI = {
      ...window.electronAPI,
      getSources,
      selectSource: vi.fn(),
    } as typeof window.electronAPI;

    render(<SourceSelector />);

    await screen.findByText("No screens or windows found");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(screen.getByText("Display 1")).toBeInTheDocument();
    });
    expect(getSources).toHaveBeenCalledTimes(2);
  });
});
