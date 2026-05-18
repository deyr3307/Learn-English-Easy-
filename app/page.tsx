'use client';
import { useState } from 'react';

import dynamic from 'next/dynamic';

const DictionaryApp = dynamic(() => import('@/components/DictionaryApp'), {
  ssr: false,
});

export default function Home() {
  const [showIntro, setShowIntro] = useState(true);

  if (!showIntro) {
    return <DictionaryApp />;
  }

  return (
    <div 
      onClick={() => setShowIntro(false)}
      className="min-h-screen bg-[#e8fbf3] flex flex-col items-center justify-center cursor-pointer transition-all duration-500"
    >
      {/* Bouncing Leaf Logo */}
      <div className="mb-6 animate-bounce">
        <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#2b5f4c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path>
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path>
        </svg>
      </div>

      {/* Fade Up Text Animation */}
      <style>{`
        @keyframes fadeUp {
          0% { opacity: 0; transform: translateY(40px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeUp {
          animation: fadeUp 1s ease-out forwards;
        }
      `}</style>
      
      <h1 className="text-5xl md:text-7xl font-black text-[#1a362d] tracking-tighter text-center animate-fadeUp uppercase" style={{ textShadow: "3px 3px 0px #4ade80", lineHeight: "1.1" }}>
        Learn English<br/>Easy
      </h1>
      
      <p className="mt-12 text-[#2b5f4c] font-bold animate-pulse tracking-widest text-sm bg-white/50 px-5 py-2 rounded-full shadow-sm">
        TAP ANYWHERE TO START
      </p>
    </div>
  );
}

