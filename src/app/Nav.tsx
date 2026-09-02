"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-3xl mx-auto w-full px-6 flex gap-1">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium px-3 py-3 border-b-2 -mb-px transition-colors ${
                active
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
