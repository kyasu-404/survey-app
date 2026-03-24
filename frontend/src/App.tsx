import { BrowserRouter, Routes, Route } from "react-router-dom";

import Builder from "./pages/Builder";
import Form from "./pages/Form";
import FormsList from "./pages/FormsList";
import AdminUsers from "./pages/AdminUsers";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FormsList />} />
        <Route path="/builder" element={<Builder />} />
        <Route path="/form/:id" element={<Form />} />
        <Route path="/admin/users" element={<AdminUsers />} />
      </Routes>
    </BrowserRouter>
  );
}
