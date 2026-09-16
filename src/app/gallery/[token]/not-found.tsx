import { Noto_Serif, Outfit } from "next/font/google";

const notoSerif = Noto_Serif({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-gallery-serif" });
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-gallery-sans" });

export default function GalleryNotFound() {
  return (
    <div className={`${notoSerif.variable} ${outfit.variable} min-h-screen bg-white`}>
      <main className="max-w-5xl mx-auto px-6 py-12 flex flex-col items-center gap-2 font-[family-name:var(--font-gallery-sans)] text-[#181A1C]">
        <div className="font-[family-name:var(--font-gallery-serif)] font-bold text-4xl sm:text-5xl tracking-tight">Hahn Media</div>
        <div className="text-xs uppercase tracking-[0.3em] text-[#181A1C]/70">Real Estate Photo &amp; Video</div>
        <div className="w-full h-px bg-[#181A1C]/10 my-6" />
        <p className="text-[#181A1C]/60 text-center py-16">This gallery link isn&rsquo;t valid — double-check it with your photographer.</p>
      </main>
    </div>
  );
}
