// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RegionPicker } from "./RegionPicker";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("maps a drag to physical pixels on a display with a negative origin", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const confirm = vi.fn();
  render(<RegionPicker name="Left display" bounds={{ x: -1000, y: 0, width: 1000, height: 500 }} onConfirm={confirm} onCancel={() => {}} />);
  const map = screen.getByLabelText("Display region map");
  map.setPointerCapture = vi.fn();
  map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  fireEvent.pointerDown(map, { clientX: 10, clientY: 20 });
  fireEvent.pointerMove(map, { clientX: 30, clientY: 40 });
  fireEvent.pointerUp(map);
  fireEvent.click(screen.getByRole("button", { name: "Use region" }));
  expect(confirm).toHaveBeenCalledWith({ x: -900, y: 100, width: 200, height: 100 });
});

it("keeps numeric selections within the chosen display", () => {
  const confirm = vi.fn();
  render(<RegionPicker name="Display" bounds={{ x: 0, y: 0, width: 1920, height: 1080 }} onConfirm={confirm} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("Region x"), { target: { value: "-9000" } });
  fireEvent.change(screen.getByLabelText("Region width"), { target: { value: "99999" } });
  fireEvent.change(screen.getByLabelText("Region height"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Use region" }));
  expect(confirm).toHaveBeenCalledWith({ x: 0, y: 270, width: 1920, height: 1 });
});
