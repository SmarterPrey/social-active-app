import { useMemo, useState } from "react";
import {
  Moon,
  Sun,
  Monitor,
  Mountain,
  Bike,
  Waves,
  Snowflake,
  Compass,
  Users,
  CalendarDays,
  ShieldCheck,
  MapPin,
} from "lucide-react";
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

/* ---------- ambient alpine backdrop ---------- */
export function GraphConstellation() {
  const contourPaths = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => {
      const y = 10 + i * 4.2;
      const amp = 1.2 + (i % 4) * 0.55;
      const phase = i * 0.85;
      return `M -5 ${y.toFixed(2)} C 15 ${(y + Math.sin(phase) * amp).toFixed(2)}, 35 ${(y + Math.cos(phase + 0.9) * amp).toFixed(2)}, 55 ${(y + Math.sin(phase + 1.6) * amp).toFixed(2)} S 95 ${(y + Math.cos(phase + 2.4) * amp).toFixed(2)}, 105 ${(y + Math.sin(phase + 3.1) * amp).toFixed(2)}`;
    });
  }, []);

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ridge-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(214 30% 30% / 0.5)" />
          <stop offset="100%" stopColor="hsl(214 25% 15% / 0.1)" />
        </linearGradient>
        <linearGradient id="ridge-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(215 28% 25% / 0.72)" />
          <stop offset="100%" stopColor="hsl(215 28% 10% / 0.22)" />
        </linearGradient>
      </defs>

      {contourPaths.map((path, i) => (
        <path
          key={`contour-${i}`}
          d={path}
          fill="none"
          stroke="hsl(214 24% 42% / 0.24)"
          strokeWidth={0.18 + (i % 3) * 0.04}
          strokeDasharray="0.3 0.5"
        >
          <animate
            attributeName="opacity"
            values="0.18;0.26;0.18"
            dur={`${10 + (i % 4) * 2}s`}
            repeatCount="indefinite"
          />
        </path>
      ))}

      <path
        d="M -5 78 C 18 68, 34 74, 52 63 C 66 54, 83 62, 105 49 L 105 110 L -5 110 Z"
        fill="url(#ridge-back)"
      />
      <path
        d="M -5 90 C 10 84, 24 88, 38 79 C 49 72, 63 76, 74 69 C 84 63, 95 66, 105 58 L 105 110 L -5 110 Z"
        fill="url(#ridge-front)"
      />
      <path
        d="M 14 84 L 18 78 L 22 84 M 48 74 L 52 68 L 56 74 M 80 68 L 84 62 L 88 68"
        stroke="hsl(205 40% 82% / 0.16)"
        strokeWidth="0.35"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- Landing Page ---------- */
interface LandingPageProps {
  onSignIn: () => void;
  showSignIn?: boolean;
  onBack?: () => void;
}

const activityPills = [
  "Rock and alpine climbing",
  "Glacier travel",
  "Canyoneering",
  "Trail and mountain running",
  "Road, gravel, and MTB",
  "Ski touring and mountaineering",
  "Parasailing",
  "Weather-window missions",
];

const trustSignals = [
  "Experience tags and route logs on every member profile",
  "Gear manifests so teams know who carries rope, rack, skis, or rescue kit",
  "Post-objective debriefs that surface dependable expedition partners",
  "Invite-only sorties for private rope teams building long-term trust",
];

