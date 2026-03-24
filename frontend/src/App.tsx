import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./app/router";
import { AuthProvider } from "./app/providers/AuthProvider";
import { QueryProvider } from "./app/providers/QueryProvider";
import { Sidebar } from "./widgets/Sidebar/Sidebar";

export default function App() {
  return (
    <BrowserRouter>
      <QueryProvider>
        <AuthProvider>
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar />
            <main style={{ padding: 16, flex: 1 }}>
              <AppRouter />
            </main>
          </div>
        </AuthProvider>
      </QueryProvider>
    </BrowserRouter>
  );
}
