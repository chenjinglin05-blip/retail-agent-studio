import { backendRequest, readObject } from '@/lib/backend-proxy';

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const keys = ['daily', 'stock', 'inbound', 'lead_days', 'safety_days'];
    if (
      Object.keys(body).some((k) => !keys.includes(k)) ||
      keys.some((k) => typeof body[k] !== 'number' || !Number.isFinite(body[k]))
    ) {
      return Response.json({ error: '请填写五项有效数字。' }, { status: 400 });
    }
    return backendRequest('/api/replenishment/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return Response.json(
      { error: '请求格式有误或内容过长。' },
      { status: 400 },
    );
  }
}
