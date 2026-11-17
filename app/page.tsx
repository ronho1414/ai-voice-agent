export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 pb-48">
      <p className="text-sm opacity-60">Voice</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        AI Voice Agent
      </h1>
      <p className="mt-4 leading-7 opacity-80">
        Cantonese, Mandarin, and English. The microphone plays a short opener
        from memory, then continues with the answer. Clip config, the site
        map, and the clinic knowledge base are in this repo.
      </p>
    </main>
  );
}
