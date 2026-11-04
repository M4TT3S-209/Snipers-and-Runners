import { CONFIG } from '@scope-rush/shared';

/** Leben als Herzen (Halbherzen möglich). */
export function Hearts({ hp, small = false }: { hp: number; small?: boolean }) {
  const hearts = CONFIG.runner.hp / 2;
  const items = [];
  for (let i = 0; i < hearts; i++) {
    const left = hp - i * 2;
    const state = left >= 2 ? 'full' : left === 1 ? 'half' : 'empty';
    items.push(<span key={i} class={`heart ${state}`} />);
  }
  return <span class={`hearts ${small ? 'small' : ''}`}>{items}</span>;
}
