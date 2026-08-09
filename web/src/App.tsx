import { Routes, Route, NavLink, Link } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { CONFIG } from "./config";
import ThemeToggle from "./components/ThemeToggle";
import Landing from "./routes/Landing";
import Public from "./routes/Public";
import Organizer from "./routes/Organizer";
import Recipient from "./routes/Recipient";

const NAV = [
  { to: "/pool", label: "Explore" },
  { to: "/organizer", label: "Organizer" },
  { to: "/claim", label: "Claim" },
];

function KeyholeMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <circle cx="12" cy="9" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.6 12.5 L14.4 12.5 L16 20 L8 20 Z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

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
        className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-transform hover:-translate-y-0.5"
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
    <header className="sticky top-0 z-[1100] border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link to="/" className="flex items-center gap-2 text-foreground">
          <span className="text-glow">
            <KeyholeMark />
          </span>
          <span className="text-sm font-semibold tracking-tight">Keyhole</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `rounded-full px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="text-glow">
            <KeyholeMark />
          </span>
          <span>Keyhole — Confidential Prize Pool</span>
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
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/pool" element={<Public />} />
          <Route path="/organizer" element={<Organizer />} />
          <Route path="/claim" element={<Recipient />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
