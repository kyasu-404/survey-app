import { Outlet } from "react-router-dom";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";

export function AppLayout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main
        style={{
          flex: 1,
          minHeight: "100vh",
          width: "100%",
          padding: 16,
          boxSizing: "border-box"
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