export function LandingPage({ onSignIn, showSignIn, onBack }: LandingPageProps) {
  const { setTheme } = useTheme();
  const signInStep = useAuthStore((state) => state.signInStep);
  const [view, setView] = useState<"signin" | "register">("signin");
  const isNewPassword =
    signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="public-page relative w-dvw min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="fixed inset-0 pointer-events-none">
        <GraphConstellation />
      </div>

      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(1200px 600px at 20% 0%, hsl(var(--primary) / 0.14), transparent 70%), radial-gradient(700px 500px at 85% 20%, hsl(170 45% 38% / 0.12), transparent 65%), radial-gradient(900px 600px at 50% 100%, hsl(36 70% 46% / 0.09), transparent 68%)",
        }}
      />

      {showSignIn && (
        <div className="fixed inset-0 z-30 flex flex-col bg-background/80" onClick={onBack}>
          <div className="flex flex-1 items-center justify-center px-6">
            <div
              className="w-full max-w-[440px] animate-fade-in rounded-2xl bg-card border border-border p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {isNewPassword ? (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-card-foreground">
                      Set new password
                    </h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Choose a secure password to continue.
                    </p>
                  </div>
                  <UserNewPasswordForm />
                </div>
              ) : view === "register" ? (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold tracking-tight text-card-foreground">
                    Create your outdoor profile
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
                    New here?{" "}
                    <button
                      type="button"
                      onClick={() => setView("register")}
                      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                    >
                      Create your profile
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="fixed right-6 top-5 z-20 md:right-12">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/70 text-muted-foreground backdrop-blur-sm hover:text-foreground hover:border-primary/40 transition-colors"
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
      </div>

      <section className="relative z-10 px-6 pt-16 pb-14 md:px-12 md:pt-24 md:pb-24">
        <div className="mx-auto grid w-full max-w-7xl gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/60 px-4 py-1.5 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <Compass className="h-3.5 w-3.5 text-primary" />
              Alpine expedition network
            </p>

            <h1 className="max-w-[18ch] text-balance text-4xl font-semibold tracking-tight md:text-6xl">
              Build your rope team before the weather window opens.
            </h1>

            <p className="max-w-[58ch] text-pretty text-base leading-7 text-muted-foreground md:text-lg">
              Document your technical experience, equipment, and objective style. Post expedition briefs,
              invite proven partners, and steadily grow a trusted mountain network.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSignIn}
                className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Create your profile
              </button>
              <button
                type="button"
                onClick={() => scrollTo("how")}
                className="rounded-lg border border-border bg-background/60 px-6 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                See how it works
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 md:max-w-[540px]">
              <div className="rounded-xl border border-border/80 bg-background/55 p-4">
                <div className="text-2xl font-semibold">Route-ready</div>
                <p className="mt-1 text-sm text-muted-foreground">Profile, brief, rope team</p>
              </div>
              <div className="rounded-xl border border-border/80 bg-background/55 p-4">
                <div className="text-2xl font-semibold">Expedition-first</div>
                <p className="mt-1 text-sm text-muted-foreground">Alpine, canyon, trail, snow, and wind objectives</p>
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-emerald-500/20 blur-3xl" />

            <div className="relative space-y-5">
              <div className="rounded-xl border border-border/80 bg-background/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Jordan M. | Expedition Dossier</p>
                    <p className="mt-1 text-xs text-muted-foreground">North Cascades and Rockies | Seattle</p>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                    Intermediate+
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border/70 bg-background/70 px-2 py-1.5">Kit: 60m rope, glacier kit, full rack</div>
                  <div className="rounded-md border border-border/70 bg-background/70 px-2 py-1.5">Objectives: alpine ridges, ice gullies, traverse runs</div>
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Expedition Brief</p>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                    Rope team slots: 2
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Alpine start for Eldorado NW Couloir. Seeking two partners with glacier navigation and crevasse rescue competency.</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1">
                    <CalendarDays className="h-3 w-3" /> Weather window: Sat 4:30 AM
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1">
                    <MapPin className="h-3 w-3" /> North Cascades
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1">
                    <Users className="h-3 w-3" /> Invite vetted partners
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-background/70 p-4">
                <p className="text-sm font-semibold">Rope team confidence</p>
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> 14 completed objectives with strong debrief feedback</p>
                  <p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-primary" /> 29 active expedition connections across alpine and ski crews</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-10 w-full max-w-7xl">
          <div className="flex flex-wrap gap-2">
            {activityPills.map((activity) => (
              <span
                key={activity}
                className="rounded-full border border-border/80 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground"
              >
                {activity}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="relative z-10 border-y border-border bg-secondary/35 px-6 py-16 md:px-12 md:py-24">
        <div className="mx-auto w-full max-w-7xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">How expeditions come together</h2>
          <p className="mt-3 max-w-[62ch] text-muted-foreground">
            This platform is built for objective-based planning. Surface relevant skills fast,
            align on logistics, and assemble the right team before committing to the route.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-border bg-card/70 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step 1</p>
              <h3 className="mt-2 text-lg font-semibold">Build your expedition profile</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Add your experience level, terrain comfort, and available gear so others can
                plan safely and quickly.
              </p>
            </article>

            <article className="rounded-2xl border border-border bg-card/70 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step 2</p>
              <h3 className="mt-2 text-lg font-semibold">Publish objective briefs</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Launch a day plan with date, location, and objective details, then invite your
                crew or open it to qualified members.
              </p>
            </article>

            <article className="rounded-2xl border border-border bg-card/70 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step 3</p>
              <h3 className="mt-2 text-lg font-semibold">Grow a dependable rope team network</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Every completed outing strengthens your connection graph so future plans get
                faster, safer, and more fun.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="activities" className="relative z-10 px-6 py-16 md:px-12 md:py-24">
        <div className="mx-auto w-full max-w-7xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Objective types</h2>
          <p className="mt-3 max-w-[62ch] text-muted-foreground">
            Find partners by terrain, seriousness, and pace, from conditioning runs to full expedition pushes.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Rock and Alpine",
                detail: "Crag days, multipitch pushes, glacier approaches",
                icon: Mountain,
              },
              {
                title: "Run and Ride",
                detail: "Trail conditioning, road blocks, gravel linkups",
                icon: Bike,
              },
              {
                title: "Water and Wind",
                detail: "Canyons, paddling windows, parasailing crews",
                icon: Waves,
              },
              {
                title: "Snow",
                detail: "Backcountry ski, splitboard, winter traverse plans",
                icon: Snowflake,
              },
            ].map((item) => (
              <article key={item.title} className="rounded-2xl border border-border bg-card/70 p-5">
                <item.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="relative z-10 border-y border-border bg-secondary/35 px-6 py-16 md:px-12 md:py-24">
        <div className="mx-auto grid w-full max-w-7xl gap-8 md:grid-cols-[1fr_minmax(0,1.1fr)]">
          <div className="rounded-2xl border border-border bg-card/75 p-6">
            <h3 className="text-xl font-semibold">Built for mountain trust over time</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Strong mountain partnerships are earned over repeated objectives. Profiles and route history help
              members assess compatibility before committing to remote or consequential terrain.
            </p>
            <div className="mt-6 space-y-3">
              {trustSignals.map((signal) => (
                <div key={signal} className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/70 p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-sm text-muted-foreground">{signal}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/75 p-6">
            <h3 className="text-xl font-semibold">From first day out to trusted expedition circle</h3>
            <div className="mt-5 space-y-4">
              {[
                {
                  title: "Create your expedition profile",
                  text: "Experience, kit, objective style",
                },
                {
                  title: "Join or host objective briefs",
                  text: "Find partners by terrain, risk, and location",
                },
                {
                  title: "Repeat with the right team",
                  text: "Trust compounds with each successful outing",
                },
              ].map((step, i) => (
                <div key={step.title} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                Local-first route discovery
              </p>
              <p className="mt-2">Filter by region and objective to find partners near your trailhead, crag, pass, or launch zone.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-6 py-16 md:px-12 md:py-24">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-border bg-card/80 p-8 text-center md:p-12">
          <p className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/60 px-4 py-1.5 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-primary" />
            Expedition community
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
            Your next trusted partner may already be tracking the same weather window.
          </h2>
          <p className="mx-auto mt-4 max-w-[58ch] text-muted-foreground">
            Join Social Active App, publish your mountain background, and plan objectives with
            people who match your standards for safety, commitment, and pace.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Register now
            </button>
            <button
              type="button"
              onClick={() => scrollTo("how")}
              className="rounded-lg border border-border bg-background/60 px-6 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              Explore features
            </button>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border px-6 py-10 md:px-12">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>Social Active App | Outdoor events, profiles, and trusted crews.</p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => scrollTo("how")} className="hover:text-foreground transition-colors">
              How it works
            </button>
            <button type="button" onClick={() => scrollTo("trust")} className="hover:text-foreground transition-colors">
              Trust network
            </button>
            <button type="button" onClick={onSignIn} className="hover:text-foreground transition-colors">
              Sign in
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
