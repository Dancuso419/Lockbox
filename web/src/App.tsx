import { Routes, Route, NavLink, Link } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { CONFIG } from "./config";
import ThemeToggle from "./components/ThemeToggle";
import { LockboxMark } from "./components/BoxWall";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./routes/Landing";
import Public from "./routes/Public";
import Organizer from "./routes/Organizer";
import Recipient from "./routes/Recipient";

const NAV = [
  { to: "/pool", label: "Explore" },
  { to: "/organizer", label: "Organizer" },
  { to: "/claim", label: "Claim" },
];

function WalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== CONFIG.chainId;

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        className="rounded-full bg-primary px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-primary-foreground transition-transform hover:-translate-y-0.5"
      >
        Connect
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <button
          onClick={() => switchChain({ chainId: CONFIG.chainId })}
          className="rounded-full border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/10"
        >
          Switch to Coston2
        </button>
      )}
      <span className="rounded-full border border-border px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </span>
      <button
        onClick={() => disconnect()}
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Disconnect
      </button>
    </div>
  );
}

function TopBar() {
  return (
    // Floating: the bar hovers over the page rather than capping it, so the
    // wrapper is click-through and only the pill itself takes pointer events.
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[1100]">
      <div className="shell pt-4">
        <div className="pointer-events-auto flex h-14 items-center justify-between gap-6 rounded-full border border-border bg-surface/80 py-2 pl-6 pr-2 shadow-[0_8px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <Link to="/" className="flex items-center gap-2.5 text-foreground">
            <span className="text-glow">
              <LockboxMark className="size-[18px]" />
            </span>
            <span className="font-display text-base font-bold uppercase tracking-[-0.02em]">
              Lockbox<span className="text-glow">.</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                    isActive ? "text-glow" : "text-muted-foreground hover:text-foreground"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="shell flex flex-col items-center justify-between gap-4 py-10 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="text-glow">
            <LockboxMark className="size-4" />
          </span>
          <span>Lockbox — Confidential Prize Pool</span>
        </div>
        <div className="flex items-center gap-5">
          <span>Coston2 testnet</span>
          <a
            href={CONFIG.explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Explorer
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="flex-1 pt-24">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/pool" element={<Public />} />
            <Route path="/organizer" element={<Organizer />} />
            <Route path="/claim" element={<Recipient />} />
          </Routes>
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}
