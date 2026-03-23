import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-[radial-gradient(ellipse,rgba(196,18,48,0.12)_0%,rgba(196,18,48,0.04)_40%,transparent_70%)] blur-[60px]" />
      </div>

      <div className="relative w-full max-w-[380px] space-y-8">
        {/* Logo */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-10 h-10 rounded-lg bg-gradient-to-br from-ruby-9 to-ruby-10 shadow-[0_0_20px_rgba(196,18,48,0.3)]" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-12">
              Knowledge Hub
            </h1>
            <p className="text-sm text-gray-9 mt-1">
              Sign in to access your team&apos;s product intelligence
            </p>
          </div>
        </div>

        <LoginForm />

        <p className="text-center text-xs text-gray-8">
          Contact your team admin for an account
        </p>
      </div>
    </div>
  );
}
