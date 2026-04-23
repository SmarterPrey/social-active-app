import React, { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  confirmResetPassword,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut,
} from "aws-amplify/auth";
import { Icons, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/types/types";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore, useCredentialStore } from "@/store/useAuthStore";
import type { AppRole } from "@/store/useAuthStore";

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {}

export function UserAuthForm({ className, ...props }: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState<boolean>(false);

  const refUser = useRef<HTMLInputElement>(null);
  const refPassword = useRef<HTMLInputElement>(null);
  const refEmail = useRef<HTMLInputElement>(null);
  const refCode = useRef<HTMLInputElement>(null);
  const refNewPassword = useRef<HTMLInputElement>(null);

  const [resetEmail, setResetEmail] = useState("");
  const { toast } = useToast();
  const setUser = useAuthStore((state) => state.setUser);
  const setIsAuthenticated = useAuthStore((state) => state.setIsAuthenticated);
  const setSignInStep = useAuthStore((state) => state.setSignInStep);
  const setAllowedMfaTypes = useAuthStore((state) => state.setAllowedMfaTypes);
  const setMfaCodeDestination = useAuthStore(
    (state) => state.setMfaCodeDestination,
  );
  const setCredential = useCredentialStore((state) => state.setCredential);
  const setRoles = useAuthStore((state) => state.setRoles);
  const navigate = useNavigate();
  const onSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsLoading(true);
    if (!refUser.current?.value) {
      return;
    }
    if (!refPassword.current?.value) {
      return;
    }

    const username = refUser.current!.value;
    const password = refPassword.current!.value;
    try {
      await signOut({ global: true });

      const { nextStep, isSignedIn } = await signIn({
        username,
        password,
      });

      setUser(username);
      setSignInStep(nextStep.signInStep);

      // ── Handle additional sign-in challenges ──────────────────────────
      // Cognito tells us what's required next via `nextStep.signInStep`.
      // For MFA we stash the allowed types / masked destination so the
      // MFA form can prompt the user. Navigation continues only when
      // the session is fully signed in.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ns = nextStep as any;
      const mfaSteps = new Set([
        "CONTINUE_SIGN_IN_WITH_MFA_SELECTION",
        "CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION",
        "CONFIRM_SIGN_IN_WITH_SMS_CODE",
        "CONFIRM_SIGN_IN_WITH_EMAIL_CODE",
        "CONFIRM_SIGN_IN_WITH_TOTP_CODE",
        "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED",
      ]);

      if (mfaSteps.has(nextStep.signInStep)) {
        setAllowedMfaTypes(
          (ns.allowedMFATypes ?? ns.allowedMfaTypes ?? []) as string[],
        );
        setMfaCodeDestination(
          (ns.codeDeliveryDetails?.destination as string | undefined) ?? "",
        );
        setIsLoading(false);
        return;
      }

      if (isSignedIn) {
        const { username: u } = await getCurrentUser();
        setUser(u);
        setIsAuthenticated(isSignedIn);
        const { credentials, tokens } = await fetchAuthSession();
        setCredential(credentials);
        const groups = (tokens?.idToken?.payload["cognito:groups"] as AppRole[]) ?? [];
        setRoles(groups);

        toast({
          title: "Success",
          description: "Sign-in was successful",
        });
        navigate({ to: "/" });
      }
    } catch (error) {
      console.log(error);
      const errorMessage = error as ErrorMessage;
      toast({
        variant: "destructive",
        title: "Sign-in error",
        description: errorMessage.message,
      });
      setIsLoading(false);
    }
  };

  const onSubmitReset = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      await resetPassword({
        username: refEmail.current!.value,
      });
      setIsOpen(!isOpen);
      setIsLoading(false);
      setResetEmail(refEmail.current!.value);
      setIsRecoveryOpen(!isRecoveryOpen);
    } catch (error) {
      setIsLoading(false);
      const errorMessage = error as ErrorMessage;
      toast({
        variant: "destructive",
        title: "Failed to reset password",
        description: errorMessage.message,
      });
    }
  };

  const onSubmitRecovery = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      await confirmResetPassword({
        username: resetEmail,
        confirmationCode: refCode.current!.value,
        newPassword: refNewPassword.current!.value,
      });
      setIsRecoveryOpen(!isRecoveryOpen);
      setIsLoading(false);
      toast({
        title: "Reset password successfully",
        description: "Try to sign in with your new password",
      });
    } catch (error) {
      setIsLoading(false);
      const errorMessage = error as ErrorMessage;
      toast({
        variant: "destructive",
        title: "Failed to reset password",
        description: errorMessage.message,
      });
    }
  };

  return (
    <div className={cn("grid gap-6", className)} {...props}>
      {!isOpen && !isRecoveryOpen && (
        <>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-2 ">
              <Label htmlFor="email" className="text-left">
                Email Address
              </Label>
              <Input
                id="user"
                placeholder="you@example.com"
                type="email"
                required={true}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect="off"
                disabled={isLoading}
                ref={refUser}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-left" htmlFor="password">
                Password
              </Label>
              <Input
                id="password"
                placeholder="Your password"
                type="password"
                autoCorrect="off"
                required={true}
                disabled={isLoading}
                ref={refPassword}
              />
              <Button type="submit" disabled={isLoading} className="mt-[10px]">
                {isLoading && (
                  <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                )}
                Sign in
              </Button>
            </div>
          </form>
          <Button
            variant="ghost"
            type="button"
            disabled={isLoading}
            onClick={() => setIsOpen(true)}
            className="mt-2 text-muted-foreground hover:text-muted-foreground hover:bg-transparent px-0 h-auto py-1 text-sm font-normal"
          >
            Reset your password
          </Button>
        </>
      )}

      {isOpen && !isRecoveryOpen && (
        <form onSubmit={onSubmitReset}>
          <div className="grid gap-2">
            <h1 className="text-[26px] font-semibold tracking-tight text-card-foreground text-center mb-6">
              Password Reset
            </h1>
            <div className="grid gap-1">
              <Label className="sr-only" htmlFor="email">
                Email
              </Label>
              <Input
                id="email"
                placeholder="sample@example.com"
                type="email"
                required={true}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect="off"
                disabled={isLoading}
                ref={refEmail}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmitReset(e); } }}
              />
            </div>
            <Button type="submit" disabled={isLoading}>
              {isLoading && (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-muted-foreground hover:bg-transparent px-0 h-auto py-1 text-sm font-normal"
            >
              Back to sign in
            </Button>
          </div>
        </form>
      )}

      {isRecoveryOpen && (
        <form onSubmit={onSubmitRecovery}>
          <div className="grid gap-2">
            <div className="grid gap-1">
              <Label className="sr-only" htmlFor="code">
                Email
              </Label>
              <Input
                id="code"
                placeholder="Your code from your email"
                type="text"
                required={true}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={isLoading}
                ref={refCode}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmitRecovery(e); } }}
              />
              <Label className="sr-only" htmlFor="new_password">
                Password
              </Label>
              <Input
                id="new_password"
                placeholder="Your new password"
                type="password"
                autoCorrect="off"
                required={true}
                disabled={isLoading}
                ref={refNewPassword}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmitRecovery(e); } }}
              />
            </div>
            <Button type="submit" disabled={isLoading}>
              {isLoading && (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
