import Workspace from './workspace';
import { analyze } from '@/lib/engine';
export default function Home() {
  return (
    <Workspace
      initialReport={analyze('分析本周销售变化，并给出补货建议', 'GZ001')}
    />
  );
}
