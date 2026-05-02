'use client';

import dynamic from 'next/dynamic';

const DictionaryApp = dynamic(() => import('@/components/DictionaryApp'), {
  ssr: false,
});

export default function Home() {
  return <DictionaryApp />;
}
