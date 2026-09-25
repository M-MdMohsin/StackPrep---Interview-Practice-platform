import Link from 'next/link';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-4">Sign Up</h1>
      <p className="text-muted-foreground mb-4">Create your StackPrep account.</p>
      <Link href="/login" className="text-blue-500 hover:underline">
        Already have an account? Log in
      </Link>
    </div>
  );
}
