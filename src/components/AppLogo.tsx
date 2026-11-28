import { useEffect, useState } from 'react';

interface AppLogoProps {
  src?: string;
  alt?: string;
  sizeClass?: string;
}

export function AppLogo({
  src = '/src/assets/images/kir_ipa_logo_1795216569338.jpg',
  alt = 'Logo KIR IPA SMAN 1 Sukabumi',
  sizeClass = 'w-10 h-10',
}: AppLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div
        className={`${sizeClass} rounded-lg bg-[#0F294A] text-amber-400 flex items-center justify-center font-display font-bold border border-amber-500/40 shrink-0`}
        aria-label={alt}
      >
        KIR
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${sizeClass} rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0`}
    />
  );
}
