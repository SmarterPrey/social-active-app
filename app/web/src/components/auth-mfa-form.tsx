import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  rememberDevice,
} from "aws-amplify/auth";
import { Mail, Phone, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore, useCredentialStore } from "@/store/useAuthStore";
import type { AppRole } from "@/store/useAuthStore";
import type { ErrorMessage } from "@/types/types";
import { Icons } from "@/lib/utils";

/**
 * Confirms the MFA challenge raised by Cognito after a password sign-in.
 *
 * Cognito presents this challenge on:
 *  - first sign-in when MFA is OPTIONAL/ON and the user hasn't enrolled yet
 *    (`CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION`)
 *  - sign-ins from a new/unremembered device (`CONTINUE_SIGN_IN_WITH_MFA_SELECTION`
 *    then `CONFIRM_SIGN_IN_WITH_{SMS,EMAIL}_CODE`)
 *
 * Trusted devices are remembered via `rememberDevice()` after the challenge
 * succeeds, so the next sign-in from the same browser skips MFA entirely.
 */
export function UserMfaForm() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const signInStep = useAuthStore((s) => s.signInStep);
  const allowedMfaTypes = useAuthStore((s) => s.allowedMfaTypes);
  const codeDestination = useAuthStore((s) => s.mfaCodeDestination);
  const setSignInStep = useAuthStore((s) => s.setSignInStep);
  const setAllowedMfaTypes = useAuthStore((s) => s.setAllowedMfaTypes);
  const setMfaCodeDestination = useAuthStore((s) => s.setMfaCodeDestination);
  const setIsAuthenticated = useAuthStore((s) => s.setIsAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const setRoles = useAuthStore((s) => s.setRoles);
  const setCredential = useCredentialStore((s) => s.setCredential);

  const [code, setCode] = useState("");
  const [rememberThisDevice, setRememberThisDevice] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const isSelection =
    signInStep === "CONTINUE_SIGN_IN_WITH_MFA_SELECTION" ||
    signInStep === "CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION";

  const channelLabel =
    signInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE"
      ? "text message"
      : signInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE"
        ? "email"
        : signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
          ? "authenticator app"
          : "verification";

  async function finishSignIn() {
    try {
      if (rememberThisDevice) {
        try {
          await rememberDevice();
        } catch (err) {
          // Non-fatal — user stays signed in, they'll just be challenged next time.
          console.warn("rememberDevice failed", err);
        }
      }
      const { username } = await getCurrentUser();
      const { credentials, tokens } = await fetchAuthSession();
      setUser(username);
      setIsAuthenticated(true);
      setCredential(credentials);
      const groups =
        (tokens?.idToken?.payload["cognito:groups"] as AppRole[]) ?? [];
      setRoles(groups);
      // Clear transient challenge state.
      setSignInStep("");
      setAllowedMfaTypes([]);
      setMfaCodeDestination("");
      toast({ title: "Success", description: "Sign-in was successful" });
      navigate({ to: "/" });
    } catch (error) {
      const msg = (error as ErrorMessage).message ?? "Sign-in failed";
      toast({ variant: "destructive", title: "Sign-in error", description: msg });
    }
  }

  async function handleSelect(choice: "SMS" | "EMAIL" | "TOTP") {
    setIsLoading(true);
    try {
      const out = await confirmSignIn({ challengeResponse: choice });
      const ns = out.nextStep;
      setSignInStep(ns.signInStep);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyNs = ns as any;
      setMfaCodeDestination(
        (anyNs.codeDeliveryDetails?.destination as string | undefined) ?? "",
      );
      if (out.isSignedIn) {
        await finishSignIn();
      }
    } catch (error) {
      const msg = (error as ErrorMessage).message ?? "Unable to continue";
      toast({ variant: "destructive", title: "MFA error", description: msg });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setIsLoading(true);
    try {
      const out = await confirmSignIn({ challengeResponse: code.trim() });
      if (out.isSignedIn) {
        await finishSignIn();
      } else {
        setSignInStep(out.nextStep.signInStep);
      }
    } catch (error) {
      const msg = (error as ErrorMessage).message ?? "Invalid code";
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: msg,
      });
    } finally {
      setIsLoading(false);
    }
  }

  if (isSelection) {
    const options = (allowedMfaTypes.length > 0
      ? allowedMfaTypes
      : ["EMAIL", "SMS"]
    ).filter((t) => t === "EMAIL" || t === "SMS" || t === "TOTP");
    return (
      <div className="space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-card-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Verify it's you
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We don't recognize this device. Choose where to send your one-time
            code.
          </p>
        </div>
        <div className="grid gap-2">
          {options.includes("EMAIL") && (
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() => handleSelect("EMAIL")}
              className="justify-start"
            >
              <Mail className="mr-2 h-4 w-4" /> Send code to email
            </Button>
          )}
          {options.includes("SMS") && (
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() => handleSelect("SMS")}
              className="justify-start"
            >
              <Phone className="mr-2 h-4 w-4" /> Send code by text message
            </Button>
          )}
          {options.includes("TOTP") && (
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() => handleSelect("TOTP")}
              className="justify-start"
            >
              <ShieldCheck className="mr-2 h-4 w-4" /> Use authenticator app
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleConfirm} className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-card-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" /> Enter your code
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We sent a one-time code to your {channelLabel}
          {codeDestination ? ` (${codeDestination})` : ""}. It's good for a few
          minutes.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mfa-code">Verification code</Label>
        <Input
          id="mfa-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          disabled={isLoading}
          autoFocus
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={rememberThisDevice}
          onChange={(e) => setRememberThisDevice(e.target.checked)}
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
        />
        Trust this device — don't ask again on this browser
      </label>
      <Button type="submit" disabled={isLoading || !code.trim()} className="w-full">
        {isLoading && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
        Verify and continue
      </Button>
    </form>
  );
}
