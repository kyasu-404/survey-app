import { BrowserRouter, Routes, Route } from "react-router-dom";
import Form from "./pages/Form";

<BrowserRouter>
  <Routes>
    <Route path="/form/:id" element={<Form />} />
  </Routes>
</BrowserRouter>
