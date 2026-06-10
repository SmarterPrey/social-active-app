import { ReactNode, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Settings,
  LogOut,
  Activity,
  Calendar,
  Store,
  Users,
  Network,
  Search,
  Shield,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "aws-amplify/auth";
import { useAuthStore, useHasRole } from "@/store/useAuthStore";

type IconType = typeof Home;

function TopNavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: IconType;
  label: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = pathname === to || (to !== "/" && pathname.startsWith(to));

  return (
    <Link
      to={to}
      className={`group relative flex h-14 min-w-[72px] flex-col items-center justify-center px-3 text-[11px] font-normal transition-colors ${
        isActive
          ? "text-foreground"
          : "text-sidebar-foreground hover:text-foreground"
      }`}
    >
      <Icon
        className="h-5 w-5"
        strokeWidth={isActive ? 2.25 : 1.75}
        aria-hidden
      />
      <span className="mt-0.5 leading-none">{label}</span>
      <span
        className={`absolute inset-x-0 bottom-0 h-[2px] bg-foreground transition-opacity ${
          isActive ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />
    </Link>
  );
}

export const MainLayout = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const canEdit = useHasRole("Admin", "Editor");
  const isAdmin = useHasRole("Admin");
  const user = useAuthStore((state) => state.user);
  const setIsAuthenticated = useAuthStore((state) => state.setIsAuthenticated);
  const [searchQuery, setSearchQuery] = useState("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    // Feed-first behavior: land on home with the query; the feed filters by it.
    navigate({
      to: "/",
      search: (q ? { q } : {}) as never,
    } as never);
  };

  const submitSignOut = async () => {
    try {
      await signOut();
      setIsAuthenticated(false);
      navigate({ to: "/" });
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
        <div className="mx-auto flex h-14 w-full max-w-[1128px] items-center gap-3 px-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-primary"
            aria-label="Social Active App — home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Shield className="h-4.5 w-4.5" strokeWidth={2.25} />
            </span>
          </Link>

          <label className="relative hidden flex-1 max-w-xs sm:block">
            <span className="sr-only">Search</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <form onSubmit={submitSearch}>
              <input
                type="search"
                placeholder="Search the feed…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-md bg-[hsl(210,16%,93%)] pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </form>
          </label>

          <nav className="ml-auto flex items-stretch">
            <TopNavItem to="/" icon={Home} label="Feed" />
            <TopNavItem to="/events" icon={Calendar} label="Events" />
            <TopNavItem to="/vendors" icon={Store} label="Vendors" />
            <TopNavItem to="/members" icon={Users} label="Members" />

            {(isAdmin || canEdit) && (
              <span className="mx-1 my-3 w-px bg-sidebar-border" aria-hidden />
            )}

            {isAdmin && (
              <TopNavItem to="/graph" icon={Network} label="Graph" />
            )}
            {canEdit && (
              <TopNavItem to="/monitoring" icon={Activity} label="Monitoring" />
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                className="group flex h-14 min-w-[72px] flex-col items-center justify-center px-2 text-[11px] text-sidebar-foreground hover:text-foreground focus:outline-none"
                aria-label="Account menu"
              >
                <Avatar name={user ?? "You"} size="sm" className="h-6 w-6 text-[10px]" />
                <span className="mt-0.5 leading-none">Me ▾</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-semibold">{user ?? "Signed in"}</div>
                  <div className="text-xs text-muted-foreground">
                    Manage your profile
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => submitSignOut()}
                  className="flex items-center gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      <main className="flex-1 animate-fade-in">{children}</main>
    </div>
  );
};
