import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { GraphConstellation } from "@/components/LandingPage";

export const Route = createFileRoute("/_auth/apply")({
  component: ApplyPage,
});

// ── validation ──────────────────────────────────────────────────────────────
const EMAIL_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Normalize a human-entered phone to E.164 (US default). */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

interface FormState {
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
}

type Channel = "email" | "phone";
type ChannelState = "idle" | "sending" | "sent" | "verified";

function ApplyPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>({
    name: "",
    company: "",
    role: "",
    email: "",
    phone: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>(
    {},
  );
  const [emailState, setEmailState] = useState<ChannelState>("idle");
  const [phoneState, setPhoneState] = useState<ChannelState>("idle");
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const patch = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => ({ ...prev, [k]: undefined }));
    // Re-entering an email/phone invalidates a prior verification.
    if (k === "email") setEmailState("idle");
    if (k === "phone") setPhoneState("idle");
  };

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = "Required";
    if (!form.company.trim()) next.company = "Required";
    if (!form.role.trim()) next.role = "Required";
    if (!EMAIL_RE.test(form.email.trim()))
      next.email = "Enter a valid email address";
    if (!normalizePhone(form.phone))
      next.phone = "Enter a valid phone number (include country code)";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function sendCode(channel: Channel) {
    if (channel === "email" && !EMAIL_RE.test(form.email.trim())) {
      setErrors((p) => ({ ...p, email: "Enter a valid email first" }));
      return;
    }
    if (channel === "phone" && !normalizePhone(form.phone)) {
      setErrors((p) => ({ ...p, phone: "Enter a valid phone number first" }));
      return;
    }
    if (channel === "email") setEmailState("sending");
    else setPhoneState("sending");

    // TODO: POST to a backend verification endpoint (SES for email, SNS for SMS).
    // For now, simulate a send — the user will enter any 6-digit code to "verify".
    await new Promise((r) => setTimeout(r, 600));

    if (channel === "email") setEmailState("sent");
    else setPhoneState("sent");
    toast({
      title: `Code sent via ${channel === "email" ? "email" : "SMS"}`,
      description: "Enter the 6-digit code to confirm.",
    });
  }

  function verifyCode(channel: Channel) {
    const code = channel === "email" ? emailCode : phoneCode;
    if (!/^\d{6}$/.test(code)) {
      toast({
        title: "Invalid code",
        description: "Enter the 6-digit code from the message.",
      });
      return;
    }
    // TODO: POST code to backend verification endpoint. For now accept any 6-digit.
    if (channel === "email") setEmailState("verified");
    else setPhoneState("verified");
    toast({ title: `${channel === "email" ? "Email" : "Phone"} verified` });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (emailState !== "verified") {
      toast({
        title: "Verify your email",
        description: "We need to confirm ownership before submitting.",
      });
      return;
    }
    if (phoneState !== "verified") {
      toast({
        title: "Verify your phone",
        description: "We need to confirm ownership before submitting.",
      });
      return;
    }

    setSubmitting(true);
    // TODO: POST application to backend (creates a Lead / pending Member vertex).
    await new Promise((r) => setTimeout(r, 600));
    setSubmitting(false);

    toast({
      title: "Thanks — we'll be in touch",
      description:
        "Our team will reach out to continue the conversation.",
    });
    navigate({ to: "/signin" });
  }

  const ChannelBadge = ({ state }: { state: ChannelState }) => {
    if (state === "verified")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" /> Verified
        </span>
      );
    if (state === "sending")
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…
        </span>
      );
    return null;
  };

  return (
    <div className="public-page relative w-dvw min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="absolute inset-0 pointer-events-none">
        <GraphConstellation />
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/signin" })}
        className="absolute top-5 left-6 z-20 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to sign in
      </button>

      <div
        role="presentation"
        onClick={() => navigate({ to: "/signin" })}
        className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-16"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-title"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[520px] animate-fade-in rounded-2xl bg-card border border-border p-8 shadow-2xl"
        >
          <div className="mb-6">
            <h1
              id="apply-title"
              className="text-xl font-semibold tracking-tight text-card-foreground"
            >
              Contact us
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Social Active App is invitation only. Share your details below and
              our team will reach out to continue the conversation.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => patch("name", e.target.value)}
                  aria-invalid={!!errors.name}
                />
                {errors.name && (
                  <p className="text-xs text-destructive">{errors.name}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  autoComplete="organization"
                  value={form.company}
                  onChange={(e) => patch("company", e.target.value)}
                  aria-invalid={!!errors.company}
                />
                {errors.company && (
                  <p className="text-xs text-destructive">{errors.company}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role">Role / title</Label>
              <Input
                id="role"
                autoComplete="organization-title"
                placeholder="CISO, VP Security, Head of Platform, …"
                value={form.role}
                onChange={(e) => patch("role", e.target.value)}
                aria-invalid={!!errors.role}
              />
              {errors.role && (
                <p className="text-xs text-destructive">{errors.role}</p>
              )}
            </div>

            {/* ── email + verification ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="email">Email</Label>
                <ChannelBadge state={emailState} />
              </div>
              <div className="flex gap-2">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => patch("email", e.target.value)}
                  aria-invalid={!!errors.email}
                  disabled={emailState === "verified"}
                />
                {emailState !== "verified" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => sendCode("email")}
                    disabled={emailState === "sending"}
                  >
                    {emailState === "sent" ? "Resend" : "Send code"}
                  </Button>
                )}
              </div>
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email}</p>
              )}
              {emailState === "sent" && (
                <div className="flex gap-2 pt-1">
                  <Input
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={emailCode}
                    onChange={(e) =>
                      setEmailCode(e.target.value.replace(/\D/g, ""))
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => verifyCode("email")}
                  >
                    Verify
                  </Button>
                </div>
              )}
            </div>

            {/* ── phone + verification ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="phone">Mobile phone</Label>
                <ChannelBadge state={phoneState} />
              </div>
              <div className="flex gap-2">
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+1 555 123 4567"
                  value={form.phone}
                  onChange={(e) => patch("phone", e.target.value)}
                  aria-invalid={!!errors.phone}
                  disabled={phoneState === "verified"}
                />
                {phoneState !== "verified" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => sendCode("phone")}
                    disabled={phoneState === "sending"}
                  >
                    {phoneState === "sent" ? "Resend" : "Send SMS"}
                  </Button>
                )}
              </div>
              {errors.phone && (
                <p className="text-xs text-destructive">{errors.phone}</p>
              )}
              {phoneState === "sent" && (
                <div className="flex gap-2 pt-1">
                  <Input
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={phoneCode}
                    onChange={(e) =>
                      setPhoneCode(e.target.value.replace(/\D/g, ""))
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => verifyCode("phone")}
                  >
                    Verify
                  </Button>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Contact me"
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground pt-1">
              We'll only use your contact details to respond to this inquiry.
            </p>

            <p className="text-center text-xs text-muted-foreground pt-2">
              Already a member?{" "}
              <button
                type="button"
                onClick={() => navigate({ to: "/signin" })}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
              >
                Sign in
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
