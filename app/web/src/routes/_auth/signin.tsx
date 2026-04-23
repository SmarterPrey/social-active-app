import { UserAuthForm } from "@/components/auth-form";
import { UserMfaForm } from "@/components/auth-mfa-form";
import { UserNewPasswordForm } from "@/components/auth-newpassword-form";
import { UserRegisterForm } from "@/components/auth-register-form";
import { useAuthStore } from "@/store/useAuthStore";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GraphConstellation } from "@/components/LandingPage";

export const Route = createFileRoute("/_auth/signin")({
  component: Signin,
});

/* ---------- main signin component ---------- */
interface SigninProps {
  onBack?: () => void;
}

export function Signin({ onBack }: SigninProps = {}) {
  const signInStep = useAuthStore((state) => state.signInStep);
  const getState = useAuthStore.getState();
  useEffect(() => {}, [getState]);

  const [view, setView] = useState<"signin" | "register">("signin");

  const isNewPassword =
    signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED";
  const isMfaChallenge =
    signInStep === "CONTINUE_SIGN_IN_WITH_MFA_SELECTION" ||
    signInStep === "CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION" ||
    signInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE" ||
    signInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" ||
    signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE";

  return (
    <div className="public-page relative w-dvw h-dvh overflow-hidden bg-background text-foreground">
      {/* background */}
      <div className="absolute inset-0">
        <GraphConstellation />
      </div>

      {/* back link */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute top-5 left-6 z-20 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
      )}

      {/* centered form */}
      <div className="relative z-10 flex h-full items-center justify-center px-6">
        <div className="w-full max-w-[420px] animate-fade-in rounded-2xl bg-card border border-border p-8 shadow-2xl">
          {/* form */}
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
          ) : isMfaChallenge ? (
            <div className="space-y-6">
              <UserMfaForm />
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
