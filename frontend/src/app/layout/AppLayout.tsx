import { Outlet } from "react-router-dom";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";

export function AppLayout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{ padding: 16, flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}
