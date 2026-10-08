import { Link } from "react-router";
import { Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Route guard for admin-only surfaces. Non-admins (and logged-out
 * visitors) get a restricted notice instead of the page — model
 * internals are proprietary and never render client-side for them.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-md pt-10 text-center">
        <Shield className="mx-auto h-8 w-8 text-warn" />
        <h2 className="mt-4 text-2xl font-extrabold">ADMIN ACCESS REQUIRED</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Model internals are restricted to platform administrators.
        </p>
        <Link to="/" className="mt-6 inline-block font-mono2 text-xs text-primary hover:underline">
          ← BACK TO TERMINAL
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
