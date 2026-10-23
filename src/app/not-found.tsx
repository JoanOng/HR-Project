import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 px-8 py-16 text-center">
      <h1 className="text-3xl font-semibold">Not found</h1>
      <p className="mt-2 text-zinc-500">That record does not exist or is not in your scope.</p>
      <Link href="/employees" className="mt-4 inline-block text-blue-600 hover:underline">
        Back to employees
      </Link>
    </main>
  );
}