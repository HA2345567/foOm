import { Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";

export default function App() {
  return (
    <>
      <Outlet />
      <Toaster theme="dark" closeButton richColors />
    </>
  );
}
