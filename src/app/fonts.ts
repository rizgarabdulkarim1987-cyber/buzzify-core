import { Bodoni_Moda, Hanken_Grotesk, Noto_Naskh_Arabic } from 'next/font/google';

export const bodoni = Bodoni_Moda({ subsets: ['latin'], variable: '--font-bodoni', display: 'swap', axes: ['opsz'] });
export const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' });
export const naskh = Noto_Naskh_Arabic({ subsets: ['arabic'], variable: '--font-naskh', display: 'swap' });

export const fontVariables = `${bodoni.variable} ${hanken.variable} ${naskh.variable}`;
