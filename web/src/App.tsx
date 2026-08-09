import { Routes, Route, NavLink } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CONFIG } from "./config";
import Public from "./routes/Public";
import Organizer from "./routes/Organizer";
import Recipient from "./routes/Recipient";

function TopBar() {
  const { address, chainId, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== CONFIG.chainId;

  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="container mx-auto max-w-5xl px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-gray-900 tracking-tight">Confidential Prize Pool</span>
          <nav className="hidden sm:flex items-center gap-4 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "text-blue-600 font-medium" : "text-gray-500 hover:text-gray-900 transition-colors"
              }
            >
              Public
            </NavLink>
            <NavLink
              to="/organizer"
              className={({ isActive }) =>
                isActive ? "text-blue-600 font-medium" : "text-gray-500 hover:text-gray-900 transition-colors"
              }
            >
              Organizer
            </NavLink>
            <NavLink
              to="/claim"
              className={({ isActive }) =>
                isActive ? "text-blue-600 font-medium" : "text-gray-500 hover:text-gray-900 transition-colors"
              }
            >
              Claim
            </NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {wrongChain && (
            <Button
              size="sm"
              variant="outline"
              className="border-yellow-400 text-yellow-700 hover:bg-yellow-50"
              onClick={() => switchChain({ chainId: CONFIG.chainId })}
            >
              Switch to Coston2
            </Button>
          )}
          {isConnected ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono tabular-nums text-xs">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => connect({ connector: injected() })}>
              Connect Wallet
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <TopBar />
      <main className="pt-2">
        <Routes>
          <Route path="/" element={<Public />} />
          <Route path="/organizer" element={<Organizer />} />
          <Route path="/claim" element={<Recipient />} />
        </Routes>
      </main>
    </div>
  );
}
