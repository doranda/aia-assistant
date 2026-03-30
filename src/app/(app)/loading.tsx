export default function AppLoading() {
  return (
    <main className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
      <p className="text-sm text-zinc-500">Loading...</p>
    </main>
  );
}
