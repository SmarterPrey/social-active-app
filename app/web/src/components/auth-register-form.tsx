import React, { useRef, useState } from "react";
import { signUp, confirmSignUp, autoSignIn } from "aws-amplify/auth";
import { Icons, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ErrorMessage } from "@/types/types";

interface UserRegisterFormProps extends React.HTMLAttributes<HTMLDivElement> {
  onRegistered?: () => void;
}

export function UserRegisterForm({
  className,
  onRegistered,
  ...props
}: UserRegisterFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [registeredUsername, setRegisteredUsername] = useState("");

  const refEmail = useRef<HTMLInputElement>(null);
  const refPassword = useRef<HTMLInputElement>(null);
  const refConfirmPassword = useRef<HTMLInputElement>(null);
  const refCode = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  const onSubmitRegister = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsLoading(true);

    const email = refEmail.current?.value;
    const password = refPassword.current?.value;
    const confirmPassword = refConfirmPassword.current?.value;

    if (!email || !password || !confirmPassword) {
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords do not match",
        description: "Please ensure both passwords are identical",
      });
      setIsLoading(false);
      return;
    }

    try {
      const { nextStep } = await signUp({
        username: email,
        password,
        options: {
          userAttributes: { email },
          autoSignIn: true,
        },
      });

      if (nextStep.signUpStep === "CONFIRM_SIGN_UP") {
        setRegisteredUsername(email);
        setNeedsConfirmation(true);
        toast({
          title: "Verification code sent",
          description: "Check your email for a confirmation code",
        });
      } else if (nextStep.signUpStep === "DONE") {
        toast({ title: "Account created successfully" });
        onRegistered?.();
      }
    } catch (error) {
      const errorMessage = error as ErrorMessage;
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: errorMessage.message || "An error occurred during registration",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitConfirmation = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsLoading(true);

    const code = refCode.current?.value;
    if (!code) {
      setIsLoading(false);
      return;
    }

    try {
      const { nextStep } = await confirmSignUp({
        username: registeredUsername,
        confirmationCode: code,
      });

      if (nextStep.signUpStep === "DONE") {
        toast({ title: "Email verified" });
        try {
          await autoSignIn();
        } catch {
          // auto sign-in may not always work, fall back to manual sign-in
        }
        onRegistered?.();
      }
    } catch (error) {
      const errorMessage = error as ErrorMessage;
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: errorMessage.message || "Invalid or expired code",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (needsConfirmation) {
    return (
      <div className={cn("grid gap-6", className)} {...props}>
        <form onSubmit={onSubmitConfirmation} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="confirmation-code" className="text-left">
              Confirmation code
            </Label>
            <Input
              id="confirmation-code"
              placeholder="Enter the 6-digit code from your email"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              disabled={isLoading}
              ref={refCode}
            />
          </div>
          <Button disabled={isLoading} className="w-full">
            {isLoading && (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            Verify email
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-6", className)} {...props}>
      <form onSubmit={onSubmitRegister} className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="reg-email" className="text-left">
            Email Address
          </Label>
          <Input
            id="reg-email"
            placeholder="you@example.com"
            type="email"
            required
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            disabled={isLoading}
            ref={refEmail}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="reg-password" className="text-left">
            Password
          </Label>
          <Input
            id="reg-password"
            placeholder="Min 8 chars, uppercase, digit, symbol"
            type="password"
            required
            disabled={isLoading}
            ref={refPassword}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="reg-confirm-password" className="text-left">
            Confirm password
          </Label>
          <Input
            id="reg-confirm-password"
            placeholder="Re-enter your password"
            type="password"
            required
            disabled={isLoading}
            ref={refConfirmPassword}
          />
        </div>
        <Button disabled={isLoading} className="w-full">
          {isLoading && (
            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
          )}
          Create account
        </Button>
      </form>
    </div>
  );
}
