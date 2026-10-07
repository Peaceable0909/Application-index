'use client';
import { useEffect, useState } from 'react';

export default function Greeting({ name }: { name: string }) {
  const [g, setG] = useState('Welcome back');
  useEffect(() => { const h = new Date().getHours(); setG(h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'); }, []);
  return <h1 className="st-h1" suppressHydrationWarning>{g}, <em>{name}</em></h1>;
}
