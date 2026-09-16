function Bar({ className }: { className: string }) {
  return <div className={`bg-[#181A1C]/8 rounded animate-pulse ${className}`} />;
}

export default function GalleryLoading() {
  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col items-center gap-2">
        <Bar className="h-10 w-52" />
        <Bar className="h-3 w-40" />
        <div className="w-full h-px bg-[#181A1C]/10 my-6" />
        <Bar className="h-6 w-64" />
        <Bar className="h-4 w-20 mt-2" />
        <Bar className="h-10 w-40 mt-3 mb-8" />
        <div className="w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-lg bg-[#F9F4F1] animate-pulse" />
          ))}
        </div>
      </main>
    </div>
  );
}
