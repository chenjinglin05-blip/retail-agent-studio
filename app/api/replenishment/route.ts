import { backendRequest, readObject } from '@/lib/backend-proxy';

export async function GET() {
  return backendRequest('/api/replenishment/history');
}

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    if (
      typeof body.query !== 'string' ||
      body.query.trim().length < 2 ||
      body.query.length > 500 ||
      Object.keys(body).some((k) => k !== 'query')
    ) {
      return Response.json(
        { error: '请输入2到500字的问题。' },
        { status: 400 },
      );
    }
    return backendRequest('/api/replenishment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: body.query.trim() }),
    });
  } catch {
    return Response.json(
      { error: '请求格式有误或内容过长。' },
      { status: 400 },
    );
  }
}
