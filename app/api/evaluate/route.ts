import { evaluate } from '@/lib/engine';
export async function POST() {
  return Response.json(evaluate());
}
