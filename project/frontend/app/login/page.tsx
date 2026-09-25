import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-4">Login</h1>
      <p className="text-muted-foreground mb-4">Sign in to your StackPrep account.</p>
      <Link href="/signup" className="text-blue-500 hover:underline">
        Don&apos;t have an account? Sign up
      </Link>
    </div>
  );
}
