import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Moon, Sun, Monitor, Menu, X } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { UserAuthForm } from "@/components/auth-form";
import { UserNewPasswordForm } from "@/components/auth-newpassword-form";
import { UserRegisterForm } from "@/components/auth-register-form";
import { useAuthStore } from "@/store/useAuthStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ---------- ambient graph constellation ---------- */
export function GraphConstellation() {
  const nodes = useMemo(() => {
    const items: { x: number; y: number; r: number; delay: number; generation: number }[] = [];
    // Seed neurons — generation 0, spread across full screen
    const seeds = [
      { x: 8, y: 10 }, { x: 35, y: 8 }, { x: 65, y: 6 }, { x: 92, y: 12 },
      { x: 12, y: 40 }, { x: 50, y: 35 }, { x: 88, y: 42 },
      { x: 8, y: 65 }, { x: 42, y: 60 }, { x: 72, y: 65 }, { x: 92, y: 58 },
      { x: 15, y: 90 }, { x: 50, y: 92 }, { x: 85, y: 88 },
    ];
    seeds.forEach((s, i) => {
      items.push({ ...s, r: 0.45, delay: i * 0.6, generation: 0 });
    });

    // Helper to branch from a range of parent nodes
    const branch = (
      startIdx: number, endIdx: number, gen: number,
      branchCount: (gi: number) => number,
      dist: (gi: number, i: number) => number,
      radius: number, delayOffset: number,
      step: number,
    ) => {
      const newStart = items.length;
      for (let gi = startIdx; gi < endIdx; gi += step) {
        const parent = items[gi];
        const count = branchCount(gi);
        for (let i = 0; i < count; i++) {
          const angle = (gi * 1.7 + i * (6.28 / count) + gen * 0.9) % 6.28;
          const d = dist(gi, i);
          items.push({
            x: Math.max(1, Math.min(99, parent.x + Math.cos(angle) * d)),
            y: Math.max(1, Math.min(99, parent.y + Math.sin(angle) * d)),
            r: radius,
            delay: parent.delay + delayOffset + i * 0.25,
            generation: gen,
          });
        }
      }
      return newStart;
    };

    // Generation 1 — primary axons
    const g1Start = branch(
      0, seeds.length, 1,
      (gi) => 3 + (gi % 3),
      (_gi, i) => 7 + (i * 2.5) % 6,
      0.35, 1.0, 1,
    );
    const g1End = items.length;

    // Generation 2 — secondary branches
    const g2Start = branch(
      g1Start, g1End, 2,
      (gi) => 2 + (gi % 2),
      (_gi, i) => 5 + (i * 1.8) % 4,
      0.25, 1.2, 1,
    );
    const g2End = items.length;

    // Generation 3 — tertiary dendrites
    const g3Start = branch(
      g2Start, g2End, 3,
      (gi) => 1 + (gi % 2),
      (_gi, i) => 3.5 + (i * 1.2) % 3,
      0.18, 1.0, 1,
    );
    const g3End = items.length;

    // Generation 4 — fine branches
    const g4Start = branch(
      g3Start, g3End, 4,
      () => 1,
      (_gi, i) => 2.5 + (i * 0.8) % 2,
      0.13, 0.8, 2,
    );
    const g4End = items.length;

    // Generation 5 — terminal tips
    branch(
      g4Start, g4End, 5,
      () => 1,
      () => 1.8,
      0.09, 0.6, 2,
    );

    return items;
  }, []);

  const edges = useMemo(() => {
    const lines: {
      x1: number; y1: number; x2: number; y2: number;
      delay: number; generation: number;
    }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Tighter connections for later generations, wider for early
        const genDiff = Math.abs(nodes[i].generation - nodes[j].generation);
        const threshold = genDiff <= 1 ? 14 : 8;
        if (dist < threshold) {
          lines.push({
            x1: nodes[i].x, y1: nodes[i].y,
            x2: nodes[j].x, y2: nodes[j].y,
            delay: Math.max(nodes[i].delay, nodes[j].delay),
            generation: Math.max(nodes[i].generation, nodes[j].generation),
          });
        }
      }
    }
    return lines;
  }, [nodes]);

  // Organic curve between two points
  const dendritePath = (
    x1: number, y1: number, x2: number, y2: number, seed: number
  ): string => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const hash = Math.sin(seed * 9301 + 4973) * 0.5;
    const offset = len * 0.25 * hash;
    const nx = -dy / len;
    const ny = dx / len;
    const cx = mx + nx * offset;
    const cy = my + ny * offset;
    return `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
  };

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* Synapses — grow along paths */}
      {edges.map((e, i) => {
        const d = dendritePath(e.x1, e.y1, e.x2, e.y2, i);
        const strokeOpacity = [0.16, 0.13, 0.10, 0.07, 0.05, 0.04][e.generation] ?? 0.04;
        const strokeW = [0.22, 0.17, 0.12, 0.08, 0.06, 0.04][e.generation] ?? 0.04;
        return (
          <g key={`e${i}`}>
            <path
              d={d}
              fill="none"
              stroke={`hsl(214 60% 38% / ${strokeOpacity})`}
              strokeWidth={strokeW}
              strokeDasharray="50"
              strokeDashoffset="50"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="50"
                to="0"
                dur="3s"
                begin={`${e.delay}s`}
                fill="freeze"
              />
              <animate
                attributeName="opacity"
                values="0;1"
                dur="0.5s"
                begin={`${e.delay}s`}
                fill="freeze"
              />
            </path>
            {/* Signal pulse traveling along synapse */}
            {i % 4 === 0 && (
              <circle
                r={0.18 + (i % 3) * 0.05}
                fill={`hsl(214 60% 50% / 0.26)`}
                opacity="0"
              >
                <animateMotion
                  dur={`${16 + (i % 5) * 4}s`}
                  repeatCount="indefinite"
                  begin={`${e.delay + 3}s`}
                  path={d}
                />
                <animate
                  attributeName="opacity"
                  values="0;0.3;0"
                  dur={`${16 + (i % 5) * 4}s`}
                  repeatCount="indefinite"
                  begin={`${e.delay + 3}s`}
                />
              </circle>
            )}
          </g>
        );
      })}
      {/* Neurons — fade in by generation */}
      {nodes.map((n, i) => {
        const fillOpacity = [0.26, 0.21, 0.15, 0.10, 0.07, 0.05][n.generation] ?? 0.05;
        return (
          <g key={`n${i}`} opacity="0">
            <animate
              attributeName="opacity"
              from="0" to="1"
              dur="1s"
              begin={`${n.delay}s`}
              fill="freeze"
            />
            <circle
              cx={n.x} cy={n.y} r={n.r}
              fill={`hsl(214 60% 38% / ${fillOpacity})`}
            >
              <animate
                attributeName="r"
                values={`0;${n.r * 1.3};${n.r}`}
                dur="1.2s"
                begin={`${n.delay}s`}
                fill="freeze"
              />
            </circle>
            {/* Glow ring on seed neurons */}
            {n.generation === 0 && (
              <circle
                cx={n.x} cy={n.y} r={n.r * 3}
                fill="none"
                stroke="hsl(214 60% 50% / 0.22)"
                strokeWidth="0.06"
                className="animate-graph-pulse"
                style={{ animationDelay: `${n.delay + 1}s` }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Landing Page ---------- */
interface LandingPageProps {
  onSignIn: () => void;
  showSignIn?: boolean;
  onBack?: () => void;
}

export function LandingPage({ onSignIn, showSignIn, onBack }: LandingPageProps) {
  const { setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const goApply = () => navigate({ to: "/apply" });

  // Signin form state
  const signInStep = useAuthStore((state) => state.signInStep);
  const [view, setView] = useState<"signin" | "register">("signin");
  const isNewPassword =
    signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="public-page relative w-dvw min-h-dvh overflow-x-hidden bg-background text-foreground">
      {/* ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <GraphConstellation />
      </div>

      {/* ─── SIGN-IN OVERLAY ─── */}
      {showSignIn && (
        <div className="fixed inset-0 z-30 flex flex-col bg-background/80" onClick={onBack}>
          {/* centered form */}
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="w-full max-w-[420px] animate-fade-in rounded-2xl bg-card border border-border p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {isNewPassword ? (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-card-foreground">
                      Set new password
                    </h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Choose a secure password to continue
                    </p>
                  </div>
                  <UserNewPasswordForm />
                </div>
              ) : view === "register" ? (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold tracking-tight text-card-foreground">
                    Create an account
                  </h2>
                  <UserRegisterForm onRegistered={() => setView("signin")} />
                  <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => setView("signin")}
                      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                    >
                      Sign in
                    </button>
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <UserAuthForm />
                  <p className="text-center text-sm text-muted-foreground">
                    Social Active App is invitation only.{" "}
                    <button
                      type="button"
                      onClick={goApply}
                      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                    >
                      Contact us
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── NAV ─── */}
      <nav className="sticky top-0 z-20 flex items-center justify-between px-6 md:px-12 py-5 bg-background/70 backdrop-blur-sm border-b border-border">
        <span className="text-lg font-semibold tracking-tight text-foreground">
          Social Active App
        </span>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6 text-sm">
          <button
            type="button"
            onClick={() => scrollTo("mission")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Mission
          </button>
          <button
            type="button"
            onClick={() => scrollTo("community")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Community
          </button>
          <button
            type="button"
            onClick={() => scrollTo("testimonials")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Testimonials
          </button>
          <button
            type="button"
            onClick={() => scrollTo("community")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Contact
          </button>

          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                aria-label="Toggle theme"
              >
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-0">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="h-4 w-4" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="h-4 w-4" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="h-4 w-4" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={onSignIn}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign In
          </button>
        </div>

        {/* Mobile hamburger */}
        <div className="flex md:hidden items-center gap-3">
          {/* Theme toggle (mobile) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                aria-label="Toggle theme"
              >
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-0">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="h-4 w-4" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="h-4 w-4" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="h-4 w-4" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile menu panel */}
      {menuOpen && (
        <div className="relative z-20 md:hidden border-b border-border bg-background/95 backdrop-blur-sm px-6 py-4 flex flex-col gap-4 text-sm">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); scrollTo("mission"); }}
            className="text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Mission
          </button>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); scrollTo("community"); }}
            className="text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Community
          </button>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); scrollTo("testimonials"); }}
            className="text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Testimonials
          </button>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); scrollTo("community"); }}
            className="text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            Contact
          </button>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); onSignIn(); }}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors w-fit"
          >
            Sign In
          </button>
        </div>
      )}

      {/* ─── HERO ─── */}
      <section className="relative z-10 flex flex-col items-center justify-center text-center px-6 min-h-[calc(100dvh-68px)]">
        <div className="flex flex-col items-center gap-2 -mt-[110px]">
          <div className="animate-fade-in rounded-2xl bg-background/50 p-4 md:p-6 w-[clamp(200px,35vw,600px)]">
            <img
              src="/assets/community-image.png"
              alt="Social Active App"
              className="w-full h-auto"
            />
          </div>
          <p className="animate-fade-in text-2xl md:text-3xl text-muted-foreground tracking-wide font-medium">
            Cybersecurity Executive Community
          </p>
          <p className="animate-fade-in text-base md:text-lg text-muted-foreground/70 tracking-widest uppercase text-center">
            Consistent &middot; Discrete &middot; Intentional
          </p>
          <button
            type="button"
            onClick={() => scrollTo("mission")}
            className="animate-fade-in rounded-lg bg-primary px-7 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Learn More
          </button>
        </div>
      </section>

      {/* ─── MISSION ─── */}
      <section
        id="mission"
        className="relative z-10 flex items-center min-h-dvh px-6 md:px-12 py-16 bg-secondary/50 border-t border-b border-border"
      >
        <div className="mx-auto max-w-7xl w-full flex flex-col items-center">
          <div className="w-full grid md:grid-cols-2 gap-12 md:gap-16 items-center">
            {/* Text — left */}
            <div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                The Mission
              </h2>
              <div className="mt-1 h-px w-16 bg-primary" />
              <p className="mt-8 text-base md:text-lg leading-relaxed text-muted-foreground">
                Social Active App &mdash; &ldquo;Social Active App&rdquo; is a
                focused, purpose-driven community of cybersecurity thought leaders.
                Elevating the members, partners, contractors, and venues of small
                business owners in the Social Active App ecosystem.
              </p>
              <p className="mt-6 text-base md:text-lg leading-relaxed text-muted-foreground">
                Our members combine deep expertise and passion to curate
                extraordinary insights collectively, furthering the knowledge share
                and growth as cybersecurity leaders.
              </p>
            </div>
            {/* Video — right */}
            <div className="rounded-2xl overflow-hidden border border-border shadow-xl">
              <video
                className="w-full h-auto"
                controls
                preload="metadata"
                poster="/assets/example-poster.jpg"
              >
                <source src="/assets/example-overview.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
          <button
            type="button"
            onClick={() => scrollTo("testimonials")}
            className="mt-12 rounded-lg bg-primary px-7 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Hear From Our Members
          </button>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section
        id="testimonials"
        className="relative z-10 flex items-center min-h-dvh px-6 md:px-12 py-16"
      >
        <div className="mx-auto max-w-5xl w-full flex flex-col items-center">
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
              Testimonials
            </h2>
            <div className="mt-1 mx-auto h-px w-16 bg-primary" />
            <p className="mt-6 text-base md:text-lg text-muted-foreground">
              What our members are saying about Social Active App.
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-3 gap-8">
            {[
              {
                quote:
                  "Social Active App has fundamentally changed how I connect with peers in the cybersecurity space. The curated conversations and genuine relationships are unlike anything else.",
                name: "Community Member",
                role: "CISO",
              },
              {
                quote:
                  "Being part of this community means having a trusted circle to navigate the constantly evolving threat landscape. The insights shared here are invaluable.",
                name: "Community Member",
                role: "VP of Security",
              },
              {
                quote:
                  "Social Active App created a space where cybersecurity leaders can be candid, collaborative, and intentional about growth. It\u2019s exactly what the industry needs.",
                name: "Community Member",
                role: "Security Director",
              },
            ].map((t, i) => (
              <div
                key={i}
                className="rounded-2xl border-2 border-foreground/20 bg-card p-8 flex flex-col justify-between"
              >
                <blockquote className="text-sm md:text-base leading-relaxed text-muted-foreground italic">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <div className="mt-6 pt-4 border-t border-border">
                  <p className="text-sm font-semibold text-foreground">
                    {t.name}
                  </p>
                  <p className="text-xs text-muted-foreground/70">{t.role}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => scrollTo("community")}
            className="mt-12 rounded-lg bg-primary px-7 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Membership
          </button>
        </div>
      </section>

      {/* ─── COMMUNITY ─── */}
      <section
        id="community"
        className="relative z-10 flex items-center min-h-dvh px-6 md:px-12 py-16 bg-secondary/50 border-t border-b border-border"
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Join The Community
          </h2>
          <div className="mt-1 mx-auto h-px w-16 bg-primary" />
          <p className="mt-8 text-base md:text-lg leading-relaxed text-muted-foreground">
            The Social Active App leadership team meets with every member
            candidate to ensure Social Active App is supporting intentional leaders
            who intend to contribute to the community.
          </p>
          <p className="mt-6 text-base md:text-lg leading-relaxed text-muted-foreground">
            Meet with our team and discover the immense value in becoming a
            member of &mdash; Social Active App.
          </p>
          <button
            type="button"
            onClick={goApply}
            className="mt-10 rounded-lg bg-primary px-7 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Contact Us
          </button>
        </div>
      </section>

      {/* ─── CONTACT / FOOTER ─── */}
      <footer
        id="contact"
        className="relative z-10 px-6 md:px-12 py-16 md:py-24"
      >
        <div className="mx-auto w-[1024px] max-w-full grid md:grid-cols-[1fr_auto_1fr] gap-16 items-start bg-background rounded-2xl p-8 border-2 border-foreground/20">
          {/* RFI */}
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Request for Information
            </h3>
            <dl className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">
                  Service Location
                </dt>
                <dd className="mt-0.5">Greater Seattle, WA</dd>
              </div>
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">
                  Contact
                </dt>
                <dd className="mt-0.5">
                  <a
                    href="mailto:info@example.com"
                    className="hover:text-foreground transition-colors"
                  >
                    info@example.com
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-lg font-semibold text-foreground">Links</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>
                <button
                  type="button"
                  onClick={() => scrollTo("mission")}
                  className="hover:text-foreground transition-colors"
                >
                  Mission
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => scrollTo("community")}
                  className="hover:text-foreground transition-colors"
                >
                  Community
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => scrollTo("testimonials")}
                  className="hover:text-foreground transition-colors"
                >
                  Testimonials
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="hover:text-foreground transition-colors"
                >
                  Sign In
                </button>
              </li>
            </ul>
          </div>

          {/* Logo */}
          <div className="flex items-center justify-end">
            <img
              src="/assets/logo.png"
              alt="Social Active App"
              className="h-48 w-auto opacity-80"
            />
          </div>
        </div>

        <div className="mt-16 mx-auto w-[1024px] max-w-full border-t border-border pt-6 text-center text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} Social Active App. All rights
          reserved.
        </div>
      </footer>
    </div>
  );
}
