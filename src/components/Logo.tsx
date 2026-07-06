import logoUrl from "@/assets/nanjil-logo.png";

export function Logo({ className = "h-10" }: { className?: string }) {
  return (
    <img src={logoUrl} alt="Nanjil Integrated Dairy Development" className={className} />
  );
}
