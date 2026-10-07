import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Picks from "./pages/Picks";
import Live from "./pages/Live";
import PlusEV from "./pages/PlusEV";
import Props from "./pages/Props";
import Parlays from "./pages/Parlays";
import LineMovement from "./pages/LineMovement";
import Sports from "./pages/Sports";
import ModelDetail from "./pages/ModelDetail";
import Assistant from "./pages/Assistant";
import Tracker from "./pages/Tracker";
import Performance from "./pages/Performance";
import Premium from "./pages/Premium";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/picks" element={<Picks />} />
        <Route path="/live" element={<Live />} />
        <Route path="/ev" element={<PlusEV />} />
        <Route path="/props" element={<Props />} />
        <Route path="/parlays" element={<Parlays />} />
        <Route path="/line-movement" element={<LineMovement />} />
        <Route path="/sports" element={<Sports />} />
        <Route path="/sports/:modelId" element={<ModelDetail />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/tracker" element={<Tracker />} />
        <Route path="/performance" element={<Performance />} />
        <Route path="/premium" element={<Premium />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
